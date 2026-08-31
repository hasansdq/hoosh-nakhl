import { getCloudflareEnv } from "@/lib/cf";

/**
 * GET /f/<object-key> — serve an uploaded image from Cloudflare R2.
 *
 * Upload URLs (`/f/food-<uuid>.webp` …) are stored in the database and
 * rendered by the UI. Object keys are immutable (UUID-based), so responses
 * carry `Cache-Control: immutable` for browser/CDN caching.
 *
 * In local development the same route reads from the Miniflare R2 bucket
 * (persistent state in `.wrangler/state`) — one code path for dev and prod.
 */

const KEY_RE = /^(food|avatar|general)-[0-9a-f-]{36}\.(webp|jpg|png|gif|avif)$/i;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  const { key: segments } = await params;
  const key = segments.map((segment) => decodeURIComponent(segment)).join("/");

  if (!KEY_RE.test(key)) {
    return new Response("not found", { status: 404 });
  }

  const env = await getCloudflareEnv();
  const bucket = env?.R2;
  if (!bucket) {
    return new Response("storage unavailable", { status: 503 });
  }

  const object = await bucket.get(key);
  if (!object || !object.body) {
    return new Response("not found", { status: 404 });
  }

  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType ?? "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  if (object.httpEtag) {
    headers.set("ETag", object.httpEtag);
  }
  if (typeof object.size === "number") {
    headers.set("Content-Length", String(object.size));
  }

  return new Response(object.body, { status: 200, headers });
}
