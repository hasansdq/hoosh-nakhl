import "server-only";
import { db } from "@/lib/db";
import { getCloudflareEnv, isWorkersRuntime, type R2Bucket } from "@/lib/cf";
import { fsDeleteUpload, fsGetUpload, fsPutUpload, fsUploadsConfigured } from "@/lib/uploads/fs-store";

/**
 * Nakhl Restaurant — image uploads (dual storage backend)
 * --------------------------------------------------------
 * • Cloudflare (production + local `next dev` via Miniflare): the R2 bucket
 *   bound as `R2` in wrangler.jsonc. Objects are streamed to browsers by the
 *   route handler at `/f/[...key]` with immutable-cache headers.
 *
 * • Docker / VPS (Node standalone): when `NAKHL_UPLOADS_DIR` is set (done by
 *   docker/entrypoint.sh → /app/data/uploads on the persistent volume), the
 *   same public contract is served from the local filesystem via
 *   src/lib/uploads/fs-store.ts. Keys, URLs (`/f/<key>`), validation and the
 *   DB record are identical across both backends, so nothing downstream
 *   (menu images, avatars, CMS content images) ever needs to know which
 *   backend is active.
 *
 * Validation (type allow-list + 5MB cap) is backend-independent; files are
 * stored as received (dimensions/quality unchanged).
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

/** URL prefix under which stored objects are served (both backends). */
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
// Storage backend selection
// ---------------------------------------------------------------------------

type StorageBackend =
  | { kind: "r2"; bucket: R2Bucket }
  | { kind: "fs" };

/**
 * Resolve the active storage backend:
 *  1. R2 binding present (Workers / Miniflare dev) → R2;
 *  2. NAKHL_UPLOADS_DIR set and not on workerd → Node filesystem (Docker);
 *  3. otherwise → null (callers return a clean API error).
 */
async function getStorage(): Promise<StorageBackend | null> {
  const env = await getCloudflareEnv();
  if (env?.R2) return { kind: "r2", bucket: env.R2 };
  if (!isWorkersRuntime() && fsUploadsConfigured()) return { kind: "fs" };
  return null;
}

/** Extract the storage key from a stored upload URL (`/f/<key>` or legacy `/uploads/<file>`). */
function keyFromUrl(url: string): string | null {
  if (url.startsWith(UPLOAD_URL_PREFIX)) {
    return url.slice(UPLOAD_URL_PREFIX.length) || null;
  }
  // legacy filesystem URLs (pre-Cloudflare rows): object key == basename
  if (url.startsWith("/uploads/")) {
    return url.slice("/uploads/".length) || null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API — save / delete (used by the upload routes)
// ---------------------------------------------------------------------------

/**
 * Store an uploaded image and record it in the database.
 * Keys embed the kind and a random UUID (collision-free, immutable-cache
 * friendly) — identical on both backends.
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

    const storage = await getStorage();
    if (!storage) {
      return {
        success: false,
        error:
          "فضای ذخیره‌سازی در دسترس نیست (در کلادفلر binding «R2» و در داکر متغیر NAKHL_UPLOADS_DIR را بررسی کنید)",
      };
    }

    const extension = EXTENSION_BY_TYPE[file.type] ?? "bin";
    const key = `${kind}-${crypto.randomUUID()}.${extension}`;
    const bytes = new Uint8Array(await file.arrayBuffer());

    if (storage.kind === "r2") {
      await storage.bucket.put(key, bytes, {
        httpMetadata: {
          contentType: file.type,
          cacheControl: "public, max-age=31536000, immutable",
        },
      });
    } else {
      await fsPutUpload(key, bytes);
    }

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

    const storage = await getStorage();
    if (storage?.kind === "r2") {
      await storage.bucket.delete(key);
    } else if (storage?.kind === "fs") {
      await fsDeleteUpload(key);
    } else {
      console.warn("[uploads] no storage backend — deleted the DB row only");
    }
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
  /** R2 → response stream; filesystem → in-memory bytes (≤5MB by policy). */
  body: ReadableStream | Uint8Array;
  contentType: string;
  size: number;
  etag?: string;
}

/**
 * Fetch a stored object by its validated key for the `/f/` route.
 * Returns null when the object does not exist.
 */
export async function getStoredObject(key: string): Promise<StoredObject | null> {
  const storage = await getStorage();
  if (!storage) return null;

  if (storage.kind === "r2") {
    const object = await storage.bucket.get(key);
    if (!object || !object.body) return null;
    return {
      body: object.body,
      contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
      size: object.size,
      etag: object.httpEtag,
    };
  }

  const file = await fsGetUpload(key);
  if (!file) return null;
  return {
    body: file.bytes,
    contentType: file.contentType,
    size: file.bytes.byteLength,
    etag: undefined,
  };
}
