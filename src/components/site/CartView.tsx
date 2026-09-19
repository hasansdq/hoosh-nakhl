"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useAppStore } from "@/lib/store";
import { useCartStore, useCartHydrated, cartTotalCount, cartSubtotal } from "@/lib/cart-store";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { formatToman, toPersianDigits, toJalali, jalaliMonthName, weekdayName } from "@/lib/fa";
import {
  SCHEDULE_SLOT_TIMES,
  isSlotSelectable,
  formatScheduleFa,
} from "@/lib/schedule";
import { toast } from "sonner";
import {
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  Bike,
  Store,
  MapPin,
  Ticket,
  Receipt,
  CreditCard,
  Loader2,
  Check,
  TriangleAlert,
  LogIn,
  Bot,
  BadgePercent,
  CalendarClock,
  Zap,
} from "lucide-react";

// ============ types ============

interface CartPreviewData {
  items: { itemId: string; name: string; imageUrl: string | null; unitPrice: number; quantity: number; lineTotal: number }[];
  unavailableItems: { itemId: string; name: string }[];
  subtotal: number;
  deliveryFee: number;
  taxPercent: number;
  taxAmount: number;
  discount: number;
  total: number;
  couponValid: boolean;
  couponCode?: string;
  couponTitle?: string;
  couponLabel?: string;
  couponReason?: string;
  baseDeliveryFee: number;
  freeDeliveryOver: number;
  freeDeliveryEligible: boolean;
  minOrderAmount: number;
  belowMinOrder: boolean;
}

interface CartCheckoutResult {
  orderId: string;
  orderNumber: string;
  total: number;
  authority: string;
  simulated: boolean;
  paymentUrl?: string;
}

interface SavedAddress {
  id: string;
  title: string;
  fullAddress: string;
  isDefault: boolean;
}

/** اختلاف روز تقویمی بین دو تاریخ (بر اساس روز شروع) */
function dayOffsetOf(date: Date, from: Date): number {
  const a = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const b = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  return Math.round((a - b) / 86_400_000);
}

// ============ view ============

