# =============================================================================
# Nakhl Restaurant — production image (multi-stage)
# -----------------------------------------------------------------------------
# Build:     docker build -t nakhl-web .
# Runtime:   node server.js  (Next.js standalone — official Node runtime)
# Bun is used ONLY as an installer/bundler (bun install / bun build); every
# runtime process (Next server, Prisma CLI, seeder) runs under Node.js 22 —
# the exact runtime the app was developed and QA'd with.
# =============================================================================

# ---------- Stage 1: builder ----------
FROM node:22-slim AS builder

# openssl + ca-certificates: Prisma engine + outbound HTTPS (ZarinPal / SMS / OpenRouter)
# curl + unzip: bun bootstrap
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates curl unzip \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL https://bun.sh/install | bash \
 && ln -s /root/.bun/bin/bun /usr/local/bin/bun \
 && bun --version

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# dependencies first (better layer caching)
COPY package.json bun.lock ./
COPY prisma ./prisma
RUN bun install --frozen-lockfile

# generate the Prisma client (engines land in node_modules/.prisma + @prisma)
RUN node node_modules/prisma/build/index.js generate

# application sources
COPY . .

# client-side realtime path is baked at BUILD time (Caddyfile.prod routes /rt
# to the notify-service); sandbox default is not used in production images.
ARG NEXT_PUBLIC_SOCKET_PATH=/rt
ENV NEXT_PUBLIC_SOCKET_PATH=${NEXT_PUBLIC_SOCKET_PATH}

# production build → .next/standalone (script also copies static + public into it)
RUN bun run build

# precompile the seeder to plain CJS for the node-only runtime stage
# (@prisma/client stays external — its engine is copied separately).
# NOTE: NODE_ENV is inlined statically by Bun's bundler — building with
# NODE_ENV=production makes the Docker seeder always use production-safe
# settings (dev OTP off, real gateway only). Dev/sandbox usage runs the
# TypeScript source directly (bun prisma/seed.ts) with live NODE_ENV.
RUN NODE_ENV=production bun build prisma/seed.ts --outdir ./prisma-seed --target node --format cjs --external @prisma/client

# ---------- Stage 2: runtime ----------
FROM node:22-slim AS runner

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL=file:/app/db/custom.db

# --- Next.js standalone server (contains server.js, .next/static, public/, traced node_modules)
COPY --from=builder /app/.next/standalone ./

# --- Prisma client + engines + CLI (for first-boot schema push; native binaries
#     are not reliably captured by Next's output file tracing)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

# --- sharp (+ @img platform binaries) for next/image optimization & upload pipeline
COPY --from=builder /app/node_modules/sharp ./node_modules/sharp
COPY --from=builder /app/node_modules/@img ./node_modules/@img

# --- schema + compiled seeder (first-boot initialization)
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma-seed ./prisma-seed

COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh && mkdir -p /app/db /app/public/uploads

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/health || exit 1

ENTRYPOINT ["./entrypoint.sh"]
