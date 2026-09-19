import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import type { BaranSettings } from "@/lib/settings";
import { saveImageUpload, deleteUploadByUrl } from "@/lib/uploads";

/**
 * Nakhl Restaurant — Baran accounting software integration
 * --------------------------------------------------------------------
 * Implements the site side of «Baran_OnlineShopApi V5.0»:
 *
 *   POST /api/ApiServiceBaran/ProductSEND  — products  Baran → site
 *   POST /api/ApiServiceBaran/SENDPics     — pictures  Baran → site
 *   GET  /api/ApiServiceBaran/Orders       — orders    site → Baran (pull)
 *   POST /api/ApiServiceBaran/ClearOrders  — ack «don't resend» (Baran → site)
 *
 * Engineering rules distilled from the official docs:
 *  • Input fields are optional to consume — we map ONLY what our schema has.
 *  • Output fields are consumed by Baran and must NEVER be null; every
 *    numeric/string output gets an explicit fallback (0 / "").
 *  • Per-item results (StatusId 0/1) drive Baran's retry behaviour: 1 = stop
 *    sending this item, 0 = send again next time.
 *  • Customers created on the site get numeric ids > 500000 (doc requirement)
 *    and mobile numbers are normalized to 09XXXXXXXXX.
 *
 * Delivery semantics for orders (at-least-once + explicit ack):
 *  • GET Orders returns only orders with baranSentAt = NULL.
 *  • ClearOrders(ItemType=2) stamps baranSentAt → they never reappear.
 *  • Factor numbers are assigned lazily and stay stable across polls, so a
 *    Baran crash between fetch and ack is harmless (same numbers re-fetched).
 *
 * Dual-runtime safe (Cloudflare Workers + Docker/Node): atob/File/crypto are
 * used only through web-standard globals available on both runtimes.
 */

// ============ C# wire types (exact PascalCase contract) ============

export interface BaranProductModel {
  ProductId: number;
  MainGroupId: number;
  MainGroupName: string;
  GroupId: number;
  GroupName: string;
  ProductName: string;
  ProductName2: string; // doc: «ProductName٢» — normalized on read
  UnitId: number;
  UnitText: string;
  ProductStatus: number; // 0 بدون برچسب | 1 دارای تخفیف | 2 پیشنهاد ما | 3 ویژه
  DiscountPrecent: number;
  SellPrice: number;
  IgnoreStock: number; // 0 چک موجودی | 1 بدون انبار
  RemainCount: number;
  PictureName: string;
  ProductComment: string;
  OrderIndex: number;
  ChangeType: number; // 0 درج | 1 ویرایش | 2 حذف
}

export interface BaranResultOut {
  BaranId: number;
  StatusId: number; // 0 خطا | 1 موفق
  Message: string;
}

export interface BaranFileModel {
  Myfile: string; // base64
  PicFileName: string;
  PicTypeFile: string;
  LocationFile: string;
}

export interface BaranStatusPicture {
  StatusPicture: number; // 0 خطا | 1 موفق
  FilePicName: string;
}

export interface BaranOrderItemModel {
  OrderId: number;
  ProductId: number;
  ProductName: string;
  ProductCount: number;
  ProductPrice: number;
  DiscountPrecent: number;
  ItemComment: string;
  VariationID: string; // «فعلاً کاربردی ندارد و مقدار صفر ارسال شود»
}

export interface BaranOrderModel {
  FactorNumber: number;
  Date: string;
  SendTime: string;
  TotalAmount: number;
  ProductDiscount: number;
  DiscountCode: string;
  DiscountAmount: number;
  TotalDiscountAmount: number;
  SendAmount: number;
  CustomerClubAmount: number;
  FinalAmount: number;
  Comment: string;
  PaymentCode: number; // 0 در محل | 1 آنلاین
  PaymentTitle: string;
  CustomerId: number;
  CustomerName: string;
  CustomerPhone: string;
  CustomerAddress: string;
  CustomerSex: number;
  CustomerCode: string;
  CustomerReagentCode: string;
  CustomerEmail: string;
  PackageType: number;
  PackageTitle: string;
  ServiceAmount: number;
  LstOrderItemsModel: BaranOrderItemModel[];
}

export interface BaranOrderResults {
  BaranStatus: number; // 0 خطا | 1 موفق
  LstOrderModel: BaranOrderModel[];
}

