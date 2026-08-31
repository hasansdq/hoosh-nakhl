import "server-only";
import { db } from "@/lib/db";
import { getCloudflareEnv } from "@/lib/cf";

/**
 * Nakhl Restaurant — image uploads on Cloudflare R2
 * --------------------------------------------------
 * Storage backend: the R2 bucket bound as `R2` in wrangler.jsonc (also
 * available in local `next dev` through Miniflare — persistent state under
 * `.wrangler/state`). Stored objects are served by the route handler at
 * `/f/[...key]` (see src/app/f/[...key]/route.ts), which streams bytes from
 * R2 with immutable-cache headers.
 *
 * Validation (type allow-list + 5MB cap) matches the previous filesystem
 * implementation; the sharp re-encode pipeline of the sandbox build was a
 * Node-only optimization step and is intentionally not part of the
 * Cloudflare runtime — files are stored as received (dimensions/quality
 * unchanged).
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

/** URL prefix under which stored R2 objects are served. */
export const UPLOAD_URL_PREFIX = "/f/";

export interface UploadResult {
  success: boolean;
  url?: string;
  filename?: string;
  size?: number;
  error?: string;
}

export type ImageKind = "food" | "avatar" | "general";

/** Extract the R2 object key from a stored upload URL (`/f/<key>` or legacy `/uploads/<file>`). */
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

/**
 * Store an uploaded image in R2 and record it in the database.
 * Avatars and food images keep their original bytes; the key embeds the
 * kind and a random UUID (collision-free, immutable-cache friendly).
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

    const env = await getCloudflareEnv();
    const bucket = env?.R2;
    if (!bucket) {
      return {
        success: false,
        error: "فضای ذخیره‌سازی R2 در دسترس نیست (اتصال binding «R2» را بررسی کنید)",
      };
    }

    const extension = EXTENSION_BY_TYPE[file.type] ?? "bin";
    const key = `${kind}-${crypto.randomUUID()}.${extension}`;
    const bytes = new Uint8Array(await file.arrayBuffer());

    await bucket.put(key, bytes, {
      httpMetadata: {
        contentType: file.type,
        cacheControl: "public, max-age=31536000, immutable",
      },
    });

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

/** Delete an uploaded file by URL (admin) — removes the R2 object and its DB row. */
export async function deleteUploadByUrl(url: string): Promise<boolean> {
  try {
    const key = keyFromUrl(url);
    if (!key) return false;

    const record = await db.upload.findFirst({ where: { url } });
    if (!record) return false;

    const env = await getCloudflareEnv();
    const bucket = env?.R2;
    if (bucket) {
      await bucket.delete(key);
    } else {
      console.warn("[uploads] R2 binding missing — deleted the DB row only");
    }
    await db.upload.delete({ where: { id: record.id } });
    return true;
  } catch {
    return false;
  }
}