export function CartView() {
  const { user, setAuthOpen, setView, setPaymentSimulation } = useAppStore();
  const hydrated = useCartHydrated();

  const items = useCartStore((s) => s.items);
  const deliveryMethod = useCartStore((s) => s.deliveryMethod);
  const address = useCartStore((s) => s.address);
  const couponCode = useCartStore((s) => s.couponCode);
  const scheduleMode = useCartStore((s) => s.scheduleMode);
  const scheduledFor = useCartStore((s) => s.scheduledFor);
  const incrementItem = useCartStore((s) => s.incrementItem);
  const decrementItem = useCartStore((s) => s.decrementItem);
  const removeItem = useCartStore((s) => s.removeItem);
  const removeItems = useCartStore((s) => s.removeItems);
  const setDeliveryMethod = useCartStore((s) => s.setDeliveryMethod);
  const setAddress = useCartStore((s) => s.setAddress);
  const setCouponCode = useCartStore((s) => s.setCouponCode);
  const setScheduleMode = useCartStore((s) => s.setScheduleMode);
  const setScheduledFor = useCartStore((s) => s.setScheduledFor);
  const clearCart = useCartStore((s) => s.clearCart);

  const count = hydrated ? cartTotalCount(items) : 0;
  const localSubtotal = hydrated ? cartSubtotal(items) : 0;

  // ---- پیش‌سفارش: ساعت جاری (هر ۶۰ ثانیه رفرش می‌شود تا چیپ‌های غیرفعال دقیق بمانند) ----
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // روز انتخاب‌شده با کلیک (null = از scheduledFor استخراج شود یا پیش‌فرض امروز)
  const [pickedDay, setPickedDay] = useState<number | null>(null);

  const scheduleActive = scheduleMode === "SCHEDULED" && !!scheduledFor;

  // چیپ‌های روز: امروز / فردا / پس‌فردا / نام روز هفته — تا ۷ روز آینده (۸ گزینه)
  const dayChips = useMemo(() => {
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Array.from({ length: 8 }, (_, offset) => {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
      const { jd, jm } = toJalali(d);
      const anySelectable = SCHEDULE_SLOT_TIMES.some((t) => {
        const [h, m] = t.split(":").map(Number);
        return isSlotSelectable(new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m), now);
      });
      return {
        offset,
        label: offset === 0 ? "امروز" : offset === 1 ? "فردا" : offset === 2 ? "پس‌فردا" : weekdayName(d),
        sub: `${toPersianDigits(jd)} ${jalaliMonthName(jm)}`,
        anySelectable,
      };
    });
  }, [now]);

  // روز انتخاب‌شده: کلیک کاربر > استخراج از scheduledFor > پیش‌فرض امروز
  const selectedDayOffset = useMemo(() => {
    if (pickedDay !== null) return pickedDay;
    if (!scheduledFor) return 0;
    const d = new Date(scheduledFor);
    if (isNaN(d.getTime())) return 0;
    const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const diff = Math.round((a - b) / 86_400_000);
    return diff >= 0 && diff <= 7 ? diff : 0;
  }, [pickedDay, scheduledFor, now]);

  // شیارهای ۳۰ دقیقه‌ای روز انتخاب‌شده (۱۲:۰۰ تا ۲۳:۳۰)
  const daySlots = useMemo(() => {
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + selectedDayOffset);
    return SCHEDULE_SLOT_TIMES.map((t) => {
      const [h, m] = t.split(":").map(Number);
      const date = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m, 0, 0);
      return { key: t, label: toPersianDigits(t), date, selectable: isSlotSelectable(date, now) };
    });
  }, [now, selectedDayOffset]);

  const selectedSlotKey = useMemo(() => {
    if (!scheduledFor) return null;
    const d = new Date(scheduledFor);
    if (isNaN(d.getTime())) return null;
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }, [scheduledFor]);

  const selectScheduleDay = (offset: number) => {
    setPickedDay(offset);
    setScheduledFor(null); // تغییر روز → پاک شدن ساعت قبلی
  };

  const selectScheduleSlot = (slot: { date: Date }) => {
    setPickedDay(null); // از این پس روز از خود scheduledFor استخراج می‌شود
    setScheduledFor(slot.date.toISOString());
  };

  // ---- saved addresses (logged-in; chips render only when user is present) ----
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const res = await api<{ addresses: SavedAddress[] }>("/api/profile/addresses");
      if (active && res.success) setAddresses(res.addresses ?? []);
    })();
    return () => {
      active = false;
    };
  }, [user]);

  // ---- server-side preview (debounced) ----
  const previewRequest = useMemo(
    () => ({
      items: items.map((i) => ({ itemId: i.itemId, quantity: i.quantity })),
      deliveryMethod,
      couponCode: couponCode.trim(),
      address: address.trim(),
    }),
    [items, deliveryMethod, couponCode, address]
  );
  const requestKey = JSON.stringify(previewRequest);

  const [preview, setPreview] = useState<CartPreviewData | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewFetching, setPreviewFetching] = useState(false);
  const reqIdRef = useRef(0);

  const fetching = previewFetching;
  const stale = previewKey !== requestKey && previewRequest.items.length > 0;
  const recompute = fetching || stale; // subtle shimmer while server recomputes

  const fetchPreview = useCallback(async (payload: typeof previewRequest, key: string) => {
    const id = ++reqIdRef.current;
    setPreviewFetching(true);
    const res = await api<CartPreviewData>("/api/cart/preview", { body: payload });
    if (id !== reqIdRef.current) return; // a newer request superseded this one
    setPreviewFetching(false);
    setPreviewKey(key);
    if (!res.success) return; // keep previous values; checkout re-validates anyway
    setPreview(res);
    if (res.unavailableItems && res.unavailableItems.length > 0) {
      const names = res.unavailableItems.map((i) => i.name).join("، ");
      removeItems(res.unavailableItems.map((i) => i.itemId));
      toast.info(`${names} فعلاً ناموجود است و از سبد حذف شد`);
    }
  }, [removeItems]);

  useEffect(() => {
    if (!user || !hydrated || previewRequest.items.length === 0) return;
    const key = requestKey;
    const t = setTimeout(() => fetchPreview(previewRequest, key), 400);
    return () => clearTimeout(t);
  }, [requestKey, previewRequest, user, hydrated, fetchPreview]);

  const applyCoupon = () => {
    if (!user) {
      setAuthOpen(true, "cart");
      return;
    }
    if (previewRequest.items.length === 0) return;
    if (!couponCode.trim()) {
      toast.info("ابتدا کد تخفیف را وارد کنید");
      return;
    }
    fetchPreview(previewRequest, requestKey);
  };

  // ---- checkout ----
  const [checkingOut, setCheckingOut] = useState(false);

  const addressTooShort = deliveryMethod === "DELIVERY" && address.trim().length < 10;
  const scheduleIncomplete = scheduleMode === "SCHEDULED" && !scheduledFor;
  const payDisabled =
    !user ||
    checkingOut ||
    count === 0 ||
    !preview ||
    recompute ||
    addressTooShort ||
    scheduleIncomplete ||
    !!preview.belowMinOrder;

  const checkout = async () => {
    if (!user) {
      setAuthOpen(true, "cart");
      return;
    }
    if (addressTooShort) {
      toast.error("برای ارسال با پیک، لطفاً آدرس کامل را وارد کنید");
      return;
    }
    if (scheduleIncomplete) {
      toast.error("برای پیش‌سفارش، ابتدا روز و ساعت تحویل را انتخاب کنید");
      return;
    }
    setCheckingOut(true);
    const res = await api<CartCheckoutResult>("/api/cart/checkout", {
      body: {
        ...previewRequest,
        scheduledFor: scheduleActive ? (scheduledFor as string) : undefined,
      },
    });
    setCheckingOut(false);

    if (!res.success) {
      toast.error(res.error ?? "خطا در ثبت سفارش");
      return;
    }

    clearCart(); // order created → empty the cart

    if (res.simulated) {
      setPaymentSimulation({
        authority: res.authority,
        orderNumber: res.orderNumber,
        total: res.total,
      });
    } else if (res.paymentUrl) {
      window.location.href = res.paymentUrl;
    } else {
      toast.error("آدرس درگاه دریافت نشد");
    }
  };

  const goChat = () => {
    if (!user) {
      setAuthOpen(true, "chat");
      return;
    }
    setView("chat");
  };

  // ============ render ============

  if (!hydrated) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <Skeleton className="mb-6 h-12 w-64 rounded-2xl" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Skeleton className="h-40 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
          </div>
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      {/* header */}
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="flex flex-wrap items-center gap-2.5 text-xl font-extrabold sm:text-2xl">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-inner">
            <ShoppingCart className="h-5.5 w-5.5" />
          </span>
          سبد خرید شما 🛒
          {count > 0 && (
            <Badge className="rounded-full bg-gold px-2.5 text-white shadow-sm">
              {toPersianDigits(count)} قلم
            </Badge>
          )}
        </h1>
        {count > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              clearCart();
              toast.success("سبد خرید خالی شد");
            }}
            className="rounded-xl text-xs text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="ml-1 h-3.5 w-3.5" />
            خالی کردن سبد
          </Button>
        )}
      </div>

      {count === 0 ? (
        /* ============ empty state ============ */
        <div className="flex flex-col items-center gap-3.5 rounded-3xl border-2 border-dashed border-muted-foreground/25 px-6 py-12 text-center sm:gap-4 sm:py-16">
          <div className="gentle-float flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/10 shadow-inner sm:h-20 sm:w-20">
            <ShoppingCart className="h-8 w-8 text-primary sm:h-10 sm:w-10" />
          </div>
          <h3 className="text-lg font-extrabold">سبد شما خالی است</h3>
          <p className="max-w-sm text-sm leading-7 text-muted-foreground">
            از منوی نخل، غذاهای موردعلاقه‌تان را به سبد اضافه کنید یا مثل همیشه با «هوش نخل» گفتگو کنید.
          </p>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            <Button onClick={() => setView("home")} size="lg" className="rounded-xl font-extrabold shadow-lg shadow-primary/25">
              مشاهده منو
            </Button>
            <Button onClick={goChat} variant="outline" size="lg" className="rounded-xl font-bold text-primary">
              <Bot className="ml-1.5 h-4.5 w-4.5" />
              سفارش با هوش نخل
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* ============ main column ============ */}
          <div className="space-y-6 lg:col-span-2">
            {/* items */}
            <Card className="gap-0 rounded-2xl p-4 shadow-sm sm:p-5">
              <div className="mb-3 flex items-center gap-2 text-sm font-extrabold">
                <Receipt className="h-4.5 w-4.5 text-primary" />
                اقلام سفارش
                <Badge variant="secondary" className="rounded-full font-bold">
                  {toPersianDigits(count)}
                </Badge>
              </div>
              <div className="space-y-3">
                {items.map((item) => (
                  <div
                    key={item.itemId}
                    className="flex items-center gap-3 rounded-2xl border bg-background/60 p-3 transition-shadow hover:shadow-sm"
                  >
                    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-primary/10">
                      {item.imageUrl ? (
                        <Image
                          src={item.imageUrl}
                          alt={item.name}
                          fill
                          sizes="56px"
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-2xl" aria-hidden>
                          🍽
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className="truncate text-sm font-extrabold">{item.name}</h3>
                        <span className="shrink-0 text-xs font-black text-primary">
                          {formatToman(item.price * item.quantity)}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        قیمت واحد: {formatToman(item.price)}
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-0.5 rounded-full border bg-muted/40 p-1">
                          <button
                            onClick={() => incrementItem(item.itemId)}
                            className="flex h-10 w-10 items-center justify-center rounded-full text-foreground transition hover:bg-primary/10 hover:text-primary active:scale-90"
                            aria-label={`افزایش تعداد ${item.name}`}
                          >
                            <Plus className="h-4.5 w-4.5" />
                          </button>
                          <span className="min-w-7 text-center text-sm font-black">
                            {toPersianDigits(item.quantity)}
                          </span>
                          <button
                            onClick={() => decrementItem(item.itemId)}
                            disabled={item.quantity <= 1}
                            className="flex h-10 w-10 items-center justify-center rounded-full text-foreground transition hover:bg-primary/10 hover:text-primary active:scale-90 disabled:opacity-40 disabled:active:scale-100"
                            aria-label={`کاهش تعداد ${item.name}`}
                          >
                            <Minus className="h-4.5 w-4.5" />
                          </button>
                        </div>
                        <button
                          onClick={() => {
                            removeItem(item.itemId);
                            toast.info(`${item.name} از سبد حذف شد`);
                          }}
                          className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive active:scale-90"
                          aria-label={`حذف ${item.name} از سبد`}
                          title="حذف از سبد"
                        >
                          <Trash2 className="h-4.5 w-4.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* delivery method */}
            <Card className="gap-0 rounded-2xl p-4 shadow-sm sm:p-5">
              <div className="mb-3 flex items-center gap-2 text-sm font-extrabold">
                <Bike className="h-4.5 w-4.5 text-primary" />
                روش تحویل سفارش
              </div>
              <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="روش تحویل">
                <button
                  type="button"
                  role="radio"
                  aria-checked={deliveryMethod === "DELIVERY"}
                  onClick={() => setDeliveryMethod("DELIVERY")}
                  className={`rounded-2xl border-2 p-4 text-right transition-all ${
                    deliveryMethod === "DELIVERY"
                      ? "border-primary bg-primary/5 shadow-md shadow-primary/10"
                      : "border-border bg-card hover:border-primary/30"
                  }`}
                >
                  <div className="flex items-center gap-2 font-extrabold">
                    <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${deliveryMethod === "DELIVERY" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                      <Bike className="h-4.5 w-4.5" />
                    </span>
                    پیک 🛵
                  </div>
                  <div className="mt-1.5 text-[11px] font-semibold text-muted-foreground">
                    {deliveryMethod === "DELIVERY" && preview
                      ? preview.freeDeliveryEligible
                        ? "ارسال رایگان 🎉"
                        : formatToman(preview.baseDeliveryFee)
                      : "ارسال به محل شما"}
                  </div>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={deliveryMethod === "PICKUP"}
                  onClick={() => setDeliveryMethod("PICKUP")}
                  className={`rounded-2xl border-2 p-4 text-right transition-all ${
                    deliveryMethod === "PICKUP"
                      ? "border-primary bg-primary/5 shadow-md shadow-primary/10"
                      : "border-border bg-card hover:border-primary/30"
                  }`}
                >
                  <div className="flex items-center gap-2 font-extrabold">
                    <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${deliveryMethod === "PICKUP" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                      <Store className="h-4.5 w-4.5" />
                    </span>
                    بیرونبر 🥡
                  </div>
                  <div className="mt-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                    تحویل حضوری — رایگان
                  </div>
                </button>
              </div>
            </Card>

            {/* delivery timing — پیش‌سفارش / زمان‌بندی */}
            <Card className="gap-0 rounded-2xl p-4 shadow-sm sm:p-5">
              <div className="mb-3 flex items-center gap-2 text-sm font-extrabold">
                <CalendarClock className="h-4.5 w-4.5 text-gold" />
                زمان تحویل سفارش
              </div>
              <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="زمان تحویل">
                <button
                  type="button"
                  role="radio"
                  aria-checked={scheduleMode === "ASAP"}
                  onClick={() => setScheduleMode("ASAP")}
                  className={`rounded-2xl border-2 p-4 text-right transition-all ${
                    scheduleMode === "ASAP"
                      ? "border-primary bg-primary/5 shadow-md shadow-primary/10"
                      : "border-border bg-card hover:border-primary/30"
                  }`}
                >
                  <div className="flex items-center gap-2 font-extrabold">
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                        scheduleMode === "ASAP" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <Zap className="h-4.5 w-4.5" />
                    </span>
                    ارسال همین حالا ⚡
                  </div>
                  <div className="mt-1.5 text-[11px] font-semibold text-muted-foreground">
                    آماده‌سازی و ارسال پس از پرداخت
                  </div>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={scheduleMode === "SCHEDULED"}
                  onClick={() => setScheduleMode("SCHEDULED")}
                  className={`rounded-2xl border-2 p-4 text-right transition-all ${
                    scheduleMode === "SCHEDULED"
                      ? "border-gold bg-gold/5 shadow-md shadow-gold/20"
                      : "border-border bg-card hover:border-gold/40"
                  }`}
                >
                  <div className="flex items-center gap-2 font-extrabold">
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                        scheduleMode === "SCHEDULED" ? "bg-gold text-white" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <CalendarClock className="h-4.5 w-4.5" />
                    </span>
                    زمان‌بندی برای بعد 🗓️
                  </div>
                  <div className="mt-1.5 text-[11px] font-semibold text-gold-foreground">
                    پیش‌سفارش از امروز تا ۷ روز آینده
                  </div>
                </button>
              </div>

              {scheduleMode === "SCHEDULED" && (
                <div className="mt-4 space-y-4 rounded-2xl border border-gold/25 bg-gold/5 p-3.5">
                  {/* روز تحویل */}
                  <div>
                    <div className="mb-2 text-[11px] font-bold text-muted-foreground">روز تحویل:</div>
                    <div className="grid grid-cols-4 gap-2">
                      {dayChips.map((c) => (
                        <button
                          key={c.offset}
                          type="button"
                          disabled={!c.anySelectable}
                          onClick={() => selectScheduleDay(c.offset)}
                          aria-pressed={selectedDayOffset === c.offset}
                          className={`rounded-xl border px-2 py-2 text-center transition-all ${
                            selectedDayOffset === c.offset
                              ? "border-primary bg-primary text-primary-foreground shadow-md shadow-primary/20"
                              : c.anySelectable
                                ? "border-border bg-card hover:border-primary/40"
                                : "cursor-not-allowed border-border/60 bg-muted text-muted-foreground/50"
                          }`}
                        >
                          <span
                            className={`block text-xs font-extrabold ${
                              selectedDayOffset !== c.offset && !c.anySelectable ? "line-through" : ""
                            }`}
                          >
                            {c.label}
                          </span>
                          <span
                            className={`mt-0.5 block text-[10px] ${
                              selectedDayOffset === c.offset ? "text-primary-foreground/80" : "text-muted-foreground"
                            }`}
                          >
                            {c.sub}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ساعت تحویل */}
                  <div>
                    <div className="mb-2 text-[11px] font-bold text-muted-foreground">
                      ساعت تحویل (۱۲ ظهر تا ۱۲ شب):
                    </div>
                    <div className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto pl-1 sm:grid-cols-6">
                      {daySlots.map((s) => {
                        const selected = selectedSlotKey === s.key && selectedDayOffset === dayOffsetOf(s.date, now);
                        return (
                          <button
                            key={s.key}
                            type="button"
                            disabled={!s.selectable}
                            onClick={() => selectScheduleSlot(s)}
                            aria-pressed={selected}
                            title={!s.selectable ? "این زمان دیگر قابل انتخاب نیست" : `تحویل ${s.label}`}
                            className={`rounded-xl border px-1 py-2 text-xs font-extrabold transition-all ${
                              selected
                                ? "border-primary bg-primary text-primary-foreground shadow-md shadow-primary/20"
                                : s.selectable
                                  ? "border-border bg-card hover:border-primary/40"
                                  : "cursor-not-allowed border-border/60 bg-muted text-muted-foreground/50 line-through"
                            }`}
                          >
                            {s.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-1.5 text-[10px] leading-5 text-muted-foreground">
                      ساعات خط‌خورده گذشته‌اند یا کمتر از ۴۵ دقیقه فاصله دارند.
                    </p>
                  </div>

                  {scheduleActive && scheduledFor && (
                    <div
                      className="flex items-center gap-1.5 rounded-xl bg-gold/15 px-3 py-2 text-xs font-bold text-gold-foreground"
                      role="status"
                    >
                      <CalendarClock className="h-4 w-4 shrink-0" />
                      سفارش شما برای {formatScheduleFa(scheduledFor, now)} ثبت و تحویل می‌شود
                    </div>
                  )}
                </div>
              )}
            </Card>

            {/* address (delivery only) */}
            {deliveryMethod === "DELIVERY" && (
              <Card className="gap-0 rounded-2xl p-4 shadow-sm sm:p-5">
                <div className="mb-2.5 flex items-center gap-2 text-sm font-extrabold">
                  <MapPin className="h-4.5 w-4.5 text-primary" />
                  آدرس تحویل سفارش
                </div>
                <Textarea
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="محله، خیابان، کوچه، پلاک، واحد..."
                  className="min-h-20 rounded-xl"
                  aria-label="آدرس تحویل سفارش"
                />
                {addressTooShort && (
                  <p className="mt-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                    برای ارسال با پیک، آدرس کامل (حداقل ۱۰ کاراکتر) الزامی است.
                  </p>
                )}
                {user && addresses.length > 0 && (
                  <div className="mt-3">
                    <div className="mb-1.5 text-[11px] font-bold text-muted-foreground">آدرس‌های ذخیره‌شده:</div>
                    <div className="flex flex-wrap gap-2">
                      {addresses.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => setAddress(a.fullAddress)}
                          title={a.fullAddress}
                          className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                            address.trim() === a.fullAddress.trim()
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-primary"
                          }`}
                        >
                          {address.trim() === a.fullAddress.trim() && <Check className="h-3 w-3 shrink-0" />}
                          <span className="truncate">{a.title}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            )}

            {/* coupon */}
            <Card className="gap-0 rounded-2xl p-4 shadow-sm sm:p-5">
              <div className="mb-2.5 flex items-center gap-2 text-sm font-extrabold">
                <Ticket className="h-4.5 w-4.5 text-gold" />
                کد تخفیف
              </div>
              <div className="flex gap-2">
                <Input
                  dir="ltr"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                  placeholder="مثلاً WELCOME50"
                  className="rounded-xl text-left tracking-wide"
                  aria-label="کد تخفیف"
                />
                <Button
                  variant="outline"
                  onClick={applyCoupon}
                  disabled={!user || count === 0 || fetching}
                  className="h-11 shrink-0 rounded-xl px-5 font-bold text-primary"
                >
                  {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "اعمال"}
                </Button>
              </div>
              {couponCode.trim() && preview && user && (
                <div className="mt-2.5">
                  {preview.couponValid ? (
                    <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                      <Check className="h-4 w-4 shrink-0" />
                      کد «{preview.couponCode}» اعمال شد — {preview.couponLabel}
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5" dir="rtl">
                        −{formatToman(preview.discount)} تخفیف
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-700 dark:text-amber-400" role="alert">
                      <TriangleAlert className="h-4 w-4 shrink-0" />
                      {preview.couponReason ?? "کد تخفیف قابل اعمال نیست"}
                    </div>
                  )}
                </div>
              )}
              {!user && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  برای اعتبارسنجی کد تخفیف، ابتدا وارد حساب خود شوید.
                </p>
              )}
            </Card>

            {/* login prompt (not logged in) */}
            {!user && (
              <Card className="gap-0 rounded-2xl border-2 border-gold/40 bg-gold/5 p-5 shadow-sm">
                <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-right">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gold text-white shadow-md">
                    <LogIn className="h-6 w-6" />
                  </span>
                  <div className="flex-1">
                    <h3 className="text-sm font-extrabold">برای ثبت و پرداخت سفارش وارد شوید</h3>
                    <p className="mt-1 text-xs leading-6 text-muted-foreground">
                      سبد خرید شما همین‌جا ذخیره می‌شود؛ فقط با شماره موبایل و کد یکبارمصرف وارد شوید و پرداخت را ادامه دهید.
                    </p>
                  </div>
                  <Button onClick={() => setAuthOpen(true)} className="rounded-xl font-extrabold shadow-lg shadow-primary/25">
                    ورود با شماره موبایل
                  </Button>
                </div>
              </Card>
            )}
          </div>

          {/* ============ invoice sidebar ============ */}
          <aside>
            <div className="lg:sticky lg:top-24">
              <Card className="gap-0 overflow-hidden rounded-2xl border-2 border-primary/20 bg-card shadow-lg">
                <div className="relative bg-gradient-to-l from-primary to-primary/85 px-4 py-3 text-primary-foreground">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 font-extrabold">
                      <Receipt className="h-5 w-5" />
                      فاکتور سفارش
                    </span>
                    {recompute && user ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-label="در حال محاسبه" />
                    ) : (
                      <Badge className="bg-white/20 text-white hover:bg-white/20">
                        {deliveryMethod === "DELIVERY" ? "پیک" : "بیرونبر"}
                      </Badge>
                    )}
                  </div>
                </div>
                <CardContent className="p-4">
                  {user ? (
                    preview ? (
                      <div className={`space-y-1.5 text-sm transition-opacity ${recompute ? "animate-pulse opacity-70" : ""}`}>
                        <div className="flex justify-between text-muted-foreground">
                          <span>جمع سفارش</span>
                          <span>{formatToman(preview.subtotal)}</span>
                        </div>
                        {preview.discount > 0 && preview.couponCode && (
                          <div className="flex items-center justify-between rounded-lg bg-emerald-500/10 px-2 py-1 font-bold text-emerald-700 dark:text-emerald-400">
                            <span className="flex min-w-0 items-center gap-1">
                              <Ticket className="h-4 w-4 shrink-0" />
                              تخفیف
                              <span className="truncate rounded-full bg-emerald-500/15 px-1.5 text-[10px]" dir="ltr">
                                {preview.couponCode}
                              </span>
                            </span>
                            <span dir="ltr">−{formatToman(preview.discount)}</span>
                          </div>
                        )}
                        {deliveryMethod === "DELIVERY" && (
                          <div className="flex justify-between text-muted-foreground">
                            <span>هزینه پیک</span>
                            {preview.deliveryFee === 0 ? (
                              <span className="font-bold text-primary">رایگان 🎉</span>
                            ) : (
                              <span>{formatToman(preview.deliveryFee)}</span>
                            )}
                          </div>
                        )}
                        {scheduleActive && scheduledFor && (
                          <div className="flex items-center justify-between rounded-lg bg-gold/15 px-2 py-1.5 font-bold text-gold-foreground">
                            <span className="flex items-center gap-1">
                              <CalendarClock className="h-4 w-4 shrink-0" />
                              زمان تحویل
                            </span>
                            <span>{formatScheduleFa(scheduledFor, now)}</span>
                          </div>
                        )}
                        {scheduleIncomplete && (
                          <div
                            className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[11px] font-bold text-amber-700 dark:text-amber-400"
                            role="alert"
                          >
                            <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                            برای پیش‌سفارش، روز و ساعت تحویل را انتخاب کنید
                          </div>
                        )}
                        <div className="flex justify-between text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <BadgePercent className="h-4 w-4" />
                            مالیات ارزش افزوده ({toPersianDigits(preview.taxPercent)}٪)
                          </span>
                          <span>{formatToman(preview.taxAmount)}</span>
                        </div>
                        <Separator className="my-2" />
                        <div className="flex items-center justify-between text-lg font-black text-primary">
                          <span>مبلغ قابل پرداخت</span>
                          <span>{formatToman(preview.total)}</span>
                        </div>
                        {preview.belowMinOrder && (
                          <div className="mt-2 flex items-center gap-1.5 rounded-xl bg-amber-500/10 px-3 py-2 text-[11px] font-bold text-amber-700 dark:text-amber-400" role="alert">
                            <TriangleAlert className="h-4 w-4 shrink-0" />
                            حداقل مبلغ سفارش {formatToman(preview.minOrderAmount)} است؛ چند قلم دیگر اضافه کنید.
                          </div>
                        )}
                        <Button
                          onClick={checkout}
                          disabled={payDisabled}
                          size="lg"
                          className="mt-3 h-13 w-full rounded-xl py-3.5 text-base font-extrabold shadow-lg shadow-primary/25"
                        >
                          {checkingOut ? (
                            <Loader2 className="ml-2 h-5 w-5 animate-spin" />
                          ) : (
                            <CreditCard className="ml-2 h-5 w-5" />
                          )}
                          پرداخت و ثبت سفارش ({formatToman(preview.total)})
                        </Button>
                        <p className="mt-2 flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
                          {preview.couponCode && preview.couponValid ? (
                            <span className="flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 font-bold text-gold-foreground">
                              <Ticket className="h-3 w-3" />
                              کد «{preview.couponCode}» روی این فاکتور اعمال شده
                            </span>
                          ) : (
                            <>پرداخت امن از طریق درگاه زرین‌پال انجام می‌شود 🔒</>
                          )}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        <Skeleton className="h-5 w-full" />
                        <Skeleton className="h-5 w-2/3" />
                        <Skeleton className="h-5 w-3/4" />
                        <Separator />
                        <Skeleton className="h-7 w-full" />
                        <Button disabled size="lg" className="mt-2 h-13 w-full rounded-xl text-base font-extrabold">
                          <Loader2 className="ml-2 h-5 w-5 animate-spin" />
                          در حال محاسبه فاکتور...
                        </Button>
                      </div>
                    )
                  ) : (
                    /* logged out: optimistic local pricing + login CTA */
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between text-muted-foreground">
                        <span>جمع اقلام سبد</span>
                        <span>{formatToman(localSubtotal)}</span>
                      </div>
                      {scheduleActive && scheduledFor && (
                        <div className="flex items-center justify-between rounded-lg bg-gold/15 px-2 py-1.5 font-bold text-gold-foreground">
                          <span className="flex items-center gap-1">
                            <CalendarClock className="h-4 w-4 shrink-0" />
                            زمان تحویل
                          </span>
                          <span>{formatScheduleFa(scheduledFor, now)}</span>
                        </div>
                      )}
                      <p className="mt-2 rounded-xl bg-muted/60 px-3 py-2 text-[11px] leading-6 text-muted-foreground">
                        هزینه پیک، مالیات ارزش افزوده و تخفیف کد، پس از ورود به حساب به‌صورت دقیق محاسبه می‌شود.
                      </p>
                      <Button
                        onClick={() => setAuthOpen(true, "cart")}
                        size="lg"
                        className="mt-2 h-12 w-full rounded-xl font-extrabold shadow-lg shadow-primary/25"
                      >
                        <LogIn className="ml-2 h-5 w-5" />
                        ورود و ادامه پرداخت
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
