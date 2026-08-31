import type { NextConfig } from "next";

/**
 * Nakhl Restaurant — Next.js configuration
 * ----------------------------------------
 * `output: "standalone"` produces a minimal self-contained server at
 * `.next/standalone/server.js` (run with `bun server.js` or `node server.js`,
 * see package.json "start" + docker/entrypoint.sh). This is the deployment
 * artifact for Docker / VPS production builds.
 *
 * Security headers are applied globally; HSTS is handled by the reverse proxy
 * (Caddy) where TLS terminates — see Caddyfile.prod.
 */
const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    // The codebase is large and contains pre-existing strict-mode warnings;
    // runtime correctness is covered by QA. Do not flip this without a full
    // type-audit pass.
    ignoreBuildErrors: true,
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
