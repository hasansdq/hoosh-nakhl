import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

/**
 * Nakhl Restaurant — Next.js configuration
 * -----------------------------------------
 * The production target is Cloudflare Workers via @opennextjs/cloudflare
 * (see wrangler.jsonc + open-next.config.ts):
 *
 *   bun run cf:build   → NEXT_PUBLIC_CF_BUILD=1 opennextjs-cloudflare build
 *   bun run deploy     → cf:build + wrangler deploy
 *
 * `initOpenNextCloudflareForDev()` wires the local `next dev` server to a
 * real Miniflare instance with the exact wrangler.jsonc bindings (D1, R2,
 * Durable Objects — state persisted under `.wrangler/state`), so local
 * development runs the same code path as production.
 *
 * Image optimization: on Cloudflare, `_next/image` is intercepted by the
 * OpenNext worker (Cloudflare Images service — a paid, account-level
 * feature). This deployment serves originals instead: `unoptimized` is set
 * for CF builds only, so local dev keeps the sharp-based optimizer. To
 * enable optimization later, add an `IMAGES` binding and remove this flag.
 */
// Only initialize the Miniflare-backed Cloudflare context for the dev server
// (NEXT_PHASE is "phase-production-build" while `next build` runs — spinning
// up Miniflare there would waste memory and warn about Durable Object
// classes that only exist in the deployable worker, not the proxy).
if (process.env.NEXT_PHASE !== "phase-production-build") {
  initOpenNextCloudflareForDev();
}

const isCloudflareBuild = process.env.NEXT_PUBLIC_CF_BUILD === "1";

const nextConfig: NextConfig = {
  // NOTE: this project deploys to Cloudflare Workers — the Node/Docker
  // standalone output mode was removed with that migration. The Workers
  // artifact (fully self-contained) is produced by `bun run cf:build`
  // under `.open-next/`.
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
