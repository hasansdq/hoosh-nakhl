#!/bin/sh

# Nakhl Restaurant — z-space 容器启动脚本（Cloudflare Workers 架构）
# ─────────────────────────────────────────────────────────────────────────────
# 部署包（由 .zscripts/build.sh 产出）内容：
#   .open-next/      自包含 OpenNext worker（Next 服务端 + 静态资源）
#   src/worker.js    main 入口：导出 NakhlRealtime DO + /api/ws WebSocket 升级路由
#   src/do/          Durable Object 实现（实时通知）
#   wrangler.jsonc   D1 / R2 / Durable Object 绑定（与 Cloudflare 生产一致）
#   migrations/seed  D1 建表 + 种子数据（幂等）
#   runtime/         wrangler + workerd 工具链（构建期已安装，冷启动免网络）
#
# 启动流程：
#   1. 应用本地 D1 迁移 + 种子（幂等；状态持久化在 ./.wrangler/state）
#   2. `wrangler dev` 在 **workerd 运行时**上运行 OpenNext worker —— 与
#      Cloudflare 生产完全同一运行时与绑定（D1 / R2 / Durable Object）。
#      实时通知由 Durable Object 处理（无需 Socket.IO mini-service）。
#      附带守护循环：wrangler 意外退出后 5 秒自动重启。
#   3. Caddy 网关作为前台主进程（:81 → 127.0.0.1:$PORT）。
# ─────────────────────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

export CI=true
export WRANGLER_SEND_METRICS=false
export PATH="$SCRIPT_DIR/runtime/node_modules/.bin:$PATH"

PORT="${PORT:-3000}"
export PORT

echo "🚀 启动 Nakhl（Cloudflare Workers runtime = workerd）..."
ls -lah "$SCRIPT_DIR"

# ── 1) 本地 D1：迁移 + 种子（幂等）─────────────────────────────────────────
echo "🗄️  应用 D1 本地迁移..."
wrangler d1 migrations apply DB --local

echo "🌱 写入种子数据（幂等 INSERT OR IGNORE）..."
wrangler d1 execute DB --local --file seed/seed-core.sql
# z 预览环境使用 dev 设置（开发 OTP 可见 → 可完整走通注册/下单/支付演练
# 流程）。与旧管线行为一致（旧管线直接打包沙箱 dev 数据库）。
# 正式 Cloudflare 生产请用 seed/settings-prod.sql（见 CLOUDFLARE-DEPLOY-FA.md）。
wrangler d1 execute DB --local --file seed/settings-dev.sql

# ── 2) Web 服务器：OpenNext worker on workerd（守护自愈）────────────────────
echo "🏃 启动 wrangler dev (127.0.0.1:$PORT)..."
(
    # 守护循环：wrangler 意外退出时 5 秒后自动重启
    while true; do
        wrangler dev --ip 127.0.0.1 --port "$PORT" >> web-server.log 2>&1
        echo "[supervisor] wrangler dev exited (code $?) — restarting in 5s" >> web-server.log
        sleep 5
    done
) &
WEB_PID=$!
echo "✅ web server 启动中（supervisor PID: $WEB_PID，日志: web-server.log）"

# 等待服务就绪（最多 90 秒，FC 健康检查预算 120s）
if command -v curl >/dev/null 2>&1; then
    i=1
    while [ "$i" -le 90 ]; do
        if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
            echo "✅ 健康检查通过（${i}s）"
            break
        fi
        sleep 1
        i=$((i + 1))
    done
else
    echo "ℹ️  容器内无 curl，固定等待 20s"
    sleep 20
fi

# ── 3) Caddy 网关（前台主进程）──────────────────────────────────────────────
echo "🌐 启动 Caddy 网关（:81 → 127.0.0.1:$PORT）..."
exec caddy run --config Caddyfile --adapter caddyfile
