"use client";

import { useState, useEffect, useRef } from "react";
import type { RealtimeSocket } from "@/lib/realtime";
import { connectRealtime } from "@/lib/realtime";
import { useAppStore } from "@/lib/store";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { formatToman, formatJalali, toPersianDigits } from "@/lib/fa";
import { formatScheduleFa } from "@/lib/schedule";
import {
  PackageSearch,
  SearchX,
  Loader2,
  Clock,
  CreditCard,
  ChefHat,
  Package,
  Bike,
  CheckCircle2,
  XCircle,
  TriangleAlert,
  RotateCcw,
  Receipt,
  Store,
  CalendarClock,
  Share2,
} from "lucide-react";
import { buildOrderShareText, shareOrderText } from "@/lib/share";
import { toast } from "sonner";

// ============ types ============

interface TrackOrder {
  orderNumber: string;
  status: string;
  statusLabel: string;
  paymentStatus: string;
  type: string;
  total: number;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  taxAmount: number;
  createdAt: string;
  updatedAt: string;
  scheduledFor?: string | null;
  items: { name: string; quantity: number }[];
  statusLogs: { status: string; label: string; note: string | null; createdAt: string }[];
}

// ============ per-status visual language (NO blue/indigo) ============

const STATUS_STYLE: Record<string, { icon: React.ElementType; circle: string; chip: string }> = {
  PENDING_PAYMENT: {
    icon: Clock,
    circle: "border-amber-500 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    chip: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  PAID: {
    icon: CreditCard,
    circle: "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  PREPARING: {
    icon: ChefHat,
    circle: "border-teal-500 bg-teal-500/10 text-teal-600 dark:text-teal-400",
    chip: "bg-teal-500/15 text-teal-700 dark:text-teal-400",
  },
  READY: {
    icon: Package,
    circle: "border-primary bg-primary/10 text-primary",
    chip: "bg-primary/15 text-primary",
  },
  DELIVERING: {
    icon: Bike,
    circle: "border-orange-500 bg-orange-500/10 text-orange-600 dark:text-orange-400",
    chip: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  },
  DELIVERED: {
    icon: CheckCircle2,
    circle: "border-emerald-600 bg-emerald-600 text-white",
    chip: "bg-emerald-600 text-white",
  },
  CANCELED: {
    icon: XCircle,
    circle: "border-destructive bg-destructive/10 text-destructive",
    chip: "bg-destructive/15 text-destructive",
  },
  PAYMENT_FAILED: {
    icon: TriangleAlert,
    circle: "border-destructive bg-destructive/10 text-destructive",
    chip: "bg-destructive/15 text-destructive",
  },
};

const DEFAULT_STYLE = {
  icon: Clock,
  circle: "border-border bg-muted text-muted-foreground",
  chip: "bg-muted text-muted-foreground",
};

function styleFor(status: string) {
  return STATUS_STYLE[status] ?? DEFAULT_STYLE;
}

// ============ view ============

