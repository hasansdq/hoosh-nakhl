"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { formatToman, formatJalali, toPersianDigits, toEnglishDigits } from "@/lib/fa";
import { toast } from "sonner";
import { Ticket, Plus, Copy, Pencil, Trash2, Loader2, ShoppingBag, CalendarClock } from "lucide-react";

interface CouponRow {
  id: string;
  code: string;
  title: string;
  type: "PERCENT" | "FIXED";
  value: number;
  minOrder: number;
  maxDiscount: number | null;
  usageLimit: number;
  usedCount: number;
  perUserLimit: number;
  startsAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
  ordersCount: number;
}

interface CouponForm {
  code: string;
  title: string;
  type: "PERCENT" | "FIXED";
  value: string;
  minOrder: string;
  maxDiscount: string;
  usageLimit: string;
  perUserLimit: string;
  expiresAt: string;
}

const EMPTY_FORM: CouponForm = {
  code: "",
  title: "",
  type: "PERCENT",
  value: "",
  minOrder: "",
  maxDiscount: "",
  usageLimit: "",
  perUserLimit: "1",
  expiresAt: "",
};

function couponValueLabel(c: CouponRow): string {
  return c.type === "PERCENT" ? `${toPersianDigits(c.value)}٪` : formatToman(c.value);
}

