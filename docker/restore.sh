#!/usr/bin/env bash
# =============================================================================
# Nakhl Restaurant — بازیابی بک‌اپ دیتابیس (Docker / VPS)
# -----------------------------------------------------------------------------
# بازیابی از یک فایل snapshot (خروجی docker/backup.sh) به volume.
#
# اجرا:   bash docker/restore.sh backups/nakhl-2025-….db
#
# نکته‌های امنیتی:
#  • کانتینر app موقتاً stop می‌شود (هیچ پروسه‌ای دیتابیس را باز نگه ندارد)
#  • اسکریپت صحت فایل را (وجود جداول Nakhl) قبل از بازنویسی بررسی می‌کند
#  • دیتابیس فعلی با پسوند .pre-restore کنار گذاشته می‌شود
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

if [ $# -ne 1 ]; then
  echo "استفاده: bash docker/restore.sh <مسیر-فایل-بک‌آپ.db>" >&2
  echo "مثال:   bash docker/restore.sh backups/nakhl-2025-09-10T12-30-00.db" >&2
  exit 1
fi

SNAPSHOT_HOST_PATH="$1"
[ -f "${SNAPSHOT_HOST_PATH}" ] || { echo "✗ فایل یافت نشد: ${SNAPSHOT_HOST_PATH}" >&2; exit 1; }
SNAPSHOT_NAME="$(basename "${SNAPSHOT_HOST_PATH}")"

echo "═══ رستوران نخل — بازیابی بک‌آپ ═══"
echo "  فایل: ${SNAPSHOT_HOST_PATH}"

# ۱) توقف اپ (volume دست‌نخورده می‌ماند)
echo "  ▶ توقف کانتینر app…"
docker compose stop app

# ۲) کپی snapshot داخل volume و اجرای restore با کانتینر یک‌بارمصرف
docker compose cp "${SNAPSHOT_HOST_PATH}" "app:/app/data/restore-tmp.db" >/dev/null
docker compose run --rm --no-deps --entrypoint node app scripts/restore.mjs /app/data/restore-tmp.db
docker compose exec -T app sh -c 'rm -f /app/data/restore-tmp.db' 2>/dev/null || \
  docker compose run --rm --no-deps --entrypoint sh app -c 'rm -f /app/data/restore-tmp.db'

# ۳) راه‌اندازی مجدد
echo "  ▶ راه‌اندازی مجدد کانتینر app…"
docker compose start app

for i in $(seq 1 30); do
  STATE="$(docker inspect --format '{{.State.Health.Status}}' nakhl-app 2>/dev/null || echo starting)"
  [ "$STATE" = "healthy" ] && { echo "  ✓ کانتینر healthy شد — بازیابی کامل"; exit 0; }
  sleep 2
done
echo "  ⚠ کانتینر هنوز healthy نشد — لاگ: docker compose logs --tail=50 app"
exit 1
