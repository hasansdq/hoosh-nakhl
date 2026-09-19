import "server-only";

/**
 * Nakhl Restaurant — filesystem storage backend for uploads (Docker / VPS)
 * ----------------------------------------------------------------------
 * Mirror of the R2 backend for the Node deployment target: uploaded images
 * are written to a directory on the persistent Docker volume
 * (`NAKHL_UPLOADS_DIR`, set by docker/entrypoint.sh → /app/data/uploads) and
 * served by the same `/f/[...key]` route.
 *
 * Module-safety for the Cloudflare build: this file IS statically importable
 * from server code (and therefore present in the worker bundle), but every
 * Node built-in it needs is loaded through a non-literal, bundler-excluded
 * dynamic import (the proven src/lib/ai/index.ts pattern) — nothing Node-
 * specific is evaluated at import time, and none of these code paths ever
 * execute on workerd (the storage selector in ./index.ts picks R2 there).
 *
 * Keys follow the exact R2 naming scheme (`food|avatar|general-<uuid>.<ext>`)
 * and are validated against a strict regex before touching the filesystem,
 * so path traversal is impossible by construction.
 */

/** Valid storage key — one flat directory, UUID filename, fixed extensions. */
export const FS_UPLOAD_KEY_RE =
  /^(food|avatar|general)-[0-9a-f-]{36}\.(webp|jpg|png|gif|avif)$/i;

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  webp: "image/webp",
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  avif: "image/avif",
};

type NodeFsPromises = typeof import("node:fs/promises");

/**
 * Lazily load `node:fs/promises`.
 *
 * A LITERAL `node:` builtin specifier is the one form that every tool in
 * both deployment pipelines passes through untouched: Turbopack emits it as
 * a native dynamic import (never a stub), esbuild cannot resolve the `node:`
 * scheme for the Workers bundle, and the file tracer recognizes builtins
 * (no whole-repo tracing fallback). Executed on the Node runtime only — on
 * workerd the storage selector in ./index.ts always picks R2 instead.
 */
async function nodeFs(): Promise<NodeFsPromises> {
  return import("node:fs/promises");
}

/** True when the Node filesystem backend is configured (env var present). */
export function fsUploadsConfigured(): boolean {
  return typeof process.env.NAKHL_UPLOADS_DIR === "string" && process.env.NAKHL_UPLOADS_DIR !== "";
}

function uploadsDir(): string {
  const dir = process.env.NAKHL_UPLOADS_DIR;
  if (!dir) {
    throw new Error("NAKHL_UPLOADS_DIR is not set — filesystem uploads backend is unavailable");
  }
  return dir.replace(/\/+$/, "");
}

/** Key → absolute path (or null when the key fails validation). */
function safePath(key: string): string | null {
  if (!FS_UPLOAD_KEY_RE.test(key)) return null;
  return `${uploadsDir()}/${key}`;
}

/** Write an upload to disk (creates the directory on first use). */
export async function fsPutUpload(key: string, bytes: Uint8Array): Promise<void> {
  const target = safePath(key);
  if (!target) throw new Error(`invalid upload key: ${key}`);
  const fsp = await nodeFs();
  await fsp.mkdir(uploadsDir(), { recursive: true });
  await fsp.writeFile(target, bytes);
}

export interface FsStoredObject {
  bytes: Uint8Array;
  contentType: string;
}

/** Read an upload from disk; null = missing (ENOENT or invalid key). */
export async function fsGetUpload(key: string): Promise<FsStoredObject | null> {
  const target = safePath(key);
  if (!target) return null;
  const extension = key.split(".").pop()?.toLowerCase() ?? "";
  try {
    const fsp = await nodeFs();
    const buffer = await fsp.readFile(target);
    return {
      bytes: new Uint8Array(buffer),
      contentType: CONTENT_TYPE_BY_EXT[extension] ?? "application/octet-stream",
    };
  } catch {
    // missing file → treated as "not found" by the /f/ route
    return null;
  }
}

/** Best-effort delete (missing files are fine — mirrors R2 delete semantics). */
export async function fsDeleteUpload(key: string): Promise<void> {
  const target = safePath(key);
  if (!target) return;
  try {
    const fsp = await nodeFs();
    await fsp.unlink(target);
  } catch {
    // already gone
  }
}
