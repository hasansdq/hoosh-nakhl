import "server-only";
import { db } from "@/lib/db";
import { fsDeleteUpload, fsGetUpload, fsPutUpload } from "@/lib/uploads/fs-store";

/**
 * Nakhl Restaurant — image uploads (filesystem storage)
 * ------------------------------------------------------
 * Uploaded images are written to a directory on the persistent Docker volume
 * (`NAKHL_UPLOADS_DIR`, set by docker/entrypoint.sh → /app/data/uploads) and
 * streamed to browsers by the route handler at `/f/[...key]` with
 * immutable-cache headers. Local `next dev` falls back to `db/uploads`
 * inside the repo (gitignored).
 *
 * Keys embed the kind and a random UUID (collision-free, immutable-cache
 * friendly); validation (type allow-list + 5MB cap) happens here, and the
 * key regex in fs-store makes path traversal impossible by construction.
 */

const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
];

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

/** URL prefix under which stored objects are served. */
export const UPLOAD_URL_PREFIX = "/f/";

export interface UploadResult {
  success: boolean;
  url?: string;
  filename?: string;
  size?: number;
  error?: string;
}

export type ImageKind = "food" | "avatar" | "general";

// ---------------------------------------------------------------------------
// Public API — save / delete (used by the upload routes)
// ---------------------------------------------------------------------------

/**
 * Store an uploaded image and record it in the database.
 * Keys embed the kind and a random UUID (collision-free, immutable-cache
 * friendly).
 */
export async function saveImageUpload(
  file: File,
  opts: { kind?: ImageKind; uploadedBy?: string },
): Promise<UploadResult> {
  const kind = opts.kind ?? "general";
  try {
    if (!file || file.size === 0) {
      return { success: false, error: "فایلی ارسال نشده است" };
    }
    if (file.size > MAX_SIZE) {
      return { success: false, error: "حجم فایل نباید بیشتر از ۵ مگابایت باشد" };
    }
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return { success: false, error: "فرمت فایل مجاز نیست (JPG، PNG، WebP، GIF)" };
    }

    const extension = EXTENSION_BY_TYPE[file.type] ?? "bin";
    const key = `${kind}-${crypto.randomUUID()}.${extension}`;
    const bytes = new Uint8Array(await file.arrayBuffer());

    await fsPutUpload(key, bytes);

    const url = `${UPLOAD_URL_PREFIX}${key}`;
    await db.upload.create({
      data: {
        filename: key,
        url,
        mimeType: file.type,
        size: bytes.byteLength,
        uploadedBy: opts.uploadedBy ?? null,
      },
    });

    return { success: true, url, filename: key, size: bytes.byteLength };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? `خطا در پردازش تصویر: ${e.message}` : "خطای نامشخص در آپلود",
    };
  }
}

/** Delete an uploaded file by URL (admin) — removes the object and its DB row. */
export async function deleteUploadByUrl(url: string): Promise<boolean> {
  try {
    const key = keyFromUrl(url);
    if (!key) return false;

    const record = await db.upload.findFirst({ where: { url } });
    if (!record) return false;

    await fsDeleteUpload(key);
    await db.upload.delete({ where: { id: record.id } });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API — read (used by the /f/[...key] route)
// ---------------------------------------------------------------------------

export interface StoredObject {
  /** In-memory bytes (≤5MB by policy). */
  body: Uint8Array;
  contentType: string;
  size: number;
  etag?: string;
}

/**
 * Fetch a stored object by its validated key for the `/f/` route.
 * Returns null when the object does not exist.
 */
export async function getStoredObject(key: string): Promise<StoredObject | null> {
  const file = await fsGetUpload(key);
  if (!file) return null;
  return {
    body: file.bytes,
    contentType: file.contentType,
    size: file.bytes.byteLength,
    etag: undefined,
  };
}

/** Extract the storage key from a stored upload URL (`/f/<key>` or legacy `/uploads/<file>`). */
function keyFromUrl(url: string): string | null {
  if (url.startsWith(UPLOAD_URL_PREFIX)) {
    return url.slice(UPLOAD_URL_PREFIX.length) || null;
  }
  // legacy filesystem URLs: object key == basename
  if (url.startsWith("/uploads/")) {
    return url.slice("/uploads/".length) || null;
  }
  return null;
}
