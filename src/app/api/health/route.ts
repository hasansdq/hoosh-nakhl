import { db } from "@/lib/db";

/**
 * GET /api/health — liveness + readiness probe
 * ---------------------------------------------
 * Used by the Docker HEALTHCHECK, the reverse proxy and external uptime
 * monitors. 200 = web process up AND database reachable; 503 = database
 * unreachable (e.g. corrupted/moved SQLite file).
 * Deliberately dynamic (no caching) and dependency-free besides the db ping.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json(
      {
        ok: true,
        service: "nakhl-web",
        db: "up",
        version: process.env.npm_package_version ?? "1.0.0",
        time: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("health check db failure:", e);
    return Response.json(
      { ok: false, service: "nakhl-web", db: "down", latencyMs: Date.now() - startedAt },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
