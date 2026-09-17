# =============================================================================
# Nakhl Restaurant — notify-service (realtime push over socket.io)
# -----------------------------------------------------------------------------
# Pure Bun runtime — this exact service already runs under Bun in development
# (`bun --hot index.ts`), so Bun is the proven runtime here. socket.io listens
# on :3003 with path "/" (the production Caddy strips the /rt prefix before
# proxying). The dev-server supervisor is disabled via NODE_ENV + NAKHL_SUPERVISE_DEV.
# Build context = repository root (see docker-compose.yml).
# =============================================================================
FROM oven/bun:1-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

ENV NODE_ENV=production \
    NAKHL_SUPERVISE_DEV=0

COPY mini-services/notify-service/package.json mini-services/notify-service/bun.lock ./
RUN bun install --frozen-lockfile --production

COPY mini-services/notify-service/index.ts ./index.ts

EXPOSE 3003

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e 'const r = await fetch("http://localhost:3003/"); process.exit(r.status ? 0 : 1)' || exit 1

CMD ["bun", "index.ts"]
