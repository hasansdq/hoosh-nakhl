"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { toPersianDigits, formatToman, formatJalali, formatPrice } from "@/lib/fa";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import {
  Wallet,
  ShoppingBag,
  Receipt,
  Percent,
  Ticket,
  Bike,
  BarChart3,
  RefreshCw,
  Copy,
  UtensilsCrossed,
  PieChart as PieIcon,
  ListChecks,
  Inbox,
  TriangleAlert,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from "recharts";

// ================= types (matches /api/admin/analytics) =================
interface Kpis {
  totalRevenue: number;
  orderCount: number;
  avgOrderValue: number;
  totalVat: number;
  totalDiscount: number;
  deliveryRevenue: number;
  totalItemsSold: number;
}
interface DayRow {
  date: string; // YYYY-MM-DD
  label: string; // «۱۵ مرداد»
  revenue: number;
  orders: number;
  discount: number;
}
interface TopItem {
  name: string;
  qty: number;
  revenue: number;
}
interface CouponImpact {
  code: string;
  title: string;
  type: string; // PERCENT | FIXED
  value: number;
  usedCount: number;
  ordersInRange: number;
  discountGiven: number;
  revenue: number;
}
interface ChannelRow {
  channel: "CHAT" | "CART";
  orders: number;
  revenue: number;
}
interface StatusRow {
  status: string;
  count: number;
}
interface AnalyticsData {
  days: number;
  kpis: Kpis;
  revenueByDay: DayRow[];
  topItems: TopItem[];
  couponImpact: CouponImpact[];
  channelSplit: ChannelRow[];
  statusSplit: StatusRow[];
}

const RANGES: { days: 7 | 30 | 90; label: string }[] = [
  { days: 7, label: "۷ روز" },
  { days: 30, label: "۳۰ روز" },
  { days: 90, label: "۹۰ روز" },
];

// status labels & colors — same conventions as OrdersManager / TrackView
const STATUS_META: Record<string, { label: string; chip: string; bar: string }> = {
  PENDING_PAYMENT: {
    label: "در انتظار پرداخت",
    chip: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    bar: "bg-amber-500",
  },
  PAID: {
    label: "پرداخت شده",
    chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    bar: "bg-emerald-500",
  },
  PREPARING: {
    label: "در حال آماده‌سازی",
    chip: "bg-teal-500/15 text-teal-700 dark:text-teal-400",
    bar: "bg-teal-500",
  },
  READY: { label: "آماده تحویل", chip: "bg-primary/15 text-primary", bar: "bg-primary" },
  DELIVERING: {
    label: "در مسیر ارسال",
    chip: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
    bar: "bg-orange-500",
  },
  DELIVERED: {
    label: "تحویل شده",
    chip: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400",
    bar: "bg-emerald-600",
  },
  CANCELED: { label: "لغو شده", chip: "bg-destructive/15 text-destructive", bar: "bg-destructive" },
  PAYMENT_FAILED: {
    label: "خطای پرداخت",
    chip: "bg-destructive/15 text-destructive",
    bar: "bg-destructive",
  },
};

// chart colors resolve through theme CSS vars → correct in light & dark
const revenueConfig = {
  revenue: { label: "درآمد", color: "var(--primary)" },
} satisfies ChartConfig;

const itemsConfig = {
  qty: { label: "تعداد فروش", color: "var(--gold)" },
} satisfies ChartConfig;

const channelConfig = {
  chat: { label: "چت هوش نخل", color: "var(--primary)" },
  cart: { label: "سبد خرید", color: "var(--gold)" },
} satisfies ChartConfig;

/** "YYYY-MM-DD" -> local Date (avoids UTC-shift when parsing) */
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

async function copyCouponCode(code: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code);
      toast.success("کد کپی شد");
      return;
    }
  } catch {
    // fall through to legacy path
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = code;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    toast.success("کد کپی شد");
  } catch {
    toast.error("کپی ناموفق بود");
  }
}