export function CouponsManager() {
  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CouponRow | null>(null);
  const [form, setForm] = useState<CouponForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CouponRow | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await api<{ coupons: CouponRow[] }>("/api/admin/coupons");
      if (active) {
        if (res.success) setCoupons(res.coupons ?? []);
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const refresh = async () => {
    const res = await api<{ coupons: CouponRow[] }>("/api/admin/coupons");
    if (res.success) setCoupons(res.coupons ?? []);
  };

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (c: CouponRow) => {
    setEditing(c);
    setForm({
      code: c.code,
      title: c.title,
      type: c.type,
      value: String(c.value),
      minOrder: c.minOrder ? String(c.minOrder) : "",
      maxDiscount: c.maxDiscount ? String(c.maxDiscount) : "",
      usageLimit: c.usageLimit ? String(c.usageLimit) : "",
      perUserLimit: c.perUserLimit ? String(c.perUserLimit) : "1",
      expiresAt: c.expiresAt ? c.expiresAt.slice(0, 10) : "",
    });
    setDialogOpen(true);
  };

  const submit = async () => {
    const code = form.code.trim().toUpperCase();
    if (code.length < 3) return toast.error("کد تخفیف حداقل ۳ نویسه باشد");
    if (!form.title.trim()) return toast.error("عنوان کد را وارد کنید");
    const value = Number(toEnglishDigits(form.value));
    if (!value || value < 1) return toast.error("مقدار تخفیف را درست وارد کنید");
    if (form.type === "PERCENT" && value > 100) return toast.error("درصد تخفیف حداکثر ۱۰۰ است");
    if (form.type === "FIXED" && value < 1000) return toast.error("مبلغ تخفیف حداقل ۱٫۰۰۰ تومان است");

    const maxDiscount = form.type === "PERCENT" ? Number(toEnglishDigits(form.maxDiscount)) || null : null;

    const body = {
      code,
      title: form.title.trim(),
      type: form.type,
      value,
      minOrder: Number(toEnglishDigits(form.minOrder)) || 0,
      maxDiscount,
      usageLimit: Number(toEnglishDigits(form.usageLimit)) || 0,
      perUserLimit: Number(toEnglishDigits(form.perUserLimit)) || 1,
      expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
    };

    setSaving(true);
    const res = editing
      ? await api(`/api/admin/coupons/${editing.id}`, { method: "PATCH", body })
      : await api("/api/admin/coupons", { method: "POST", body });
    setSaving(false);
    if (!res.success) return toast.error(res.error ?? "ذخیره ناموفق بود");

    toast.success(editing ? "کد تخفیف بروزرسانی شد ✅" : `کد تخفیف «${code}» ساخته شد 🎟`);
    setDialogOpen(false);
    refresh();
  };

  const toggleActive = async (c: CouponRow, checked: boolean) => {
    setBusyId(c.id);
    const res = await api(`/api/admin/coupons/${c.id}`, { method: "PATCH", body: { isActive: checked } });
    setBusyId(null);
    if (!res.success) return toast.error(res.error ?? "خطا در تغییر وضعیت");
    toast.success(checked ? `کد «${c.code}» فعال شد` : `کد «${c.code}» غیرفعال شد`);
    refresh();
  };

  const remove = async (c: CouponRow) => {
    setBusyId(c.id);
    const res = await api<{ deactivated?: boolean; reason?: string }>(`/api/admin/coupons/${c.id}`, {
      method: "DELETE",
    });
    setBusyId(null);
    setDeleteTarget(null);
    if (!res.success) return toast.error(res.error ?? "حذف ناموفق بود");
    if (res.deactivated) {
      toast.info(res.reason ?? "این کد به‌دلیل سابقه سفارش‌ها فقط غیرفعال شد");
    } else {
      toast.success("کد تخفیف حذف شد");
    }
    refresh();
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code).then(
      () => toast.success(`کد «${toPersianDigits(code)}» کپی شد 📋`),
      () => toast.error("کپی ناموفق بود")
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-black">
            <Ticket className="h-6 w-6 text-primary" />
            کدهای تخفیف
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading ? "در حال بارگذاری..." : `${toPersianDigits(coupons.length)} کد ثبت‌شده — ${toPersianDigits(coupons.filter((c) => c.isActive).length)} فعال`}
          </p>
        </div>
        <Button onClick={openCreate} className="rounded-xl font-bold">
          <Plus className="ml-1.5 h-4 w-4" />
          کد جدید
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : coupons.length === 0 ? (
        <Card className="border-dashed p-12 text-center">
          <Ticket className="mx-auto h-12 w-12 text-muted-foreground/40" />
          <p className="mt-3 font-bold">هنوز کد تخفیفی ثبت نشده</p>
          <p className="mt-1 text-sm text-muted-foreground">
            با ساخت اولین کد، مشتری‌ها در سبد خرید می‌توانند از آن استفاده کنند
          </p>
          <Button onClick={openCreate} className="mt-4 rounded-xl font-bold">
            <Plus className="ml-1.5 h-4 w-4" />
            ساخت اولین کد تخفیف
          </Button>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {coupons.map((c) => (
            <Card key={c.id} className={`rounded-2xl p-4 transition ${c.isActive ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    onClick={() => copyCode(c.code)}
                    title="کپی کد"
                    className="group flex items-center gap-1.5 rounded-xl border border-dashed bg-muted/40 px-3 py-1.5 font-mono text-sm font-black tracking-wider transition hover:border-primary/50 hover:bg-accent"
                    dir="ltr"
                  >
                    {c.code}
                    <Copy className="h-3.5 w-3.5 text-muted-foreground transition group-hover:text-primary" />
                  </button>
                  <span className="text-sm font-bold">{c.title}</span>
                  <Badge className="border-gold/40 bg-gold/10 text-[11px] text-gold-foreground">
                    {couponValueLabel(c)}
                  </Badge>
                  {c.type === "PERCENT" && c.maxDiscount != null && (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      سقف {formatToman(c.maxDiscount)}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={c.isActive}
                    onCheckedChange={(checked) => toggleActive(c, checked)}
                    disabled={busyId === c.id}
                    aria-label={c.isActive ? "غیرفعال کردن کد" : "فعال کردن کد"}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 rounded-xl"
                    onClick={() => openEdit(c)}
                    aria-label={`ویرایش ${c.code}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 rounded-xl text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(c)}
                    aria-label={`حذف ${c.code}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t pt-2.5 text-[11px] text-muted-foreground">
                {c.minOrder > 0 && (
                  <span>حداقل سفارش: <b className="text-foreground/80">{formatToman(c.minOrder)}</b></span>
                )}
                <span>
                  استفاده:{" "}
                  <b className="text-foreground/80">
                    {toPersianDigits(c.usedCount)} از {c.usageLimit > 0 ? toPersianDigits(c.usageLimit) : "∞"}
                  </b>
                </span>
                <span>
                  سقف هر کاربر: <b className="text-foreground/80">{toPersianDigits(c.perUserLimit)}</b>
                </span>
                <span className="flex items-center gap-1">
                  <CalendarClock className="h-3.5 w-3.5" />
                  {c.expiresAt ? `انقضا: ${formatJalali(c.expiresAt)}` : "بدون تاریخ انقضا"}
                </span>
                <span className="flex items-center gap-1">
                  <ShoppingBag className="h-3.5 w-3.5" />
                  {toPersianDigits(c.ordersCount)} سفارش با این کد
                </span>
                {busyId === c.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-lg" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ticket className="h-5 w-5 text-primary" />
              {editing ? `ویرایش کد ${toPersianDigits(editing.code)}` : "کد تخفیف جدید"}
            </DialogTitle>
            <DialogDescription>
              {editing ? "مشخصات کد را بروزرسانی کنید" : "مشخصات کد تخفیف را وارد کنید"}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="coupon-code">کد تخفیف</Label>
              <Input
                id="coupon-code"
                dir="ltr"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="NAKHL20"
                className="rounded-xl font-mono tracking-wider"
                readOnly={!!editing}
                disabled={!!editing}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="coupon-title">عنوان</Label>
              <Input
                id="coupon-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="مثلاً جشن افتتاح نخل"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label>نوع تخفیف</Label>
              <Select
                value={form.type}
                onValueChange={(v) => setForm({ ...form, type: v as "PERCENT" | "FIXED" })}
              >
                <SelectTrigger className="w-full rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PERCENT">درصدی</SelectItem>
                  <SelectItem value="FIXED">مبلغی</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="coupon-value">مقدار تخفیف</Label>
              <div className="relative">
                <Input
                  id="coupon-value"
                  dir="ltr"
                  inputMode="numeric"
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                  placeholder={form.type === "PERCENT" ? "20" : "50000"}
                  className="rounded-xl pl-14"
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground" dir="ltr">
                  {form.type === "PERCENT" ? "%" : "Toman"}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                {form.type === "PERCENT" ? "درصد تخفیف (۱ تا ۱۰۰)" : "مبلغ ثابت به تومان (حداقل ۱٫۰۰۰)"}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="coupon-min-order">حداقل مبلغ سفارش</Label>
              <Input
                id="coupon-min-order"
                dir="ltr"
                inputMode="numeric"
                value={form.minOrder}
                onChange={(e) => setForm({ ...form, minOrder: e.target.value })}
                placeholder="0"
                className="rounded-xl"
              />
            </div>
            {form.type === "PERCENT" && (
              <div className="space-y-1.5">
                <Label htmlFor="coupon-max-discount">سقف تخفیف (تومان)</Label>
                <Input
                  id="coupon-max-discount"
                  dir="ltr"
                  inputMode="numeric"
                  value={form.maxDiscount}
                  onChange={(e) => setForm({ ...form, maxDiscount: e.target.value })}
                  placeholder="خالی = بدون سقف"
                  className="rounded-xl"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="coupon-usage">محدودیت تعداد استفاده</Label>
              <Input
                id="coupon-usage"
                dir="ltr"
                inputMode="numeric"
                value={form.usageLimit}
                onChange={(e) => setForm({ ...form, usageLimit: e.target.value })}
                placeholder="0 = نامحدود"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="coupon-per-user">سقف استفاده هر کاربر</Label>
              <Input
                id="coupon-per-user"
                dir="ltr"
                inputMode="numeric"
                value={form.perUserLimit}
                onChange={(e) => setForm({ ...form, perUserLimit: e.target.value })}
                placeholder="1"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="coupon-expires">تاریخ انقضا</Label>
              <Input
                id="coupon-expires"
                type="date"
                dir="ltr"
                value={form.expiresAt}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                className="rounded-xl"
              />
              <p className="text-[10px] text-muted-foreground">خالی بگذارید تا بدون انقضا باشد</p>
            </div>
          </div>

          <DialogFooter className="mt-2 gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="rounded-xl" disabled={saving}>
              انصراف
            </Button>
            <Button onClick={submit} disabled={saving} className="rounded-xl font-bold">
              {saving ? (
                <>
                  <Loader2 className="ml-2 h-4 w-4 animate-spin" /> در حال ذخیره...
                </>
              ) : (
                <>
                  <Ticket className="ml-2 h-4 w-4" />
                  {editing ? "ذخیره تغییرات" : "ساخت کد تخفیف"}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف کد تخفیف؟</AlertDialogTitle>
            <AlertDialogDescription>
              کد «{toPersianDigits(deleteTarget?.code ?? "")}» حذف شود؟ اگر سفارشی با این کد ثبت شده باشد، به‌جای
              حذف فقط غیرفعال می‌شود.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="rounded-xl">انصراف</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && remove(deleteTarget)}
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <Trash2 className="ml-1.5 h-4 w-4" />
              حذف کن
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