export function TrackView() {
  const { setView } = useAppStore();
  const [orderNumber, setOrderNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TrackOrder | null>(null);

  // live channel state — null = not tracking, "connecting" = socket up but not
  // yet acked, "live" = acked "joined-customer", "disconnected" = socket dropped
  const [live, setLive] = useState<"connecting" | "live" | "disconnected" | null>(null);
  const socketRef = useRef<RealtimeSocket | null>(null);
  // snapshot the query at submit time — the user might edit the inputs while the
  // result card is open; the live refetch needs the exact phone they used.
  const queryRef = useRef<{ orderNumber: string; phone: string } | null>(null);
  // bumping this key re-triggers the live effect after a successful refetch so
  // the result card animates back in (the animate-fade-up class runs once per
  // mount, so we remount the card with a new key to re-fire it).
  const [resultKey, setResultKey] = useState(0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!orderNumber.trim() || !phone.trim()) {
      setError("شماره سفارش و شماره موبایل را وارد کنید");
      setResult(null);
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    const res = await api<{ order: TrackOrder }>("/api/orders/track", {
      body: { orderNumber: orderNumber.trim(), phone: phone.trim() },
    });
    setLoading(false);
    if (!res.success) {
      setError(res.error ?? "خطا در رهگیری سفارش");
      return;
    }
    queryRef.current = { orderNumber: orderNumber.trim(), phone: phone.trim() };
    setResult(res.order);
  };

  const disconnectLive = () => {
    const s = socketRef.current;
    if (s) {
      s.removeAllListeners();
      s.disconnect();
      socketRef.current = null;
    }
    setLive(null);
  };

  const reset = () => {
    disconnectLive();
    queryRef.current = null;
    setOrderNumber("");
    setPhone("");
    setError(null);
    setResult(null);
  };

  // live channel: connect socket.io whenever a result is on screen.
  // disconnects on unmount or when the user clicks reset.
  useEffect(() => {
    if (!result) return; // no active track → no socket needed
    let active = true;
    let keyRejected = false;

    const connect = async () => {
      // connectRealtime: sandbox gateway (XTransformPort) or production path /rt
      const s = await connectRealtime();
      if (!active) return;

      socketRef.current = s;
      setLive("connecting");

      // re-join on every (re)connect — room membership is per-connection
      s.on("connect", () => {
        if (!active) return;
        setLive("connecting");
        s.emit("customer-join", { orderNumber: queryRef.current?.orderNumber });
      });

      s.on("joined-customer", () => {
        if (!active) return;
        setLive("live");
      });

      s.on("error: invalid order number", () => {
        // server rejected the orderNumber shape — stop trying
        keyRejected = true;
        setLive("disconnected");
        s.disconnect();
      });

      s.on("disconnect", () => {
        if (!active) return;
        setLive("disconnected");
      });

      s.on("connect_error", () => {
        if (!active) return;
        setLive("disconnected");
      });

      // the actual live update: re-fetch the track endpoint and animate
      s.on("customer:order-status", async (p: { orderNumber?: string; status?: string; statusLabel?: string }) => {
        if (!active) return;
        const q = queryRef.current;
        if (!q) return;
        // only react to events for OUR order (defense-in-depth — the room
        // filter on the server already scopes this)
        if (p?.orderNumber && q.orderNumber && p.orderNumber !== q.orderNumber) return;
        const res = await api<{ order: TrackOrder }>("/api/orders/track", {
          body: { orderNumber: q.orderNumber, phone: q.phone },
        });
        if (!active) return;
        if (res.success && res.order) {
          setResult(res.order);
          setResultKey((k) => k + 1); // remount → re-fire animate-fade-up
          toast.success(`📡 وضعیت سفارش به‌روز شد: ${p?.statusLabel ?? res.order.statusLabel}`, {
            description: `شماره سفارش ${toPersianDigits(res.order.orderNumber)}`,
          });
        }
      });
    };

    void connect();

    return () => {
      active = false;
      const s = socketRef.current;
      if (s) {
        s.removeAllListeners();
        s.disconnect();
      }
      socketRef.current = null;
      setLive(null);
      void keyRejected; // silence unused-warning while keeping the flag named
    };
  }, [result?.orderNumber]); // re-run only when the tracked order changes
  // (effect reads result.orderNumber via queryRef snapshot — no need to depend on more)

  /** share tracked-order receipt via WhatsApp (native share sheet on mobile) */
  const handleShare = async () => {
    if (!result) return;
    const ok = await shareOrderText(
      buildOrderShareText({
        orderNumber: result.orderNumber,
        statusLabel: result.statusLabel,
        type: result.type,
        subtotal: result.subtotal,
        discount: result.discount,
        deliveryFee: result.deliveryFee,
        taxAmount: result.taxAmount,
        total: result.total,
        createdAt: result.createdAt,
        scheduledFor: result.scheduledFor,
        items: result.items.map((it) => ({ name: it.name, quantity: it.quantity })),
      })
    );
    if (ok) toast.success("رسید سفارش برای هم‌رسانی آماده شد 📲");
  };

  const currentStyle = result ? styleFor(result.status) : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      {/* header */}
      <div className="mb-6 text-center">
        <h1 className="flex flex-wrap items-center justify-center gap-2.5 text-xl font-extrabold sm:text-2xl">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-inner">
            <PackageSearch className="h-5.5 w-5.5" />
          </span>
          رهگیری سفارش 📦
        </h1>
        <p className="mx-auto mt-2.5 max-w-md text-sm leading-7 text-muted-foreground">
          شماره سفارش (مثل NK-1234) و شماره موبایلی که با آن سفارش ثبت کرده‌اید را وارد کنید — بدون نیاز به ورود.
        </p>
        <div className="mx-auto mt-3.5 h-1 w-12 rounded-full bg-gradient-to-l from-primary to-gold" />
      </div>

      {/* search form */}
      <Card className="gap-0 rounded-2xl border-2 border-primary/15 p-4 shadow-md sm:p-5">
        <form onSubmit={submit} className="space-y-3.5">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="track-order-number" className="text-xs font-bold">
                شماره سفارش
              </Label>
              <Input
                id="track-order-number"
                dir="ltr"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value.toUpperCase())}
                placeholder="NK-XXXX"
                className="h-11 rounded-xl text-left font-mono tracking-wider"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="track-phone" className="text-xs font-bold">
                شماره موبایل (صاحب سفارش)
              </Label>
              <Input
                id="track-phone"
                dir="ltr"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="09xxxxxxxxx"
                className="h-11 rounded-xl text-left tracking-wide"
                autoComplete="tel"
              />
            </div>
          </div>
          <Button
            type="submit"
            disabled={loading}
            size="lg"
            className="h-12 w-full rounded-xl font-extrabold shadow-lg shadow-primary/25"
          >
            {loading ? <Loader2 className="ml-2 h-5 w-5 animate-spin" /> : <PackageSearch className="ml-2 h-5 w-5" />}
            پیگیری سفارش
          </Button>
        </form>
      </Card>

      {/* inline error */}
      {error && (
        <Card className="mt-5 animate-fade-up gap-0 rounded-2xl border-destructive/30 bg-destructive/5 p-4" role="alert">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/15 text-destructive">
              <SearchX className="h-5 w-5" />
            </span>
            <div className="flex-1 text-sm leading-6">
              <b className="text-destructive">{error}</b>
              <p className="mt-0.5 text-xs text-muted-foreground">
                شماره سفارش را از رسید پرداخت بررسی کنید و مطمئن شوید موبایلِ همان حسابی را وارد کرده‌اید که سفارش با آن ثبت شده است.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* result */}
      {result && currentStyle && (
        <Card key={resultKey} className="mt-5 animate-fade-up gap-0 overflow-hidden rounded-2xl shadow-lg">
          {/* header */}
          <div className={`px-4 py-3.5 ${result.status === "CANCELED" || result.status === "PAYMENT_FAILED" ? "bg-destructive text-white" : "bg-gradient-to-l from-primary to-primary/85 text-primary-foreground"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-extrabold">
                <Package className="h-5 w-5" />
                وضعیت: {result.statusLabel}
                {/* live pill — emerald pulsing when acked, gray while connecting,
                    hidden (transparent chip placeholder when not yet started) */}
                {live === "live" && (
                  <span
                    role="status"
                    aria-live="polite"
                    title="تغییرات وضعیت سفارش به‌صورت لحظه‌ای روی همین صفحه نمایش داده می‌شود"
                    className="mr-1 inline-flex items-center gap-1 rounded-full bg-emerald-400/95 px-2.5 py-0.5 text-[10px] font-black text-emerald-950 shadow-sm animate-pulse"
                  >
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-900 opacity-60" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-900" />
                    </span>
                    به‌روزرسانی زنده فعال
                  </span>
                )}
                {live === "connecting" && (
                  <span
                    role="status"
                    title="در حال اتصال به کانال زنده برای دریافت تغییرات وضعیت سفارش"
                    className="mr-1 inline-flex items-center gap-1 rounded-full bg-white/25 px-2 py-0.5 text-[10px] font-bold text-white"
                  >
                    <Loader2 className="h-3 w-3 animate-spin" />
                    در حال اتصال...
                  </span>
                )}
                {live === "disconnected" && (
                  <span
                    role="status"
                    title="اتصال زنده قطع شد — در حال تلاش برای اتصال مجدد"
                    className="mr-1 inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold text-white/90"
                  >
                    ⚠ زنده قطع است
                  </span>
                )}
              </div>
              <span className="rounded-lg bg-black/15 px-2 py-0.5 font-mono text-xs" dir="ltr">
                {result.orderNumber}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="rounded-full bg-white/20 px-2.5 py-1 font-bold">
                {result.type === "DELIVERY" ? "ارسال با پیک 🛵" : "بیرونبر 🥡"}
              </span>
              <span className="rounded-full bg-white/20 px-2.5 py-1 font-bold">
                {result.paymentStatus === "PAID"
                  ? "پرداخت شده ✓"
                  : result.paymentStatus === "FAILED"
                    ? "پرداخت ناموفق"
                    : "در انتظار پرداخت"}
              </span>
              <span className="font-bold opacity-95">ثبت: {formatJalali(result.createdAt, true)}</span>
            </div>
            {result.scheduledFor && !["DELIVERED", "CANCELED"].includes(result.status) && (
              <div
                className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-gold px-3 py-1 text-[11px] font-extrabold text-white shadow-md"
              >
                <CalendarClock className="h-3.5 w-3.5" />
                پیش‌سفارش برای: {formatScheduleFa(result.scheduledFor)}
              </div>
            )}
          </div>

          <CardContent className="p-4 sm:p-5">
            {/* vertical timeline */}
            <div className="mb-1 flex items-center gap-2 text-sm font-extrabold">
              <Clock className="h-4.5 w-4.5 text-primary" />
              مسیر سفارش
            </div>
            <div className="mt-3">
              {result.statusLogs.map((log, i) => {
                const style = styleFor(log.status);
                const Icon = style.icon;
                const last = i === result.statusLogs.length - 1;
                const current = last && result.status !== "DELIVERED";
                return (
                  <div key={i} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 ${style.circle} ${current ? "animate-pulse-ring" : ""}`}
                        aria-hidden
                      >
                        <Icon className="h-4.5 w-4.5" />
                      </span>
                      {!last && <span className="w-0.5 flex-1 bg-border" style={{ minHeight: 14 }} aria-hidden />}
                    </div>
                    <div className={last ? "pb-1" : "pb-5"}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-extrabold">{log.label}</span>
                        {last && <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${style.chip}`}>وضعیت فعلی</span>}
                      </div>
                      {log.note && <div className="mt-0.5 text-xs text-muted-foreground">{log.note}</div>}
                      <div className="mt-0.5 text-[11px] text-muted-foreground">{formatJalali(log.createdAt, true)}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <Separator className="my-4" />

            {/* items */}
            <div className="flex items-center gap-2 text-sm font-extrabold">
              <Receipt className="h-4.5 w-4.5 text-primary" />
              اقلام سفارش
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {result.items.map((item, i) => (
                <Badge key={i} variant="secondary" className="rounded-lg font-normal">
                  {item.name} ×{toPersianDigits(item.quantity)}
                </Badge>
              ))}
            </div>

            {/* totals */}
            <div className="mt-4 space-y-1.5 rounded-xl bg-muted/50 p-3.5 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>جمع اقلام</span>
                <span>{formatToman(result.subtotal)}</span>
              </div>
              {result.discount > 0 && (
                <div className="flex justify-between font-bold text-emerald-700 dark:text-emerald-400">
                  <span>تخفیف</span>
                  <span dir="ltr">−{formatToman(result.discount)}</span>
                </div>
              )}
              {result.type === "DELIVERY" && (
                <div className="flex justify-between text-muted-foreground">
                  <span>هزینه پیک</span>
                  {result.deliveryFee === 0 ? (
                    <span className="font-bold text-primary">رایگان 🎉</span>
                  ) : (
                    <span>{formatToman(result.deliveryFee)}</span>
                  )}
                </div>
              )}
              <div className="flex justify-between text-muted-foreground">
                <span>مالیات ارزش افزوده</span>
                <span>{formatToman(result.taxAmount)}</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between text-base font-extrabold text-primary">
                <span>مبلغ کل سفارش</span>
                <span>{formatToman(result.total)}</span>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" onClick={reset} className="rounded-xl font-bold text-primary">
                <RotateCcw className="ml-1.5 h-4 w-4" />
                رهگیری سفارش دیگر
              </Button>
              <Button
                variant="outline"
                onClick={handleShare}
                className="rounded-xl font-bold text-emerald-700 hover:bg-emerald-600/10 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-400"
              >
                <Share2 className="ml-1.5 h-4 w-4" />
                هم‌رسانی وضعیت
              </Button>
              <Button variant="ghost" onClick={() => setView("home")} className="rounded-xl font-bold text-muted-foreground">
                <Store className="ml-1.5 h-4 w-4" />
                بازگشت به منو
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* empty initial state */}
      {!result && !error && (
        <div className="mt-5 flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-muted-foreground/25 px-6 py-12 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/10">
            <SearchX className="h-8 w-8 text-primary" />
          </span>
          <h3 className="text-sm font-extrabold">هنوز جستجویی انجام نشده</h3>
          <p className="max-w-sm text-xs leading-6 text-muted-foreground">
            شماره سفارش شما در رسید پرداخت (پس از خرید) نمایش داده می‌شود؛ به شکل <b dir="ltr">NK-XXXX</b> است.
            وضعیت لحظه‌ای سفارش — از آماده‌سازی تا تحویل — همین‌جا قابل مشاهده است.
          </p>
        </div>
      )}
    </div>
  );
}
