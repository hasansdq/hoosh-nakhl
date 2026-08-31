#!/bin/sh
# =============================================================================
# Nakhl Restaurant — container entrypoint
# -----------------------------------------------------------------------------
# 1. First boot  → create the SQLite schema (prisma db push) and seed initial
#    data (menu, admin user, production-safe settings) via the precompiled
#    seeder. ADMIN_USERNAME / ADMIN_PASSWORD env vars bootstrap the admin.
# 2. Every boot  → best-effort schema drift sync (prisma db push is a no-op
#    when the schema already matches).
# 3. Always      → exec the Next.js standalone server (PID 1, receives signals).
#
# The database lives on the `db_data` volume (/app/db/custom.db) and uploaded
# images on the `uploads_data` volume (/app/public/uploads) — both survive
# container rebuilds and upgrades.
# =============================================================================
set -e
cd /app

DB_FILE="/app/db/custom.db"

if [ ! -f "$DB_FILE" ]; then
  echo "[nakhl-init] first boot — creating SQLite schema..."
  DATABASE_URL="file:$DB_FILE" node node_modules/prisma/build/index.js db push --skip-generate --accept-data-loss

  echo "[nakhl-init] seeding initial data (menu / admin / settings)..."
  DATABASE_URL="file:$DB_FILE" node prisma-seed/seed.js

  echo "[nakhl-init] database ready at $DB_FILE"
else
  echo "[nakhl-init] existing database found — syncing schema drift..."
  if DATABASE_URL="file:$DB_FILE" node node_modules/prisma/build/index.js db push --skip-generate --accept-data-loss; then
    echo "[nakhl-init] schema in sync"
  else
    echo "[nakhl-init] WARN: schema sync failed (continuing with current schema)"
  fi
fi

echo "[nakhl] starting Next.js standalone server on port ${PORT:-3000}..."
exec node server.js
