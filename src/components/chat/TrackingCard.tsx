"use client";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatToman, formatJalali, toPersianDigits } from "@/lib/fa";
import { api } from "@/lib/client-api";
import { useAppStore } from "@/lib/store";
import {
  Package,
  ChefHat,
  Bike,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Clock,
  CreditCard,
  Loader2,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export interface TrackingPayload {
  orderNumber: string;
  status: string;
  statusLabel: string;
  paymentStatus: string;
  total: number;
  type: string;
  createdAt: string;
  paymentError?: string | null;
  items: { name: string; quantity: number }[];
  timeline: { status: string; label: string; at: string }[];
}

const STEPS = [
  { key: "PAID", label: "پرداخت شد", icon: CreditCard },
  { key: "PREPARING", label: "در حال آماده‌سازی", icon: ChefHat },
  { key: "READY", label: "آماده تحویل", icon: Package },
  { key: "DELIVERING", label: "در مسیر ارسال", icon: Bike },
  { key: "DELIVERED", label: "تحویل شد", icon: CheckCircle2 },
];

const STEP_INDEX: Record<string, number> = {
  PENDING_PAYMENT: -1,
  PAYMENT_FAILED: -1,
  PAID: 0,
  PREPARING: 1,
  READY: 2,
  DELIVERING: 3,
  DELIVERED: 4,
};

export function TrackingCard({ payload, onPaid }: { payload: TrackingPayload; onPaid?: () => void }) {
  const { setView } = useAppStore();
  const [retrying, setRetrying] = useState(false);
  const failed = payload.status === "PAYMENT_FAILED" || payload.paymentStatus === "FAILED";

  const stepIndex = STEP_INDEX[payload.status] ?? 0;
  const progress = failed ? 100 : payload.status === "DELIVERED" ? 100 : Math.max(5, ((stepIndex + 1) / STEPS.length) * 100);

  return (
    <div className="w-full max-w-xl overflow-hidden rounded-2xl border bg-card shadow-lg">
      <div className={`px-4 py-3 ${failed ? "bg-destructive/90 text-white" : "bg-gradient-to-l from-primary to-primary/85 text-primary-foreground"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-extrabold">
            {failed ? <AlertCircle className="h-5 w-5" /> : <Package className="h-5 w-5" />}
            {failed ? "خطا در پرداخت سفارش" : "وضعیت سفارش شما"}
          </div>
          <span className="rounded-lg bg-black/15 px-2 py-0.5 font-mono text-xs" dir="ltr">
            {payload.orderNumber}
          </span>
        </div>
      </div>

      <div className="p-4">
        {failed ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm leading-6">
              <b className="text-destructive">پرداخت سفارش ناموفق بود.</b>
              <br />
              <span className="text-muted-foreground">
                {payload.paymentError ?? "به دلیل خطای درگاه، مبلغ از حساب شما کسر نشده است. می‌توانید دوباره پرداخت کنید."}
              </span>
            </div>
            <Button
              variant="outline"
              className="w-full border-primary/40 font-bold text-primary"
              onClick={() => setView("chat")}
            >
              گفتگو با هوش نخل برای سفارش مجدد
            </Button>
          </div>
        ) : (
          <>
            {/* progress */}
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-bold text-foreground">{payload.statusLabel}</span>
              <span>{formatJalali(payload.createdAt, true)}</span>
            </div>
            <Progress value={progress} className="mb-4 h-2" />

            <div className="grid grid-cols-5 gap-1">
              {STEPS.map((step, i) => {
                const Icon = step.icon;
                const active = i <= stepIndex;
                const current = i === stepIndex && payload.status !== "DELIVERED";
                return (
                  <div key={step.key} className="flex flex-col items-center gap-1 text-center">
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all ${
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted bg-muted/40 text-muted-foreground/50"
                      } ${current ? "animate-pulse-ring" : ""}`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className={`text-[10px] leading-3 ${active ? "font-bold" : "text-muted-foreground/60"}`}>
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* items */}
            <div className="mt-4 rounded-xl bg-muted/50 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                اقلام سفارش:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {payload.items.map((item, i) => (
                  <Badge key={i} variant="secondary" className="font-normal">
                    {item.name} ×{toPersianDigits(item.quantity)}
                  </Badge>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between border-t pt-2 text-sm">
                <span className="text-muted-foreground">مبلغ پرداخت‌شده</span>
                <span className="font-extrabold text-primary">{formatToman(payload.total)}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
