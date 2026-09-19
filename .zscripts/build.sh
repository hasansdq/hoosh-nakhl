#!/bin/bash

# 将 stderr 重定向到 stdout，避免 execute_command 因为 stderr 输出而报错
exec 2>&1

set -e

# 获取脚本所在目录（.zscripts 目录，即 workspace-agent/.zscripts）
# 使用 $0 获取脚本路径（兼容 sh 和 bash）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Next.js 项目路径
NEXTJS_PROJECT_DIR="/home/z/my-project"

# 检查 Next.js 项目目录是否存在
if [ ! -d "$NEXTJS_PROJECT_DIR" ]; then
    echo "❌ 错误: Next.js 项目目录不存在: $NEXTJS_PROJECT_DIR"
    exit 1
fi

echo "🚀 开始构建 Nakhl 餐厅应用（Cloudflare Workers 架构）..."
echo "📁 Next.js 项目路径: $NEXTJS_PROJECT_DIR"

# 切换到 Next.js 项目目录
cd "$NEXTJS_PROJECT_DIR" || exit 1

# 设置环境变量
export NEXT_TELEMETRY_DISABLED=1

BUILD_ID="${BUILD_ID:-manual}"
BUILD_DIR="/tmp/build_fullstack_$BUILD_ID"
echo "📁 清理并创建构建目录: $BUILD_DIR"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# ─────────────────────────────────────────────────────────────────────────────
# 1) 安装依赖
#    postinstall 自动执行 `prisma generate`（生成 D1/Workers 无引擎客户端）。
# ─────────────────────────────────────────────────────────────────────────────
echo "📦 安装依赖..."
bun install

# ─────────────────────────────────────────────────────────────────────────────
# 2) Cloudflare Workers 构建（@opennextjs/cloudflare 适配器）
#
#    `bun run cf:build` = prisma generate + `next build`（完整类型检查，
#    无 ignoreBuildErrors）+ OpenNext 打包，产出**完全自包含**的 worker：
#      • .open-next/worker.js  — Next 服务端 + 全部路由（运行时不再需要
#        应用的 node_modules）
#      • .open-next/assets     — 静态资源（public + .next/static）
#
#    应用架构：D1（数据库，Prisma + adapter-d1）/ R2（上传）/ Durable
#    Object（实时通知，替代 Socket.IO mini-service）。
# ─────────────────────────────────────────────────────────────────────────────
echo "🔨 构建 Cloudflare Workers 应用 (OpenNext)..."
bun run cf:build

# 部署成功率守卫：worker 入口必须存在（cf:build 失败时 set -e 会提前
# 退出，这里防御“静默成功”的情况）。
if [ ! -f ".open-next/worker.js" ]; then
    echo "❌ 构建失败：未生成 .open-next/worker.js（cf:build 出错，见上方日志）"
    exit 1
fi
echo "✅ OpenNext worker 已生成: .open-next/worker.js"

# ─────────────────────────────────────────────────────────────────────────────
# 3) 收集部署产物（目录结构与仓库一致，wrangler 配置原样可用）
# ─────────────────────────────────────────────────────────────────────────────
echo "📦 收集构建产物到 $BUILD_DIR..."

# 自定义 worker 入口 + Durable Object 源码（wrangler 启动时现场打包 TS）：
#   src/worker.js   → main：导出 NakhlRealtime 类（DO 绑定要求从 main 导出），
#                     并把 /api/ws 的 WebSocket 升级在进入 Next.js 之前路由到 DO
#   src/do/realtime.ts → DO 实现（零依赖、自包含，无任何 import）
mkdir -p "$BUILD_DIR/src/do"
cp src/worker.js "$BUILD_DIR/src/worker.js"
cp src/do/realtime.ts "$BUILD_DIR/src/do/realtime.ts"

# OpenNext 产物（worker + 静态资源）
echo "  - 复制 .open-next"
cp -r .open-next "$BUILD_DIR/.open-next"

# wrangler 配置（D1/R2/DO/assets/vars 绑定原样；main=src/worker.js）
cp wrangler.jsonc "$BUILD_DIR/wrangler.jsonc"

# D1 迁移 + 种子数据（容器首次启动时由 start.sh 应用，幂等）
echo "  - 复制 migrations + seed"
cp -r migrations "$BUILD_DIR/migrations"
mkdir -p "$BUILD_DIR/seed"
cp seed/*.sql "$BUILD_DIR/seed/"

# 复制 Caddyfile（如果存在）
if [ -f "Caddyfile" ]; then
    echo "  - 复制 Caddyfile"
    cp Caddyfile "$BUILD_DIR/"
fi

# 注：本项目实时通知走 Durable Object（worker 内），不再打包
# mini-services/notify-service（Socket.IO）—— 更小的包、更少的内存。

# ─────────────────────────────────────────────────────────────────────────────
# 4) wrangler 运行时工具链（wrangler + workerd + miniflare）
#    构建期安装并直接打进包里 → 部署容器冷启动**无需网络、无需 npm install**。
#    （约 260MB 未压缩 / ~70MB tar.gz）
# ─────────────────────────────────────────────────────────────────────────────
echo "🧰 安装 wrangler 运行时工具链..."
RUNTIME_DIR="$BUILD_DIR/runtime"
mkdir -p "$RUNTIME_DIR"
cat > "$RUNTIME_DIR/package.json" <<'EOF'
{
  "name": "nakhl-wrangler-runtime",
  "private": true,
  "dependencies": {
    "wrangler": "4.127.1"
  }
}
EOF
(cd "$RUNTIME_DIR" && bun install)

# 注：本项目为纯 JS/TS 应用（无 Python 源码依赖）—— 不执行
# python-runtime-build.sh。项目的 skills/ 目录只包含 AI 平台脚手架
# 脚本（.py），与应用运行时无关，不应打进部署包。

# 复制 start.sh 脚本（容器启动：D1 迁移+种子 → wrangler dev → Caddy 网关）
echo "  - 复制 start.sh"
cp "$SCRIPT_DIR/start.sh" "$BUILD_DIR/start.sh"
chmod +x "$BUILD_DIR/start.sh"

# ─────────────────────────────────────────────────────────────────────────────
# 5) 打包
# ─────────────────────────────────────────────────────────────────────────────
PACKAGE_FILE="${BUILD_DIR}.tar.gz"
echo ""
echo "📦 打包构建产物到 $PACKAGE_FILE..."
cd "$BUILD_DIR" || exit 1
tar -czf "$PACKAGE_FILE" .
cd - > /dev/null || exit 1

# 清理临时目录（保留 tar.gz）
rm -rf "$BUILD_DIR"

echo ""
echo "✅ 构建完成！所有产物已打包到 $PACKAGE_FILE"
echo "📊 打包文件大小:"
ls -lh "$PACKAGE_FILE"
