import "server-only";
import { db } from "@/lib/db";
import sharp from "sharp";
import { randomUUID } from "crypto";
import { mkdir, writeFile, unlink } from "fs/promises";
import path from "path";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
];

export interface UploadResult {
  success: boolean;
  url?: string;
  filename?: string;
  size?: number;
  error?: string;
}

export type ImageKind = "food" | "avatar" | "general";

/**
 * Professional image upload: validates, optimizes via sharp, stores under /public/uploads,
 * records in DB. Avatars are squared 400px; food images max 1200px webp.
 */
export async function saveImageUpload(
  file: File,
  opts: { kind?: ImageKind; uploadedBy?: string }
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

    const buffer = Buffer.from(await file.arrayBuffer());

    // Optimize with sharp
    const pipeline = sharp(buffer, { failOn: "none" }).rotate();
    let output: Buffer;
    let width: number | undefined;
    let height: number | undefined;

    if (kind === "avatar") {
      output = await pipeline
        .resize(400, 400, { fit: "cover", position: "attention" })
        .webp({ quality: 85 })
        .toBuffer();
      width = height = 400;
    } else if (kind === "food") {
      output = await pipeline
        .resize(1200, 900, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
    } else {
      output = await pipeline
        .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();
    }

    const meta = await sharp(output).metadata();

    const filename = `${kind}-${randomUUID()}.webp`;
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(path.join(UPLOAD_DIR, filename), output);

    const url = `/uploads/${filename}`;
    await db.upload.create({
      data: {
        filename,
        url,
        mimeType: "image/webp",
        size: output.length,
        uploadedBy: opts.uploadedBy ?? null,
      },
    });

    return { success: true, url, filename, size: output.length, ...(width ? { width, height } : {}) } as UploadResult;
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? `خطا در پردازش تصویر: ${e.message}` : "خطای نامشخص در آپلود",
    };
  }
}

/** Delete an uploaded file by URL (admin) */
export async function deleteUploadByUrl(url: string): Promise<boolean> {
  try {
    const record = await db.upload.findFirst({ where: { url } });
    if (!record) return false;
    const filename = path.basename(url);
    await unlink(path.join(UPLOAD_DIR, filename)).catch(() => {});
    await db.upload.delete({ where: { id: record.id } });
    return true;
  } catch {
    return false;
  }
}
