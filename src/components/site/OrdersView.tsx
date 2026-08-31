"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import type { Socket } from "socket.io-client";
import { useAppStore } from "@/lib/store";
import { api } from "@/lib/client-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { formatToman, formatJalali, toPersianDigits } from "@/lib/fa";
import { useCartStore } from "@/lib/cart-store";
import { toast } from "sonner";
import {
  Package,
  Bike,
  Store,
  CreditCard,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Inbox,
  RotateCcw,
  Bot,
  Star,
  Ticket,
  ShoppingCart,
  Printer,
  Share2,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import { buildOrderShareText, shareOrderText } from "@/lib/share";

interface OrderItem {
  menuItemId: string | null;
  name: string;
  quantity: number;
  lineTotal: number;
  myRating: number | null;
}

interface OrderRow {
  id: string;
  orderNumber: string;
  status: string;
  statusLabel: string;
  paymentStatus: string;
  paymentRef: string | null;
  paymentError: string | null;
  type: string;
  address: string | null;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  couponCode: string | null;
  taxAmount: number;
  total: number;
  createdAt: string;
  scheduledFor?: string | null;
  canReview: boolean;
  items: OrderItem[];
}

/** state of the rating dialog — which item is being reviewed */
interface RatingTarget {
  menuItemId: string;
  name: string;
}

/** state of the reorder confirmation dialog — which order is being re-ordered */
interface ReorderTarget {
  order: OrderRow;
}

/** one row in the reorder preview — what the user is about to add to cart */
interface ReorderRow {
  name: string;
  menuItemId: string | null;
  quantity: number;
  // snapshot price (what the user paid back then)
  oldUnitPrice: number;
  // current menu price (null = no longer in menu)
  newUnitPrice: number | null;
  // whether the item is currently marked available
  available: boolean;
}

/** Printable invoice — hidden on screen, isolated via .print-area on print */
function PrintInvoice({ order, customerName }: { order: OrderRow; customerName?: string }) {
  return (
    <div className="print-area hidden" aria-hidden>
      <div className="mx-auto max-w-lg">
        <div className="border-b-2 border-black pb-3 text-center">
          <div className="text-xl font-black">رستوران نخل رفسنجان 🌴</div>
          <div className="mt-1 text-xs">رفسنجان، بلوار شهید مطهری، نبش کوچه نخل، پلاک ۱۲ — ۰۳۴-۳۴۳۰۰۰۰۰</div>
          <div className="mt-2 text-sm font-bold">فاکتور فروش</div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div>شماره سفارش: <b dir="ltr">{order.orderNumber}</b></div>
          <div>تاریخ: {formatJalali(order.createdAt, true)}</div>
          <div>نوع تحویل: {order.type === "DELIVERY" ? "ارسال با پیک" : "بیرون‌بر"}</div>
          {order.paymentRef && <div>کد رهگیری: <b dir="ltr">{toPersianDigits(order.paymentRef)}</b></div>}
          {customerName && <div>مشتری: {customerName}</div>}
        </div>
        {order.address && <div className="mt-2 text-xs">آدرس: {order.address}</div>}
        <table className="mt-4 w-full border-collapse text-xs">
          <thead>
            <tr className="border-y border-black">
              <th className="py-2 text-right">شرح</th>
              <th className="py-2">تعداد</th>
              <th className="py-2">فی</th>
              <th className="py-2 text-left">جمع</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((it, i) => (
              <tr key={i} className="border-b border-dashed">
                <td className="py-1.5 text-right">{it.name}</td>
                <td className="py-1.5 text-center">{toPersianDigits(it.quantity)}</td>
                <td className="py-1.5 text-center">{formatToman(Math.round(it.lineTotal / it.quantity))}</td>
                <td className="py-1.5 text-left">{formatToman(it.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 space-y-1 text-xs">
          <div className="flex justify-between"><span>جمع سفارش</span><span>{formatToman(order.subtotal)}</span></div>
          {order.discount > 0 && (
            <div className="flex justify-between">
              <span>تخفیف {order.couponCode ? `(کد ${order.couponCode})` : ""}</span>
              <span>−{formatToman(order.discount)}</span>
            </div>
          )}
          {order.type === "DELIVERY" && (
            <div className="flex justify-between"><span>هزینه پیک</span><span>{formatToman(order.deliveryFee)}</span></div>
          )}
          <div className="flex justify-between"><span>مالیات ارزش افزوده</span><span>{formatToman(order.taxAmount)}</span></div>
          <div className="flex justify-between border-t-2 border-black pt-1.5 text-sm font-black">
            <span>مبلغ کل</span><span>{formatToman(order.total)}</span>
          </div>
        </div>
        <div className="mt-6 text-center text-xs">
          از اعتماد شما سپاسگزاریم — رستوران نخل رفسنجان 🌴
        </div>
      </div>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  PENDING_PAYMENT: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  PAID: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  PREPARING: "bg-sky-600/10 text-sky-700 dark:text-sky-400",
  READY: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
  DELIVERING: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  DELIVERED: "bg-emerald-600/10 text-emerald-800 dark:text-emerald-400",
  CANCELED: "bg-red-500/10 text-red-700 dark:text-red-400",
  PAYMENT_FAILED: "bg-red-500/10 text-red-700 dark:text-red-400",
};

/** Interactive 5-star picker with hover preview */
function StarPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(0);
  const active = hover || value;
  return (
    <div className="flex flex-row-reverse justify-center gap-1.5" dir="ltr" role="radiogroup" aria-label="انتخاب امتیاز">
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          aria-label={`${toPersianDigits(s)} ستاره`}
          disabled={disabled}
          onMouseEnter={() => !disabled && setHover(s)}
          onMouseLeave={() => setHover(0)}
          onClick={() => !disabled && onChange(s)}
          className="rounded-lg p-1 transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Star
            className={`h-10 w-10 transition-colors ${
              s <= active ? "fill-gold text-gold" : "fill-transparent text-muted-foreground/40"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

export function OrdersView() {
  const { user, setView, menu } = useAppStore();
  const addItem = useCartStore((s) => s.addItem);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"ALL" | "ACTIVE" | "PAID" | "FAILED">("ALL");
  const [printTarget, setPrintTarget] = useState<OrderRow | null>(null);

  // rating dialog state
  const [ratingTarget, setRatingTarget] = useState<RatingTarget | null>(null);
  const [ratingValue, setRatingValue] = useState(0);
  const [ratingComment, setRatingComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // reorder confirmation dialog state
  const [reorderTarget, setReorderTarget] = useState<ReorderTarget | null>(null);
  const [reorderMode, setReorderMode] = useState<"append" | "replace">("append");
  const clearCart = useCartStore((s) => s.clearCart);

  // live channel — socket.io via the gateway (XTransformPort=3003, path "/").
  // The customer-join handshake is per-order; we join every order in the
  // user's list so room-scoped broadcasts reach us for each.
  const [liveConnected, setLiveConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  // mirror of the current orders list for the connect/reconnect effect to read
  // without re-subscribing. Updated synchronously after every setOrders.
  const ordersRef = useRef<OrderRow[]>([]);
  // debounced refetch handle — rapid multi-status updates coalesce into one load
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async () => {
    setLoading(true);
    const res = await api<{ orders: OrderRow[] }>("/api/orders");
    setLoading(false);
    if (res.success) {
      const next = res.orders ?? [];
      ordersRef.current = next;
      setOrders(next);
      // re-join customer rooms for any new orders placed since last load
      const s = socketRef.current;
      if (s && s.connected) {
        for (const o of next) {
          s.emit("customer-join", { orderNumber: o.orderNumber });
        }
      }
    }
  };

  // schedule a debounced load() — coalesces bursts of status-change events so
  // we don't hammer the API when many orders flip status in quick succession.
  const scheduleReload = (delayMs = 500) => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => {
      reloadTimer.current = null;
      void load();
    }, delayMs);
  };

  useEffect(() => {
    if (user) load();
  }, [user]);

  // live socket: connect once on mount, listen for "customer:order-status"
  // events (the server scopes by room, we joined every order's room), debounce
  // a refetch. Re-join rooms on every (re)connect — room membership is per-connection.
  useEffect(() => {
    if (!user) return;
    let active = true;

    const connect = async () => {
      const { io } = await import("socket.io-client");
      if (!active) return;

      const s = io("/?XTransformPort=3003", {
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 2000,
      });
      socketRef.current = s;

      s.on("connect", () => {
        if (!active) return;
        setLiveConnected(true);
        // (re)join every customer room for every order in the list
        for (const o of ordersRef.current) {
          s.emit("customer-join", { orderNumber: o.orderNumber });
        }
      });

      s.on("disconnect", () => {
        if (!active) return;
        setLiveConnected(false);
      });

      s.on("connect_error", () => {
        if (!active) return;
        setLiveConnected(false);
      });

      s.on("customer:order-status", () => {
        if (!active) return;
        // No orderNumber filter needed — the server only emits to sockets in
        // the order's room (which we joined), so any event here is relevant to
        // one of our orders. Debounced refetch keeps the list fresh.
        scheduleReload(500);
      });
    };

    void connect();

    return () => {
      active = false;
      if (reloadTimer.current) {
        clearTimeout(reloadTimer.current);
        reloadTimer.current = null;
      }
      const s = socketRef.current;
      if (s) {
        s.removeAllListeners();
        s.disconnect();
      }
      socketRef.current = null;
      setLiveConnected(false);
    };
  }, [user]);

  /** open the reorder confirmation modal — show item list with current prices + availability */
  const handleReorder = (order: OrderRow) => {
    setReorderMode("append");
    setReorderTarget({ order });
  };

  /** actually perform the reorder — pushes every available item into the cart */
  const confirmReorder = () => {
    if (!reorderTarget) return;
    const order = reorderTarget.order;
    const allItems = menu.flatMap((c) => c.items);
    const reorderable = order.items.filter((it) => it.menuItemId);
    if (reorderable.length === 0) {
      toast.error("اقلام این سفارش دیگر در منو موجود نیست");
      setReorderTarget(null);
      return;
    }
    if (reorderMode === "replace") {
      clearCart();
    }
    let added = 0;
    let skipped = 0;
    for (const it of reorderable) {
      const menuItem = allItems.find((m) => m.id === it.menuItemId);
      if (menuItem && menuItem.isAvailable) {
        addItem(
          { itemId: it.menuItemId as string, name: it.name, price: menuItem.price, imageUrl: menuItem.imageUrl },
          it.quantity
        );
        added += it.quantity;
      } else {
        skipped += it.quantity;
      }
    }
    setReorderTarget(null);
    if (added > 0) {
      toast.success(
        `${toPersianDigits(added)} عدد به سبد اضافه شد 🛒${
          skipped > 0 ? ` — ${toPersianDigits(skipped)} عدد فعلاً ناموجود بود` : ""
        }`
      );
      setView("cart");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      toast.error("فعلاً هیچ‌کدام از اقلام این سفارش موجود نیست");
    }
  };

  /** compute preview rows for the reorder modal — maps order items to current menu state */
  const reorderRows: ReorderRow[] = useMemo(() => {
    if (!reorderTarget) return [];
    const allItems = menu.flatMap((c) => c.items);
    return reorderTarget.order.items.map((it) => {
      const menuItem = it.menuItemId ? allItems.find((m) => m.id === it.menuItemId) : null;
      return {
        name: it.name,
        menuItemId: it.menuItemId,
        quantity: it.quantity,
        oldUnitPrice: Math.round(it.lineTotal / it.quantity),
        newUnitPrice: menuItem ? menuItem.price : null,
        available: Boolean(menuItem?.isAvailable),
      };
    });
  }, [reorderTarget, menu]);

  /** totals for the reorder modal preview */
  const reorderTotals = useMemo(() => {
    const available = reorderRows.filter((r) => r.available && r.newUnitPrice != null);
    const skipped = reorderRows.filter((r) => !r.available).reduce((s, r) => s + r.quantity, 0);
    const oldTotal = available.reduce((s, r) => s + r.oldUnitPrice * r.quantity, 0);
    const newTotal = available.reduce((s, r) => s + (r.newUnitPrice ?? 0) * r.quantity, 0);
    const diff = newTotal - oldTotal;
    return {
      availableCount: available.reduce((s, r) => s + r.quantity, 0),
      skippedCount: skipped,
      oldTotal,
      newTotal,
      diff,
    };
  }, [reorderRows]);

  /** print invoice: render the hidden receipt then trigger the browser print dialog */
  const handlePrint = (order: OrderRow) => {
    setPrintTarget(order);
    window.setTimeout(() => {
      window.print();
      setPrintTarget(null);
    }, 120);
  };

  /** share order receipt via WhatsApp (native share sheet on mobile) */
  const handleShare = async (order: OrderRow) => {
    const ok = await shareOrderText(
      buildOrderShareText({
        orderNumber: order.orderNumber,
        statusLabel: order.statusLabel,
        type: order.type,
        subtotal: order.subtotal,
        discount: order.discount,
        couponCode: order.couponCode,
        deliveryFee: order.deliveryFee,
        taxAmount: order.taxAmount,
        total: order.total,
        paymentRef: order.paymentRef,
        createdAt: order.createdAt,
        scheduledFor: order.scheduledFor,
        items: order.items.map((it) => ({ name: it.name, quantity: it.quantity })),
      })
    );
    if (ok) toast.success("رسید سفارش برای هم‌رسانی آماده شد 📲");
  };

  const openRating = (item: OrderItem) => {
    setRatingValue(0);
    setRatingComment("");
    setRatingTarget({ menuItemId: item.menuItemId as string, name: item.name });
  };

  const submitRating = async () => {
    if (!ratingTarget) return;
    if (ratingValue < 1) return toast.error("لطفاً امتیاز را انتخاب کنید");
    setSubmitting(true);
    const res = await api("/api/reviews", {
      method: "POST",
      body: {
        menuItemId: ratingTarget.menuItemId,
        rating: ratingValue,
        comment: ratingComment.trim() || undefined,
      },
    });
    setSubmitting(false);
    if (!res.success) return toast.error(res.error ?? "ثبت امتیاز ناموفق بود");
    toast.success("امتیاز شما ثبت شد و پس از تأیید نمایش داده می‌شود 🌟");
    setRatingTarget(null);
    load();
  };

  const filtered = orders.filter((o) => {
    if (filter === "ALL") return true;
    if (filter === "PAID") return o.paymentStatus === "PAID" && o.status !== "CANCELED";
    if (filter === "FAILED") return o.paymentStatus === "FAILED" || o.status === "PAYMENT_FAILED";
    return ["PENDING_PAYMENT", "PAID", "PREPARING", "READY", "DELIVERING"].includes(o.status);
  });

  if (!user) return null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black">
            <Package className="h-7 w-7 text-primary" />
            سفارش‌های من
            {liveConnected && (
              <span
                role="status"
                aria-live="polite"
                title="تغییرات وضعیت سفارش‌ها به‌صورت لحظه‌ای روی همین صفحه به‌روز می‌شود"
                className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-extrabold text-emerald-700 dark:text-emerald-400"
              >
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                به‌روزرسانی زنده
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {toPersianDigits(orders.length)} سفارش تاکنون ثبت کرده‌اید
          </p>
        </div>
        <Button onClick={() => setView("chat")} className="rounded-xl font-bold">
          <Bot className="ml-2 h-4 w-4" />
          سفارش جدید با هوش نخل
        </Button>
      </div>

      {/* filters */}
      <div className="mb-5 flex flex-wrap gap-2">
        {[
          { k: "ALL", l: "همه" },
          { k: "ACTIVE", l: "در جریان" },
          { k: "PAID", l: "پرداخت‌شده" },
          { k: "FAILED", l: "ناموفق" },
        ].map((f) => (
          <button
            key={f.k}
            onClick={() => setFilter(f.k as typeof filter)}
            className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
              filter === f.k ? "bg-primary text-primary-foreground shadow-md" : "border bg-card hover:bg-accent"
            }`}
          >
            {f.l}
          </button>
        ))}
        <Button variant="ghost" size="sm" onClick={load} className="rounded-xl" aria-label="بروزرسانی">
          <RotateCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <Inbox className="h-12 w-12 text-muted-foreground/40" />
            <div>
              <p className="font-bold">سفارشی در این دسته نیست</p>
              <p className="mt-1 text-sm text-muted-foreground">با هوش نخل اولین سفارشت رو ثبت کن!</p>
            </div>
            <Button onClick={() => setView("chat")} className="rounded-xl font-bold">
              شروع سفارش
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filtered.map((order) => (
            <Card key={order.id} className="overflow-hidden rounded-2xl p-0">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b bg-muted/30 py-3.5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    {order.type === "DELIVERY" ? <Bike className="h-5 w-5" /> : <Store className="h-5 w-5" />}
                  </div>
                  <div>
                    <CardTitle className="text-sm font-black" dir="ltr">
                      {order.orderNumber}
                    </CardTitle>
                    <div className="text-[11px] text-muted-foreground">{formatJalali(order.createdAt, true)}</div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {order.scheduledFor && (
                    <span
                      className="flex items-center gap-1 rounded-lg bg-gold/15 px-2.5 py-1 text-[11px] font-bold text-gold-foreground"
                      title={`زمان تحویل: ${formatJalali(order.scheduledFor, true)}`}
                    >
                      📅 پیش‌سفارش
                      <span className="text-[10px] font-semibold opacity-80">
                        {formatJalali(order.scheduledFor, true)}
                      </span>
                    </span>
                  )}
                  <span className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${STATUS_COLORS[order.status] ?? ""}`}>
                    {order.statusLabel}
                  </span>
                  {order.paymentStatus === "PAID" ? (
                    <span className="flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      پرداخت شد
                    </span>
                  ) : order.paymentStatus === "FAILED" ? (
                    <span className="flex items-center gap-1 rounded-lg bg-red-500/10 px-2.5 py-1 text-[11px] font-bold text-red-700 dark:text-red-400">
                      <XCircle className="h-3.5 w-3.5" />
                      پرداخت ناموفق
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 rounded-lg bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold text-amber-700 dark:text-amber-400">
                      <Clock className="h-3.5 w-3.5" />
                      در انتظار پرداخت
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-4">
                <div className="flex flex-wrap gap-1.5">
                  {order.items.map((item, i) => (
                    <Badge key={i} variant="secondary" className="font-normal">
                      {item.name} ×{toPersianDigits(item.quantity)}
                    </Badge>
                  ))}
                </div>

                {/* rating rows — only for delivered orders */}
                {order.canReview && order.items.some((it) => it.menuItemId) && (
                  <div className="mt-3 space-y-1.5 rounded-xl border border-dashed border-gold/40 bg-gold/5 p-2.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-gold-foreground/80">
                      <Star className="h-3.5 w-3.5 fill-gold text-gold" />
                      امتیازدهی به غذاها
                    </div>
                    {order.items
                      .filter((it) => it.menuItemId)
                      .map((item, i) => (
                        <div
                          key={`${item.menuItemId}-${i}`}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-card/70 px-2.5 py-1.5"
                        >
                          <span className="text-xs font-bold">
                            {item.name}
                            <span className="text-muted-foreground"> ×{toPersianDigits(item.quantity)}</span>
                          </span>
                          {item.myRating != null ? (
                            <Badge className="border-gold/40 bg-gold/10 text-[11px] text-gold-foreground">
                              <Star className="ml-1 h-3 w-3 fill-gold text-gold" />
                              امتیاز شما: ★{toPersianDigits(item.myRating)}
                            </Badge>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openRating(item)}
                              className="h-7 rounded-lg border-gold/50 px-2.5 text-[11px] font-bold text-gold-foreground hover:bg-gold/15 hover:text-gold-foreground"
                            >
                              <Star className="ml-1 h-3.5 w-3.5 fill-gold/30 text-gold" />
                              ثبت امتیاز
                            </Button>
                          )}
                        </div>
                      ))}
                  </div>
                )}

                {order.address && (
                  <p className="mt-3 text-xs leading-6 text-muted-foreground">📍 {order.address}</p>
                )}
                {order.paymentError && (
                  <p className="mt-2 rounded-lg bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                    ⚠️ {order.paymentError}
                  </p>
                )}
                <Separator className="my-3" />
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>جمع سفارش</span>
                    <span>{formatToman(order.subtotal)}</span>
                  </div>
                  {order.discount > 0 && (
                    <div className="flex justify-between text-primary">
                      <span className="flex items-center gap-1">
                        <Ticket className="h-3.5 w-3.5" />
                        تخفیف {order.couponCode ? `(کد ${order.couponCode})` : ""}
                      </span>
                      <span className="font-bold">−{formatToman(order.discount)}</span>
                    </div>
                  )}
                  {order.type === "DELIVERY" && (
                    <div className="flex justify-between">
                      <span>هزینه پیک</span>
                      <span>{order.deliveryFee === 0 ? "رایگان" : formatToman(order.deliveryFee)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>مالیات ارزش افزوده</span>
                    <span>{formatToman(order.taxAmount)}</span>
                  </div>
                  <div className="flex justify-between pt-1 text-sm font-black text-primary">
                    <span>مبلغ کل</span>
                    <span>{formatToman(order.total)}</span>
                  </div>
                </div>
                {order.paymentRef && (
                  <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-muted/60 px-3 py-2 text-xs" dir="ltr">
                    <CreditCard className="h-4 w-4 shrink-0" />
                    کد رهگیری پرداخت: <b>{toPersianDigits(order.paymentRef)}</b>
                  </div>
                )}
                {/* quick actions: reorder + print invoice */}
                <div className="no-print mt-3 flex flex-wrap gap-2">
                  {order.items.some((it) => it.menuItemId) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleReorder(order)}
                      className="h-9 rounded-xl border-primary/30 text-xs font-bold text-primary hover:bg-primary/10 hover:text-primary active:scale-95"
                    >
                      <ShoppingCart className="ml-1.5 h-3.5 w-3.5" />
                      سفارش مجدد
                    </Button>
                  )}
                  {order.paymentStatus === "PAID" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handlePrint(order)}
                      className="h-9 rounded-xl text-xs font-bold text-muted-foreground hover:bg-accent hover:text-accent-foreground active:scale-95"
                    >
                      <Printer className="ml-1.5 h-3.5 w-3.5" />
                      چاپ فاکتور
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleShare(order)}
                    className="h-9 rounded-xl border-emerald-600/30 text-xs font-bold text-emerald-700 hover:bg-emerald-600/10 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-400 active:scale-95"
                  >
                    <Share2 className="ml-1.5 h-3.5 w-3.5" />
                    هم‌رسانی رسید
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* printable invoice (hidden on screen) */}
      {printTarget && (
        <PrintInvoice
          order={printTarget}
          customerName={user ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || undefined : undefined}
        />
      )}

      {/* reorder confirmation modal — shows current prices + availability + price diff */}
      <Dialog open={!!reorderTarget} onOpenChange={(open) => !open && setReorderTarget(null)}>
        <DialogContent className="max-w-lg rounded-2xl" aria-describedby={undefined}>
          {reorderTarget && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5 text-primary" />
                  سفارش مجدد
                </DialogTitle>
                <DialogDescription>
                  سفارش <b dir="ltr" className="inline-block">{reorderTarget.order.orderNumber}</b> —
                  بررسی اقلام با قیمت‌های فعلی منو
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                {/* items list */}
                <div className="max-h-64 space-y-1.5 overflow-y-auto nice-scroll rounded-2xl border bg-card/40 p-2.5">
                  {reorderRows.map((row, i) => {
                    const diff = row.newUnitPrice != null ? row.newUnitPrice - row.oldUnitPrice : 0;
                    return (
                      <div
                        key={`${row.menuItemId ?? "x"}-${i}`}
                        className={`flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-xs ${
                          row.available ? "bg-background" : "bg-red-500/5 opacity-70"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <b className="truncate">{row.name}</b>
                            <span className="text-muted-foreground">×{toPersianDigits(row.quantity)}</span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <span>قیمت قبل: {formatToman(row.oldUnitPrice)}</span>
                            {row.available ? (
                              diff !== 0 ? (
                                <span
                                  className={`flex items-center gap-0.5 font-bold ${
                                    diff > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"
                                  }`}
                                >
                                  {diff > 0 ? (
                                    <TrendingUp className="h-3 w-3" />
                                  ) : (
                                    <TrendingDown className="h-3 w-3" />
                                  )}
                                  {diff > 0 ? "+" : "−"}
                                  {formatToman(Math.abs(diff))}
                                </span>
                              ) : (
                                <span className="text-emerald-600 dark:text-emerald-400">بدون تغییر</span>
                              )
                            ) : (
                              <span className="flex items-center gap-0.5 font-bold text-red-600 dark:text-red-400">
                                <AlertCircle className="h-3 w-3" />
                                فعلاً ناموجود
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0 text-left">
                          {row.available && row.newUnitPrice != null ? (
                            <b className="text-primary">{formatToman(row.newUnitPrice * row.quantity)}</b>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* totals */}
                <div className="space-y-1 rounded-2xl bg-muted/40 p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">اقلام قابل افزودن</span>
                    <b className="text-emerald-700 dark:text-emerald-400">
                      {toPersianDigits(reorderTotals.availableCount)} عدد
                    </b>
                  </div>
                  {reorderTotals.skippedCount > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">اقلام ناموجود</span>
                      <b className="text-red-600 dark:text-red-400">
                        {toPersianDigits(reorderTotals.skippedCount)} عدد — قابل افزودن نیست
                      </b>
                    </div>
                  )}
                  {reorderTotals.availableCount > 0 && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">مبلغ قبلی</span>
                        <span className="line-through text-muted-foreground">{formatToman(reorderTotals.oldTotal)}</span>
                      </div>
                      <div className="flex items-center justify-between border-t border-border pt-1.5 text-sm font-black text-primary">
                        <span>مبلغ جدید</span>
                        <span>{formatToman(reorderTotals.newTotal)}</span>
                      </div>
                      {reorderTotals.diff !== 0 && (
                        <div
                          className={`flex items-center justify-between pt-0.5 text-[11px] font-bold ${
                            reorderTotals.diff > 0
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-emerald-600 dark:text-emerald-400"
                          }`}
                        >
                          <span className="flex items-center gap-1">
                            <Minus className="h-3 w-3" />
                            {reorderTotals.diff > 0 ? "افزایش قیمت" : "کاهش قیمت"}
                          </span>
                          <span>
                            {reorderTotals.diff > 0 ? "+" : "−"}
                            {formatToman(Math.abs(reorderTotals.diff))}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* cart mode toggle */}
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setReorderMode("append")}
                    className={`flex-1 rounded-xl border-2 px-3 py-2 text-center font-bold transition ${
                      reorderMode === "append"
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    افزودن به سبد فعلی
                  </button>
                  <button
                    type="button"
                    onClick={() => setReorderMode("replace")}
                    className={`flex-1 rounded-xl border-2 px-3 py-2 text-center font-bold transition ${
                      reorderMode === "replace"
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    پاک و جایگزین سبد
                  </button>
                </div>

                {/* actions */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setReorderTarget(null)}
                    className="flex-1 rounded-xl"
                  >
                    انصراف
                  </Button>
                  <Button
                    onClick={confirmReorder}
                    disabled={reorderTotals.availableCount === 0}
                    className="flex-[2] rounded-xl font-bold"
                  >
                    <ShoppingCart className="ml-2 h-4 w-4" />
                    {reorderMode === "append" ? "افزودن به سبد" : "پاک و افزودن"}
                    {reorderTotals.availableCount > 0 && ` (${toPersianDigits(reorderTotals.availableCount)} عدد)`}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* rating dialog */}
      <Dialog open={!!ratingTarget} onOpenChange={(open) => !open && setRatingTarget(null)}>
        <DialogContent className="max-w-sm rounded-2xl" aria-describedby={undefined}>
          {ratingTarget && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Star className="h-5 w-5 fill-gold text-gold" />
                  {ratingTarget.name}
                </DialogTitle>
                <DialogDescription>تجربه‌ات از این غذا رو با ستاره بگو</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <StarPicker value={ratingValue} onChange={setRatingValue} disabled={submitting} />
                <div className="text-center text-xs text-muted-foreground">
                  {ratingValue > 0
                    ? ["", "نمی‌تونم پیشنهاد کنم", "معمولی بود", "خوب بود", "خیلی خوب بود", "عالی بود! 🌴"][ratingValue]
                    : "از ۱ تا ۵ ستاره"}
                </div>
                <Textarea
                  value={ratingComment}
                  onChange={(e) => setRatingComment(e.target.value)}
                  placeholder="نظرت درباره این غذا چیه؟ (اختیاری)"
                  className="min-h-20 rounded-xl text-sm"
                  maxLength={600}
                  disabled={submitting}
                />
                <Button
                  onClick={submitRating}
                  disabled={submitting || ratingValue < 1}
                  className="w-full rounded-xl font-bold"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="ml-2 h-4 w-4 animate-spin" /> در حال ثبت...
                    </>
                  ) : (
                    <>
                      <Star className="ml-2 h-4 w-4" /> ثبت امتیاز
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
