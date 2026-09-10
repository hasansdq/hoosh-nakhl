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
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }

bold "═══ رستوران نخل — به‌روزرسانی ═══"

# ۱) بک‌اپ پیش از به‌روزرسانی
bold "گام ۱/۳ — بک‌اپ دیتابیس…"
bash docker/backup.sh

# ۲) ساخت ایمیج جدید
bold "گام ۲/۳ — ساخت ایمیج جدید…"
docker compose build

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
