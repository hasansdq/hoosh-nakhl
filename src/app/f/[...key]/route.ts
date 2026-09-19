import { getStoredObject } from "@/lib/uploads";

/**
 * GET /f/<object-key> — serve an uploaded image from the active storage
 * backend (Cloudflare R2 on Workers, filesystem volume on Docker/VPS).
 *
 * Upload URLs (`/f/food-<uuid>.webp` …) are stored in the database and
 * rendered by the UI. Object keys are immutable (UUID-based), so responses
 * carry `Cache-Control: immutable` for browser/CDN caching.
 *
 * In local development the same route reads from the Miniflare R2 bucket
 * (persistent state in `.wrangler/state`) — one code path for every runtime.
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

  const object = await getStoredObject(key);
  if (!object) {
    // distinguish "no backend configured" from "object missing"? Both are
    // cacheable-negative from the client's perspective — keep 404 simple.
    return new Response("not found", { status: 404 });
  }

  const headers = new Headers();
  headers.set("Content-Type", object.contentType);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  if (object.etag) {
    headers.set("ETag", object.etag);
  }
  if (typeof object.size === "number") {
    headers.set("Content-Length", String(object.size));
  }

  return new Response(object.body as BodyInit, { status: 200, headers });
}
