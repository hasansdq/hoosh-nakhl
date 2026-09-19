#!/usr/bin/env bash
# =============================================================================
# Nakhl Restaurant — به‌روزرسانی بدون از دست رفتن داده‌ها (Docker / VPS)
# -----------------------------------------------------------------------------
# اجرا از ریشهٔ پروژه:   bash docker/update.sh
#
# ترتیب کارها (هر سه قانون طلایی رعایت می‌شود):
#  ۱. بک‌اپ لحظه‌ای از دیتابیس قبل از هر کاری (VACUUM INTO — سازگار آنلاین)
#  ۲. ساخت ایمیج جدید + جایگزینی کانتینر (volume باقی می‌ماند — down -v هرگز)
#  ۳. مهاجرت‌های جدید فقط در جهت جلو اعمال می‌شوند؛ داده/تنظیمات/مدیر موجود
#     دست نمی‌خورد (seed ها INSERT OR IGNORE هستند)
#
# نکتهٔ شبکه: Dockerfile عمداً بدون directive «# syntax=…» نوشته شده و بیلد
# برای خودش به docker.io وصل نمی‌شود (ایمیج‌های پایه از کش محلی مصرف می‌شوند).
# اگر شبکه/رجیستری داکر مشکل داشته باشد، همین اسکریپت علت را تشخیص داده و
# راه‌حل فارسی چاپ می‌کند — کانتینر فعلی و داده‌ها دست‌نخورده می‌مانند.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m⚠\033[0m %s\n' "$1"; }

# --- پیش‌پروازش شبکهٔ داکر (سرورهای ایران) ------------------------------------
# فقط «آگاهی‌رسانی» است — چیزی را نشکانیم. اگر رجیستری سالم باشد بیلد حتی با
# این هشدارها ادامه پیدا می‌کند و موفق می‌شود.
net_preflight() {
  # ۱) پروکسی دیمن داکر: اگر پیکربندی شده باشد، یک اتصال آزمایشی ۴ ثانیه‌ای
  #    می‌زنیم. پروکسیِ مرده یعنی هر pull شکست می‌خورد (خطای proxyconnect).
  DAEMON_PROXY="$(docker info 2>/dev/null | awk -F': ' '/^ *(HTTP|HTTPS) Proxy:/{print $2; exit}' | tr -d ' ' || true)"
  if [ -n "${DAEMON_PROXY}" ]; then
    P_ADDR="${DAEMON_PROXY#*://}"; P_ADDR="${P_ADDR%%/*}"
    if timeout 4 bash -c "</dev/tcp/${P_ADDR%:*}/${P_ADDR##*:}" 2>/dev/null; then
      ok "پروکسی دیمن داکر (${DAEMON_PROXY}) پاسخ می‌دهد"
    else
      warn "پروکسی پیکربندی‌شده روی داکر (${DAEMON_PROXY}) پاسخ نمی‌دهد — هر pull از رجیستری شکست می‌خورد"
      warn "راه‌حل: DOCKER-DEPLOY-FA.md §۱۰ → «خطای شبکه هنگام بیلد» (گام ۱)"
    fi
  fi
  # ۲) ایمیج‌های پایه: اگر محلی نباشند و docker.io هم در دسترس نباشد، بیلد
  #    در همان ابتدا می‌شکند — راه‌حل، میرور ابرآروان است.
  MISSING_BASE=""
  for IMG in "oven/bun:1" "node:22-slim"; do
    docker image inspect "${IMG}" >/dev/null 2>&1 || MISSING_BASE="${MISSING_BASE} ${IMG}"
  done
  if [ -n "${MISSING_BASE}" ]; then
    warn "ایمیج‌های پایه به‌صورت محلی موجود نیستند:${MISSING_BASE}"
    warn "اگر docker.io روی این سرور در دسترس نیست، از میرور بکشید و همان نام را بزنید:"
    echo  "        docker pull docker.arvancloud.ir/oven/bun:1 && docker tag docker.arvancloud.ir/oven/bun:1 oven/bun:1"
    echo  "        docker pull docker.arvancloud.ir/library/node:22-slim && docker tag docker.arvancloud.ir/library/node:22-slim node:22-slim"
  fi
}

