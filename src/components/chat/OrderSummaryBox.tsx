"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { formatToman, toPersianDigits } from "@/lib/fa";
import { api } from "@/lib/client-api";
import { useAppStore } from "@/lib/store";
import { useCartStore } from "@/lib/cart-store";
import {
  Receipt,
  CreditCard,
  MapPin,
  Loader2,
  Bike,
  Store,
  BadgePercent,
  Ticket,
  Minus,
  Plus,
  Trash2,
  PenLine,
  Archive,
  ShieldCheck,
  ShoppingCart,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { describeBusinessHours, nowMinutesInRestaurantTz, openStatusText } from "@/lib/hours";

export interface OrderSummaryPayload {
  items: { itemId?: string; name: string; quantity: number; unitPrice: number; lineTotal: number }[];
  subtotal: number;
  deliveryFee: number;
  taxPercent: number;
  taxAmount: number;
  discount: number;
  couponCode?: string;
  couponTitle?: string;
  couponLabel?: string;
  total: number;
  deliveryMethod: "DELIVERY" | "PICKUP";
  address?: string;
  freeDelivery: boolean;
  orderId?: string;
  orderNumber?: string;
}

type DraftOp = { op: "INC_ITEM" | "DEC_ITEM" | "REMOVE_ITEM"; itemId: string } | { op: "SET_DELIVERY"; method: "DELIVERY" | "PICKUP" } | { op: "SET_ADDRESS"; address: string };

/**
 * The live invoice card — editable at any moment (quantity steppers, item
 * removal, delivery-method switch) AND payable. Archived copies (older
 * messages) render read-only. All mutations are validated and re-priced
 * server-side via /api/chat/draft.
 */
export function OrderSummaryBox({
  payload,
  live = true,
  onUpdate,
}: {
  payload: OrderSummaryPayload;
  live?: boolean;
  /** called with the fresh server payload after each successful edit (undefined = basket emptied) */
  onUpdate?: (payload: OrderSummaryPayload | undefined, stage?: string) => void;
}) {
  const { setPaymentSimulation, siteSettings } = useAppStore();
  const [address, setAddress] = useState(payload.address ?? "");
  const [loading, setLoading] = useState(false);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [switchingMethod, setSwitchingMethod] = useState(false);

  // وضعیت باز/بستهٔ رستوران به وقت ایران — گیت دکمهٔ پرداخت فاکتور چت (هر ۳۰ ثانیه)
  const [nowMinTz, setNowMinTz] = useState(() => nowMinutesInRestaurantTz());
  useEffect(() => {
    const t = window.setInterval(() => setNowMinTz(nowMinutesInRestaurantTz()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const closedStatus = openStatusText(siteSettings.businessHours, nowMinTz);
  const restaurantClosed = !closedStatus.open;

  // keep the inline address field in sync with server-side changes (chat/AI edits)
  // — the React "adjust state during render" pattern for prop-derived resets
  const serverAddress = payload.address ?? "";
  const [prevServerAddress, setPrevServerAddress] = useState(serverAddress);
  if (serverAddress !== prevServerAddress) {
    setPrevServerAddress(serverAddress);
    setAddress(serverAddress);
  }

  const runOp = async (op: DraftOp) => {
    setBusyItem("itemId" in op ? op.itemId : "method" in op ? "__method__" : "__addr__");
    if ("method" in op) setSwitchingMethod(true);
    const res = await api<{
      orderSummary?: OrderSummaryPayload;
      stage?: string;
      warnings?: string[];
    }>("/api/chat/draft", { body: op });
    setBusyItem(null);
    setSwitchingMethod(false);

    if (!res.success) {
      toast.error(res.error ?? "خطا در به‌روزرسانی فاکتور");
      return;
    }
    if (res.warnings?.length) {
      toast.info(res.warnings.join("\n"));
    }
    if (res.orderSummary) {
      onUpdate?.(res.orderSummary, res.stage);
    } else {
      // basket emptied server-side — notify parent to drop the invoice
      onUpdate?.(undefined, res.stage);
    }
  };

  const pay = async () => {
    if (payload.deliveryMethod === "DELIVERY" && address.trim().length < 10) {
      toast.error("برای ارسال با پیک، لطفاً آدرس کامل را وارد کنید");
      return;
    }
    setLoading(true);
    const res = await api<{
      orderId: string;
      orderNumber: string;
      total: number;
      authority: string;
      simulated: boolean;
      paymentUrl?: string;
    }>("/api/payment/request", { body: { address: address.trim() } });
    setLoading(false);

    if (!res.success) {
      toast.error(res.error ?? "خطا در ایجاد پرداخت");
      return;
    }

    // the order was issued — drop the mirrored chat items from the classic
    // cart so the same basket can never be paid twice (retry/edit stays in chat)
    useCartStore.getState().clearChatItems();

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

  return (
    <div
      className={cn(
        "w-full max-w-xl overflow-hidden rounded-2xl border-2 bg-card shadow-lg transition-colors",
        live ? "border-primary/25" : "border-border/70 opacity-90"
      )}
    >
      {/* header */}
      <div className="relative bg-gradient-to-l from-primary to-primary/85 px-4 py-3 text-primary-foreground">
        <div className="palm-pattern absolute inset-0 opacity-15" aria-hidden />
        <div className="relative flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-extrabold">
            <Receipt className="h-5 w-5" />
            فاکتور نهایی سفارش
          </div>
          <div className="flex items-center gap-1.5">
            {live ? (
              <Badge className="gap-1 bg-white/20 text-white hover:bg-white/20">
                <PenLine className="h-3 w-3" />
                قابل ویرایش
              </Badge>
            ) : (
              <Badge className="gap-1 bg-white/20 text-white hover:bg-white/20">
                <Archive className="h-3 w-3" />
                آرشیو
              </Badge>
            )}
            <Badge className="hidden bg-white/20 text-white hover:bg-white/20 sm:inline-flex">
              {payload.deliveryMethod === "DELIVERY" ? (
                <><Bike className="ml-1 h-3.5 w-3.5" /> پیک</>
              ) : (
                <><Store className="ml-1 h-3.5 w-3.5" /> بیرونبر</>
              )}
            </Badge>
          </div>
        </div>
      </div>

      <div className="p-4">
        {/* items */}
        <div className="space-y-2">
          {payload.items.map((item, idx) => {
            const key = item.itemId ?? `idx-${idx}`;
            const itemBusy = live && busyItem === key;
            return (
              <div
                key={key}
                className={cn(
                  "flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2 text-sm transition-opacity",
                  itemBusy && "pointer-events-none opacity-50"
                )}
              >
                {live && item.itemId ? (
                  <div className="flex items-center gap-0.5">
                    <button
                      className="flex h-7 w-7 items-center justify-center rounded-lg border bg-background text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
                      onClick={() => runOp({ op: "DEC_ITEM", itemId: item.itemId! })}
                      disabled={itemBusy}
                      aria-label={`کاهش ${item.name}`}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-8 text-center text-sm font-black tabular-nums">
                      {toPersianDigits(item.quantity)}
                    </span>
                    <button
                      className="flex h-7 w-7 items-center justify-center rounded-lg border bg-background text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
                      onClick={() => runOp({ op: "INC_ITEM", itemId: item.itemId! })}
                      disabled={itemBusy}
                      aria-label={`افزایش ${item.name}`}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <span className="flex h-7 w-8 items-center justify-center text-sm font-black tabular-nums">
                    {toPersianDigits(item.quantity)}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {item.name}
                  {live && !item.itemId && (
                    <span className="mr-1.5 text-[10px] text-muted-foreground">(آیتم قدیمی)</span>
                  )}
                </span>
                <span className="shrink-0 font-bold text-muted-foreground">{formatToman(item.lineTotal)}</span>
                {live && item.itemId && (
                  <button
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => runOp({ op: "REMOVE_ITEM", itemId: item.itemId! })}
                    disabled={itemBusy}
                    aria-label={`حذف ${item.name}`}
                    title="حذف از فاکتور"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* delivery switch (live only) */}
        {live && (
          <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-xl border bg-muted/40 p-1">
            {(
              [
                { method: "DELIVERY" as const, icon: Bike, label: "ارسال با پیک" },
                { method: "PICKUP" as const, icon: Store, label: "بیرونبر" },
              ]
            ).map(({ method, icon: Icon, label }) => {
              const active = payload.deliveryMethod === method;
              return (
                <button
                  key={method}
                  onClick={() => (active ? undefined : runOp({ op: "SET_DELIVERY", method }))}
                  disabled={switchingMethod}
                  className={cn(
                    "flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-bold transition-all",
                    active
                      ? "bg-primary text-primary-foreground shadow-md"
                      : "text-muted-foreground hover:bg-background hover:text-foreground"
                  )}
                  aria-pressed={active}
                >
                  {switchingMethod && busyItem === "__method__" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                  {label}
                </button>
              );
            })}
          </div>
        )}

        <Separator className="my-3" />

        {/* totals */}
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>جمع سفارش</span>
            <span>{formatToman(payload.subtotal)}</span>
          </div>
          {payload.discount > 0 && payload.couponCode && (
            <div className="flex items-center justify-between rounded-lg bg-primary/10 px-2 py-1 font-bold text-primary">
              <span className="flex items-center gap-1">
                <Ticket className="h-4 w-4" />
                تخفیف {payload.couponLabel ? `(${payload.couponLabel})` : ""}
              </span>
              <span dir="ltr">−{formatToman(payload.discount)}</span>
            </div>
          )}
          {payload.deliveryMethod === "DELIVERY" && (
            <div className="flex justify-between text-muted-foreground">
              <span>هزینه پیک</span>
              {payload.deliveryFee === 0 ? (
                <span className="font-bold text-primary">رایگان 🎉</span>
              ) : (
                <span>{formatToman(payload.deliveryFee)}</span>
              )}
            </div>
          )}
          <div className="flex justify-between text-muted-foreground">
            <span className="flex items-center gap-1">
              <BadgePercent className="h-4 w-4" />
              مالیات ارزش افزوده ({toPersianDigits(payload.taxPercent)}٪)
            </span>
            <span>{formatToman(payload.taxAmount)}</span>
          </div>
          <Separator />
          <div className="flex justify-between text-base font-extrabold text-primary">
            <span>مبلغ قابل پرداخت</span>
            <span>{formatToman(payload.total)}</span>
          </div>
        </div>

        {/* address */}
        {payload.deliveryMethod === "DELIVERY" && (
          <div className="mt-4 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
              <MapPin className="h-4 w-4 text-primary" />
              آدرس تحویل سفارش
            </div>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onBlur={() => {
                const addr = address.trim();
                if (live && addr.length >= 10 && addr !== (payload.address ?? "")) {
                  runOp({ op: "SET_ADDRESS", address: addr });
                }
              }}
              placeholder="محله، خیابان، کوچه، پلاک، واحد..."
              className="rounded-xl"
              disabled={!live}
            />
            {live && (
              <p className="text-[10px] text-muted-foreground">
                آدرس را کامل بنویسید و بیرون فیلد کلیک کنید تا روی فاکتور ذخیره شود
              </p>
            )}
          </div>
        )}

        {/* pay / archive note */}
        {live ? (
          <>
            {restaurantClosed && (
              <div
                className="mt-3 space-y-1 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2.5 text-[11px] font-bold leading-5 text-rose-700 dark:text-rose-400"
                role="alert"
              >
                <span className="flex items-center gap-1.5">
                  <Store className="h-4 w-4 shrink-0" />
                  رستوران الان بسته است! {closedStatus.detail}
                </span>
                <span className="block font-normal text-muted-foreground">
                  فاکتورتان حفظ می‌شود — در ساعات کاری ({describeBusinessHours(siteSettings.businessHours)}) دکمهٔ پرداخت فعال می‌شود.
                </span>
              </div>
            )}
            <Button
              onClick={pay}
              disabled={loading || payload.items.length === 0 || restaurantClosed}
              className="mt-4 h-13 w-full rounded-xl py-3.5 text-base font-extrabold shadow-lg shadow-primary/25"
              size="lg"
              title={restaurantClosed ? `رستوران الان بسته است — ${closedStatus.detail}` : undefined}
            >
              {loading ? (
                <Loader2 className="ml-2 h-5 w-5 animate-spin" />
              ) : (
                <CreditCard className="ml-2 h-5 w-5" />
              )}
              {restaurantClosed
                ? "سفارش‌گیری در ساعات کاری فعال است"
                : `پرداخت و ثبت سفارش (${formatToman(payload.total)})`}
            </Button>
            <p className="mt-2 flex flex-wrap items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
              {payload.couponCode ? (
                <span className="flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 font-bold text-gold-foreground">
                  <Ticket className="h-3 w-3" />
                  کد «{payload.couponCode}» روی این فاکتور اعمال شده
                </span>
              ) : (
                <>
                  <ShieldCheck className="h-3 w-3 text-emerald-600" />
                  پرداخت امن زرین‌پال — تا پیش از پرداخت، هر تغییری بخواهید همین‌جا در گفتگو بگویید
                </>
              )}
              <span className="flex w-full items-center justify-center gap-1">
                <ShoppingCart className="h-3 w-3 text-primary" />
                اقلام این فاکتور هم‌زمان در سبد خرید سایت هم اعمال می‌شود
              </span>
            </p>
          </>
        ) : (
          <p className="mt-4 rounded-xl border border-dashed bg-muted/30 px-3 py-2.5 text-center text-xs leading-5 text-muted-foreground">
            این نسخهٔ آرشیوی فاکتور است — نسخهٔ به‌روز و قابل پرداخت در ادامهٔ گفتگو قرار دارد.
          </p>
        )}
      </div>
    </div>
  );
}
