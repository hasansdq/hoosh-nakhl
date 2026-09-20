"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/client-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatToman, formatJalali, timeAgo } from "@/lib/fa";
import { toPersianDigits } from "@/lib/fa";
import { useAdminStore } from "@/lib/admin-store";
import {
  TrendingUp,
  Users,
  ShoppingBag,
  Clock,
  Bot,
  UtensilsCrossed,
  ArrowUpLeft,
  Cable,
  HeartPulse,
  ArrowLeft,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

interface StatsData {
  stats: {
    totalOrders: number;
    paidOrders: number;
    pendingOrders: number;
    totalUsers: number;
    newUsersWeek: number;
    revenueMonth: number;
    revenueToday: number;
  };
  recentOrders: {
    id: string;
    orderNumber: string;
    status: string;
    paymentStatus: string;
    total: number;
    type: string;
    createdAt: string;
    customer: string;
  }[];
  topItems: { name: string; quantity: number }[];
  revenueChart: { date: string; total: number; count: number }[];
}

export function AdminDashboard() {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const res = await api<StatsData>("/api/admin/stats");
      if (res.success) setData(res as unknown as StatsData);
      setLoading(false);
    };
    load();
  }, []);

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }

  const cards = [
    {
      title: "درآمد امروز",
      value: formatToman(data.stats.revenueToday),
      icon: TrendingUp,
      color: "text-emerald-600 bg-emerald-500/10",
      sub: "پرداخت‌های موفق امروز",
    },
    {
      title: "درآمد ۳۰ روز",
      value: formatToman(data.stats.revenueMonth),
      icon: TrendingUp,
      color: "text-primary bg-primary/10",
      sub: "مجموع پرداخت‌های ماه",
    },
    {
      title: "کل سفارش‌ها",
      value: String(data.stats.totalOrders),
      icon: ShoppingBag,
      color: "text-gold-foreground bg-gold/15",
      sub: `${data.stats.paidOrders} پرداخت موفق • ${data.stats.pendingOrders} در انتظار`,
    },
    {
      title: "کاربران",
      value: String(data.stats.totalUsers),
      icon: Users,
      color: "text-sky-600 bg-sky-500/10",
      sub: `${data.stats.newUsersWeek} کاربر جدید این هفته`,
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-black">
          <Bot className="h-6 w-6 text-primary" />
          داشبورد مدیریت نخل
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">نمای کلی عملکرد رستوران — به‌روزرسانی با هر بازدید</p>
      </div>

      {/* stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {cards.map((c) => (
          <Card key={c.title} className="gap-0 rounded-2xl p-4 transition-shadow hover:shadow-lg">
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">{c.title}</div>
                <div className="mt-1.5 truncate text-lg font-black lg:text-xl">{c.value}</div>
                <div className="mt-1 text-[10px] leading-4 text-muted-foreground">{c.sub}</div>
              </div>
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${c.color}`}>
                <c.icon className="h-5 w-5" />
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Baran connection status widget */}
      <BaranStatusWidget />

      {/* revenue chart */}
      <Card className="gap-0 overflow-hidden rounded-2xl p-0">
        <CardHeader className="border-b py-4">
          <CardTitle className="text-base">نمودار درآمد ۱۴ روز اخیر</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          <div className="h-64" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.revenueChart} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.44 0.085 158)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="oklch(0.44 0.085 158)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.015 110)" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "oklch(0.5 0.02 130)" }}
                  tickFormatter={(v: string) => v.slice(5)}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "oklch(0.5 0.02 130)" }}
                  tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                  width={44}
                />
                <Tooltip
                  formatter={(value: number) => [`${value.toLocaleString("en-US")} تومان`, "درآمد"]}
                  labelFormatter={(l) => `تاریخ: ${l}`}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid oklch(0.9 0.015 110)",
                    fontFamily: "inherit",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="oklch(0.44 0.085 158)"
                  strokeWidth={2.5}
                  fill="url(#revenue)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* recent orders */}
        <Card className="gap-0 overflow-hidden rounded-2xl p-0">
          <CardHeader className="border-b py-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-5 w-5 text-primary" />
              آخرین سفارش‌ها
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.recentOrders.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">هنوز سفارشی ثبت نشده است</div>
            ) : (
              <div className="divide-y">
                {data.recentOrders.map((o) => (
                  <div key={o.id} className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-muted/40">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-bold">
                        <span dir="ltr">{o.orderNumber}</span>
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                            o.paymentStatus === "PAID"
                              ? "bg-emerald-500/10 text-emerald-600"
                              : o.paymentStatus === "FAILED"
                                ? "bg-red-500/10 text-red-600"
                                : "bg-amber-500/10 text-amber-600"
                          }`}
                        >
                          {o.paymentStatus === "PAID" ? "پرداخت شد" : o.paymentStatus === "FAILED" ? "ناموفق" : "در انتظار"}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {o.customer} • {timeAgo(o.createdAt)}
                      </div>
                    </div>
                    <div className="shrink-0 text-sm font-black text-primary">{formatToman(o.total)}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* top items */}
        <Card className="gap-0 overflow-hidden rounded-2xl p-0">
          <CardHeader className="border-b py-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <UtensilsCrossed className="h-5 w-5 text-gold" />
              پرفروش‌ترین غذاها
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            {data.topItems.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">پس از اولین فروش‌ها، اینجا پر می‌شود 🌱</div>
            ) : (
              <div className="space-y-2.5">
                {data.topItems.map((item, i) => {
                  const max = data.topItems[0]?.quantity || 1;
                  return (
                    <div key={item.name}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="font-bold">
                          {i + 1}. {item.name}
                        </span>
                        <span className="text-muted-foreground">{item.quantity} عدد</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-gradient-to-l from-primary to-gold transition-all"
                          style={{ width: `${(item.quantity / max) * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ============ ویجت وضعیت اتصال باران (در داشبورد) ============

interface BaranWidgetData {
  settings: { enabled: boolean };
  stats: {
    productsSynced: number;
    ordersPending: number;
    lastProductSyncAt: string | null;
  };
  health: {
    verdict: "off" | "no_contact" | "healthy" | "stale" | "failing";
    lastCallAt: string | null;
    calls24h: number;
  };
}

const WIDGET_META: Record<
  BaranWidgetData["health"]["verdict"],
  { label: string; badge: string; dot: string; pulse: boolean }
> = {
  healthy: {
    label: "متصل و سالم",
    badge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
    pulse: true,
  },
  no_contact: {
    label: "در انتظار تماس باران",
    badge: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
    pulse: true,
  },
  stale: {
    label: "فعال اما بی‌خبر",
    badge: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
    pulse: false,
  },
  failing: {
    label: "خطا در آخرین فراخوانی",
    badge: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
    dot: "bg-red-500",
    pulse: true,
  },
  off: {
    label: "غیرفعال",
    badge: "border-muted bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/50",
    pulse: false,
  },
};

function sinceFa(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "همین حالا";
  if (m < 60) return `${toPersianDigits(m)} دقیقه پیش`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${toPersianDigits(h)} ساعت پیش`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${toPersianDigits(d)} روز پیش`;
  return formatJalali(iso, true);
}

function BaranStatusWidget() {
  const [data, setData] = useState<BaranWidgetData | null>(null);
  const [failed, setFailed] = useState(false);
  const setTab = useAdminStore((s) => s.setTab);

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await api<BaranWidgetData>("/api/admin/baran");
      if (!active) return;
      if (res.success && res.settings) setData(res as unknown as BaranWidgetData);
      else setFailed(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (failed) return null; // بی‌سر‌و‌صدا — داشبورد بدون این ویجت هم کامل است

  if (!data) {
    return <Skeleton className="h-[104px] rounded-2xl" />;
  }

  const meta = WIDGET_META[data.health?.verdict ?? "off"] ?? WIDGET_META.off;
  const h = data.health;

  return (
    <Card className="gap-0 overflow-hidden rounded-2xl border-dashed p-0 transition-shadow hover:shadow-lg">
      <div className="flex flex-wrap items-center gap-3 p-4 sm:gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <Cable className="h-6 w-6 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-sm font-bold">
              <HeartPulse className="h-4 w-4 text-muted-foreground" />
              اتصال نرم‌افزار باران
            </span>
            <Badge variant="outline" className={`gap-1.5 px-2 py-0.5 text-[11px] ${meta.badge}`}>
              <span className="relative flex h-1.5 w-1.5">
                {meta.pulse && (
                  <span
                    className={`absolute inline-flex h-full w-full animate-ping rounded-full ${meta.dot} opacity-60`}
                  />
                )}
                <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${meta.dot}`} />
              </span>
              {meta.label}
            </Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {h?.lastCallAt
              ? `آخرین تماس باران: ${sinceFa(h.lastCallAt)} · ${toPersianDigits(data.stats.productsSynced)} قلم همگام · ${toPersianDigits(data.stats.ordersPending)} سفارش در انتظار ارسال`
              : "هنوز تماسی از نرم‌افزار باران ثبت نشده — آدرس API و کلید را در باران وارد کنید"}
          </p>
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={() => setTab("baran")}>
          مدیریت اتصال
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
        </Button>
      </div>
    </Card>
  );
}
