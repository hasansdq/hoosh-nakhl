#!/bin/sh
# =============================================================================
# Nakhl Restaurant — container entrypoint (Docker / VPS)
# -----------------------------------------------------------------------------
# Boot order (fail-fast, data-preserving):
#   1. prepare the persistent data directory (volume mount at /app/data)
#   2. secrets bootstrap  — ADMIN_NOTIFY_KEY is generated ONCE and persisted
#      in data/secrets.env so redeploys never invalidate live realtime keys
#      (an explicit env var always wins and is persisted in its place)
#   3. forward-only migrations (docker/migrate.mjs — additive, transactional)
#   4. idempotent seeding + admin bootstrap (docker/seed.mjs)
#   5. exec the Node production server (docker/app-server.js) as PID 1
#
# Everything in here is safe to re-run on every container start — including
# image upgrades — without touching existing data.
# =============================================================================
set -eu

DATA_DIR="${NAKHL_DATA_DIR:-/app/data}"
SECRETS_FILE="${DATA_DIR}/secrets.env"

log() { echo "[entrypoint] $*"; }

# ---------- 1. persistent data directory ------------------------------------
mkdir -p "${DATA_DIR}" "${DATA_DIR}/uploads" "${DATA_DIR}/backups"

# ---------- 2. secrets bootstrap ---------------------------------------------
# set_secret <NAME> <VALUE> — upsert one NAME=VALUE line in the secrets file.
set_secret() {
  name="$1"; value="$2"
  touch "${SECRETS_FILE}"; chmod 600 "${SECRETS_FILE}"
  if grep -q "^${name}=" "${SECRETS_FILE}" 2>/dev/null; then
    sed -i "s|^${name}=.*|${name}=${value}|" "${SECRETS_FILE}"
  else
    echo "${name}=${value}" >> "${SECRETS_FILE}"
  fi
}

random_hex() { head -c 24 /dev/urandom | od -An hex | tr -d ' \n'; }

if [ -n "${ADMIN_NOTIFY_KEY:-}" ]; then
  # operator-provided key wins; persist it so it can never be lost silently
  set_secret ADMIN_NOTIFY_KEY "${ADMIN_NOTIFY_KEY}"
  export ADMIN_NOTIFY_KEY
  log "ADMIN_NOTIFY_KEY taken from environment (persisted to data/secrets.env)"
elif [ -f "${SECRETS_FILE}" ] && grep -q "^ADMIN_NOTIFY_KEY=" "${SECRETS_FILE}"; then
  # reuse the key generated on an earlier boot — sessions/staff panels keep
  # receiving realtime events across redeploys
  . "${SECRETS_FILE}"
  [ -n "${ADMIN_NOTIFY_KEY:-}" ] && export ADMIN_NOTIFY_KEY
  log "ADMIN_NOTIFY_KEY restored from data/secrets.env (unchanged since first boot)"
else
  ADMIN_NOTIFY_KEY="nakhl-$(random_hex)"
  set_secret ADMIN_NOTIFY_KEY "${ADMIN_NOTIFY_KEY}"
  export ADMIN_NOTIFY_KEY
  log "ADMIN_NOTIFY_KEY generated (random) and persisted to data/secrets.env"
fi

# ---------- 3. forward-only migrations ----------------------------------------
log "applying database migrations (forward-only, transactional)…"
node /app/scripts/migrate.mjs

# ---------- 4. idempotent seed + admin bootstrap -------------------------------
log "seeding (idempotent — existing rows and admin credentials preserved)…"
node /app/scripts/seed.mjs

# ---------- 5. hand over to the production server ------------------------------
log "starting Nakhl production server on ${PORT:-3000}…"
exec node /app/app-server.js
