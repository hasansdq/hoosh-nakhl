import type { NextConfig } from "next";

/**
 * Nakhl Restaurant — Next.js configuration
 * -----------------------------------------
 * Single production target: Docker / VPS.
 * `docker build` (and `bun run docker:build`) set NAKHL_DOCKER_BUILD=1 →
 * classic `next build` with `output: "standalone"` (self-contained server
 * bundle for the Node runtime image; see docker/ + DOCKER-DEPLOY-FA.md).
 *
 * Local `next dev` needs no Cloudflare/binding setup: the app talks to a
 * local SQLite file (db/nakhl.db — create it with `bun run db:setup`) and
 * the sandbox notify-service (mini-services/notify-service) provides the
 * realtime channel on port 3003 through the Caddy gateway.
 *
 * Image optimization: the Docker runtime image installs sharp, so `/_next/image`
 * optimization works out of the box.
 */
const isDockerBuild = process.env.NAKHL_DOCKER_BUILD === "1";

const nextConfig: NextConfig = {
  // Docker/VPS target: standalone output (copied into the runtime image
  // by the Dockerfile).
  ...(isDockerBuild ? { output: "standalone" as const } : {}),
  // Never let the output file tracer drag sandbox/CI-only directories into a
  // production artifact. The app reads none of them at runtime.
  outputFileTracingExcludes: {
    "*": [
      "./skills/**",
      "./examples/**",
      "./mini-services/**",
      "./tool-results/**",
      "./agent-ctx/**",
      "./qa/**",
      "./docker/**",
      "./scripts/**",
      "./backups/**",
      "./db/**",
      "./*.log",
      "./.env",
      "./.env.*",
    ],
  },
  reactStrictMode: false,
  poweredByHeader: false,
  compress: true,
  productionBrowserSourceMaps: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
      {
        // Never cache API responses at the CDN/proxy layer (auth-dependent).
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
