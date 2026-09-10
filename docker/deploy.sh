#!/usr/bin/env bash
# =============================================================================
# Nakhl Restaurant — استقرار اولیه روی VPS (Docker)
# -----------------------------------------------------------------------------
# اجرا از ریشهٔ پروژه:   bash docker/deploy.sh
#
# کارها:
#  ۱. بررسی پیش‌نیازها (docker, docker compose, فایل .env)
#  ۲. ساخت ایمیج (multi-stage) و راه‌اندازی کانتینر
#  ۳. انتظار برای healthy شدن (مهاجرت + سید اولین بوت انجام می‌شود)
#  ۴. نمایش راهنمای ورود مدیر و گام بعدی (پراکسی آپاچی دایرکت‌ادمین)
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT_DIR="$(pwd)"

bold()  { printf '\033[1m%s\033[0m\n' "$1"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$1"; }
err()   { printf '  \033[31m✗\033[0m %s\n' "$1" >&2; }

bold "═══ رستوران نخل — استقرار Docker ═══"

# ---------- 1. پیش‌نیازها ----------
command -v docker >/dev/null 2>&1 || { err "docker نصب نیست (docker docs → Install Engine)"; exit 1; }
docker compose version >/dev/null 2>&1 || { err "«docker compose v2» موجود نیست"; exit 1; }
if [ ! -f .env ]; then
  err "فایل .env یافت نشد — ابتدا: cp docker/env.example .env و مقادیر را تنظیم کنید"
  exit 1
fi
ok "پیش‌نیازها"

# پورت ۸۰/۴۴۳ نباید توسط این استک گرفته شود (مالک آن‌ها DirectAdmin/Apache است)
if [ -f /usr/local/directadmin ]; then
  ok "دایرکت‌ادمین شناسایی شد — استک فقط روی 127.0.0.1:\${NAKHL_PORT:-8080} منتشر می‌شود"
fi

# ---------- 2. ساخت و راه‌اندازی ----------
bold "ساخت ایمیج (چند دقیقه — لایه‌ها کش می‌شوند)…"
docker compose build

bold "راه‌اندازی کانتینر…"
docker compose up -d

# ---------- 3. انتظار برای سلامت ----------
PORT="$(grep -E '^NAKHL_PORT=' .env | cut -d= -f2 || true)"
PORT="${PORT:-8080}"
bold "انتظار برای healthy شدن (مهاجرت دیتابیس + سید اولین بوت)…"
for i in $(seq 1 60); do
  STATE="$(docker inspect --format '{{.State.Health.Status}}' nakhl-app 2>/dev/null || echo starting)"
  if [ "$STATE" = "healthy" ]; then
    ok "کانتینر healthy شد (${i}×۲ ثانیه)"
    break
  fi
  if [ "$i" = "60" ]; then
    err "کانتینر healthy نشد — لاگ‌ها: docker compose logs --tail=100 app"
    exit 1
  fi
  sleep 2
done

HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/api/health" || true)"
[ "$HTTP_CODE" = "200" ] && ok "GET /api/health → 200" || err "health endpoint → ${HTTP_CODE:-fail}"

# ---------- 4. راهنمای ادامه ----------
CREDS_HINT="$(docker compose exec -T app sh -c '[ -f /app/data/initial-admin-credentials.txt ] && echo yes || echo no' 2>/dev/null || echo no)"

bold "═══ استقرار کامل شد ═══"
echo "  • سایت روی میزبان:  http://127.0.0.1:${PORT}"
echo "  • لاگ‌ها:            docker compose logs -f app"
if [ "$CREDS_HINT" = "yes" ]; then
  echo "  • رمز اولیهٔ مدیر:   docker compose exec app cat /app/data/initial-admin-credentials.txt"
fi
echo
bold "گام بعدی — اتصال دامنه از طریق دایرکت‌ادمین:"
echo "  1) در DirectAdmin یک دامنه/ساب‌دامنه بسازید (DocumentRoot دلخواه)"
echo "  2) فایل docker/directadmin/nakhl-proxy.conf را در Custom HTTPD همان دامنه قرار دهید"
echo "  3) گواهی SSL (Let's Encrypt) را از خود DirectAdmin برای دامنه صادر کنید"
echo "  4) راهنمای کامل: DOCKER-DEPLOY-FA.md (بخش دایرکت‌ادمین)"
