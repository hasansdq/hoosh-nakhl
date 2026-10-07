"use client";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
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
  Copy,
  Check,
  Hourglass,
  ShoppingCart,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface TrackingPayload {
  orderNumber: string;
  status: string;
  statusLabel: string;
  paymentStatus: string;
  total: number;
  type: string;
  createdAt: string;
  paymentError?: string | null;
  paymentRef?: string | null;
  /** true when the order still awaits a successful payment (retry/edit allowed) */
  unpaid?: boolean;
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

export function TrackingCard({
  payload,
  onReorder,
}: {
  payload: TrackingPayload;
  /** «تکرار همین سفارش» — یک‌کلیک از کارت رهگیری؛ Promise<boolean> = موفقیت */
  onReorder?: (orderNumber: string) => Promise<boolean>;
}) {
  const { setView, setPaymentSimulation } = useAppStore();
  const [retrying, setRetrying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reordering, setReordering] = useState(false);
  const failed = payload.status === "PAYMENT_FAILED" || payload.paymentStatus === "FAILED";
  const unpaid = !!payload.unpaid && !failed;

  const stepIndex = STEP_INDEX[payload.status] ?? 0;
  const progress = failed ? 100 : payload.status === "DELIVERED" ? 100 : Math.max(5, ((stepIndex + 1) / STEPS.length) * 100);

  const retryPayment = async () => {
    setRetrying(true);
    const res = await api<{
      orderId: string;
      orderNumber: string;
      total: number;
      authority: string;
      simulated: boolean;
      paymentUrl?: string;
    }>("/api/payment/request", { body: { retry: true } });
    setRetrying(false);

    if (!res.success) {
      toast.error(res.error ?? "خطا در ایجاد پرداخت مجدد");
      return;
    }
    if (res.simulated) {
      setView("chat");
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

  const copyRef = async () => {
    if (!payload.paymentRef) return;
    try {
      await navigator.clipboard.writeText(payload.paymentRef);
      setCopied(true);
      toast.success("کد رهگیری کپی شد");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("کپی نشد — دستی انتخاب و کپی کنید");
    }
  };

  const repeatOrder = async () => {
    if (!onReorder || reordering) return;
    setReordering(true);
    try {
      await onReorder(payload.orderNumber);
    } finally {
      setReordering(false);
    }
  };

  const headerTone = failed
    ? "bg-destructive/90 text-white"
    : unpaid
      ? "bg-gradient-to-l from-amber-500 to-amber-400 text-amber-950"
      : "bg-gradient-to-l from-primary to-primary/85 text-primary-foreground";

  return (
    <div className="w-full max-w-xl overflow-hidden rounded-2xl border bg-card shadow-lg">
      {/* header */}
      <div className={cn("px-4 py-3", headerTone)}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-extrabold">
            {failed ? <AlertCircle className="h-5 w-5" /> : unpaid ? <Hourglass className="h-5 w-5" /> : <Package className="h-5 w-5" />}
            {failed ? "خطا در پرداخت سفارش" : unpaid ? "در انتظار پرداخت" : "وضعیت سفارش شما"}
          </div>
          <button
            className="rounded-lg bg-black/15 px-2 py-0.5 font-mono text-xs transition-colors hover:bg-black/25"
            dir="ltr"
            onClick={() => {
              navigator.clipboard?.writeText(payload.orderNumber).catch(() => null);
              toast.success("شماره سفارش کپی شد");
            }}
            title="کپی شماره سفارش"
          >
            {payload.orderNumber}
          </button>
        </div>
      </div>

      <div className="p-4">
        {failed || unpaid ? (
          <div className="space-y-3">
            <div className={cn("rounded-xl border p-3 text-sm leading-6", failed ? "border-destructive/30 bg-destructive/5" : "border-amber-500/30 bg-amber-500/5")}>
              {failed ? (
                <>
                  <b className="text-destructive">پرداخت سفارش ناموفق بود.</b>
                  <br />
                  <span className="text-muted-foreground">
                    {payload.paymentError ?? "به دلیل خطای درگاه، مبلغ از حساب شما کسر نشده است. می‌توانید دوباره پرداخت کنید."}
                  </span>
                </>
              ) : (
                <>
                  <b className="text-amber-700 dark:text-amber-400">این سفارش هنوز پرداخت نشده است.</b>
                  <br />
                  <span className="text-muted-foreground">
                    هر لحظه که آماده بودید دکمهٔ زیر را بزنید؛ اگر هم می‌خواهید چیزی را تغییر بدهید، همین‌جا در گفتگو بنویسید تا فاکتور را برایتان باز کنم ✏️
                  </span>
                </>
              )}
            </div>
            <Button
              className={cn("w-full font-bold", unpaid && "bg-amber-600 text-white shadow-lg shadow-amber-600/25 hover:bg-amber-700")}
              variant={failed ? "outline" : "default"}
              onClick={retryPayment}
              disabled={retrying}
            >
              {retrying ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <CreditCard className="ml-2 h-4 w-4" />}
              پرداخت مجدد ({formatToman(payload.total)})
            </Button>
          </div>
        ) : (
          <>
            {/* tracking code */}
            {payload.paymentRef && (
              <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400">کد رهگیری پرداخت</div>
                  <div className="truncate font-mono text-sm font-black text-emerald-800 dark:text-emerald-300" dir="ltr">
                    {toPersianDigits(payload.paymentRef)}
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0 rounded-lg border-emerald-500/40 text-emerald-700 hover:text-emerald-800 dark:text-emerald-400"
                  onClick={copyRef}
                  aria-label="کپی کد رهگیری"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            )}

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

            {/* one-click reorder — same items again as a fresh order */}
            {onReorder && (
              <Button
                variant="outline"
                onClick={repeatOrder}
                disabled={reordering}
                className="mt-3 w-full rounded-xl border-primary/30 font-bold text-primary transition-all hover:bg-primary/10 hover:text-primary active:scale-[0.98]"
              >
                {reordering ? (
                  <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                ) : (
                  <ShoppingCart className="ml-2 h-4 w-4" />
                )}
                {reordering ? "در حال آماده‌کردن سفارش قبلی…" : "تکرار همین سفارش"}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