// ---------- custom recharts tooltips (Persian digits + Toman + Jalali) ----------
function RevenueTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: DayRow }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-xl border bg-card px-3 py-2 text-xs shadow-lg" dir="rtl">
      <div className="font-black">{formatJalali(parseLocalDate(d.date))}</div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />
        درآمد: <b className="text-primary">{formatToman(d.revenue)}</b>
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">
        {toPersianDigits(d.orders)} سفارش • تخفیف: {formatPrice(d.discount)} تومان
      </div>
    </div>
  );
}

function ItemsTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: TopItem }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-xl border bg-card px-3 py-2 text-xs shadow-lg" dir="rtl">
      <div className="font-black">{d.name}</div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full bg-gold" aria-hidden />
        {toPersianDigits(d.qty)} عدد فروخته شده
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">
        درآمد: <b className="text-primary">{formatToman(d.revenue)}</b>
      </div>
    </div>
  );
}

function ChannelTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: ChannelDatum }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const total = d.total || 1;
  return (
    <div className="rounded-xl border bg-card px-3 py-2 text-xs shadow-lg" dir="rtl">
      <div className="font-black">{d.name}</div>
      <div className="mt-1 text-muted-foreground">
        {toPersianDigits(d.orders)} سفارش ({toPersianDigits(Math.round((d.orders / total) * 100))}٪)
      </div>
      <div className="text-primary">
        <b>{formatToman(d.revenue)}</b>
      </div>
    </div>
  );
}

interface ChannelDatum {
  key: "CHAT" | "CART";
  name: string;
  orders: number;
  revenue: number;
  total: number;
}

