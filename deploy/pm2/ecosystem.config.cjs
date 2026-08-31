// =============================================================================
// Nakhl Restaurant — PM2 process configuration (VPS without Docker)
// -----------------------------------------------------------------------------
// Prerequisites (one-time):
//   1. bun + node installed        (e.g. curl -fsSL https://bun.sh/install | bash)
//   2. project built:              bun install && bun run build
//   3. database initialized:       bun run db:push && bun run db:seed
//   4. .env created from .env.example with production values
//
// Start / save / boot-persist:
//   pm2 start deploy/pm2/ecosystem.config.cjs --env production
//   pm2 save && pm2 startup         # auto-start on server reboot
//
// Reverse proxy: point Caddy/Nginx at 127.0.0.1:3000 (and /rt → 127.0.0.1:3003)
// using deploy/caddy/Caddyfile.vps.
// =============================================================================
module.exports = {
  apps: [
    {
      name: "nakhl-web",
      script: ".next/standalone/server.js",
      interpreter: "node",
      cwd: "/opt/nakhl", // ← change to your deploy path
      env: {
        NODE_ENV: "production",
        PORT: "3000",
        HOSTNAME: "127.0.0.1",
        DATABASE_URL: "file:/opt/nakhl/db/custom.db", // ← absolute path!
        AUTH_SECRET: "", // ← REQUIRED (openssl rand -hex 32)
        ADMIN_NOTIFY_KEY: "", // ← REQUIRED (must match notify below)
        NAKHL_NOTIFY_URL: "http://127.0.0.1:3003/emit",
        NAKHL_SUPERVISE_DEV: "0",
        ZARINPAL_FORCE_REAL: "1",
      },
      max_memory_restart: "600M",
      restart_delay: 3000,
      time: true,
    },
    {
      name: "nakhl-notify",
      script: "index.ts",
      interpreter: "bun", // this service is proven under Bun runtime
      cwd: "/opt/nakhl/mini-services/notify-service", // ← change to your deploy path
      env: {
        NODE_ENV: "production",
        NAKHL_SUPERVISE_DEV: "0",
        ADMIN_NOTIFY_KEY: "", // ← REQUIRED (must match web above)
      },
      max_memory_restart: "300M",
      restart_delay: 3000,
      time: true,
    },
  ],
};
