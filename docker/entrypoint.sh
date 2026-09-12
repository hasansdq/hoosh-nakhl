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
APP_DIR="${NAKHL_APP_DIR:-/app}"
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

random_hex() {
  # od -t x1 is the POSIX-portable hex dump. The previous `od -An hex` was
  # silently broken on standard systems: od treated «hex» as a FILE name,
  # failed, and the pipeline produced an EMPTY string — which would have
  # made ADMIN_NOTIFY_KEY a guessable 6-char value in production Docker.
  head -c 24 /dev/urandom | od -An -t x1 | tr -d ' \n'
}

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
node "${APP_DIR}/scripts/migrate.mjs"

# ---------- 3b. production-safety posture check --------------------------------
# Loud, unmissable warnings when the container boots in a NON-production-safe
# posture. These never block the boot (the operator may be running a private
# staging box on purpose) — but nobody can say they were not told.
if [ "${ZARINPAL_FORCE_REAL:-}" != "1" ]; then
  log "⚠⚠  WARNING: ZARINPAL_FORCE_REAL is NOT \"1\" — the SIMULATED payment gateway is LIVE!"
  log "⚠⚠  Customers could complete orders without paying real money."
  log "⚠⚠  For production set ZARINPAL_FORCE_REAL=1 in .env (docker-compose defaults to it)."
fi
if [ "${NAKHL_SEED_PROFILE:-prod}" = "dev" ]; then
  log "⚠⚠  WARNING: NAKHL_SEED_PROFILE=dev — OTP codes are exposed in API responses!"
  log "⚠⚠  Only acceptable on a PRIVATE staging box. Production must use NAKHL_SEED_PROFILE=prod."
fi
if [ -n "${ADMIN_PASSWORD:-}" ]; then
  log "note: ADMIN_PASSWORD was set through the environment — change it from the admin panel after first login, then remove it from .env"
fi

# ---------- 4. idempotent seed + admin bootstrap -------------------------------
log "seeding (idempotent — existing rows and admin credentials preserved)…"
node "${APP_DIR}/scripts/seed.mjs"

# ---------- 5. hand over to the production server ------------------------------
log "starting Nakhl production server on ${PORT:-3000}…"
exec node "${APP_DIR}/app-server.js"