export function AnalyticsView() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [retryKey, setRetryKey] = useState(0);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await api<AnalyticsData>(`/api/admin/analytics?days=${days}`);
      if (!active) return;
      if (res.success) {
        setData(res as unknown as AnalyticsData);
        setError(false);
      } else {
        setError(true);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [days, retryKey]);

  // loading flags are flipped in the event handlers (not the effect) so the
  // skeleton appears instantly while the new range is being fetched
  const changeRange = (d: 7 | 30 | 90) => {
    setDays(d);
    setLoading(true);
    setError(false);
  };

  const retry = () => {
    setRetryKey((k) => k + 1);
    setLoading(true);
    setError(false);
  };

  // ---------- render helpers ----------
  const kpis = data?.kpis;
  const kpiCards = kpis
    ? [
        {
          title: "درآمد کل",
          value: formatToman(kpis.totalRevenue),
          icon: Wallet,
          tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          sub: "مجموع سفارش‌های پرداخت‌شده",
        },
        {
          title: "تعداد سفارش",
          value: `${toPersianDigits(kpis.orderCount)} سفارش`,
          icon: ShoppingBag,
          tint: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
          sub: `${toPersianDigits(kpis.totalItemsSold)} قلم غذا فروخته شده`,
        },
        {
          title: "میانگین سفارش",
          value: formatToman(kpis.avgOrderValue),
          icon: Receipt,
          tint: "bg-primary/10 text-primary",
          sub: "سرانه هر سفارش پرداخت‌شده",
        },
        {
          title: "مالیات",
          value: formatToman(kpis.totalVat),
          icon: Percent,
          tint: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          sub: "مالیات بر ارزش افزوده",
        },
        {
          title: "تخفیف‌ها",
          value: formatToman(kpis.totalDiscount),
          icon: Ticket,
          tint: "bg-gold/15 text-gold-foreground",
          sub: "مجموع کدهای اعمال‌شده",
        },
        {
          title: "درآمد پیک",
          value: formatToman(kpis.deliveryRevenue),
          icon: Bike,
          tint: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
          sub: "هزینه ارسال سفارش‌ها",
        },
      ]
    : [];

  const chat = data?.channelSplit.find((c) => c.channel === "CHAT");
  const cart = data?.channelSplit.find((c) => c.channel === "CART");
  const channelTotal = (chat?.orders ?? 0) + (cart?.orders ?? 0);
  const channelData: ChannelDatum[] = [
    {
      key: "CHAT",
      name: "چت هوش نخل",
      orders: chat?.orders ?? 0,
      revenue: chat?.revenue ?? 0,
      total: channelTotal,
    },
    {
      key: "CART",
      name: "سبد خرید",
      orders: cart?.orders ?? 0,
      revenue: cart?.revenue ?? 0,
      total: channelTotal,
    },
  ];

  const statusTotal = data?.statusSplit.reduce((s, r) => s + r.count, 0) ?? 0;
  const hasPaidOrders = (kpis?.orderCount ?? 0) > 0;

  return (
    <div className="space-y-5">
      {/* header + range selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-black">
            <BarChart3 className="h-6 w-6 text-primary" />
            تحلیل مالی
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            نمای مالی فروش بر اساس سفارش‌های پرداخت‌شده — {toPersianDigits(days)} روز اخیر
          </p>
        </div>
        <div
          className="flex items-center gap-1.5 rounded-2xl border bg-card p-1.5"
          role="tablist"
          aria-label="بازه زمانی تحلیل"
        >
          {RANGES.map((r) => (
            <button
              key={r.days}
              role="tab"
              aria-selected={days === r.days}
              onClick={() => changeRange(r.days)}
              className={`min-h-[36px] rounded-xl px-4 py-1.5 text-xs font-black transition ${
                days === r.days
                  ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                  : "text-foreground/70 hover:bg-accent"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* loading skeletons */}
      {loading && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-[340px] rounded-2xl" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Skeleton className="h-80 rounded-2xl" />
            <Skeleton className="h-80 rounded-2xl" />
          </div>
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      )}

      {/* error state */}
      {!loading && error && (
        <Card className="rounded-2xl p-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
              <TriangleAlert className="h-7 w-7" />
            </div>
            <div className="font-black">دریافت اطلاعات تحلیل ناموفق بود</div>
            <p className="text-sm text-muted-foreground">
              ارتباط با سرور برقرار نشد. لطفاً دوباره تلاش کنید.
            </p>
            <Button onClick={retry} variant="outline" className="rounded-xl">
              <RefreshCw className="ml-1.5 h-4 w-4" />
              تلاش مجدد
            </Button>
          </div>
        </Card>
      )}

      {!loading && !error && data && kpis && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {kpiCards.map((c) => (
              <Card key={c.title} className="gap-0 rounded-2xl p-4 transition-shadow hover:shadow-lg">
                <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${c.tint}`}>
                  <c.icon className="h-4.5 w-4.5" />
                </div>
                <div className="mt-2.5 text-[11px] text-muted-foreground">{c.title}</div>
                <div className="mt-1 truncate text-base font-black" title={c.value}>
                  {c.value}
                </div>
                <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{c.sub}</div>
              </Card>
            ))}
          </div>

          {hasPaidOrders ? (
            <>
              {/* revenue trend */}
              <Card className="gap-0 overflow-hidden rounded-2xl p-0">
                <CardHeader className="border-b py-4">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Wallet className="h-5 w-5 text-primary" />
                    روند درآمد ({RANGES.find((r) => r.days === days)?.label})
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-3">
                  <div dir="ltr">
                    <ChartContainer
                      id="analytics-revenue"
                      config={revenueConfig}
                      className="aspect-auto h-[280px] w-full"
                    >
                      <AreaChart data={data.revenueByDay} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="analyticsRevenueFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" style={{ stopColor: "var(--color-revenue)" }} stopOpacity={0.32} />
                            <stop offset="100%" style={{ stopColor: "var(--color-revenue)" }} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 10 }}
                          interval="preserveStartEnd"
                          minTickGap={38}
                        />
                        <YAxis
                          tick={{ fontSize: 10 }}
                          width={46}
                          tickFormatter={(v: number) =>
                            v >= 1000
                              ? `${toPersianDigits(Math.round(v / 1000))}k`
                              : toPersianDigits(v)
                          }
                        />
                        <Tooltip content={<RevenueTooltip />} cursor={{ stroke: "var(--primary)", strokeOpacity: 0.25 }} />
                        <Area
                          type="monotone"
                          dataKey="revenue"
                          stroke="var(--color-revenue)"
                          strokeWidth={2.5}
                          fill="url(#analyticsRevenueFill)"
                          name="درآمد"
                        />
                      </AreaChart>
                    </ChartContainer>
                  </div>
                </CardContent>
              </Card>

              {/* top items + channel split */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* top items */}
                <Card className="gap-0 overflow-hidden rounded-2xl p-0">
                  <CardHeader className="border-b py-4">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <UtensilsCrossed className="h-5 w-5 text-gold" />
                      پرفروش‌ترین اقلام
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-3">
                    {data.topItems.length === 0 ? (
                      <div className="p-6 text-center text-sm text-muted-foreground">
                        قلمی در این بازه فروخته نشده است
                      </div>
                    ) : (
                      <div dir="ltr">
                        <ChartContainer
                          id="analytics-items"
                          config={itemsConfig}
                          className="aspect-auto h-[290px] w-full"
                        >
                          <BarChart
                            data={data.topItems}
                            layout="vertical"
                            margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
                            barCategoryGap="24%"
                          >
                            <XAxis type="number" hide />
                            <YAxis
                              type="category"
                              dataKey="name"
                              width={116}
                              tick={{ fontSize: 10 }}
                            />
                            <Tooltip content={<ItemsTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
                            <Bar
                              dataKey="qty"
                              fill="var(--color-qty)"
                              radius={[0, 8, 8, 0]}
                              name="تعداد فروش"
                            />
                          </BarChart>
                        </ChartContainer>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* channel split */}
                <Card className="gap-0 overflow-hidden rounded-2xl p-0">
                  <CardHeader className="border-b py-4">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <PieIcon className="h-5 w-5 text-primary" />
                      کانال ثبت سفارش
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-3">
                    <div dir="ltr">
                      <ChartContainer
                        id="analytics-channel"
                        config={channelConfig}
                        className="aspect-auto h-[210px] w-full"
                      >
                        <PieChart>
                          <Tooltip content={<ChannelTooltip />} />
                          <Pie
                            data={channelData}
                            dataKey="orders"
                            nameKey="name"
                            innerRadius={56}
                            outerRadius={88}
                            paddingAngle={channelTotal > 0 ? 3 : 0}
                            strokeWidth={0}
                          >
                            <Cell key="chat" fill="var(--color-chat)" />
                            <Cell key="cart" fill="var(--color-cart)" />
                          </Pie>
                        </PieChart>
                      </ChartContainer>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {channelData.map((ch) => (
                        <div
                          key={ch.key}
                          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border bg-muted/30 px-3 py-2"
                        >
                          <span
                            className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                              ch.key === "CHAT" ? "bg-primary" : "bg-gold"
                            }`}
                            aria-hidden
                          />
                          <span className="text-xs font-black">{ch.name}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {toPersianDigits(ch.orders)} سفارش
                          </span>
                          <span className="text-[11px] font-black text-primary">
                            {formatToman(ch.revenue)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          ) : (
            /* empty state — no paid orders in range */
            <Card className="rounded-2xl p-10">
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Inbox className="h-8 w-8" />
                </div>
                <div className="text-base font-black">سفارشی در این بازه ثبت نشده</div>
                <p className="max-w-md text-sm leading-6 text-muted-foreground">
                  با ثبت اولین سفارش پرداخت‌شده، نمودار درآمد، پرفروش‌ترین اقلام و تحلیل کانال‌ها
                  همین‌جا نمایش داده می‌شوند 🌴
                </p>
              </div>
            </Card>
          )}

          {/* status split (all orders in range) */}
          {data.statusSplit.length > 0 && (
            <Card className="gap-0 overflow-hidden rounded-2xl p-0">
              <CardHeader className="border-b py-4">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ListChecks className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                  توزیع وضعیت سفارش‌ها
                  <span className="text-xs font-normal text-muted-foreground">
                    (همه سفارش‌های بازه — {toPersianDigits(statusTotal)} سفارش)
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 p-4 pt-3">
                {/* stacked bar */}
                <div
                  className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label="نمودار میله‌ای توزیع وضعیت سفارش‌ها"
                >
                  {data.statusSplit.map((r) => {
                    const meta = STATUS_META[r.status];
                    if (!meta || r.count === 0) return null;
                    return (
                      <span
                        key={r.status}
                        className={`${meta.bar} h-full`}
                        style={{ width: `${(r.count / Math.max(statusTotal, 1)) * 100}%` }}
                        title={`${meta.label}: ${toPersianDigits(r.count)}`}
                      />
                    );
                  })}
                </div>
                {/* chips */}
                <div className="flex flex-wrap items-center gap-2">
                  {data.statusSplit.map((r) => {
                    const meta = STATUS_META[r.status] ?? {
                      label: r.status,
                      chip: "bg-muted text-muted-foreground",
                      bar: "bg-muted-foreground",
                    };
                    return (
                      <span
                        key={r.status}
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${meta.chip}`}
                      >
                        {meta.label}
                        <span className="rounded-full bg-card/70 px-1.5 text-[10px] font-black">
                          {toPersianDigits(r.count)}
                        </span>
                      </span>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* coupon impact table */}
          <Card className="gap-0 overflow-hidden rounded-2xl p-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <Ticket className="h-5 w-5 text-gold" />
                اثر کدهای تخفیف
                <span className="text-xs font-normal text-muted-foreground">
                  (برای کپی، روی کد کلیک کنید)
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="nice-scroll max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-10 [&_th]:bg-card">
                    <TableRow>
                      <TableHead className="text-right">کد تخفیف</TableHead>
                      <TableHead className="text-right">عنوان</TableHead>
                      <TableHead className="text-right">نوع / مقدار</TableHead>
                      <TableHead className="text-right">استفاده</TableHead>
                      <TableHead className="text-right">تخفیف اعطاشده</TableHead>
                      <TableHead className="text-right">درآمد ایجادشده</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.couponImpact.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                          هنوز کد تخفیفی ثبت نشده است
                        </TableCell>
                      </TableRow>
                    ) : (
                      data.couponImpact.map((c, i) => (
                        <TableRow
                          key={c.code}
                          className={i % 2 === 1 ? "bg-muted/30" : undefined}
                        >
                          <TableCell>
                            <button
                              dir="ltr"
                              onClick={() => void copyCouponCode(c.code)}
                              title="کپی کد"
                              className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1 font-mono text-xs font-black tracking-wider transition hover:bg-primary/10 hover:text-primary"
                            >
                              {c.code}
                              <Copy className="h-3 w-3" />
                            </button>
                          </TableCell>
                          <TableCell className="max-w-[180px] truncate text-xs" title={c.title}>
                            {c.title}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="text-[11px]">
                              {c.type === "PERCENT"
                                ? `${toPersianDigits(c.value)}٪`
                                : formatToman(c.value)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="text-xs font-black">{toPersianDigits(c.usedCount)}</div>
                            <div
                              className={`text-[10px] ${
                                c.ordersInRange > 0
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {toPersianDigits(c.ordersInRange)} در این بازه
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">
                            {c.discountGiven > 0 ? (
                              <span className="text-amber-600 dark:text-amber-400">
                                {formatToman(c.discountGiven)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs font-black text-primary">
                            {c.revenue > 0 ? formatToman(c.revenue) : "—"}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
