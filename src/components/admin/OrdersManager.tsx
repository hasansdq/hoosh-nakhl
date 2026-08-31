"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { formatToman, formatJalali, formatJalaliLong, toPersianDigits, timeAgo } from "@/lib/fa";
import { formatScheduleFa } from "@/lib/schedule";
import {
  ShoppingBag,
  Search,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Bike,
  Store,
  RefreshCw,
  Clock,
  CalendarClock,
} from "lucide-react";
import { toast } from "sonner";

interface OrderRow {
  id: string;
  orderNumber: string;
  status: string;
  statusLabel: string;
  paymentStatus: string;
  paymentRef: string | null;
  paymentAuthority: string | null;
  paymentError: string | null;
  type: string;
  address: string | null;
  note: string | null;
  subtotal: number;
  deliveryFee: number;
  taxAmount: number;
  total: number;
  createdAt: string;
  scheduledFor?: string | null;
  customer: string;
  customerPhone: string;
  items: { id: string; name: string; quantity: number; lineTotal: number }[];
}

interface OrderDetail extends OrderRow {
  statusLogs: { id: string; status: string; note: string | null; createdAt: string }[];
}

const STATUS_FLOW = ["PAID", "PREPARING", "READY", "DELIVERING", "DELIVERED"];

export function OrdersManager({ initialFilter }: { initialFilter?: string } = {}) {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [updating, setUpdating] = useState(false);
  // skip the existing [page, statusFilter] effect on first render — the
  // mount effect handles the initial load (with optional initialFilter from
  // the global Cmd+K search palette) so we don't double-fetch on mount.
  const firstRender = useRef(true);

  const load = useCallback(
    async (p = page, opts?: { search?: string }) => {
      const q = opts?.search ?? search;
      setLoading(true);
      const res = await api<{ orders: OrderRow[]; pagination: { pages: number } }>(
        `/api/admin/orders?page=${p}&status=${statusFilter === "ALL" ? "" : statusFilter}&q=${encodeURIComponent(q)}`
      );
      if (res.success) {
        setOrders(res.orders ?? []);
        setPages(res.pagination?.pages ?? 1);
      }
      setLoading(false);
    },
    [statusFilter, search, page]
  );

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetching (matches original OrdersManager pattern)
    load(page);
  }, [page, statusFilter]);

  // Mount: if an initial filter is supplied by the Cmd+K palette (e.g. an
  // order number picked from search results), seed the search box with it
  // and trigger an immediate filtered fetch.
  useEffect(() => {
    if (initialFilter) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- seed search box from Cmd+K palette selection
      setSearch(initialFilter);
      load(1, { search: initialFilter });
    } else {
      load(1);
    }
  }, []);

  // live refresh — dispatched by AdminPanel when a real-time socket event
  // (new paid order / status change by another admin) arrives
  useEffect(() => {
    const handler = () => load(page);
    window.addEventListener("nk:refresh-orders", handler);
    return () => window.removeEventListener("nk:refresh-orders", handler);
  }, [load, page]);

  const openDetail = async (order: OrderRow) => {
    const res = await api<{ order: OrderDetail }>(`/api/admin/orders/${order.id}`);
    if (res.success) {
      setDetail(res.order ?? null);
    }
  };

  const updateStatus = async (orderId: string, status: string) => {
    setUpdating(true);
    const res = await api(`/api/admin/orders/${orderId}`, { method: "PUT", body: { status } });
    setUpdating(false);
    if (!res.success) return toast.error(res.error ?? "خطا");
    toast.success("وضعیت سفارش به‌روزرسانی شد ✅");
    setDetail(null);
    load(page);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-black">
            <ShoppingBag className="h-6 w-6 text-primary" />
            مدیریت سفارش‌ها
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">مشاهده، پیگیری و به‌روزرسانی وضعیت سفارش‌ها</p>
        </div>
        <Button variant="outline" onClick={() => load(page)} className="rounded-xl">
          <RefreshCw className={`ml-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          بروزرسانی
        </Button>
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-72">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            onKeyDown={(e) => e.key === "Enter" && load(1)}
            placeholder="جستجو: شماره سفارش / نام / موبایل..."
            className="rounded-xl pr-9"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44 rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">همه وضعیت‌ها</SelectItem>
            <SelectItem value="PENDING_PAYMENT">در انتظار پرداخت</SelectItem>
            <SelectItem value="PAID">پرداخت شده</SelectItem>
            <SelectItem value="PREPARING">در حال آماده‌سازی</SelectItem>
            <SelectItem value="READY">آماده تحویل</SelectItem>
            <SelectItem value="DELIVERING">در مسیر ارسال</SelectItem>
            <SelectItem value="DELIVERED">تحویل شده</SelectItem>
            <SelectItem value="PAYMENT_FAILED">خطای پرداخت</SelectItem>
            <SelectItem value="CANCELED">لغو شده</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* table */}
      <Card className="overflow-hidden rounded-2xl p-0">
        {loading ? (
          <div className="space-y-2 p-4">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">سفارشی با این مشخصات یافت نشد</div>
        ) : (
          <div className="divide-y">
            {orders.map((o) => (
              <button
                key={o.id}
                onClick={() => openDetail(o)}
                className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3.5 text-right transition hover:bg-muted/40"
              >
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${o.type === "DELIVERY" ? "bg-primary/10 text-primary" : "bg-gold/15 text-gold-foreground"}`}>
                    {o.type === "DELIVERY" ? <Bike className="h-5 w-5" /> : <Store className="h-5 w-5" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 text-sm font-black">
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
                        {o.statusLabel}
                      </span>
                      {o.scheduledFor && (
                        <span
                          className="flex items-center gap-1 rounded-md bg-gold/15 px-1.5 py-0.5 text-[10px] font-bold text-gold-foreground"
                          title={`زمان تحویل پیش‌سفارش: ${formatJalali(o.scheduledFor, true)}`}
                        >
                          <CalendarClock className="h-3 w-3" />
                          پیش‌سفارش
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {o.customer} • {toPersianDigits(o.items.length)} قلم • {timeAgo(o.createdAt)}
                      {o.scheduledFor && (
                        <span className="font-bold text-gold-foreground">
                          {" "}• تحویل {formatScheduleFa(o.scheduledFor)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-black text-primary">{formatToman(o.total)}</span>
                  <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="icon" className="rounded-xl" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="text-sm font-bold">
            صفحه {toPersianDigits(page)} از {toPersianDigits(pages)}
          </span>
          <Button variant="outline" size="icon" className="rounded-xl" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* detail dialog */}
      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto rounded-2xl" aria-describedby={undefined}>
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  جزئیات سفارش
                  <span dir="ltr" className="rounded-lg bg-muted px-2 py-0.5 text-sm">
                    {detail.orderNumber}
                  </span>
                </DialogTitle>
                <DialogDescription>
                  {detail.customer} — <span dir="ltr">{detail.customerPhone}</span> • {formatJalali(detail.createdAt, true)}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* items */}
                <div className="space-y-1.5">
                  {detail.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2 text-sm">
                      <span className="font-semibold">
                        {item.name}
                        <span className="mr-1 text-xs text-muted-foreground">×{toPersianDigits(item.quantity)}</span>
                      </span>
                      <span className="text-muted-foreground">{formatToman(item.lineTotal)}</span>
                    </div>
                  ))}
                </div>

                {detail.address && (
                  <div className="rounded-xl border px-3 py-2.5 text-xs leading-6">
                    <b className="text-primary">آدرس تحویل:</b> {detail.address}
                  </div>
                )}
                {detail.scheduledFor && (
                  <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-gold/40 bg-gold/10 px-3 py-2.5 text-xs font-bold leading-6 text-gold-foreground">
                    <CalendarClock className="h-4 w-4 shrink-0" />
                    <span>
                      زمان تحویل پیش‌سفارش: {formatScheduleFa(detail.scheduledFor)}
                      <span className="font-semibold opacity-75">
                        {" "}({formatJalaliLong(detail.scheduledFor)})
                      </span>
                    </span>
                  </div>
                )}
                {detail.note && (
                  <div className="rounded-xl border px-3 py-2.5 text-xs leading-6">
                    <b className="text-gold">یادداشت مشتری:</b> {detail.note}
                  </div>
                )}
                {detail.paymentError && (
                  <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs leading-6 text-destructive">
                    <b>خطای پرداخت:</b> {detail.paymentError}
                  </div>
                )}

                <Separator />

                <div className="space-y-1 text-sm text-muted-foreground">
                  <div className="flex justify-between">
                    <span>جمع سفارش</span>
                    <span>{formatToman(detail.subtotal)}</span>
                  </div>
                  {detail.type === "DELIVERY" && (
                    <div className="flex justify-between">
                      <span>هزینه پیک</span>
                      <span>{detail.deliveryFee === 0 ? "رایگان" : formatToman(detail.deliveryFee)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>مالیات ارزش افزوده</span>
                    <span>{formatToman(detail.taxAmount)}</span>
                  </div>
                  <div className="flex justify-between text-base font-black text-primary">
                    <span>مبلغ کل</span>
                    <span>{formatToman(detail.total)}</span>
                  </div>
                  {detail.paymentRef && (
                    <div className="flex justify-between pt-1 text-xs">
                      <span>کد رهگیری پرداخت</span>
                      <span dir="ltr" className="font-bold">{toPersianDigits(detail.paymentRef)}</span>
                    </div>
                  )}
                </div>

                {/* status timeline */}
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    تاریخچه وضعیت
                  </div>
                  <div className="space-y-1.5">
                    {(detail.statusLogs ?? []).map((log) => (
                      <div key={log.id} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-1.5 text-[11px]">
                        <span className="font-semibold">{log.note ?? log.status}</span>
                        <span className="text-muted-foreground">{formatJalali(log.createdAt, true)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* status update */}
                {detail.paymentStatus === "PAID" && !["DELIVERED", "CANCELED"].includes(detail.status) && (
                  <div>
                    <div className="mb-2 text-xs font-bold text-muted-foreground">تغییر وضعیت به:</div>
                    <div className="flex flex-wrap gap-2">
                      {STATUS_FLOW.filter((s) => s !== detail.status).map((s) => (
                        <Button
                          key={s}
                          variant="outline"
                          size="sm"
                          disabled={updating}
                          onClick={() => updateStatus(detail.id, s)}
                          className="rounded-xl text-xs font-bold"
                        >
                          {updating && <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin" />}
                          {statusLabel(s)}
                        </Button>
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={updating}
                        onClick={() => updateStatus(detail.id, "CANCELED")}
                        className="rounded-xl border-destructive/40 text-xs font-bold text-destructive"
                      >
                        لغو سفارش
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    PENDING_PAYMENT: "در انتظار پرداخت",
    PAID: "پرداخت شده",
    PREPARING: "در حال آماده‌سازی",
    READY: "آماده تحویل",
    DELIVERING: "در مسیر ارسال",
    DELIVERED: "تحویل شده",
    CANCELED: "لغو شده",
    PAYMENT_FAILED: "خطای پرداخت",
  };
  return map[s] ?? s;
}
