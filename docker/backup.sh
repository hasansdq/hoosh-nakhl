#!/usr/bin/env bash
# =============================================================================
# Nakhl Restaurant — بک‌اپ دیتابیس (Docker / VPS)
# -----------------------------------------------------------------------------
# snapshot سازگار (VACUUM INTO) داخل volume می‌سازد + یک کپی روی میزبان
# در پوشهٔ ./backups نگه می‌دارد (برای انتقال به سرور فایل/فضای ابری).
#
# اجرا از ریشهٔ پروژه:   bash docker/backup.sh
# کرون (هر شب ۳:۳۰):     30 3 * * *  cd /path/to/project && bash docker/backup.sh
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

HOST_BACKUP_DIR="./backups"
mkdir -p "${HOST_BACKUP_DIR}"

# ۱) snapshot داخل volume (با retention خودکار)
docker compose exec -T app node scripts/backup.mjs

# ۲) کپی جدیدترین snapshot روی میزبان
LATEST="$(docker compose exec -T app sh -c 'ls -1t /app/data/backups/nakhl-*.db 2>/dev/null | head -1' | tr -d '\r')"
if [ -n "${LATEST}" ]; then
  docker compose cp "app:${LATEST}" "${HOST_BACKUP_DIR}/" >/dev/null
  BASENAME="$(basename "${LATEST}")"
  echo "  ✓ کپی میزبان: ${HOST_BACKUP_DIR}/${BASENAME}"
else
  echo "  (دیتابیس هنوز وجود ندارد — چیزی برای کپی نیست)"
fi
