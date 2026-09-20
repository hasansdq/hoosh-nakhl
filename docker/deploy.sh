#!/usr/bin/env bash
# =============================================================================
# Nakhl Restaurant — استقرار اولیه روی VPS (Docker)
# -----------------------------------------------------------------------------
# اجرا از ریشهٔ پروژه:   bash docker/deploy.sh
#
# چهار گام زمان‌دار (در پایان «جدول زمان‌ها» چاپ می‌شود):
#  ۱. پیش‌نیازها: docker/compose/.env + حافظه/سواپ/دیسک + وضعیت رجیستری
#  ۲. ساخت ایمیج — با «ضربان‌سنج»: هر ۳۰ ثانیه یک خط وضعیت (زمان سپری‌شده +
#     گام جاری BuildKit)؛ اگر خروجی بیلد قطع بماند هشدار و علت‌یابی چاپ می‌شود
#     (مرحلهٔ TypeScript روی سرورهای کند چند دقیقه بی‌خروجی و کاملاً طبیعی است —
#     خطوط «[nakhl] … (cpu busy)» هر ۶۰ ثانیه نشانهٔ زنده بودن‌اند)
#  ۳. راه‌اندازی کانتینر + انتظار برای healthy شدن (مهاجرت + سید اولین بوت)
#  ۴. جمع‌بندی: جدول زمان‌ها + راهنمای ورود مدیر + گام بعدی (پراکسی آپاچی)
#
# اگر بیلد شکست بخورد، علت به‌صورت خودکار تشخیص داده می‌شود (شبکه / کمبود
# حافظه OOM / خطای TypeScript) و لاگ کامل در /tmp نگه داشته می‌شود.
#
# تنظیم ریز‌تر پایش (ثانیه، اختیاری):
#   NAKHL_BUILD_TICK=30   فاصلهٔ خط‌های تایمر (پیش‌فرض ۳۰)
#   NAKHL_STALL_WARN=240  آستانهٔ هشدار «بی‌خروجی» (پیش‌فرض ۲۴۰)
#   NAKHL_STALL_ALERT=900 آستانهٔ هشدار جدی + علت‌یابی (پیش‌فرض ۹۰۰)
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

source docker/lib.sh
trap cleanup EXIT
trap 'exit 130' INT TERM

bold "═══ رستوران نخل — استقرار Docker ═══"
printf '  \033[2m%s\033[0m\n' "$(date '+%Y-%m-%d %H:%M:%S')"

# ═══════════ گام ۱: پیش‌نیازها ═══════════
ph "پیش‌نیازها" "۱" "۴"

command -v docker >/dev/null 2>&1 || { err "docker نصب نیست (docker docs → Install Engine)"; exit 1; }
docker compose version >/dev/null 2>&1 || { err "«docker compose v2» موجود نیست"; exit 1; }
if [ ! -f .env ]; then
  err "فایل .env یافت نشد — ابتدا: cp docker/env.example .env و مقادیر را تنظیم کنید"
  exit 1
fi
ok "docker و compose و .env"

sys_preflight
net_preflight

# پورت ۸۰/۴۴۳ نباید توسط این استک گرفته شود (مالک آن‌ها DirectAdmin/Apache است)
if [ -d /usr/local/directadmin ]; then
  ok "دایرکت‌ادمین شناسایی شد — استک فقط روی 127.0.0.1:\${NAKHL_PORT:-8080} منتشر می‌شود"
fi

ph_done

# ═══════════ گام ۲: ساخت ایمیج ═══════════
ph "ساخت ایمیج" "۲" "۴"

build_image
if [ "$BUILD_RC" -ne 0 ]; then
  diagnose_build_failure "استقرار ناتمام ماند (هنوز چیزی سرویس‌دهی نمی‌کند)"
  exit 1
fi

ph_done

# ═══════════ گام ۳: راه‌اندازی و سلامت ═══════════
ph "راه‌اندازی و سلامت" "۳" "۴"

PORT="$(grep -E '^NAKHL_PORT=' .env | cut -d= -f2 || true)"
PORT="${PORT:-8080}"

bold "راه‌اندازی کانتینر…"
docker compose up -d

# اولین بوت: مهاجرت دیتابیس + سید + ساخت ادمین داخل entrypoint انجام می‌شود
wait_healthy 180 || exit 1
http_health "$PORT"

ph_done

# ═══════════ گام ۴: جمع‌بندی ═══════════
ph "جمع‌بندی" "۴" "۴"

CREDS_HINT="$(docker compose exec -T app sh -c '[ -f /app/data/initial-admin-credentials.txt ] && echo yes || echo no' 2>/dev/null || echo no)"

summary

echo
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

ph_done
