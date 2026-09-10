"use client";

/**
 * ContentManager — مدیریت حرفه‌ای متن‌ها و تصاویر ایستایی سایت (CMS)
 * ─────────────────────────────────────────────────────────────────────
 * هر متن/تصویر ثابت فروشگاه (هیرو، ورود، سربرگ، پاورقی، سئو) اینجا توسط
 * مدیر قابل ویرایش است. معماری:
 *   • رجیستری فیلدها در کد (src/lib/content-defs.ts) — منبع پیش‌فرض‌ها
 *   • جدول SiteContent فقط «بازنویسی»‌ها را نگه می‌دارد (حذف = بازگشت به پیش‌فرض)
 *
 * قابلیت‌ها:
 *   • تب‌بندی گروه‌ها + جستجو + شمارندهٔ فیلدهای شخصی‌سازی‌شده
 *   • ویرایشگر نوع‌آگاه (متن کوتاه / متن بلند / تصویر با آپلود R2)
 *   • ذخیرهٔ گروهی با ردیابی تغییرات (دکمهٔ شناور + Ctrl+S)
 *   • بازگردانی تک‌فیلد و کل گروه به پیش‌فرض (با تأیید)
 *   • راهنمای نشانه‌گذاری [[هایلایت]] و {متغیرها}
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { api } from "@/lib/client-api";
import { toPersianDigits, timeAgo } from "@/lib/fa";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2,
  Save,
  Search,
  RotateCcw,
  ImagePlus,
  ExternalLink,
  FileText,
  ImageIcon,
  Info,
  Wand2,
  Check,
  Eye,
  Sparkles,
  Keyboard,
  AlertCircle,
} from "lucide-react";

type ContentType = "text" | "textarea" | "image";
type ContentGroupKey = "home" | "auth" | "header" | "footer" | "seo";

interface ContentItem {
  key: string;
  group: ContentGroupKey;
  type: ContentType;
  label: string;
  description: string | null;
  defaultValue: string;
  value: string;
  customized: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

interface GroupMeta {
  key: ContentGroupKey;
  title: string;
  description: string;
}

const GROUP_ICONS: Record<ContentGroupKey, React.ElementType> = {
  home: Sparkles,
  auth: FileText,
  header: Eye,
  footer: Info,
  seo: Wand2,
};

/** How the value renders in the storefront — small hint chips per type */
const TYPE_HINT: Record<ContentType, string> = {
  text: "متن کوتاه",
  textarea: "متن بلند",
  image: "تصویر",
};

