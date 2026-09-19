# =============================================================================
# Nakhl Restaurant — production image (multi-stage · Docker / VPS target)
# -----------------------------------------------------------------------------
# NOTE — deliberately NO «# syntax=docker/dockerfile:1» directive on line 1!
# That directive makes BuildKit fetch the EXTERNAL dockerfile frontend image
# from docker.io before building anything at all — on Iranian VPSs docker.io
# is typically unreachable (dead HTTP proxy / filtering) and the build dies
# instantly with:
#   failed to resolve docker.io/docker/dockerfile:1: proxyconnect … i/o timeout
# Every feature used below (multi-stage, COPY --from, ARG, ENV, HEALTHCHECK,
# VOLUME, USER) is supported by the dockerfile frontend BUNDLED inside Docker
# Engine itself — with the two base images cached locally, this build needs
# ZERO registry/network access. (If you ever add heredocs, --mount or
# COPY --link, reconsider — but keep VPS offline-build capability in mind.)
# -----------------------------------------------------------------------------
# Build:    docker compose build          (or docker build -t nakhl-restaurant .)
# Runtime:  ONE Node.js process — docker/app-server.js boots the Next.js
#           standalone server, the /api/ws socket.io realtime channel and the
#           /emit push endpoint (see DOCKER-DEPLOY-FA.md).
#
# Stage 1 «builder»  — oven/bun:1 (Debian): bun install → prisma generate →
#                      next build (output: standalone) → merge runtime-only
#                      native deps into the standalone bundle.
# Stage 2 «runner»   — node:22-slim (Debian): non-root, healthchecked,
#                      forward-only migrations + idempotent seed at boot
#                      (docker/entrypoint.sh), data on the nakhl-data volume.
#
# Ports: the app listens on container port 3000 and is published to
# 127.0.0.1:8080 (host) by docker-compose.yml — DirectAdmin's Apache owns
#  ports 80/443 on the VPS and reverse-proxies to this container.
# =============================================================================

# ---------- Stage 1: builder ----------
FROM oven/bun:1 AS builder

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# dependencies first — this layer caches until package.json/bun.lock change
COPY package.json bun.lock ./
COPY prisma ./prisma
RUN bun install --frozen-lockfile

# application sources (.dockerignore keeps node_modules/.next/.git/… out)
COPY . .

# Prisma client — engineless "workerd" build (WASM query compiler): the very
# same generated client runs on Cloudflare workerd AND on Node (next dev and
# this standalone server). Native .so engine files are stripped defensively.
RUN bunx prisma generate && rm -f src/generated/prisma/*.so.node

# Build-time public env — the browser bundle connects to socket.io on the
# same origin at /api/ws (served by docker/app-server.js behind Apache).
ARG NEXT_PUBLIC_SOCKET_PATH=/api/ws
ENV NAKHL_DOCKER_BUILD=1 \
    NEXT_PUBLIC_SOCKET_PATH=${NEXT_PUBLIC_SOCKET_PATH} \
    NEXT_TELEMETRY_DISABLED=1

# Production build → .next/standalone
RUN bun run build

# Runtime-only dependencies: modules that the app loads through bundler-
# excluded dynamic imports (@libsql, socket.io server, optional ZAI SDK)
# are NOT part of webpack's output-file tracing — install them explicitly
# and merge them into the standalone node_modules tree. sharp serves
# /_next/image optimization. Versions are pinned to the tested lockfile.
RUN mkdir -p /runtime-deps \
 && cd /runtime-deps \
 && echo '{"name":"nakhl-runtime-deps","private":true}' > package.json \
 && bun add --exact @libsql/client@0.18.0 @prisma/adapter-libsql@6.19.3 socket.io@4.8.3 sharp@0.34.5 z-ai-web-dev-sdk@0.0.18 \
 && cp -r /runtime-deps/node_modules/. /app/.next/standalone/node_modules/

# ---------- Stage 2: runner ----------
FROM node:22-slim AS runner

# ca-certificates: outbound HTTPS (ZarinPal / SMS / OpenRouter) through the
# system trust store; node's built-in store covers most cases — belt & braces.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=Asia/Tehran \
    NAKHL_DATA_DIR=/app/data \
    NAKHL_SQLITE_PATH=/app/data/nakhl.db \
    NAKHL_UPLOADS_DIR=/app/data/uploads \
    NAKHL_MIGRATIONS_DIR=/app/migrations \
    NAKHL_SEED_DIR=/app/seed \
    NAKHL_NOTIFY_URL=http://127.0.0.1:3000/emit

# standalone server bundle (+ merged runtime deps). Next's file tracing
# conservatively copies some repo dirs (sandbox services, QA artifacts, …)
# and even the local .env into the standalone tree — prune all of them; the
# operational scripts and SQL are copied explicitly right after. Production
# configuration comes exclusively from the container environment (compose
# env_file), never from a build-time .env.
COPY --from=builder /app/.next/standalone ./
RUN rm -rf docker examples mini-services skills tool-results scripts \
 && rm -rf .next/cache \
 && rm -f .env .env.*
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# operational scripts + SQL (migrations/seed run at every boot, idempotently)
COPY docker/app-server.js ./app-server.js
COPY docker/migrate.mjs docker/seed.mjs docker/backup.mjs docker/restore.mjs ./scripts/
COPY migrations ./migrations
COPY seed ./seed
COPY docker/entrypoint.sh /usr/local/bin/nakhl-entrypoint

RUN chmod +x /usr/local/bin/nakhl-entrypoint \
 && mkdir -p /app/data \
 && chown -R node:node /app

# never run as root; the data volume inherits this ownership
USER node
VOLUME /app/data

EXPOSE 3000

# App-level health: /api/health pings the SQLite database — the container is
# only "healthy" when the web process AND the database respond.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["nakhl-entrypoint"]
