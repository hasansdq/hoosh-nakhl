"use client";

/**
 * ابزارهای مدیریت — درون‌ریزی و برون‌بری محصولات (CSV)
 * ---------------------------------------------------------------------------
 * • برون‌بری: خروجی کامل CSV با BOM (سازگار با Excel فارسی) + شناسه برای
 *   همگام‌سازی رفت‌وبرگشت. دادهٔ تصویر عمداً در خروجی نیست.
 * • درون‌ریزی انبوه: کشیدن‌ورهاکردن فایل → اعتبارسنجی و پیش‌نمایش دقیق
 *   سمت کلاینت (همان موتور مشترک سرور) → اجرای درون‌ریزی با انتخاب حالت.
 * • نتایج سطری: ایجاد/به‌روزرسانی/رد/خطا با شمارهٔ ردیف و پیام فارسی.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { toPersianDigits, formatToman } from "@/lib/fa";
import {
  MAX_CSV_BYTES,
  MAX_CSV_ROWS,
  PRODUCT_CSV_HEADERS,
  validateProductsCsv,
  type ImportMode,
  type ImportOutcome,
  type ProductsCsvValidation,
} from "@/lib/products-csv";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Wrench,
  FileDown,
  FileSpreadsheet,
  Download,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Loader2,
  RotateCcw,
  Play,
  PackageCheck,
  Pencil,
  SkipForward,
  FileWarning,
  ImageOff,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

// ============ داده‌های راهنما ============

const COLUMN_GUIDE: { label: string; required: boolean; desc: string }[] = [
  { label: "شناسه", required: false, desc: "کد یکتای محصول — فقط برای به‌روزرسانی دقیق (از فایل برون‌بری شده). خالی بگذارید یعنی محصول جدید یا تطبیق با نام و دسته." },
  { label: "نام", required: true, desc: "نام محصول — بین ۲ تا ۸۰ نویسه." },
  { label: "دسته‌بندی", required: true, desc: "نام دقیق دسته‌بندی (یا شناسهٔ لاتین آن). با گزینهٔ ساخت خودکار، دستهٔ جدید ساخته می‌شود." },
  { label: "قیمت (تومان)", required: true, desc: "عدد صحیح بین ۱٬۰۰۰ و ۵۰۰٬۰۰۰٬۰۰۰ — ارقام فارسی/انگلیسی و جداکنندهٔ هزارگان (، و ٬) مجاز است." },
  { label: "توضیحات", required: false, desc: "تا ۶۰۰ نویسه. متن‌های دارای کاما یا خط جدید به‌صورت خودکار داخل نقل‌قول ( \" \" ) قرار می‌گیرند." },
  { label: "موجود", required: false, desc: "بله / خیر — خالی = بله." },
  { label: "پیشنهاد ویژه", required: false, desc: "بله / خیر — خالی = خیر." },
  { label: "نوشیدنی", required: false, desc: "بله / خیر — خالی = خیر (در محصول جدید، اگر دسته نوشیدنی‌ها باشد خودکار بله)." },
  { label: "گیاهی", required: false, desc: "بله / خیر — خالی = خیر." },
  { label: "تند", required: false, desc: "بله / خیر — خالی = خیر." },
  { label: "کالری", required: false, desc: "عدد ۰ تا ۵٬۰۰۰ — خالی = بدون محدودیت." },
  { label: "زمان آماده‌سازی (دقیقه)", required: false, desc: "عدد ۰ تا ۶۰۰." },
  { label: "مواد تشکیل‌دهنده", required: false, desc: "تا ۶۰۰ نویسه." },
  { label: "ترتیب نمایش", required: false, desc: "عدد ۰ تا ۹۹۹ — خالی = صفر." },
  { label: "تعداد سفارش", required: false, desc: "فقط‌خواندنی — صرفاً جهت اطلاع در برون‌بری؛ در درون‌ریزی نادیده گرفته می‌شود (آمار واقعی از سفارش‌ها)." },
];

const MODE_LABEL: Record<ImportMode, { title: string; desc: string }> = {
  sync: {
    title: "به‌روزرسانی و افزودن (همگام‌سازی)",
    desc: "محصولات موجود — بر اساس «شناسه» یا «نام + دسته‌بندی» — به‌روزرسانی و محصولات جدید ساخته می‌شوند. مناسب ویرایش انبوه و رفت‌وبرگشت فایل برون‌بری.",
  },
  "create-only": {
    title: "فقط افزودن محصولات جدید",
    desc: "محصولات موجود دست نمی‌خورند؛ ردیف‌های تکراری فقط ثبت رد می‌شوند. مناسب افزودن انبوه محصولات جدید بدون ریسک تغییر موارد فعلی.",
  },
};

// ============ رابط درون‌ریزی ============

interface ImportPreviewState {
  file: File;
  text: string;
  validation: ProductsCsvValidation;
}

const ACTION_META: Record<string, { label: string; className: string }> = {
  created: { label: "ایجاد شد", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" },
  updated: { label: "به‌روزرسانی شد", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30" },
  skipped: { label: "رد شد", className: "bg-muted text-muted-foreground border-border" },
  error: { label: "خطا", className: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30" },
};

function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${toPersianDigits(bytes)} بایت`;
  if (bytes < 1024 * 1024) return `${toPersianDigits((bytes / 1024).toFixed(1))} کیلوبایت`;
  return `${toPersianDigits((bytes / (1024 * 1024)).toFixed(2))} مگابایت`;
}

export function ToolsManager() {
  // ---------- آمار ----------
  const [productsCount, setProductsCount] = useState<number | null>(null);
  const [categoriesCount, setCategoriesCount] = useState<number | null>(null);

  // ---------- درون‌ریزی ----------
  const [preview, setPreview] = useState<ImportPreviewState | null>(null);
  const [mode, setMode] = useState<ImportMode>("sync");
  const [createCategories, setCreateCategories] = useState(true);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportOutcome | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadCounts = useCallback(async () => {
    const [menuRes, catRes] = await Promise.all([
      api<{ items: unknown[] }>("/api/admin/menu"),
      api<{ categories: unknown[] }>("/api/admin/categories"),
    ]);
    if (menuRes.success) setProductsCount(menuRes.items?.length ?? 0);
    if (catRes.success) setCategoriesCount(catRes.categories?.length ?? 0);
  }, []);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  // ---------- انتخاب فایل + اعتبارسنجی کلاینت ----------
  const handleFile = useCallback(async (file: File) => {
    setResult(null);
    const name = file.name.toLowerCase();
    if (!name.endsWith(".csv") && file.type !== "text/csv") {
      toast.error("فقط فایل CSV پذیرفته می‌شود");
      return;
    }
    if (file.size === 0) {
      toast.error("فایل خالی است");
      return;
    }
    if (file.size > MAX_CSV_BYTES) {
      toast.error(`حجم فایل بیش از حد مجاز است (حداکثر ${fileSizeLabel(MAX_CSV_BYTES)})`);
      return;
    }
    try {
      const text = await file.text();
      const validation = validateProductsCsv(text);
      setPreview({ file, text, validation });
      if (validation.fatal) {
        toast.error(validation.fatal);
      } else if (validation.invalidCount > 0) {
        toast.warning(
          `${toPersianDigits(validation.validCount)} ردیف معتبر و ${toPersianDigits(validation.invalidCount)} ردیف نامعتبر — پیش‌نمایش را ببینید`
        );
      } else {
        toast.success(`${toPersianDigits(validation.validCount)} ردیف معتبر آمادهٔ درون‌ریزی است`);
      }
    } catch {
      toast.error("خطا در خواندن فایل");
    }
  }, []);

  const resetImport = useCallback(() => {
    setPreview(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // ---------- اجرای درون‌ریزی ----------
  const runImport = useCallback(async () => {
    if (!preview || importing) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", preview.file);
      fd.append("mode", mode);
      fd.append("createCategories", String(createCategories));
      const res = await fetch("/api/admin/tools/products/import", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (data.success && data.result) {
        setResult(data.result as ImportOutcome);
        toast.success(
          `درون‌ریزی انجام شد: ${toPersianDigits(data.result.created)} ایجاد، ${toPersianDigits(data.result.updated)} به‌روزرسانی`
        );
        loadCounts();
      } else {
        toast.error(data.error ?? "خطا در درون‌ریزی");
      }
    } catch {
      toast.error("خطا در ارتباط با سرور");
    } finally {
      setImporting(false);
    }
  }, [preview, importing, mode, createCategories, loadCounts]);

  // ---------- محاسبات پیش‌نمایش ----------
  const previewValidRows = useMemo(() => {
    if (!preview) return [];
    return preview.validation.rows.filter((r) => r.record !== null).slice(0, 8);
  }, [preview]);

  const previewInvalidRows = useMemo(() => {
    if (!preview) return [];
    return preview.validation.rows.filter((r) => r.record === null).slice(0, 50);
  }, [preview]);

  const canImport =
    !!preview &&
    !preview.validation.fatal &&
    preview.validation.validCount > 0 &&
    !importing;

  return (
    <div className="space-y-5">
      {/* ================= سرتیتر ================= */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md">
            <Wrench className="h-5.5 w-5.5" />
          </div>
          <div>
            <h1 className="text-lg font-black">ابزارهای مدیریت</h1>
            <p className="text-xs text-muted-foreground">
              درون‌ریزی و برون‌بری انبوه محصولات با فایل CSV — سریع، دقیق و امن
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold">
            <PackageCheck className="h-3.5 w-3.5" />
            {productsCount == null ? "…" : `${toPersianDigits(productsCount)} محصول`}
          </Badge>
          <Badge variant="secondary" className="gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold">
            <FileSpreadsheet className="h-3.5 w-3.5" />
            {categoriesCount == null ? "…" : `${toPersianDigits(categoriesCount)} دسته‌بندی`}
          </Badge>
        </div>
      </div>

      {/* ================= برون‌بری + فایل نمونه ================= */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="overflow-hidden rounded-2xl border-emerald-500/20 bg-gradient-to-bl from-emerald-500/5 to-transparent">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <FileDown className="h-4.5 w-4.5" />
              </div>
              <div>
                <CardTitle className="text-base font-black">برون‌بری محصولات (CSV)</CardTitle>
                <CardDescription className="text-xs">
                  خروجی کامل و استاندارد — قابل ویرایش در Excel و بازگشت به سیستم
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-1.5 text-xs leading-6 text-muted-foreground">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                همهٔ اطلاعات غیرتصویری محصولات + «شناسه» برای همگام‌سازی دقیق رفت‌وبرگشت
              </li>
              <li className="flex items-start gap-2">
                <ImageOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                دادهٔ تصویر عمداً در خروجی نیست — تصاویر فقط از پنل مدیریت مدیریت می‌شوند
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                کدگذاری UTF-8 با BOM — فارسی در Excel درست نمایش داده می‌شود
              </li>
            </ul>
            <Button asChild className="w-full gap-2 rounded-xl font-bold">
              <a href="/api/admin/tools/products/export" aria-label="دانلود فایل CSV محصولات">
                <Download className="h-4 w-4" />
                دانلود فایل محصولات
                {productsCount != null && (
                  <span className="opacity-75">({toPersianDigits(productsCount)} محصول)</span>
                )}
              </a>
            </Button>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-2xl border-gold/25 bg-gradient-to-bl from-gold/5 to-transparent">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gold/15 text-gold-foreground">
                <FileSpreadsheet className="h-4.5 w-4.5" />
              </div>
              <div>
                <CardTitle className="text-base font-black">فایل نمونهٔ استاندارد</CardTitle>
                <CardDescription className="text-xs">
                  قالب صحیح CSV با سه ردیف نمونه و دسته‌بندی‌های واقعی رستوران
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-1.5 text-xs leading-6 text-muted-foreground">
              <li className="flex items-start gap-2">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold-foreground" />
                سرستون‌های رسمی + نمونهٔ ردیف کامل، حداقلی و اعداد فارسی
              </li>
              <li className="flex items-start gap-2">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold-foreground" />
                ردیف‌های نمونه را ویرایش یا حذف کنید — شناسهٔ خالی یعنی محصول جدید
              </li>
            </ul>
            <Button asChild variant="outline" className="w-full gap-2 rounded-xl border-gold/40 font-bold hover:border-gold hover:bg-gold/10">
              <a href="/api/admin/tools/products/template" aria-label="دانلود فایل نمونه CSV">
                <Download className="h-4 w-4" />
                دانلود فایل نمونه
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ================= درون‌ریزی ================= */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <UploadCloud className="h-4.5 w-4.5" />
            </div>
            <div>
              <CardTitle className="text-base font-black">درون‌ریزی انبوه محصولات (CSV)</CardTitle>
              <CardDescription className="text-xs">
                حداکثر {toPersianDigits(MAX_CSV_ROWS)} ردیف و {fileSizeLabel(MAX_CSV_BYTES)} — اعتبارسنجی قبل از اجرا
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* ----- ناحیهٔ رهاکردن فایل ----- */}
          {!preview && (
            <div
              role="button"
              tabIndex={0}
              aria-label="انتخاب یا رهاکردن فایل CSV"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) handleFile(f);
              }}
              className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 text-center transition ${
                dragOver
                  ? "scale-[1.01] border-primary bg-primary/5"
                  : "border-border bg-muted/30 hover:border-primary/40 hover:bg-muted/50"
              }`}
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <UploadCloud className="h-7 w-7" />
              </div>
              <div>
                <p className="text-sm font-black">فایل CSV را اینجا رها کنید یا کلیک کنید</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  فایل برون‌بری‌شده یا فایل نمونه را ویرایش کنید و همین‌جا برگردانید
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </div>
          )}

          {/* ----- پیش‌نمایش اعتبارسنجی ----- */}
          {preview && (
            <div className="space-y-4">
              {/* اطلاعات فایل */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-muted/30 p-3.5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <FileSpreadsheet className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black" title={preview.file.name}>
                      {preview.file.name}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {fileSizeLabel(preview.file.size)} · جداکنندهٔ شناسایی‌شده: {preview.validation.delimiterLabel}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 rounded-xl text-xs"
                    onClick={() => {
                      if (fileInputRef.current) fileInputRef.current.value = "";
                      fileInputRef.current?.click();
                    }}
                    disabled={importing}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    تغییر فایل
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 rounded-xl text-xs text-destructive hover:text-destructive"
                    onClick={resetImport}
                    disabled={importing}
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    پاک‌کردن
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFile(f);
                    }}
                  />
                </div>
              </div>

              {/* خطای مهلک */}
              {preview.validation.fatal ? (
                <div className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/5 p-4">
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
                  <div className="space-y-1.5">
                    <p className="text-sm font-black text-red-600 dark:text-red-400">
                      فایل قابل درون‌ریزی نیست
                    </p>
                    <p className="text-xs leading-6 text-red-600/90 dark:text-red-400/90">
                      {preview.validation.fatal}
                    </p>
                    {preview.validation.missingRequired.length > 0 && (
                      <p className="text-xs leading-6 text-muted-foreground">
                        سرستون‌های الزامی که یافت نشدند: {preview.validation.missingRequired.join("، ")}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      راهنمایی: از فایل نمونهٔ استاندارد استفاده کنید و سرستون‌ها را تغییر نام ندهید.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {/* خلاصهٔ شمارش */}
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    <div className="rounded-2xl border bg-card p-3 text-center">
                      <p className="text-xl font-black">{toPersianDigits(preview.validation.rows.length)}</p>
                      <p className="mt-0.5 text-[11px] font-bold text-muted-foreground">کل ردیف‌ها</p>
                    </div>
                    <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-3 text-center">
                      <p className="text-xl font-black text-emerald-600 dark:text-emerald-400">
                        {toPersianDigits(preview.validation.validCount)}
                      </p>
                      <p className="mt-0.5 text-[11px] font-bold text-muted-foreground">معتبر</p>
                    </div>
                    <div className="rounded-2xl border border-red-500/25 bg-red-500/5 p-3 text-center">
                      <p className="text-xl font-black text-red-600 dark:text-red-400">
                        {toPersianDigits(preview.validation.invalidCount)}
                      </p>
                      <p className="mt-0.5 text-[11px] font-bold text-muted-foreground">نامعتبر</p>
                    </div>
                    <div className="rounded-2xl border bg-card p-3 text-center">
                      <p className="text-xl font-black">{toPersianDigits(preview.validation.columns.filter((c) => c.canonical).length)}</p>
                      <p className="mt-0.5 text-[11px] font-bold text-muted-foreground">ستون شناسایی‌شده</p>
                    </div>
                  </div>

                  {/* هشدار ستون‌ها + یادداشت‌های سطح‌فایل */}
                  {(preview.validation.unknownColumns.length > 0 ||
                    preview.validation.duplicateColumns.length > 0 ||
                    preview.validation.notes.length > 0) && (
                    <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3.5">
                      <AlertTriangle className="mt-0.5 h-4.5 w-4.5 shrink-0 text-amber-500" />
                      <div className="space-y-1 text-xs leading-6">
                        {preview.validation.notes.map((n, i) => (
                          <p key={i} className="text-amber-700 dark:text-amber-400">{n}</p>
                        ))}
                        {preview.validation.unknownColumns.length > 0 && (
                          <p className="text-amber-700 dark:text-amber-400">
                            ستون‌های ناشناخته (نادیده گرفته می‌شوند): {preview.validation.unknownColumns.join("، ")}
                          </p>
                        )}
                        {preview.validation.duplicateColumns.length > 0 && (
                          <p className="text-amber-700 dark:text-amber-400">
                            ستون‌های تکراری (نخستین مورد استفاده می‌شود): {preview.validation.duplicateColumns.join("، ")}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* خطاهای ردیف‌ها */}
                  {previewInvalidRows.length > 0 && (
                    <div className="rounded-2xl border border-red-500/25 bg-red-500/5">
                      <div className="flex items-center gap-2 border-b border-red-500/15 px-4 py-2.5">
                        <XCircle className="h-4 w-4 text-red-500" />
                        <p className="text-xs font-black text-red-600 dark:text-red-400">
                          ردیف‌های نامعتبر ({preview.validation.invalidCount > 50 ? "۵۰ مورد اول — " : ""}
                          {toPersianDigits(preview.validation.invalidCount)} از {toPersianDigits(preview.validation.rows.length)})
                        </p>
                      </div>
                      <div className="max-h-44 space-y-1 overflow-y-auto p-3 text-xs leading-6">
                        {previewInvalidRows.map((r) => (
                          <div key={r.row} className="flex items-start gap-2 rounded-lg bg-card px-2.5 py-1.5">
                            <Badge variant="outline" className="shrink-0 border-red-500/30 bg-red-500/10 text-[10px] font-black text-red-600 dark:text-red-400">
                              ردیف {toPersianDigits(r.row)}
                            </Badge>
                            <span className="text-muted-foreground">{r.errors.join("؛ ")}</span>
                          </div>
                        ))}
                        {preview.validation.invalidCount > 50 && (
                          <p className="px-2.5 pt-1 text-[11px] text-muted-foreground">
                            و {toPersianDigits(preview.validation.invalidCount - 50)} خطای دیگر…
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* پیش‌نمایش ردیف‌های معتبر */}
                  {previewValidRows.length > 0 && (
                    <div className="rounded-2xl border">
                      <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        <p className="text-xs font-black">پیش‌نمایش ردیف‌های معتبر (۸ مورد اول)</p>
                      </div>
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/30 hover:bg-muted/30">
                              <TableHead className="h-9 w-14 text-center text-[11px] font-black">ردیف</TableHead>
                              <TableHead className="h-9 text-[11px] font-black">نام</TableHead>
                              <TableHead className="h-9 text-[11px] font-black">دسته‌بندی</TableHead>
                              <TableHead className="h-9 text-[11px] font-black">قیمت</TableHead>
                              <TableHead className="h-9 text-center text-[11px] font-black">موجود</TableHead>
                              <TableHead className="h-9 text-center text-[11px] font-black">ویژه</TableHead>
                              <TableHead className="h-9 text-[11px] font-black">شناسه</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {previewValidRows.map((r) => (
                              <TableRow key={r.row}>
                                <TableCell className="py-2 text-center text-xs text-muted-foreground">
                                  {toPersianDigits(r.row)}
                                </TableCell>
                                <TableCell className="max-w-44 truncate py-2 text-xs font-bold" title={r.record!.name}>
                                  {r.record!.name}
                                </TableCell>
                                <TableCell className="max-w-32 truncate py-2 text-xs" title={r.record!.category}>
                                  {r.record!.category}
                                </TableCell>
                                <TableCell className="py-2 text-xs whitespace-nowrap">{formatToman(r.record!.price)}</TableCell>
                                <TableCell className="py-2 text-center">
                                  {r.record!.isAvailable ? (
                                    <Badge className="bg-emerald-500/15 text-[10px] text-emerald-600 dark:text-emerald-400">بله</Badge>
                                  ) : (
                                    <Badge variant="secondary" className="text-[10px]">خیر</Badge>
                                  )}
                                </TableCell>
                                <TableCell className="py-2 text-center">
                                  {r.record!.isSpecial ? (
                                    <Badge className="bg-gold/20 text-[10px] text-gold-foreground">بله</Badge>
                                  ) : (
                                    <Badge variant="secondary" className="text-[10px]">خیر</Badge>
                                  )}
                                </TableCell>
                                <TableCell className="max-w-28 truncate py-2 font-mono text-[10px] text-muted-foreground" title={r.record!.id ?? ""}>
                                  {r.record!.id ? r.record!.id.slice(0, 10) + "…" : "— جدید —"}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                  {/* گزینه‌های درون‌ریزی */}
                  <Separator />
                  <div className="space-y-3">
                    <p className="text-xs font-black text-muted-foreground">تنظیمات درون‌ریزی</p>
                    <div className="grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="حالت درون‌ریزی">
                      {(Object.keys(MODE_LABEL) as ImportMode[]).map((m) => (
                        <button
                          key={m}
                          type="button"
                          role="radio"
                          aria-checked={mode === m}
                          onClick={() => setMode(m)}
                          disabled={importing}
                          className={`rounded-2xl border p-3.5 text-right transition ${
                            mode === m
                              ? "border-primary bg-primary/5 shadow-sm"
                              : "border-border bg-card hover:border-primary/30"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                                mode === m ? "border-primary" : "border-muted-foreground/40"
                              }`}
                            >
                              {mode === m && <span className="h-2 w-2 rounded-full bg-primary" />}
                            </span>
                            <span className="text-xs font-black">{MODE_LABEL[m].title}</span>
                          </div>
                          <p className="mt-1.5 pr-6 text-[11px] leading-5 text-muted-foreground">
                            {MODE_LABEL[m].desc}
                          </p>
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center justify-between gap-3 rounded-2xl border bg-card p-3.5">
                      <div className="space-y-0.5">
                        <Label htmlFor="create-categories" className="text-xs font-black">
                          ساخت خودکار دسته‌بندی‌های جدید
                        </Label>
                        <p className="text-[11px] leading-5 text-muted-foreground">
                          اگر دسته‌بندیِ یک ردیف در سیستم وجود نداشته باشد، همان‌جا ساخته و به آن ردیف اختصاص
                          داده می‌شود و درون‌ریزی بدون توقف ادامه می‌یابد. در حالت خاموش، ردیفِ دارای دستهٔ
                          ناشناخته با خطا ثبت می‌شود.
                        </p>
                      </div>
                      <Switch
                        id="create-categories"
                        checked={createCategories}
                        onCheckedChange={setCreateCategories}
                        disabled={importing}
                      />
                    </div>
                  </div>

                  {/* دکمهٔ اجرا */}
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      className="h-11 flex-1 gap-2 rounded-xl text-sm font-black sm:flex-none sm:px-8"
                      onClick={runImport}
                      disabled={!canImport}
                    >
                      {importing ? (
                        <>
                          <Loader2 className="h-4.5 w-4.5 animate-spin" />
                          در حال درون‌ریزی…
                        </>
                      ) : (
                        <>
                          <Play className="h-4.5 w-4.5" />
                          شروع درون‌ریزی {toPersianDigits(preview.validation.validCount)} ردیف معتبر
                        </>
                      )}
                    </Button>
                    <p className="text-[11px] leading-5 text-muted-foreground">
                      ردیف‌های نامعتبر اجرا نمی‌شوند — پس از پایان، گزارش کامل می‌بینید.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ----- نتایج درون‌ریزی ----- */}
          {result && (
            <div className="space-y-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.03] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <p className="text-sm font-black">گزارش درون‌ریزی تکمیل شد</p>
                    <p className="text-[11px] text-muted-foreground">
                      {toPersianDigits(result.totalRows)} ردیف در{" "}
                      {toPersianDigits(Math.max(1, Math.round(result.durationMs / 100)) / 10)} ثانیه
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 rounded-xl text-xs"
                    onClick={loadCounts}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    به‌روزرسانی آمار
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 rounded-xl text-xs"
                    onClick={resetImport}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    درون‌ریزی فایل دیگر
                  </Button>
                </div>
              </div>

              {/* شمارنده‌ها */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3 text-center">
                  <p className="text-lg font-black text-emerald-600 dark:text-emerald-400">{toPersianDigits(result.created)}</p>
                  <p className="mt-0.5 flex items-center justify-center gap-1 text-[11px] font-bold text-muted-foreground">
                    <PackageCheck className="h-3 w-3" /> ایجاد شده
                  </p>
                </div>
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-center">
                  <p className="text-lg font-black text-amber-600 dark:text-amber-400">{toPersianDigits(result.updated)}</p>
                  <p className="mt-0.5 flex items-center justify-center gap-1 text-[11px] font-bold text-muted-foreground">
                    <Pencil className="h-3 w-3" /> به‌روزرسانی شده
                  </p>
                </div>
                <div className="rounded-xl border bg-card p-3 text-center">
                  <p className="text-lg font-black">{toPersianDigits(result.skipped)}</p>
                  <p className="mt-0.5 flex items-center justify-center gap-1 text-[11px] font-bold text-muted-foreground">
                    <SkipForward className="h-3 w-3" /> رد شده
                  </p>
                </div>
                <div className="rounded-xl border border-red-500/25 bg-red-500/5 p-3 text-center">
                  <p className="text-lg font-black text-red-600 dark:text-red-400">{toPersianDigits(result.failed)}</p>
                  <p className="mt-0.5 flex items-center justify-center gap-1 text-[11px] font-bold text-muted-foreground">
                    <FileWarning className="h-3 w-3" /> ناموفق
                  </p>
                </div>
              </div>

              {/* دسته‌بندی‌های ساخته‌شده */}
              {result.categoriesCreated.length > 0 && (
                <div className="flex items-start gap-2.5 rounded-xl border border-gold/30 bg-gold/5 p-3">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-gold-foreground" />
                  <p className="text-xs leading-6">
                    <span className="font-black">دسته‌بندی‌های جدید ساخته شد: </span>
                    <span className="text-muted-foreground">
                      {result.categoriesCreated.map((c) => c.name).join("، ")}
                    </span>
                  </p>
                </div>
              )}

              {/* جزئیات ردیف‌ها */}
              <div>
                <p className="mb-2 text-xs font-black text-muted-foreground">
                  جزئیات ردیف‌ها ({toPersianDigits(result.rows.length)} مورد)
                </p>
                <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border bg-card p-2">
                  {result.rows.map((r, idx) => {
                    const meta = ACTION_META[r.action] ?? ACTION_META.skipped;
                    return (
                      <div
                        key={`${r.row}-${idx}`}
                        className="flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-xs hover:bg-accent/50"
                      >
                        <span className="w-14 shrink-0 text-center font-mono text-[10px] leading-6 text-muted-foreground">
                          ردیف {toPersianDigits(r.row)}
                        </span>
                        <Badge variant="outline" className={`shrink-0 text-[10px] font-black ${meta.className}`}>
                          {meta.label}
                        </Badge>
                        <span className="min-w-0 flex-1 truncate font-bold" title={r.name}>
                          {r.name}
                        </span>
                        {r.message && (
                          <span className="max-w-[45%] truncate text-[11px] text-muted-foreground" title={r.message}>
                            {r.message}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ================= راهنمای کامل ستون‌ها ================= */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Info className="h-4.5 w-4.5" />
            </div>
            <div>
              <CardTitle className="text-base font-black">راهنمای قالب CSV محصولات</CardTitle>
              <CardDescription className="text-xs">
                مرجع کامل ستون‌ها، مقادیر مجاز و قواعد همگام‌سازی
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-3">
          <Accordion type="multiple" defaultValue={["cols", "rules"]}>
            <AccordionItem value="cols">
              <AccordionTrigger className="py-2 text-sm font-black">
                جدول ستون‌ها ({toPersianDigits(PRODUCT_CSV_HEADERS.length)} ستون)
              </AccordionTrigger>
              <AccordionContent>
                <div className="overflow-x-auto rounded-xl border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableHead className="h-9 text-[11px] font-black">سرستون</TableHead>
                        <TableHead className="h-9 w-20 text-center text-[11px] font-black">الزامی</TableHead>
                        <TableHead className="h-9 text-[11px] font-black">توضیحات و مقادیر مجاز</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {COLUMN_GUIDE.map((c) => (
                        <TableRow key={c.label}>
                          <TableCell className="py-2.5 text-xs font-black whitespace-nowrap">{c.label}</TableCell>
                          <TableCell className="py-2.5 text-center">
                            {c.required ? (
                              <Badge className="bg-red-500/10 text-[10px] text-red-600 dark:text-red-400">الزامی</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[10px]">اختیاری</Badge>
                            )}
                          </TableCell>
                          <TableCell className="py-2.5 text-xs leading-6 text-muted-foreground">{c.desc}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="rules">
              <AccordionTrigger className="py-2 text-sm font-black">قواعد همگام‌سازی و نکات مهم</AccordionTrigger>
              <AccordionContent>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {[
                    {
                      icon: ImageOff,
                      title: "تصاویر همیشه محفوظ",
                      desc: "دادهٔ تصویر در CSV نیست و هنگام درون‌ریزی هیچ تغییری در تصاویر محصولات ایجاد نمی‌شود — تصاویر فقط از بخش «مدیریت منو» مدیریت می‌شوند.",
                    },
                    {
                      icon: RefreshCw,
                      title: "رفت‌وبرگشت بدون تکرار",
                      desc: "خروجی بگیرید → در Excel ویرایش کنید → درون‌ریزی کنید: محصولات موجود (با شناسه یا نام+دسته) به‌روزرسانی و محصول تازه‌ای تکراری ساخته نمی‌شود.",
                    },
                    {
                      icon: Info,
                      title: "ستون غایب در برابر سلول خالی",
                      desc: "اگر ستونی در فایل نباشد، آن فیلد در محصولات موجود دست نمی‌خورد؛ اگر ستون باشد ولی سلول خالی باشد، فیلد پاک یا به مقدار پیش‌فرض تنظیم می‌شود (همگام‌سازی کامل).",
                    },
                    {
                      icon: FileSpreadsheet,
                      title: "سازگاری Excel و فرمت‌ها",
                      desc: "جداکنندهٔ کاما ( , )، سمی‌کالن ( ; ) و تب تشخیص داده می‌شود؛ BOM و ارقام فارسی/عربی و جداکنندهٔ هزارگان در اعداد پذیرفته می‌شود.",
                    },
                    {
                      icon: CheckCircle2,
                      title: "اعتبارسنجی قبل از اجرا",
                      desc: "پیش از هر درون‌ریزی، فایل در مرورگر شما با همان موتور سرور بررسی می‌شود؛ ردیف‌های نامعتبر هرگز اجرا نمی‌شوند و گزارش دقیق می‌گیرید.",
                    },
                    {
                      icon: SkipForward,
                      title: "بدون حذف خودکار",
                      desc: "این ابزار هیچ محصولی را حذف نمی‌کند — محصولاتِ غایب از فایل بدون تغییر باقی می‌مانند. حذف فقط از بخش «مدیریت منو».",
                    },
                  ].map((r) => (
                    <div key={r.title} className="rounded-2xl border bg-card p-3.5">
                      <div className="flex items-center gap-2">
                        <r.icon className="h-4 w-4 shrink-0 text-primary" />
                        <p className="text-xs font-black">{r.title}</p>
                      </div>
                      <p className="mt-1.5 text-[11px] leading-6 text-muted-foreground">{r.desc}</p>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