export function ContentManager() {
  const [items, setItems] = useState<ContentItem[] | null>(null);
  const [groups, setGroups] = useState<GroupMeta[]>([]);
  const [group, setGroup] = useState<ContentGroupKey>("home");
  const [query, setQuery] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [resetGroupOpen, setResetGroupOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: ContentItem[]; groups: GroupMeta[] }>(
        "/api/admin/site-content"
      );
      if (res.success && Array.isArray(res.items)) {
        setItems(res.items);
        setGroups(Array.isArray(res.groups) ? res.groups : []);
        setEdits({});
      } else {
        toast.error(res.error ?? "خطا در دریافت محتوای سایت");
        setItems([]);
      }
    } catch {
      toast.error("خطا در اتصال به سرور");
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* ── derived state ── */

  const groupItems = useMemo(
    () => (items ?? []).filter((i) => i.group === group),
    [items, group]
  );

  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groupItems;
    return groupItems.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        i.key.toLowerCase().includes(q) ||
        (i.description ?? "").toLowerCase().includes(q)
    );
  }, [groupItems, query]);

  const customizedCount = useMemo(
    () => (items ?? []).filter((i) => i.customized).length,
    [items]
  );

  const groupCustomizedCount = useMemo(
    () => groupItems.filter((i) => i.customized).length,
    [groupItems]
  );

  /** effective editor value for a key: pending edit ?? server value */
  const effective = useCallback(
    (item: ContentItem): string =>
      Object.prototype.hasOwnProperty.call(edits, item.key) ? edits[item.key] : item.value,
    [edits]
  );

  const dirtyItems = useMemo(() => {
    if (!items) return [];
    return items.filter((item) => effective(item) !== item.value);
  }, [items, effective]);

  const save = useCallback(async () => {
    if (dirtyItems.length === 0 || saving) return;
    setSaving(true);
    try {
      const updates = dirtyItems.map((item) => ({
        key: item.key,
        value: effective(item),
      }));
      const res = await api<{
        savedCount: number;
        resetCount: number;
        errors: { key: string; message: string }[];
        items: ContentItem[];
        groups: GroupMeta[];
      }>("/api/admin/site-content", { method: "PUT", body: { updates } });
      if (res.success && Array.isArray(res.items)) {
        setItems(res.items);
        setGroups(Array.isArray(res.groups) ? res.groups : []);
        setEdits({});
        const saved = res.savedCount ?? 0;
        const reset = res.resetCount ?? 0;
        const parts: string[] = [];
        if (saved > 0) parts.push(`${toPersianDigits(saved)} مورد ذخیره شد`);
        if (reset > 0) parts.push(`${toPersianDigits(reset)} مورد به پیش‌فرض برگشت`);
        if (parts.length > 0) toast.success(parts.join(" • "), { description: "تغییرات بلافاصله در سایت اعمال می‌شود." });
        const errs = res.errors ?? [];
        if (errs.length > 0) {
          toast.warning(`${toPersianDigits(errs.length)} فیلد ذخیره نشد`, {
            description: errs.map((e) => `${e.key}: ${e.message}`).join("\n").slice(0, 300),
          });
        }
      } else {
        toast.error(res.error ?? "ذخیره انجام نشد");
      }
    } catch {
      toast.error("خطا در اتصال به سرور");
    } finally {
      setSaving(false);
    }
  }, [dirtyItems, saving, effective]);

  /* Ctrl+S / Cmd+S — quick save from anywhere in the editor */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        void save();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [save]);

  const resetGroup = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await api<{ resetCount: number; items: ContentItem[]; groups: GroupMeta[] }>(
        "/api/admin/site-content",
        { method: "DELETE", body: { group } }
      );
      if (res.success && Array.isArray(res.items)) {
        setItems(res.items);
        setGroups(Array.isArray(res.groups) ? res.groups : []);
        setEdits({});
        toast.success("کل گروه به حالت پیش‌فرض بازگشت");
      } else {
        toast.error(res.error ?? "بازگردانی انجام نشد");
      }
    } catch {
      toast.error("خطا در اتصال به سرور");
    } finally {
      setSaving(false);
      setResetGroupOpen(false);
    }
  }, [group, saving]);

  /* ── image upload (R2 via /api/admin/upload) ── */

  const pickImage = (key: string) => {
    uploadTargetKey.current = key;
    fileInputRef.current?.click();
  };

  const uploadFile = async (file: File) => {
    const key = uploadTargetKey.current;
    if (!key) return;
    setUploadingKey(key);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (data.success && data.url) {
        setEdits((prev) => ({ ...prev, [key]: data.url }));
        toast.success("تصویر آپلود شد — برای اعمال، ذخیره کنید");
      } else {
        toast.error(data.error ?? "خطا در آپلود تصویر");
      }
    } catch {
      toast.error("خطا در آپلود فایل");
    } finally {
      setUploadingKey(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  /* ── rendering ── */

  if (items === null) {
    return (
      <div className="space-y-4" aria-busy>
        <div className="skeleton skeleton-block h-24 w-full rounded-2xl" />
        <div className="skeleton skeleton-text w-64" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton skeleton-block h-36 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  const activeGroupMeta = groups.find((g) => g.key === group);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4 pb-24">
        {/* hidden file input for image uploads */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadFile(f);
          }}
          aria-hidden
        />

        {/* ═══ header card ═══ */}
        <Card className="gap-0 overflow-hidden">
          <div className="relative bg-gradient-to-l from-primary/10 via-primary/5 to-gold/10 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2.5 text-xl font-black">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
                    <Wand2 className="h-5.5 w-5.5" />
                  </span>
                  محتوا و ظاهر سایت
                </h2>
                <p className="mt-2.5 max-w-2xl text-sm leading-7 text-muted-foreground">
                  متن‌ها و تصاویر ایستایی فروشگاه — صفحه اصلی، ورود، سربرگ، پاورقی و سئو — اینجا
                  ویرایش می‌شوند و بلافاصله پس از ذخیره در سایت اعمال می‌شوند.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="gap-1.5 bg-primary/10 text-primary">
                  <FileText className="h-3.5 w-3.5" />
                  {toPersianDigits(items.length)} فیلد
                </Badge>
                {customizedCount > 0 && (
                  <Badge className="gap-1.5 bg-gold text-gold-foreground">
                    <Sparkles className="h-3.5 w-3.5" />
                    {toPersianDigits(customizedCount)} شخصی‌سازی‌شده
                  </Badge>
                )}
                <Button asChild variant="outline" size="sm" className="rounded-xl">
                  <a href="/" target="_blank" rel="noreferrer">
                    <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                    مشاهده سایت
                  </a>
                </Button>
              </div>
            </div>

            {/* markup guide */}
            <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-primary/15 bg-card/70 p-3.5 text-xs leading-6 text-muted-foreground">
              <p className="flex items-center gap-1.5 font-bold text-foreground">
                <Info className="h-4 w-4 text-primary" />
                راهنمای قالب‌بندی متن‌ها
              </p>
              <p>
                <code className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] text-primary">[[متن]]</code>
                {" "}متن را با رنگ طلایی برجسته می‌کند؛ خط جدید = شکست خط در سایت.
              </p>
              <p>
                متغیرهای زنده:
                <code className="mx-1 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px]" dir="ltr">
                  {"{city} {restaurantName} {workingHours} {phone} {address}"}
                </code>
                — با مقادیر «تنظیمات ← عمومی» جایگزین می‌شوند.
              </p>
            </div>
          </div>
        </Card>

        {/* ═══ group tabs + search ═══ */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Tabs value={group} onValueChange={(v) => setGroup(v as ContentGroupKey)} dir="rtl">
            <TabsList className="h-auto w-full flex-wrap justify-start gap-1 rounded-2xl bg-muted/60 p-1.5 lg:w-auto">
              {groups.map((g) => {
                const Icon = GROUP_ICONS[g.key] ?? FileText;
                const customized = items.filter((i) => i.group === g.key && i.customized).length;
                return (
                  <TabsTrigger
                    key={g.key}
                    value={g.key}
                    className="gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground sm:text-[13px]"
                  >
                    <Icon className="h-4 w-4" />
                    {g.title}
                    {customized > 0 && (
                      <span className="flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-black text-gold-foreground">
                        {toPersianDigits(customized)}
                      </span>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-2">
            <div className="relative flex-1 lg:w-64">
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="جستجوی فیلد…"
                className="h-10 rounded-xl pr-9 text-sm"
                aria-label="جستجوی فیلدهای محتوا"
              />
            </div>
            {groupCustomizedCount > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 shrink-0 rounded-xl text-destructive hover:text-destructive"
                    onClick={() => setResetGroupOpen(true)}
                    aria-label="بازگردانی کل گروه به پیش‌فرض"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>بازگردانی کل گروه به پیش‌فرض</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

        {activeGroupMeta && (
          <p className="text-xs leading-6 text-muted-foreground">
            <Check className="ml-1 inline h-3.5 w-3.5 text-primary" />
            {activeGroupMeta.description}
          </p>
        )}

        {/* ═══ fields ═══ */}
        {visibleItems.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-muted-foreground/25 px-6 py-12 text-center">
            <AlertCircle className="h-9 w-9 text-muted-foreground/40" />
            <p className="text-sm font-extrabold">فیلدی یافت نشد</p>
            <p className="text-xs text-muted-foreground">عبارت جستجو را تغییر دهید</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {visibleItems.map((item) => (
              <FieldEditor
                key={item.key}
                item={item}
                value={effective(item)}
                dirty={effective(item) !== item.value}
                uploading={uploadingKey === item.key}
                onChange={(v) => setEdits((prev) => ({ ...prev, [item.key]: v }))}
                onRevert={() => setEdits((prev) => ({ ...prev, [item.key]: item.defaultValue }))}
                onPickImage={() => pickImage(item.key)}
              />
            ))}
          </div>
        )}

        {/* ═══ sticky save bar ═══ */}
        {dirtyItems.length > 0 && (
          <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 backdrop-blur-md">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-bold">
                <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-black text-primary-foreground">
                  {toPersianDigits(dirtyItems.length)}
                </span>
                تغییر ذخیره‌نشده
                <span className="hidden text-xs font-normal text-muted-foreground sm:inline">
                  (خالی کردن مقدار = بازگشت به پیش‌فرض)
                </span>
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => setEdits({})}
                >
                  دورانداختن تغییرات
                </Button>
                <Button onClick={() => void save()} disabled={saving} className="rounded-xl font-bold shadow-lg shadow-primary/25">
                  {saving ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Save className="ml-2 h-4 w-4" />}
                  {saving ? "در حال ذخیره…" : "ذخیره تغییرات"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ═══ reset group confirmation ═══ */}
        <AlertDialog open={resetGroupOpen} onOpenChange={setResetGroupOpen}>
          <AlertDialogContent dir="rtl">
            <AlertDialogHeader>
              <AlertDialogTitle>بازگردانی کل گروه به پیش‌فرض؟</AlertDialogTitle>
              <AlertDialogDescription>
                تمام {toPersianDigits(groupCustomizedCount)} فیلدِ شخصی‌سازی‌شدهٔ این گروه به
                مقادیر پیش‌فرض برمی‌گردند. این عمل قابل بازگشت نیست.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="rounded-xl">انصراف</AlertDialogCancel>
              <AlertDialogAction
                className="rounded-xl bg-destructive text-white hover:bg-destructive/90"
                onClick={() => void resetGroup()}
              >
                بله، بازگردانی کن
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}

/* ------------------------------------------------------------------ */
/*  تک‌فیلد ویرایشگر                                                    */
/* ------------------------------------------------------------------ */

function FieldEditor({
  item,
  value,
  dirty,
  uploading,
  onChange,
  onRevert,
  onPickImage,
}: {
  item: ContentItem;
  value: string;
  dirty: boolean;
  uploading: boolean;
  onChange: (v: string) => void;
  onRevert: () => void;
  onPickImage: () => void;
}) {
  return (
    <Card
      className={`gap-0 overflow-hidden rounded-2xl transition-all ${
        dirty ? "border-primary/50 shadow-md shadow-primary/10" : "hover:border-border"
      }`}
    >
      <CardContent className="space-y-3 p-4">
        {/* header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="text-sm font-extrabold">{item.label}</h3>
              <Badge variant="secondary" className="gap-1 bg-muted text-[10px] font-bold text-muted-foreground">
                {item.type === "image" ? <ImageIcon className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                {TYPE_HINT[item.type]}
              </Badge>
              {item.customized && !dirty && (
                <Badge variant="secondary" className="gap-1 bg-gold/15 text-[10px] font-bold text-gold-foreground">
                  <Sparkles className="h-3 w-3" />
                  شخصی‌سازی‌شده
                </Badge>
              )}
              {dirty && (
                <Badge className="gap-1 bg-primary text-[10px] font-bold text-primary-foreground">
                  <Check className="h-3 w-3" />
                  تغییر جدید
                </Badge>
              )}
            </div>
            <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground/70" dir="ltr" title={item.key}>
              {item.key}
            </p>
          </div>
          {(item.customized || dirty) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:text-primary"
                  onClick={onRevert}
                  aria-label={`بازگردانی «${item.label}» به پیش‌فرض`}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>بازگشت به مقدار پیش‌فرض</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* editor by type */}
        {item.type === "image" ? (
          <div className="space-y-2.5">
            <div className="relative flex h-36 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-muted-foreground/25 bg-muted/40">
              {value ? (
                <Image
                  src={value}
                  alt={item.label}
                  fill
                  sizes="(min-width: 1280px) 25vw, 50vw"
                  className="object-contain p-2"
                  unoptimized
                />
              ) : (
                <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
                  <ImageIcon className="h-8 w-8 opacity-40" />
                  <p className="text-[11px]">بدون تصویر (پیش‌فرض خالی)</p>
                </div>
              )}
              {uploading && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-sm">
                  <Loader2 className="h-7 w-7 animate-spin text-primary" />
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-xl"
                onClick={onPickImage}
                disabled={uploading}
              >
                <ImagePlus className="ml-1.5 h-4 w-4" />
                آپلود تصویر جدید
              </Button>
            </div>
            <Input
              dir="ltr"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="/food/hero.png یا https://…"
              className="rounded-xl font-mono text-xs"
              aria-label={`آدرس تصویر «${item.label}»`}
            />
          </div>
        ) : item.type === "textarea" ? (
          <Textarea
            dir="rtl"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={item.defaultValue}
            className="min-h-[92px] rounded-xl text-sm leading-7"
            aria-label={item.label}
          />
        ) : (
          <Input
            dir="rtl"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={item.defaultValue}
            className="rounded-xl text-sm"
            aria-label={item.label}
          />
        )}

        {/* footer: description / default preview / meta */}
        <div className="space-y-1.5 border-t border-dashed pt-2.5">
          {item.description && (
            <p className="text-[11px] leading-5 text-muted-foreground">{item.description}</p>
          )}
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-1 text-[10px] font-bold text-muted-foreground/80 transition-colors hover:text-primary">
              <Keyboard className="h-3 w-3" />
              مقدار پیش‌فرض
            </summary>
            <p className="mt-1 whitespace-pre-wrap rounded-lg bg-muted/50 px-2.5 py-2 text-[11px] leading-6 text-muted-foreground">
              {item.defaultValue || "—"}
            </p>
          </details>
          {item.updatedAt && (
            <p className="text-[10px] text-muted-foreground/60">
              آخرین ویرایش: {timeAgo(item.updatedAt)}
              {item.updatedBy ? ` • ${item.updatedBy}` : ""}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
