"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldCheck, CheckCircle2, XCircle, Loader2, Lock } from "lucide-react";
import { formatToman } from "@/lib/fa";
import { toast } from "sonner";

export function SimulatedGateway() {
  const { paymentSimulation, setPaymentSimulation, setPaymentResult, bumpChat } = useAppStore();
  const [processing, setProcessing] = useState<"success" | "failed" | null>(null);

  if (!paymentSimulation) return null;
  const { authority, orderNumber, total } = paymentSimulation;

  const complete = async (success: boolean) => {
    setProcessing(success ? "success" : "failed");
    const res = await api<{ status: string; ref?: number }>("/api/payment/simulate", {
      body: { authority, success },
    });
    setProcessing(null);

    if (!res.success) {
      toast.error(res.error ?? "خطا در پرداخت");
      return;
    }

    setPaymentSimulation(null);
    setPaymentResult({
      status: success ? "success" : "failed",
      orderNumber,
      ref: res.ref ? String(res.ref) : undefined,
    });
    bumpChat();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-md overflow-hidden rounded-3xl p-0 shadow-2xl">
        {/* fake gateway header */}
        <div className="flex items-center justify-between bg-[#f6f6f6] px-5 py-3 dark:bg-[#1a1a1a]">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f6c344] text-sm font-black text-[#5d3e00]">ز</div>
            <div className="leading-tight">
              <div className="text-sm font-extrabold">زرین‌پال</div>
              <div className="text-[10px] text-muted-foreground">درگاه پرداخت اینترنتی (شبیه‌سازی آزمایشی)</div>
            </div>
          </div>
          <ShieldCheck className="h-5 w-5 text-emerald-600" />
        </div>

        <CardContent className="space-y-5 p-6">
          <div className="rounded-2xl border bg-muted/40 p-4 text-center">
            <div className="text-xs text-muted-foreground">مبلغ قابل پرداخت</div>
            <div className="mt-1 text-3xl font-black text-primary">{formatToman(total)}</div>
            <div className="mt-2 text-[11px] text-muted-foreground">
              شماره سفارش: <b dir="ltr">{orderNumber}</b>
            </div>
          </div>

          <div className="rounded-xl bg-amber-500/10 px-4 py-3 text-xs leading-6 text-amber-800 dark:text-amber-300">
            🔔 این صفحه، شبیه‌ساز درگاه زرین‌پال است (چون مرچنت واقعی هنوز تنظیم نشده). با فعال‌سازی
            مرچنت‌آیدی واقعی در پنل مدیریت، پرداخت به درگاه اصلی زرین‌پال منتقل می‌شود.
          </div>

          <div className="space-y-2.5">
            <Button
              onClick={() => complete(true)}
              disabled={processing !== null}
              className="h-13 w-full rounded-2xl bg-emerald-600 py-4 text-base font-black text-white shadow-lg shadow-emerald-600/25 hover:bg-emerald-700"
            >
              {processing === "success" ? <Loader2 className="ml-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="ml-2 h-5 w-5" />}
              پرداخت موفق (تست)
            </Button>
            <Button
              onClick={() => complete(false)}
              disabled={processing !== null}
              variant="outline"
              className="h-12 w-full rounded-2xl border-red-300 py-4 font-bold text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30"
            >
              {processing === "failed" ? <Loader2 className="ml-2 h-5 w-5 animate-spin" /> : <XCircle className="ml-2 h-5 w-5" />}
              شبیه‌سازی خطای پرداخت
            </Button>
          </div>

          <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
            <Lock className="h-3 w-3" />
            اتصال امن SSL — این تراکنش فقط در محیط آزمایشی است
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function PaymentResultBanner() {
  const { paymentResult, setPaymentResult, setView } = useAppStore();
  if (!paymentResult) return null;

  const success = paymentResult.status === "success";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-md overflow-hidden rounded-3xl p-0 text-center shadow-2xl">
        <div className={`px-6 py-8 ${success ? "bg-gradient-to-b from-emerald-600 to-emerald-500" : "bg-gradient-to-b from-red-600 to-red-500"} text-white`}>
          {success ? (
            <CheckCircle2 className="mx-auto h-16 w-16" />
          ) : (
            <XCircle className="mx-auto h-16 w-16" />
          )}
          <h2 className="mt-3 text-2xl font-black">
            {success ? "پرداخت با موفقیت انجام شد!" : "پرداخت ناموفق بود"}
          </h2>
        </div>
        <CardContent className="space-y-4 p-6">
          <div className="rounded-xl border bg-muted/40 p-3.5 text-sm leading-7">
            {success ? (
              <>
                سفارش شما ثبت شد و آشپزخونه نخل در خدمتته 🌴
                <br />
                شماره سفارش: <b dir="ltr">{paymentResult.orderNumber}</b>
                {paymentResult.ref && (
                  <>
                    <br />
                    کد رهگیری پرداخت: <b dir="ltr">{paymentResult.ref}</b>
                  </>
                )}
                <br />
                <span className="text-xs text-muted-foreground">
                  وضعیت سفارش را می‌توانید از «هوش نخل» یا «سفارش‌های من» دنبال کنید.
                </span>
              </>
            ) : (
              <>
                سفارش شما ثبت شد اما پرداخت انجام نشد 😔
                <br />
                شماره سفارش: <b dir="ltr">{paymentResult.orderNumber}</b>
                <br />
                <span className="text-xs text-muted-foreground">
                  از «هوش نخل» دوباره سفارش‌گیری کنید و پرداخت را تکرار کنید. مبلغی از حساب شما کسر نشده است.
                </span>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                setPaymentResult(null);
                setView("chat");
              }}
              className="flex-1 rounded-xl font-bold"
            >
              گفتگو با هوش نخل
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setPaymentResult(null);
                setView("orders");
              }}
              className="flex-1 rounded-xl font-bold"
            >
              سفارش‌های من
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
