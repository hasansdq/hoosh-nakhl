import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

/**
 * Nakhl Restaurant — Next.js configuration
 * -----------------------------------------
 * TWO production targets share this one config:
 *
 *  • Cloudflare Workers: `bun run cf:build` (NEXT_PUBLIC_CF_BUILD=1 →
 *    opennextjs-cloudflare build, artifact under .open-next/).
 *
 *  • Docker / VPS: `docker build` sets NAKHL_DOCKER_BUILD=1 → classic
 *    `next build` with `output: "standalone"` (self-contained server bundle
 *    for the Node runtime image; see docker/ + DOCKER-DEPLOY-FA.md).
 *
 * `initOpenNextCloudflareForDev()` wires the local `next dev` server to a
 * real Miniflare instance with the exact wrangler.jsonc bindings (D1, R2,
 * Durable Objects — state persisted under `.wrangler/state`), so local
 * development runs the same code path as the Cloudflare production target.
 *
 * Image optimization: on Cloudflare, `_next/image` is intercepted by the
 * OpenNext worker (Cloudflare Images service — a paid, account-level
 * feature). This deployment serves originals instead: `unoptimized` is set
 * for CF builds only, so local dev and the Docker image (sharp is installed
 * in the runtime stage) keep the sharp-based optimizer.
 */
// Only initialize the Miniflare-backed Cloudflare context for the dev server
// (NEXT_PHASE is "phase-production-build" while `next build` runs — spinning
// up Miniflare there would waste memory and warn about Durable Object
// classes that only exist in the deployable worker, not the proxy).
if (process.env.NEXT_PHASE !== "phase-production-build") {
  initOpenNextCloudflareForDev();
}

const isCloudflareBuild = process.env.NEXT_PUBLIC_CF_BUILD === "1";
const isDockerBuild = process.env.NAKHL_DOCKER_BUILD === "1";

const nextConfig: NextConfig = {
  // Docker/VPS target only: standalone output (copied into the runtime image
  // by the Dockerfile). The Cloudflare target produces its own artifact via
  // opennextjs-cloudflare and must NOT set this.
  ...(isDockerBuild ? { output: "standalone" as const } : {}),
  // Never let the output file tracer drag sandbox/CI-only directories into a
  // production artifact (standalone image or the OpenNext worker output).
  // The app reads none of them at runtime.
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
  images: {
    unoptimized: isCloudflareBuild,
  },
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
