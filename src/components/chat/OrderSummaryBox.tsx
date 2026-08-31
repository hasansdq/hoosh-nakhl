"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { formatToman, toPersianDigits } from "@/lib/fa";
import { api } from "@/lib/client-api";
import { useAppStore } from "@/lib/store";
import { Receipt, CreditCard, MapPin, Loader2, Bike, Store, BadgePercent, Ticket } from "lucide-react";
import { toast } from "sonner";

export interface OrderSummaryPayload {
  items: { name: string; quantity: number; unitPrice: number; lineTotal: number }[];
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

export function OrderSummaryBox({ payload, onPaid }: { payload: OrderSummaryPayload; onPaid?: () => void }) {
  const { setPaymentSimulation } = useAppStore();
  const [address, setAddress] = useState(payload.address ?? "");
  const [loading, setLoading] = useState(false);

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

    if (res.simulated) {
      // simulated gateway inside the app
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
    <div className="w-full max-w-xl overflow-hidden rounded-2xl border-2 border-primary/25 bg-card shadow-lg">
      {/* header */}
      <div className="relative bg-gradient-to-l from-primary to-primary/85 px-4 py-3 text-primary-foreground">
        <div className="palm-pattern absolute inset-0 opacity-15" aria-hidden />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-2 font-extrabold">
            <Receipt className="h-5 w-5" />
            فاکتور نهایی سفارش
          </div>
          <Badge className="bg-white/20 text-white hover:bg-white/20">
            {payload.deliveryMethod === "DELIVERY" ? (
              <><Bike className="ml-1 h-3.5 w-3.5" /> ارسال با پیک</>
            ) : (
              <><Store className="ml-1 h-3.5 w-3.5" /> بیرونبر</>
            )}
          </Badge>
        </div>
      </div>

      <div className="p-4">
        {/* items */}
        <div className="space-y-2">
          {payload.items.map((item, idx) => (
            <div key={idx} className="flex items-center justify-between gap-2 rounded-xl bg-muted/50 px-3 py-2 text-sm">
              <span className="font-semibold">
                {item.name}
                <span className="mr-1.5 text-xs text-muted-foreground">×{toPersianDigits(item.quantity)}</span>
              </span>
              <span className="font-bold text-muted-foreground">{formatToman(item.lineTotal)}</span>
            </div>
          ))}
        </div>

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
              placeholder="محله، خیابان، کوچه، پلاک، واحد..."
              className="rounded-xl"
            />
          </div>
        )}

        {/* pay button */}
        <Button
          onClick={pay}
          disabled={loading || payload.items.length === 0}
          className="mt-4 h-13 w-full rounded-xl py-3.5 text-base font-extrabold shadow-lg shadow-primary/25"
          size="lg"
        >
          {loading ? (
            <Loader2 className="ml-2 h-5 w-5 animate-spin" />
          ) : (
            <CreditCard className="ml-2 h-5 w-5" />
          )}
          پرداخت و ثبت سفارش ({formatToman(payload.total)})
        </Button>
        <p className="mt-2 flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
          {payload.couponCode ? (
            <span className="flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 font-bold text-gold-foreground">
              <Ticket className="h-3 w-3" />
              کد «{payload.couponCode}» روی این فاکتور اعمال شده
            </span>
          ) : (
            <>پرداخت امن از طریق درگاه زرین‌پال انجام می‌شود 🔒</>
          )}
        </p>
      </div>
    </div>
  );
}
