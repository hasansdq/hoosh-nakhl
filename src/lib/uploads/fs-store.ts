import "server-only";

/**
 * Nakhl Restaurant — filesystem storage backend for uploads
 * ----------------------------------------------------------------------
 * Uploaded images are written to a directory on the persistent Docker volume
 * (`NAKHL_UPLOADS_DIR`, set by docker/entrypoint.sh → /app/data/uploads) and
 * served by the same `/f/[...key]` route. Local `next dev` falls back to
 * `db/uploads` inside the repo (gitignored) so the admin panel's upload
 * features work out of the box.
 *
 * Keys follow the naming scheme (`food|avatar|general-<uuid>.<ext>`) and are
 * validated against a strict regex before touching the filesystem, so path
 * traversal is impossible by construction.
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
 * A LITERAL `node:` builtin specifier is the one form that every bundler in
 * the pipeline passes through untouched: Turbopack emits it as a native
 * dynamic import (never a stub), and the output-file tracer recognizes
 * builtins (no whole-repo tracing fallback).
 */
async function nodeFs(): Promise<NodeFsPromises> {
  return import("node:fs/promises");
}

/** Uploads root: explicit env (Docker volume) → repo dev default. */
function uploadsDir(): string {
  return (process.env.NAKHL_UPLOADS_DIR || "db/uploads").replace(/\/+$/, "");
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
