"use client";

/**
 * اتصال به نرم‌افزار حسابداری باران — پنل مدیریت
 * ---------------------------------------------------------------------------
 * • وضعیت اتصال: فعال/غیرفعال + آمار زندهٔ همگام‌سازی
 * • راهنمای پیکربندی: آدرس API و کلید (کپی/نمایش/تولید مجدد)
 * • تنظیمات: سطح دسته‌بندی، موجودی، حذف‌شده‌ها، سفارش‌های در انتظار پرداخت
 * • اقلام متصل به باران + گزارش فراخوانی‌های API
 * • عملیات پیشرفته: ارسال مجدد سفارش‌ها (اگر داده در باران گم شد)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client-api";
import { toPersianDigits, formatJalali } from "@/lib/fa";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Cable,
  Power,
  RefreshCw,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  PackageCheck,
  FolderTree,
  Image as ImageIcon,
  ShoppingBag,
  CheckCheck,
  Clock,
  Save,
  Loader2,
  RotateCcw,
  AlertTriangle,
  Info,
  ServerCog,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

// ============ انواع ============

interface BaranSettingsDto {
  enabled: boolean;
  apiKey: string;
  requireKey: boolean;
  categoryLevel: "group" | "main";
  stockSync: boolean;
  hideDeleted: boolean;
  includePendingOrders: boolean;
}

interface BaranStats {
  productsSynced: number;
  categoriesLinked: number;
  imagesReceived: number;
  ordersPending: number;
  ordersSent: number;
  lastProductSyncAt: string | null;
}

interface BaranLogRow {
  id: string;
  method: string;
  totalCount: number;
  okCount: number;
  failCount: number;
  message: string | null;
  ip: string | null;
  createdAt: string;
}

interface BaranItemRow {
  id: string;
  name: string;
  baranProductId: number | null;
  price: number;
  isAvailable: boolean;
  hasImage: boolean;
  baranUnit: string | null;
  categoryName: string;
  syncedAt: string | null;
}

interface BaranState {
  settings: BaranSettingsDto;
  stats: BaranStats;
  logs: BaranLogRow[];
  items: BaranItemRow[];
  apiPath: string;
}

const METHOD_META: Record<string, { label: string; dir: string; desc: string; className: string }> = {
  ProductSEND: {
    label: "ارسال محصولات",
    dir: "rtl",
    desc: "باران → سایت",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  },
  SENDPics: {
    label: "ارسال تصاویر",
    dir: "rtl",
    desc: "باران → سایت",
    className: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/30",
  },
  Orders: {
    label: "دریافت سفارش‌ها",
    dir: "rtl",
    desc: "سایت → باران",
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  },
  ClearOrders: {
    label: "تأیید ثبت",
    dir: "rtl",
    desc: "عدم ارسال مجدد",
    className: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30",
  },
};

function fa(n: number | null | undefined): string {
  return toPersianDigits(n ?? 0);
}

function timeLabel(iso: string | null): string {
  if (!iso) return "—";
  return formatJalali(iso, true);
}

export function BaranManager() {
  const [state, setState] = useState<BaranState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [form, setForm] = useState<BaranSettingsDto | null>(null);

  // ---------- بارگذاری ----------
  const applyState = useCallback((res: BaranState) => {
    setState({
      settings: res.settings,
      stats: res.stats,
      logs: res.logs ?? [],
      items: res.items ?? [],
      apiPath: res.apiPath ?? "/api/ApiServiceBaran/",
    });
    setForm(res.settings);
    setDirty(false);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await api<BaranState>("/api/admin/baran");
      if (!active) return;
      if (res.success && res.settings) {
        applyState(res);
      } else {
        toast.error(res.error ?? "خطا در بارگذاری وضعیت اتصال باران");
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [applyState]);

  const load = useCallback(
    async (withSpinner = false) => {
      const res = await api<BaranState>("/api/admin/baran");
      if (res.success && res.settings) {
        applyState(res);
      } else {
        toast.error(res.error ?? "خطا در بارگذاری وضعیت اتصال باران");
      }
      if (withSpinner) setRefreshing(false);
    },
    [applyState],
  );

  // ---------- عملیات ----------
  const apiUrl = useMemo(() => {
    if (typeof window === "undefined") return state?.apiPath ?? "/api/ApiServiceBaran/";
    return `${window.location.origin}${state?.apiPath ?? "/api/ApiServiceBaran/"}`;
  }, [state?.apiPath]);

  const copy = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} کپی شد`);
    } catch {
      toast.error("کپی ناموفق بود — به‌صورت دستی انتخاب و کپی کنید");
    }
  }, []);

  const toggleEnabled = useCallback(
    async (enabled: boolean) => {
      if (!form) return;
      setToggling(true);
      const res = await api<{ settings: BaranSettingsDto; generatedKey?: boolean }>("/api/admin/baran", {
        method: "PUT",
        body: { enabled },
      });
      if (res.success && res.settings) {
        setForm(res.settings);
        setState((s) => (s ? { ...s, settings: res.settings } : s));
        toast.success(enabled ? "اتصال باران فعال شد" : "اتصال باران غیرفعال شد");
        if (res.generatedKey) toast.info("کلید API به‌صورت خودکار تولید شد");
        void load();
      } else {
        toast.error(res.error ?? "خطا در تغییر وضعیت");
      }
      setToggling(false);
    },
    [form, load],
  );

  const saveSettings = useCallback(async () => {
    if (!form) return;
    setSaving(true);
    const res = await api<{ settings: BaranSettingsDto }>("/api/admin/baran", {
      method: "PUT",
      body: {
        requireKey: form.requireKey,
        categoryLevel: form.categoryLevel,
        stockSync: form.stockSync,
        hideDeleted: form.hideDeleted,
        includePendingOrders: form.includePendingOrders,
      },
    });
    if (res.success && res.settings) {
      setForm(res.settings);
      setState((s) => (s ? { ...s, settings: res.settings } : s));
      setDirty(false);
      toast.success("تنظیمات همگام‌سازی ذخیره شد");
    } else {
      toast.error(res.error ?? "خطا در ذخیرهٔ تنظیمات");
    }
    setSaving(false);
  }, [form]);

  const rotateKey = useCallback(async () => {
    const res = await api<{ settings: BaranSettingsDto }>("/api/admin/baran/rotate-key", {
      method: "POST",
    });
    if (res.success && res.settings) {
      setForm(res.settings);
      setState((s) => (s ? { ...s, settings: res.settings } : s));
      setShowKey(true);
      toast.success("کلید جدید ساخته شد — کلید را در نرم‌افزار باران به‌روزرسانی کنید");
    } else {
      toast.error(res.error ?? "خطا در تولید کلید");
    }
  }, []);

  const resendOrders = useCallback(async () => {
    const res = await api<{ count: number }>("/api/admin/baran/resend-orders", {
      method: "POST",
      body: {},
    });
    if (res.success) {
      toast.success(`${fa(res.count)} سفارش برای ارسال مجدد به باران علامت‌گذاری شد`);
      void load();
    } else {
      toast.error(res.error ?? "خطا در ارسال مجدد");
    }
  }, [load]);

  const hideManualItems = useCallback(async () => {
    const res = await api<{ hiddenItems: number; deactivatedCategories: number }>(
      "/api/admin/baran/hide-manual",
      { method: "POST", body: {} },
    );
    if (res.success) {
      toast.success(
        `${fa(res.hiddenItems)} قلم دستی مخفی شد` +
          (res.deactivatedCategories > 0
            ? ` و ${fa(res.deactivatedCategories)} دستهٔ خالی غیرفعال شد`
            : ""),
      );
      void load();
    } else {
      toast.error(res.error ?? "خطا در مخفی‌سازی اقلام دستی");
    }
  }, [load]);

  // ---------- نمایش ----------
  if (loading || !state || !form) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const s = state.settings;
  const st = state.stats;

  const statCards = [
    { label: "اقلام همگام‌شده", value: st.productsSynced, icon: PackageCheck },
    { label: "دسته‌های متصل", value: st.categoriesLinked, icon: FolderTree },
    { label: "تصاویر دریافتی", value: st.imagesReceived, icon: ImageIcon },
    { label: "سفارش در انتظار ارسال", value: st.ordersPending, icon: ShoppingBag },
    { label: "سفارش ارسال‌شده", value: st.ordersSent, icon: CheckCheck },
  ];

  return (
    <div className="space-y-6">
      {/* ---------- هدر ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
            <Cable className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">اتصال به نرم‌افزار حسابداری باران</h2>
            <p className="text-sm text-muted-foreground">
              همگام‌سازی دوطرفهٔ منو و سفارش‌ها با نرم‌افزار باران (OnlineShopApi نسخهٔ ۵)
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setRefreshing(true);
            void load(true);
          }}
          disabled={refreshing}
        >
          {refreshing ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <RefreshCw className="ml-2 h-4 w-4" />}
          به‌روزرسانی
        </Button>
      </div>

      {/* ---------- وضعیت اتصال ---------- */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Power className="h-4 w-4" />
              وضعیت اتصال
            </CardTitle>
            <div className="flex items-center gap-3">
              <Badge
                variant="outline"
                className={
                  s.enabled
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "border-muted bg-muted text-muted-foreground"
                }
              >
                {s.enabled ? "فعال" : "غیرفعال"}
              </Badge>
              <Switch
                checked={s.enabled}
                disabled={toggling}
                onCheckedChange={(v) => void toggleEnabled(v)}
                aria-label="فعال/غیرفعال‌سازی اتصال باران"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!s.enabled && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>اتصال غیرفعال است</AlertTitle>
              <AlertDescription>
                تا زمان فعال‌شدن، همهٔ متدهای <code dir="ltr">api/ApiServiceBaran</code> پاسخ خطا
                می‌دهند و نرم‌افزار باران نمی‌تواند اطلاعاتی ارسال یا دریافت کند. با فعال‌کردن،
                آدرس و کلید زیر را در تنظیمات نرم‌افزار باران وارد کنید.
              </AlertDescription>
            </Alert>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {statCards.map((c) => (
              <div
                key={c.label}
                className="flex flex-col gap-1.5 rounded-xl border bg-muted/30 p-3 transition-colors hover:bg-muted/60"
              >
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <c.icon className="h-3.5 w-3.5" />
                  <span className="text-[11px] leading-4">{c.label}</span>
                </div>
                <span className="text-2xl font-bold tabular-nums">{fa(c.value)}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            آخرین همگام‌سازی محصولات: {timeLabel(st.lastProductSyncAt)}
          </div>
        </CardContent>
      </Card>

      {/* ---------- راهنمای پیکربندی ---------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ServerCog className="h-4 w-4" />
            پیکربندی نرم‌افزار باران
          </CardTitle>
          <CardDescription>
            این مقادیر را در تنظیمات فروشگاه آنلاین نرم‌افزار باران وارد کنید
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>آدرس API</Label>
            <div className="flex items-center gap-2">
              <code
                dir="ltr"
                className="flex-1 truncate rounded-lg border bg-muted/50 px-3 py-2 text-left text-xs"
              >
                {apiUrl}
              </code>
              <Button variant="outline" size="icon" onClick={() => void copy(apiUrl, "آدرس API")} aria-label="کپی آدرس API">
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              نرم‌افزار باران متدها را به انتهای این آدرس اضافه می‌کند (مثال:{" "}
              <code dir="ltr">{`${state.apiPath}ProductSEND`}</code>)
            </p>
          </div>

          <Separator />

          <div className="space-y-1.5">
            <Label>کلید API</Label>
            <div className="flex items-center gap-2">
              <code
                dir="ltr"
                className="flex-1 truncate rounded-lg border bg-muted/50 px-3 py-2 text-left text-xs"
              >
                {s.apiKey ? (showKey ? s.apiKey : "bk_•••••••••••••••••••••••••") : "— تولید نشده —"}
              </code>
              {s.apiKey && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? "پنهان‌کردن کلید" : "نمایش کلید"}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              )}
              {s.apiKey && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => void copy(s.apiKey, "کلید API")}
                  aria-label="کپی کلید API"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="icon" disabled={!s.apiKey} aria-label="تولید کلید جدید">
                    <KeyRound className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>کلید جدید تولید شود؟</AlertDialogTitle>
                    <AlertDialogDescription>
                      کلید قبلی بلافاصله باطل می‌شود و نرم‌افزار باران تا به‌روزرسانی کلید، به سایت
                      دسترسی نخواهد داشت. این عمل برای زمانی است که کلید فعلی در معرض خطر قرار گرفته
                      باشد.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>انصراف</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void rotateKey()}>
                      بله، کلید جدید بساز
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
            <p className="text-[11px] text-muted-foreground">
              ارسال با هدر <code dir="ltr">X-Api-Key</code> یا{" "}
              <code dir="ltr">Authorization: Bearer</code> یا کوئری{" "}
              <code dir="ltr">?apikey=</code> پذیرفته می‌شود. اگر نرم‌افزار امکان ارسال هدر را
              ندارد، الزام کلید را در تنظیمات همگام‌سازی خاموش کنید.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label>متدهای فعال</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(METHOD_META).map(([name, meta]) => (
                <div
                  key={name}
                  className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
                >
                  <div className="min-w-0">
                    <code dir="ltr" className="block text-xs font-semibold">
                      {name}
                    </code>
                    <span className="text-[11px] text-muted-foreground">{meta.desc}</span>
                  </div>
                  <Badge variant="outline" className={meta.className}>
                    {meta.label}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ---------- تنظیمات همگام‌سازی ---------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Save className="h-4 w-4" />
            تنظیمات همگام‌سازی
          </CardTitle>
          <CardDescription>رفتار دقیق تبدیل داده‌های باران به منو و سفارش‌ها</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>ساخت دسته‌بندی منو از</Label>
              <Select
                value={form.categoryLevel}
                onValueChange={(v) => {
                  setForm({ ...form, categoryLevel: v as "group" | "main" });
                  setDirty(true);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="group">زیرگروه کالا (پیشنهادی)</SelectItem>
                  <SelectItem value="main">سرگروه کالا</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                دسته‌بندی‌های فهرست منوی سایت بر اساس گروه‌های باران ساخته و به‌روزرسانی می‌شوند.
              </p>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="baran-require-key">الزام کلید API</Label>
                <p className="text-[11px] text-muted-foreground">
                  درخواست‌های بدون کلید معتبر رد می‌شوند (پیشنهادی)
                </p>
              </div>
              <Switch
                id="baran-require-key"
                checked={form.requireKey}
                onCheckedChange={(v) => {
                  setForm({ ...form, requireKey: v });
                  setDirty(true);
                }}
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="baran-stock-sync">مدیریت موجودی از باران</Label>
                <p className="text-[11px] text-muted-foreground">
                  کالای بدون موجودی به‌صورت «ناموجود» نمایش داده می‌شود
                </p>
              </div>
              <Switch
                id="baran-stock-sync"
                checked={form.stockSync}
                onCheckedChange={(v) => {
                  setForm({ ...form, stockSync: v });
                  setDirty(true);
                }}
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="baran-hide-deleted">مخفی‌سازی کالای حذف‌شده</Label>
                <p className="text-[11px] text-muted-foreground">
                  حذف در باران → خارج‌شدن از منو (به‌جای حذف فیزیکی و از دست رفتن تاریخ سفارش‌ها)
                </p>
              </div>
              <Switch
                id="baran-hide-deleted"
                checked={form.hideDeleted}
                onCheckedChange={(v) => {
                  setForm({ ...form, hideDeleted: v });
                  setDirty(true);
                }}
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border p-3 md:col-span-2">
              <div className="space-y-0.5">
                <Label htmlFor="baran-include-pending">ارسال سفارش‌های در انتظار پرداخت</Label>
                <p className="text-[11px] text-muted-foreground">
                  پیش‌فرض: فقط سفارش‌های پرداخت‌شده به باران ارسال می‌شوند. با فعال‌کردن این گزینه،
                  سفارش‌های ثبت‌شده با پرداخت در محل هم ارسال می‌شوند.
                </p>
              </div>
              <Switch
                id="baran-include-pending"
                checked={form.includePendingOrders}
                onCheckedChange={(v) => {
                  setForm({ ...form, includePendingOrders: v });
                  setDirty(true);
                }}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            {dirty && <span className="text-xs text-amber-600 dark:text-amber-400">تغییرات ذخیره نشده</span>}
            <Button
              variant="outline"
              size="sm"
              disabled={!dirty}
              onClick={() => {
                setForm(s);
                setDirty(false);
              }}
            >
              <RotateCcw className="ml-2 h-4 w-4" />
              بازنشانی
            </Button>
            <Button size="sm" disabled={!dirty || saving} onClick={() => void saveSettings()}>
              {saving ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Save className="ml-2 h-4 w-4" />}
              ذخیرهٔ تنظیمات
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ---------- اقلام متصل ---------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <PackageCheck className="h-4 w-4" />
            اقلام متصل به باران
          </CardTitle>
          <CardDescription>
            {fa(st.productsSynced)} قلم از منوی سایت با کد کالای باران همگام شده‌اند (۶۰ مورد
            اخیر)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state.items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <PackageCheck className="h-8 w-8 opacity-40" />
              <p className="text-sm">هنوز کالایی از باران دریافت نشده است</p>
              <p className="text-xs">
                پس از فعال‌کردن اتصال، نرم‌افزار باران با متد{" "}
                <code dir="ltr">ProductSEND</code> کالاها را ارسال می‌کند
              </p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto rounded-lg border [scrollbar-width:thin]">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-20 text-center">کد کالا</TableHead>
                    <TableHead>نام</TableHead>
                    <TableHead className="hidden md:table-cell">دسته</TableHead>
                    <TableHead className="text-left">قیمت</TableHead>
                    <TableHead className="text-center">وضعیت</TableHead>
                    <TableHead className="hidden text-center sm:table-cell">تصویر</TableHead>
                    <TableHead className="hidden text-center lg:table-cell">آخرین همگام‌سازی</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="text-center font-mono text-xs tabular-nums">
                        {fa(i.baranProductId)}
                      </TableCell>
                      <TableCell className="font-medium">
                        {i.name}
                        {i.baranUnit && (
                          <span className="ml-1 text-xs text-muted-foreground">({i.baranUnit})</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        {i.categoryName}
                      </TableCell>
                      <TableCell className="text-left tabular-nums">{fa(i.price)}</TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant="outline"
                          className={
                            i.isAvailable
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
                          }
                        >
                          {i.isAvailable ? "موجود" : "ناموجود"}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden text-center sm:table-cell">
                        {i.hasImage ? (
                          <ImageIcon className="mx-auto h-4 w-4 text-emerald-500" />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-center text-xs text-muted-foreground lg:table-cell">
                        {timeLabel(i.syncedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------- گزارش اتصال ---------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ExternalLink className="h-4 w-4" />
            گزارش فراخوانی‌های API
          </CardTitle>
          <CardDescription>آخرین ۳۰ فراخوانی نرم‌افزار باران روی سایت</CardDescription>
        </CardHeader>
        <CardContent>
          {state.logs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <ExternalLink className="h-8 w-8 opacity-40" />
              <p className="text-sm">هنوز فراخوانی‌ای ثبت نشده است</p>
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto rounded-lg border [scrollbar-width:thin]">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-32">متد</TableHead>
                    <TableHead className="text-center">نتیجه</TableHead>
                    <TableHead className="hidden md:table-cell">خلاصه</TableHead>
                    <TableHead className="text-left">زمان</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.logs.map((l) => {
                    const meta = METHOD_META[l.method];
                    return (
                      <TableRow key={l.id}>
                        <TableCell>
                          {meta ? (
                            <Badge variant="outline" className={meta.className}>
                              {meta.label}
                            </Badge>
                          ) : (
                            <code dir="ltr" className="text-xs">
                              {l.method}
                            </code>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="text-xs tabular-nums">
                            <span className="text-emerald-600 dark:text-emerald-400">{fa(l.okCount)}</span>
                            {" / "}
                            {fa(l.totalCount)}
                            {l.failCount > 0 && (
                              <span className="text-red-600 dark:text-red-400">
                                {" "}
                                ({fa(l.failCount)} خطا)
                              </span>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="hidden max-w-md truncate text-xs text-muted-foreground md:table-cell">
                          {l.message ?? "—"}
                        </TableCell>
                        <TableCell className="text-left text-xs text-muted-foreground">
                          {timeLabel(l.createdAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------- عملیات پیشرفته ---------- */}
      <Card className="border-amber-500/40">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            عملیات پیشرفته
          </CardTitle>
          <CardDescription>
            فقط در صورت نیاز — این عملیات‌ها رفتار همگام‌سازی و منو را تغییر می‌دهند
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">منوی کاملاً بارانی</p>
              <p className="max-w-xl text-xs text-muted-foreground">
                همهٔ اقلامی که از باران نیامده‌اند (اقلام دستی/اولیه) از منو مخفی و دسته‌های خالیِ بدون
                اتصال غیرفعال می‌شوند — حذف فیزیکی نیست و از «مدیریت منو» قابل بازگردانی است.
                مناسب وقتی می‌خواهید فهرست منو دقیقاً همان کالاهای نرم‌افزار باشد.
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <PackageCheck className="ml-2 h-4 w-4" />
                  مخفی‌سازی اقلام دستی
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>اقلام غیربارانی از منو مخفی شوند؟</AlertDialogTitle>
                  <AlertDialogDescription>
                    اقلام بدون اتصال به باران از فهرست منوی سایت خارج می‌شوند (سفارش‌ها و داده‌های
                    آن‌ها حفظ می‌شود). این عمل از بخش «مدیریت منو» قابل بازگردانی است.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>انصراف</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void hideManualItems()}>
                    بله، منو را بارانی کن
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">ارسال مجدد سفارش‌ها به باران</p>
              <p className="max-w-xl text-xs text-muted-foreground">
                سفارش‌هایی که باران دریافتشان را تأیید کرده ({fa(st.ordersSent)} سفارش) دوباره در
                لیست ارسال قرار می‌گیرند. مناسب زمانی که داده‌های نرم‌افزار گم شده یا نصب مجدد
                شده است. توجه: ممکن است در باران رکورد تکراری ایجاد کند.
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={st.ordersSent === 0}>
                  <RotateCcw className="ml-2 h-4 w-4" />
                  ارسال مجدد همه
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>همهٔ سفارش‌های ارسال‌شده مجدداً ارسال شوند؟</AlertDialogTitle>
                  <AlertDialogDescription>
                    {fa(st.ordersSent)} سفارش دوباره در دسترس متد Orders قرار می‌گیرند. اگر
                    نرم‌افزار باران آن‌ها را داشته باشد، رکورد تکراری ثبت خواهد شد. مطمئن شوید
                    واقعاً نیاز دارید.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>انصراف</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void resendOrders()}>
                    بله، بازگردانی کن
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