export interface BaranClearOrderModel {
  ItemType: number; // 2 سفارش | 5 شارژ کیف پول
  ItemIds: string; // «101-102-103»
}

// ============ Constants ============

/** پرداخت‌شده و پس از آن — سفارش‌های قابل ارسال به باران */
const SENDABLE_ORDER_STATUSES = ["PAID", "PREPARING", "READY", "DELIVERING", "DELIVERED"];

/** سقف اقلام هر فراخوانی — مازاد با StatusId=0 برمی‌گردد تا باران مجدداً ارسال کند */
const MAX_ITEMS_PER_CALL = 300;

/** شمارهٔ فاکتور از ۱ شروع می‌شود؛ شناسهٔ مشتری سایت طبق مستندات باید > 500000 باشد */
const FACTOR_NUMBER_BASE = 0;
const CUSTOMER_ID_BASE = 500000;

/** تهران UTC+3:30 — از ۱۴۰۱ بدون ساعت تابستانی */
const TEHRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000;

const BARAN_LOG_RETENTION_DAYS = 60;

// ============ Small runtime helpers (dual-runtime) ============

/** تبدیل ارقام فارسی/عربی به لاتین */
export function normalizeDigits(input: string): string {
  return input
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

function str(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length ? t : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function toInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string") {
    const n = Number(normalizeDigits(v).replace(/[,٬\s]/g, ""));
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(normalizeDigits(v).replace(/[,٬\s]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** ورودی JSON نرم — آرایه، یا آبجکتِ دربرگیرندهٔ آرایه */
function asArray(input: unknown): unknown[] {
  if (Array.isArray(input)) return input;
  if (input && typeof input === "object") {
    for (const v of Object.values(input as Record<string, unknown>)) {
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

/** «yyyy-MM-ddTHH:mm:ss» به وقت محلی تهران */
function tehranLocalIso(d: Date): string {
  return new Date(d.getTime() + TEHRAN_OFFSET_MS).toISOString().slice(0, 19);
}

/** «HH:mm:ss» به وقت محلی تهران */
function tehranLocalTime(d: Date): string {
  return new Date(d.getTime() + TEHRAN_OFFSET_MS).toISOString().slice(11, 19);
}

/** نرمال‌سازی شمارهٔ همراه سایت (98XXXXXXXXXX) به فرمت مستند باران (09XXXXXXXXX) */
function toBaranPhone(phone: string): string {
  const p = normalizeDigits(phone).replace(/\D/g, "");
  if (p.startsWith("98")) return `0${p.slice(2)}`;
  if (p.startsWith("9") && p.length === 10) return `0${p}`;
  return p;
}

/** base64 (با/بدون پیشوند data:) → بایت‌ها */
function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^,]*,/i, "").replace(/\s+/g, "");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** تشخیص MIME از بایت‌های آغازین فایل */
function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (riff === "RIFF" && webp === "WEBP") return "image/webp";
  return null;
}

/** مقایسهٔ مقاوم در برابر حملات زمانی — هش هر دو طرف و مقایسهٔ دیجست */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = va.length ^ vb.length;
  for (let i = 0; i < Math.min(va.length, vb.length); i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

// ============ Settings & auth ============

export async function getBaranSettings(): Promise<BaranSettings> {
  return getSettings<BaranSettings>("baran");
}

export function generateBaranApiKey(): string {
  return `bk_${crypto.randomUUID().replaceAll("-", "")}`;
}

/** استخراج کلید از هدر یا کوئری — نرم‌افزارهای مختلف کانال‌های متفاوتی دارند */
function extractApiKey(req: NextRequest): string {
  const header = req.headers.get("x-api-key")?.trim();
  if (header) return header;
  const auth = req.headers.get("authorization")?.trim();
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const q = req.nextUrl.searchParams;
  return (q.get("apikey") ?? q.get("key") ?? q.get("token") ?? "").trim();
}

/**
 * نگهبان احراز اتصال باران:
 *  • غیرفعال → 503 با پیام روشن
 *  • کلید الزامی و غایب/نادرست → 401
 */
export async function baranGuard(req: NextRequest): Promise<NextResponse | null> {
  const s = await getBaranSettings();
  if (!s.enabled) {
    return NextResponse.json(
      { error: "اتصال نرم‌افزار باران روی سایت فعال نیست — از پنل مدیریت › اتصال باران فعال کنید" },
      { status: 503 },
    );
  }
  if (s.requireKey && s.apiKey) {
    const provided = extractApiKey(req);
    if (!provided || !(await safeEqual(provided, s.apiKey))) {
      return NextResponse.json({ error: "کلید API نامعتبر یا ارسال‌نشده است" }, { status: 401 });
    }
  }
  return null;
}

// ============ Sync log ============

interface LogSummary {
  ok: number;
  fail: number;
  total: number;
  message?: string;
  errors?: { id: string | number; message: string }[];
}

async function logBaranCall(
  method: string,
  ip: string | null,
  summary: LogSummary,
): Promise<void> {
  try {
    let detail: string | null = null;
    if (summary.errors?.length) {
      detail = JSON.stringify({ errors: summary.errors.slice(0, 50) }).slice(0, 4000);
    }
    await db.baranSyncLog.create({
      data: {
        method,
        totalCount: summary.total,
        okCount: summary.ok,
        failCount: summary.fail,
        message: summary.message ?? null,
        detail,
        ip,
      },
    });
    // هرازگاهی لاگ‌های قدیمی‌تر از دورهٔ نگهداری حذف شوند
    if (Math.random() < 0.1) {
      const cutoff = new Date(Date.now() - BARAN_LOG_RETENTION_DAYS * 24 * 3600 * 1000);
      await db.baranSyncLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    }
  } catch (e) {
    console.error("[baran] sync-log failed:", e);
  }
}

function clientIp(req: NextRequest): string | null {
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}

// ============ ProductSEND — محصولات از باران به سایت ============

/** نام کالا — مستندات باران نام دوم را «ProductName٢» (با رقم عربی) می‌نویسند */
function productName(p: Record<string, unknown>): string | null {
  return (
    str(p.ProductName) ??
    str(p["ProductName٢"]) ??
    str(p.ProductName2) ??
    str(p["ProductName۱"]) ??
    str(p.ProductName1)
  );
}

async function resolveBaranCategory(
  p: Record<string, unknown>,
  settings: BaranSettings,
): Promise<{ id: string }> {
  const level = settings.categoryLevel;
  const gId =
    level === "main"
      ? toInt(p.MainGroupId)
      : toInt(p.GroupId) ?? toInt(p.MainGroupId);
  const gName =
    level === "main"
      ? str(p.MainGroupName)
      : str(p.GroupName) ?? str(p.MainGroupName);
  if (!gId) throw new Error("کد گروه کالا (GroupId/MainGroupId) نامعتبر است");

  // ۱) دستهٔ متصل به همین گروه باران
  let category = await db.category.findFirst({ where: { baranGroupId: gId } });

  // ۲) فرخوانی: دستهٔ هم‌نامِ موجود (بدون اتصال باران) به این گروه متصل می‌شود —
  //    از ساخت دسته‌های تکراری با نام یکسان جلوگیری می‌کند
  if (!category && gName) {
    category = await db.category.findFirst({
      where: { name: gName, OR: [{ baranGroupId: null }, { baranGroupId: gId }] },
    });
    if (category) {
      category = await db.category.update({
        where: { id: category.id },
        data: { baranGroupId: gId, baranMainGroupId: toInt(p.MainGroupId) ?? gId },
      });
    }
  }

  // ۳) ساخت دستهٔ جدید
  if (!category) {
    const name = gName ?? `گروه ${gId}`;
    category = await db.category.create({
      data: {
        name,
        slug: `cat-${gId}-${crypto.randomUUID().slice(0, 8)}`,
        baranGroupId: gId,
        baranMainGroupId: toInt(p.MainGroupId) ?? gId,
        sortOrder: Math.min(Math.max(toInt(p.OrderIndex) ?? 0, 0), 999),
        isActive: true,
      },
    });
  } else if (gName && category.name !== gName) {
    category = await db.category.update({ where: { id: category.id }, data: { name: gName } });
  }
  return category;
}

export async function handleProductSend(
  req: NextRequest,
  body: unknown,
): Promise<NextResponse> {
  const ip = clientIp(req);
  const settings = await getBaranSettings();
  const products = asArray(body);
  const results: BaranResultOut[] = [];
  const errors: { id: string | number; message: string }[] = [];

  for (const [index, raw] of products.entries()) {
    if (index >= MAX_ITEMS_PER_CALL) {
      // باقی اقلام را با خطای صریح برمی‌گردانیم تا باران در مرتبهٔ بعد ارسال کند
      const p = raw as Record<string, unknown>;
      results.push({
        BaranId: toInt(p?.ProductId) ?? 0,
        StatusId: 0,
        Message: `سقف ${MAX_ITEMS_PER_CALL} کالا در هر فراخوانی — در دستهٔ بعدی ارسال شود`,
      });
      continue;
    }
    let productId = 0;
    try {
      const p = raw as Record<string, unknown>;
      productId = toInt(p.ProductId) ?? 0;
      if (productId <= 0) throw new Error("کد کالا (ProductId) نامعتبر است");

      const name = productName(p);
      const changeType = toInt(p.ChangeType) ?? 0;

      // ---- حذف (ChangeType=2): مخفی‌سازی به‌جای حذف فیزیکی ----
      if (changeType === 2) {
        const existing = await db.menuItem.findUnique({ where: { baranProductId: productId } });
        if (existing) {
          await db.menuItem.update({
            where: { id: existing.id },
            data: {
              isAvailable: settings.hideDeleted ? false : existing.isAvailable,
              baranSyncedAt: new Date(),
            },
          });
          results.push({ BaranId: productId, StatusId: 1, Message: "کالای حذف‌شده از فهرست منو خارج شد" });
        } else {
          results.push({ BaranId: productId, StatusId: 1, Message: "کالایی برای حذف یافت نشد — نادیده گرفته شد" });
        }
        continue;
      }

      if (!name) throw new Error("نام کالا (ProductName) خالی است");
      if (name.length > 120) throw new Error("نام کالا بیش از حد طولانی است");

      const category = await resolveBaranCategory(p, settings);

      // ---- قیمت: قیمت فروش با احتساب درصد تخفیف ----
      const sell = toNum(p.SellPrice);
      const discountPercent = Math.min(Math.max(toNum(p.DiscountPrecent) ?? 0, 0), 100);
      const existing = await db.menuItem.findUnique({ where: { baranProductId: productId } });
      if (sell === null && !existing) throw new Error("قیمت فروش (SellPrice) ارسال نشده است");
      const base = sell ?? existing!.price;
      const finalPrice = Math.max(0, Math.round(base * (1 - discountPercent / 100)));

      // ---- موجودی ----
      // غیبت هر دو فیلد انبار در ویرایش یعنی «بدون تغییر» — وضعیت فعلی حفظ می‌شود
      const hasStockInfo = p.IgnoreStock != null || p.RemainCount != null;
      const ignoreStock = toInt(p.IgnoreStock) ?? 1;
      const remain = toNum(p.RemainCount) ?? 0;
      const stockAvailable = hasStockInfo
        ? ignoreStock === 1 || remain > 0
        : (existing?.isAvailable ?? true);

      // ---- تصویر: اگر فایل مربوطه قبلاً از SENDPics رسیده باشد ----
      // غیبت PictureName در ویرایش یعنی «بدون تغییر» — مقدار موجود پاک نمی‌شود
      const pictureName = str(p.PictureName) ?? existing?.baranPictureName ?? null;
      let imageUrl: string | undefined;
      if (pictureName) {
        const asset = await db.baranAsset.findUnique({ where: { fileName: pictureName } });
        if (asset) imageUrl = asset.url;
      }

      const productStatus = toInt(p.ProductStatus) ?? 0;
      const comment = str(p.ProductComment);

      const data = {
        name,
        description: comment ?? existing?.description ?? null,
        price: finalPrice,
        categoryId: category.id,
        isSpecial: productStatus === 2 || productStatus === 3,
        sortOrder: Math.min(Math.max(toInt(p.OrderIndex) ?? 0, 0), 999),
        baranProductId: productId,
        baranPictureName: pictureName,
        baranUnit: str(p.UnitText),
        baranSyncedAt: new Date(),
        ...(imageUrl !== undefined ? { imageUrl } : {}),
        ...(settings.stockSync ? { isAvailable: stockAvailable } : {}),
      };

      if (existing) {
        await db.menuItem.update({ where: { id: existing.id }, data });
        results.push({ BaranId: productId, StatusId: 1, Message: "کالا به‌روزرسانی شد" });
      } else {
        // فرخوانی: آیتم هم‌نامِ متصل‌نشده در همین دسته به باران متصل می‌شود —
        // از ایجاد ردیف تکراری (مثلاً «کباب کوبیده»ی دمو + باران) جلوگیری می‌کند
        const twin = await db.menuItem.findFirst({
          where: { categoryId: category.id, name, baranProductId: null },
        });
        if (twin) {
          await db.menuItem.update({ where: { id: twin.id }, data });
          results.push({
            BaranId: productId,
            StatusId: 1,
            Message: "کالای هم‌نام موجود به باران متصل و به‌روزرسانی شد",
          });
        } else {
          await db.menuItem.create({
            data: { ...data, isAvailable: settings.stockSync ? stockAvailable : true },
          });
          results.push({ BaranId: productId, StatusId: 1, Message: "کالا ایجاد شد" });
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "خطای نامشخص";
      results.push({ BaranId: productId, StatusId: 0, Message: message });
      errors.push({ id: productId || `ردیف ${index + 1}`, message });
    }
  }

  const ok = results.filter((r) => r.StatusId === 1).length;
  await logBaranCall("ProductSEND", ip, {
    total: products.length,
    ok,
    fail: results.length - ok,
    message: `دریافت ${toPersianCount(products.length)} کالا — ${toPersianCount(ok)} موفق`,
    errors,
  });

  return NextResponse.json(results);
}

function toPersianCount(n: number): string {
  return new Intl.NumberFormat("fa-IR").format(n);
}

// ============ SENDPics — تصاویر محصولات از باران ============

export async function handleSendPics(
  req: NextRequest,
  body: unknown,
): Promise<NextResponse> {
  const ip = clientIp(req);
  const results: BaranStatusPicture[] = [];
  const errors: { id: string | number; message: string }[] = [];

  // ورودی: لیست Model_Album_Picture (هر آلبوم دارای ListPicture)
  // تحمل‌پذیر: اگر خود آیتم‌ها Model_File باشند هم پذیرفته می‌شوند
  const files: Record<string, unknown>[] = [];
  for (const album of asArray(body)) {
    if (!album || typeof album !== "object") continue;
    const a = album as Record<string, unknown>;
    const list = a.ListPicture;
    if (Array.isArray(list)) {
      for (const f of list) if (f && typeof f === "object") files.push(f as Record<string, unknown>);
    } else if ("Myfile" in a || "PicFileName" in a) {
      files.push(a);
    }
  }

  let ok = 0;
  for (const [index, f] of files.entries()) {
    if (index >= MAX_ITEMS_PER_CALL) {
      results.push({ StatusPicture: 0, FilePicName: str(f.PicFileName) ?? "" });
      continue;
    }
    const picName = str(f.PicFileName) ?? "";
    try {
      const b64 = typeof f.Myfile === "string" ? f.Myfile : null;
      if (!picName) throw new Error("نام فایل تصویر (PicFileName) خالی است");
      if (!b64) throw new Error("دیتای فایل (Myfile) خالی است");

      const bytes = b64ToBytes(b64);
      if (bytes.byteLength === 0) throw new Error("فایل تصویر خالی است");
      if (bytes.byteLength > 5 * 1024 * 1024) throw new Error("حجم تصویر بیشتر از ۵ مگابایت است");

      const mime = sniffImageMime(bytes);
      if (!mime) throw new Error("فرمت فایل تصویر پشتیبانی نمی‌شود (JPG/PNG/WebP/GIF)");

      const ext = mime === "image/jpeg" ? "jpg" : mime.split("/")[1];
      const safeName = picName.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
      const file = new File(
        [bytes.buffer as ArrayBuffer],
        safeName.endsWith(`.${ext}`) ? safeName : `${safeName}.${ext}`,
        { type: mime },
      );

      const saved = await saveImageUpload(file, { kind: "food", uploadedBy: "baran" });
      if (!saved.success || !saved.url) throw new Error(saved.error ?? "ذخیرهٔ تصویر ناموفق بود");

      // رکورد/به‌روزرسانی دارایی باران — فایل قبلی با همین نام پاک می‌شود
      const prev = await db.baranAsset.findUnique({ where: { fileName: picName } });
      if (prev && prev.url !== saved.url) {
        await deleteUploadByUrl(prev.url).catch(() => false);
      }
      await db.baranAsset.upsert({
        where: { fileName: picName },
        update: {
          mimeType: mime,
          size: bytes.byteLength,
          url: saved.url,
          updatedAt: new Date(),
        },
        create: {
          fileName: picName,
          mimeType: mime,
          size: bytes.byteLength,
          url: saved.url,
        },
      });

      // اتصال به کالای مربوطه (اگر اطلاعات کالا قبلاً رسیده باشد)
      const item = await db.menuItem.findFirst({ where: { baranPictureName: picName } });
      if (item) {
        await db.menuItem.update({
          where: { id: item.id },
          data: { imageUrl: saved.url },
        });
        await db.baranAsset.update({
          where: { fileName: picName },
          data: { linkedMenuItemId: item.id },
        });
      }

      results.push({ StatusPicture: 1, FilePicName: picName });
      ok++;
    } catch (e) {
      const message = e instanceof Error ? e.message : "خطای نامشخص";
      results.push({ StatusPicture: 0, FilePicName: picName });
      errors.push({ id: picName || `تصویر ${index + 1}`, message });
    }
  }

  await logBaranCall("SENDPics", ip, {
    total: files.length,
    ok,
    fail: files.length - ok,
    message: `دریافت ${toPersianCount(files.length)} تصویر — ${toPersianCount(ok)} موفق`,
    errors,
  });

  return NextResponse.json(results);
}

// ============ Orders — سفارش‌های سایت برای باران ============

export async function handleGetOrders(req: NextRequest): Promise<NextResponse> {
  const ip = clientIp(req);
  try {
    const settings = await getBaranSettings();
    const statuses = settings.includePendingOrders
      ? [...SENDABLE_ORDER_STATUSES, "PENDING_PAYMENT"]
      : SENDABLE_ORDER_STATUSES;

    const orders = await db.order.findMany({
      where: { baranSentAt: null, status: { in: statuses } },
      orderBy: { createdAt: "asc" },
      take: 100,
      include: {
        items: { include: { menuItem: { select: { baranProductId: true } } } },
        user: true,
      },
    });

    // ---- تخصیص پایدار شمارهٔ فاکتور و شناسهٔ مشتری (تنها بار اول) ----
    const maxFactor = await db.order.aggregate({ _max: { baranFactorNumber: true } });
    let nextFactor = Math.max(maxFactor._max.baranFactorNumber ?? FACTOR_NUMBER_BASE, FACTOR_NUMBER_BASE);
    for (const o of orders) {
      if (o.baranFactorNumber == null) {
        nextFactor += 1;
        try {
          await db.order.update({ where: { id: o.id }, data: { baranFactorNumber: nextFactor } });
          o.baranFactorNumber = nextFactor;
        } catch {
          o.baranFactorNumber = -1; // در فراخوانی بعدی دوباره تلاش می‌شود
        }
      }
    }
    const usersNeedingId = [...new Set(orders.map((o) => o.user).filter((u) => u.baranCustomerId == null))];
    if (usersNeedingId.length) {
      const maxCustomer = await db.user.aggregate({ _max: { baranCustomerId: true } });
      let nextCustomer = Math.max(maxCustomer._max.baranCustomerId ?? CUSTOMER_ID_BASE, CUSTOMER_ID_BASE);
      for (const u of usersNeedingId) {
        nextCustomer += 1;
        try {
          await db.user.update({ where: { id: u.id }, data: { baranCustomerId: nextCustomer } });
          u.baranCustomerId = nextCustomer;
        } catch {
          /* تلاش مجدد در فراخوانی بعدی */
        }
      }
    }

    const models: BaranOrderModel[] = orders
      .filter((o) => (o.baranFactorNumber ?? 0) > 0)
      .map((o) => {
        const paid = o.paymentStatus === "PAID";
        const noteParts = [o.note?.trim(), o.type === "PICKUP" ? "تحویل حضوری" : null].filter(
          (x): x is string => !!x,
        );
        const fullName = `${o.user.firstName ?? ""} ${o.user.lastName ?? ""}`.trim();

        return {
          FactorNumber: o.baranFactorNumber!,
          Date: tehranLocalIso(o.createdAt),
          SendTime: tehranLocalTime(o.createdAt),
          TotalAmount: o.subtotal,
          ProductDiscount: 0, // تخفیف سطری روی سایت نداریم
          DiscountCode: o.couponCode ?? "",
          DiscountAmount: o.discount,
          TotalDiscountAmount: 0, // تخفیف فاکتور جدا از کد تخفیف نداریم
          SendAmount: o.deliveryFee,
          CustomerClubAmount: 0, // کیف پول روی سایت فعال نیست
          FinalAmount: o.total,
          Comment: noteParts.join(" — "),
          PaymentCode: paid ? 1 : 0,
          PaymentTitle: paid ? "پرداخت آنلاین (زرین‌پال)" : "پرداخت در محل",
          CustomerId: o.user.baranCustomerId ?? CUSTOMER_ID_BASE,
          CustomerName: fullName || "مشتری سایت نخل",
          CustomerPhone: toBaranPhone(o.user.phone),
          CustomerAddress: o.address ?? "",
          CustomerSex: o.user.gender === "MALE" ? 1 : o.user.gender === "FEMALE" ? 2 : 0,
          CustomerCode: "",
          CustomerReagentCode: "",
          CustomerEmail: o.user.email ?? "",
          PackageType: 0,
          PackageTitle: "استاندارد",
          ServiceAmount: o.taxAmount, // مالیات/خدمات — مجموع اقلام + ارسال + خدمات = مبلغ نهایی
          LstOrderItemsModel: o.items.map((i) => ({
            OrderId: o.baranFactorNumber!,
            ProductId: i.menuItem?.baranProductId ?? 0,
            ProductName: i.name,
            ProductCount: i.quantity,
            ProductPrice: i.unitPrice,
            DiscountPrecent: 0,
            ItemComment: "",
            VariationID: "0",
          })),
        };
      });

    await logBaranCall("Orders", ip, {
      total: models.length,
      ok: models.length,
      fail: 0,
      message: `ارسال ${toPersianCount(models.length)} سفارش جدید برای باران`,
    });

    return NextResponse.json({ BaranStatus: 1, LstOrderModel: models } satisfies BaranOrderResults);
  } catch (e) {
    console.error("[baran] Orders failed:", e);
    await logBaranCall("Orders", ip, {
      total: 0,
      ok: 0,
      fail: 0,
      message: `خطا در آماده‌سازی سفارش‌ها: ${e instanceof Error ? e.message : "نامشخص"}`,
    });
    return NextResponse.json({ BaranStatus: 0, LstOrderModel: [] } satisfies BaranOrderResults);
  }
}

// ============ ClearOrders — عدم ارسال مجدد ============

export async function handleClearOrders(
  req: NextRequest,
  body: unknown,
): Promise<NextResponse> {
  const ip = clientIp(req);
  try {
    const b = (body ?? {}) as Record<string, unknown>;
    const itemType = toInt(b.ItemType) ?? 2;
    const rawIds = typeof b.ItemIds === "string" ? b.ItemIds : "";
    const ids = normalizeDigits(rawIds)
      .split(/[-,;\s]+/)
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isInteger(n) && n > 0);

    if (itemType === 5) {
      // شارژ کیف پول — روی سایت کیف پول فعال نیست؛ دریافت صحیح تأیید می‌شود
      await logBaranCall("ClearOrders", ip, {
        total: ids.length,
        ok: ids.length,
        fail: 0,
        message: `تأیید ${toPersianCount(ids.length)} رکورد کیف پول (فعال نیست)`,
      });
      return NextResponse.json({});
    }

    if (itemType !== 2) {
      await logBaranCall("ClearOrders", ip, {
        total: 0,
        ok: 0,
        fail: 0,
        message: `ItemType ناشناخته: ${itemType}`,
      });
      return NextResponse.json({});
    }

    const result = await db.order.updateMany({
      where: { baranFactorNumber: { in: ids }, baranSentAt: null },
      data: { baranSentAt: new Date() },
    });

    await logBaranCall("ClearOrders", ip, {
      total: ids.length,
      ok: result.count,
      fail: 0,
      message: `تأیید ثبت ${toPersianCount(result.count)} سفارش در باران — دیگر ارسال نمی‌شوند`,
    });

    return NextResponse.json({});
  } catch (e) {
    console.error("[baran] ClearOrders failed:", e);
    await logBaranCall("ClearOrders", ip, {
      total: 0,
      ok: 0,
      fail: 0,
      message: `خطا: ${e instanceof Error ? e.message : "نامشخص"}`,
    });
    return NextResponse.json({});
  }
}