bold "═══ رستوران نخل — به‌روزرسانی ═══"

# ۱) بک‌اپ پیش از به‌روزرسانی
bold "گام ۱/۳ — بک‌اپ دیتابیس…"
bash docker/backup.sh

# ۲) ساخت ایمیج جدید
bold "گام ۲/۳ — ساخت ایمیج جدید…"
net_preflight
BUILD_LOG="$(mktemp /tmp/nakhl-build-XXXXXX.log)"
trap 'rm -f "${BUILD_LOG}"' EXIT

if ! docker compose build 2>&1 | tee "${BUILD_LOG}"; then
  bold "✗ ساخت ایمیج شکست خورد — هیچ چیزی تغییر نکرده است:"
  echo  "    • کانتینر فعلی همچنان در حال سرویس‌دهی است (نسخهٔ قبلی)"
  echo  "    • بک‌اپ گام ۱ گرفته شده است (docker/restore.sh در صورت نیاز)"
  echo
  if grep -qiE 'proxyconnect|deadline ?exceeded|i/o timeout|failed to resolve' "${BUILD_LOG}"; then
    bold "  تشخیص: خطای شبکه/رجیستری داکر (در سرورهای ایران رایج). سه مسیر رفع:"
    echo
    echo  "  ۱) پروکسی مردهٔ دیمن داکر را پیدا و حذف/اصلاح کنید:"
    echo  "       docker info | grep -i proxy"
    echo  "       systemctl show docker --property=Environment"
    echo  "       cat /etc/docker/daemon.json"
    echo  "       ls /etc/systemd/system/docker.service.d/ 2>/dev/null"
    echo  "     سپس:  systemctl daemon-reload && systemctl restart docker"
    echo
    echo  "  ۲) اگر docker.io بدون پروکسی هم باز نیست — میرور ابرآروان در daemon.json:"
    echo  "       { \"registry-mirrors\": [\"https://docker.arvancloud.ir\"] }"
    echo  "     سپس:  systemctl restart docker   (کانتینرها خودشان برمی‌گردند؛ داده‌ها روی volume امن‌اند)"
    echo
    echo  "  ۳) راه سریع بدون دست زدن به دیمن — فقط ایمیج‌های پایه را از میرور بکشید:"
    echo  "       docker pull docker.arvancloud.ir/oven/bun:1 && docker tag docker.arvancloud.ir/oven/bun:1 oven/bun:1"
    echo  "       docker pull docker.arvancloud.ir/library/node:22-slim && docker tag docker.arvancloud.ir/library/node:22-slim node:22-slim"
    echo
    echo  "  راهنمای کامل: DOCKER-DEPLOY-FA.md §۱۰ (خطای شبکه هنگام بیلد)"
  else
    echo  "  لاگ کامل بیلد در همین خروجی بالاست؛ جدول رفع اشکال: DOCKER-DEPLOY-FA.md §۱۰"
  fi
  exit 1
fi

# ۳) جایگزینی کانتینر (volume دست‌نخورده)
bold "گام ۳/۳ — جایگزینی کانتینر…"
docker compose up -d

# منتظر healthy شدن بمانیم
for i in $(seq 1 45); do
  STATE="$(docker inspect --format '{{.State.Health.Status}}' nakhl-app 2>/dev/null || echo starting)"
  [ "$STATE" = "healthy" ] && { ok "کانتینر جدید healthy شد"; break; }
  [ "$i" = "45" ] && { echo "  ⚠ هنوز healthy نیست — لاگ: docker compose logs --tail=100 app"; exit 1; }
  sleep 2
done

# پاک‌سازی ایمیج‌های قدیمی بی‌استفاده (volume ها را هرگز لمس نمی‌کند)
docker image prune -f >/dev/null 2>&1 && ok "ایمیج‌های بلااستفاده پاک شدند" || true

bold "═══ به‌روزرسانی کامل شد — داده‌ها دست‌نخورده ═══"
docker compose ps
