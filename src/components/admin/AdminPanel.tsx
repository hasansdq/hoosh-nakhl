"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Socket } from "socket.io-client";
import { connectRealtime } from "@/lib/realtime";
import { useAdminStore, type AdminTab } from "@/lib/admin-store";
import { api } from "@/lib/client-api";
import { toPersianDigits, formatToman } from "@/lib/fa";
import { toast } from "sonner";
import { AdminLogin } from "./AdminLogin";
import { AdminDashboard } from "./AdminDashboard";
import { AnalyticsView } from "./AnalyticsView";
import { MenuManager } from "./MenuManager";
import { OrdersManager } from "./OrdersManager";
import { UsersManager } from "./UsersManager";
import { CouponsManager } from "./CouponsManager";
import { ReviewsManager } from "./ReviewsManager";
import { AdminSettings } from "./AdminSettings";
import { UploadsManager, AuditLogView } from "./UploadsAudit";
import { AdminSearchPalette, type AdminSearchSelection } from "./AdminSearchPalette";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  LayoutDashboard,
  BarChart3,
  UtensilsCrossed,
  ShoppingBag,
  Users,
  Ticket,
  Star,
  Settings,
  UploadCloud,
  ScrollText,
  Loader2,
  LogOut,
  ExternalLink,
  Menu as MenuIcon,
  X,
  ShieldCheck,
  Search,
} from "lucide-react";

const TABS: { key: AdminTab; label: string }[] = [
  { key: "dashboard", label: "داشبورد" },
  { key: "analytics", label: "تحلیل مالی" },
  { key: "menu", label: "مدیریت منو" },
  { key: "orders", label: "سفارش‌ها" },
  { key: "users", label: "کاربران" },
  { key: "coupons", label: "کدهای تخفیف" },
  { key: "reviews", label: "نظرات" },
  { key: "settings", label: "تنظیمات" },
  { key: "uploads", label: "فایل‌ها" },
  { key: "audit", label: "گزارش‌ها" },
];

const TAB_ICONS: Record<AdminTab, React.ElementType> = {
  dashboard: LayoutDashboard,
  analytics: BarChart3,
  menu: UtensilsCrossed,
  orders: ShoppingBag,
  users: Users,
  coupons: Ticket,
  reviews: Star,
  settings: Settings,
  uploads: UploadCloud,
  audit: ScrollText,
};

interface LiveStats {
  newPaidOrders: number;
  pendingReviews: number;
}

// ---- real-time push payloads (notify-service on :3003 via Caddy XTransformPort) ----
interface NewPaidPayload {
  orderNumber?: string;
  total?: number;
  userName?: string;
  type?: string;
}
interface NewReviewPayload {
  id?: string;
  itemName?: string;
  userName?: string;
  rating?: number;
}
interface StatusChangedPayload {
  orderNumber?: string;
  from?: string;
  to?: string;
}

const STATUS_LABELS_FA: Record<string, string> = {
  PENDING_PAYMENT: "در انتظار پرداخت",
  PAID: "پرداخت شده",
  PREPARING: "در حال آماده‌سازی",
  READY: "آماده تحویل",
  DELIVERING: "در مسیر ارسال",
  DELIVERED: "تحویل داده شد",
  CANCELED: "لغو شده",
  PAYMENT_FAILED: "خطا در پرداخت",
};

function statusFa(s?: string): string {
  if (!s) return "-";
  return STATUS_LABELS_FA[s] ?? s;
}

function refreshOrdersListIfVisible() {
  if (useAdminStore.getState().tab === "orders") {
    window.dispatchEvent(new CustomEvent("nk:refresh-orders"));
  }
}

export function AdminPanel() {
  const { admin, checked, checkAuth, tab, setTab, logout } = useAdminStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [live, setLive] = useState<LiveStats>({ newPaidOrders: 0, pendingReviews: 0 });
  const [socketConnected, setSocketConnected] = useState(false);
  const prevNewPaid = useRef(0);
  const firstPoll = useRef(true);
  const socketRef = useRef<Socket | null>(null);
  // true while the real-time push channel is up → polling becomes fallback-only
  const livePushRef = useRef(false);
  const pollRef = useRef<(() => Promise<void>) | null>(null);

  // ---- global Cmd+K search palette ----
  const [searchOpen, setSearchOpen] = useState(false);
  // searchNav holds the most recent selection from the palette. We use a
  // monotonically-increasing nonce in the React `key` prop of the affected
  // manager (OrdersManager / UsersManager / MenuManager) so that a fresh
  // selection remounts the manager with its `initialFilter` consumed once
  // on mount. A null searchNav means no navigation has happened yet.
  const [searchNav, setSearchNav] = useState<{
    tab: AdminTab;
    filter?: string;
    nonce: number;
  } | null>(null);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Global ⌘K / Ctrl+K shortcut — open the palette from anywhere in the
  // admin panel. preventDefault so the browser doesn't trap the combo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K" || e.key === "چ")) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Selection handler — switch tab + remember the filter so the newly-mounted
  // manager consumes it as its `initialFilter`.
  const handleSearchSelect = (sel: AdminSearchSelection) => {
    setSearchOpen(false);
    const tabForSel: AdminTab =
      sel.type === "order"
        ? "orders"
        : sel.type === "user"
          ? "users"
          : sel.type === "menu"
            ? "menu"
            : "coupons";
    setSearchNav({
      tab: tabForSel,
      filter: sel.filter,
      nonce: Date.now(),
    });
    setTab(tabForSel);
  };

  // socket connect/disconnect events keep `socketConnected` in sync — the
  // manual disconnect() on cleanup also fires the "disconnect" handler, so the
  // live pill can never go stale after logout → re-login.
  // (derived from pure state — no ref reads during render)
  const liveConnected = socketConnected;
  const pollIntervalMs = liveConnected ? 60_000 : 30_000;

  // live stats polling — fallback channel (every 30s; relaxed to 60s while the
  // WebSocket push connection is up)
  useEffect(() => {
    if (!admin) return;
    let active = true;
    const poll = async () => {
      const res = await api<{ stats: LiveStats }>("/api/admin/stats");
      if (active && res.success && res.stats) {
        const newPaid = res.stats.newPaidOrders ?? 0;
        const pendingReviews = res.stats.pendingReviews ?? 0;
        setLive({ newPaidOrders: newPaid, pendingReviews });
        if (
          !livePushRef.current &&
          !firstPoll.current &&
          newPaid > prevNewPaid.current &&
          newPaid > 0 &&
          useAdminStore.getState().tab !== "orders"
        ) {
          toast.success(`🛎 سفارش جدید پرداخت‌شده دارید! (${toPersianDigits(newPaid)})`);
        }
        prevNewPaid.current = newPaid;
        firstPoll.current = false;
      }
    };
    pollRef.current = poll;
    poll();
    const id = setInterval(poll, pollIntervalMs);
    return () => {
      active = false;
      clearInterval(id);
      pollRef.current = null;
    };
  }, [admin, pollIntervalMs]);

  // real-time channel — socket.io via the gateway (NEVER hardcode the port in
  // the URL, only the XTransformPort query — Caddy gateway rule)
  useEffect(() => {
    if (!admin) return;
    let active = true;

    const connect = async () => {
      // fetch the shared key (admin-only endpoint), then join the notify room
      const res = await api<{ key: string }>("/api/admin/notify-key");
      if (!active || !res.success || !res.key) return;
      // connectRealtime lazily imports socket.io-client (fully client-side, no SSR)
      const s = await connectRealtime();
      if (!active) return;

      socketRef.current = s;
      // set when the server rejects our key — stops the manual reconnect below
      // from looping forever on a misconfigured shared secret
      let keyRejected = false;

      s.on("connect", () => {
        if (!active) return;
        setSocketConnected(true);
        livePushRef.current = true;
        // re-join on every (re)connect — room membership is per-connection
        s.emit("admin-join", { key: res.key });
      });

      s.on("error: invalid key", () => {
        keyRejected = true;
        livePushRef.current = false;
        setSocketConnected(false);
        // stop reconnecting — fall back to polling notifications
        s.disconnect();
      });

      s.on("disconnect", (reason: string) => {
        livePushRef.current = false;
        setSocketConnected(false);
        // "io server disconnect" (server sent a disconnect packet) disables the
        // client's auto-reconnect — restart it manually so the panel never
        // silently stays offline
        if (reason === "io server disconnect" && !keyRejected) {
          s.connect();
        }
      });

      s.on("order:new-paid", (p: NewPaidPayload) => {
        if (!active) return;
        const total = Number(p?.total) || 0;
        const who = p?.userName ? p?.userName : "";
        const typeLabel =
          p?.type === "DELIVERY" ? "ارسال با پیک" : p?.type === "PICKUP" ? "تحویل حضوری" : "";
        toast.success(
          `🛎 سفارش جدید پرداخت‌شده: ${toPersianDigits(p?.orderNumber ?? "")} (${formatToman(total)})`,
          { description: [who, typeLabel].filter(Boolean).join(" — ") || undefined }
        );
        pollRef.current?.();
        refreshOrdersListIfVisible();
      });

      s.on("review:new-pending", (p: NewReviewPayload) => {
        if (!active) return;
        toast(`⭐ نظر جدید در انتظار تأیید: ${p?.itemName ?? ""}`, {
          description: `${p?.userName ?? "کاربر"} — امتیاز ${toPersianDigits(p?.rating ?? 0)} از ۵`,
          style: {
            background: "var(--gold)",
            color: "var(--gold-foreground)",
            border: "1px solid var(--gold)",
          },
        });
        pollRef.current?.();
      });

      s.on("order:status-changed", (p: StatusChangedPayload) => {
        if (!active) return;
        toast(`🔁 سفارش ${toPersianDigits(p?.orderNumber ?? "")} به «${statusFa(p?.to)}» تغییر کرد`, {
          description: `وضعیت قبلی: ${statusFa(p?.from)} — به‌روزرسانی لحظه‌ای`,
        });
        pollRef.current?.();
        refreshOrdersListIfVisible();
      });
    };

    void connect();

    return () => {
      active = false;
      const s = socketRef.current;
      if (s) {
        s.removeAllListeners();
        s.disconnect();
      }
      socketRef.current = null;
      livePushRef.current = false;
    };
  }, [admin]);

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-9 w-9 animate-spin text-primary" />
          <span className="text-sm font-bold">در حال بررسی دسترسی امن...</span>
        </div>
      </div>
    );
  }

  if (!admin) return <AdminLogin />;

  return (
    <div className="min-h-screen bg-muted/30" dir="rtl">
      {/* top bar */}
      <header className="sticky top-0 z-40 border-b bg-card/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              className="rounded-xl lg:hidden"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label="منو"
            >
              {sidebarOpen ? <X className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
            </Button>
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="leading-tight">
                <div className="text-sm font-black">پنل مدیریت نخل</div>
                <div className="text-[11px] text-muted-foreground">{admin.displayName} (@{admin.username})</div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Cmd+K search trigger — opens the global admin search palette */}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="group flex h-9 items-center gap-2 rounded-xl border border-gold/40 bg-gold/5 px-3 text-xs font-semibold text-gold-foreground transition hover:border-gold hover:bg-gold/10"
              aria-label="جستجوی سریع پنل مدیریت (⌘K)"
              title="جستجوی سریع (⌘K)"
            >
              <Search className="h-4 w-4 shrink-0" />
              <span className="hidden truncate sm:inline">جستجوی سریع...</span>
              <kbd className="mr-auto rounded border border-gold/40 bg-card px-1.5 py-0.5 font-mono text-[10px] font-bold text-gold-foreground">
                ⌘K
              </kbd>
            </button>
            {/* real-time connection indicator */}
            <div
              role="status"
              aria-live="polite"
              title={
                liveConnected
                  ? "اعلان‌های لحظه‌ای فعال است — سفارش‌ها و نظرات جدید بلافاصله اعلام می‌شوند"
                  : "اتصال لحظه‌ای قطع است — در حال تلاش برای اتصال مجدد؛ اعلان‌ها هر ۳۰ ثانیه بررسی می‌شوند"
              }
              className="flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1"
            >
              <span className="relative flex h-2 w-2" aria-hidden>
                {liveConnected && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                )}
                <span
                  className={`relative inline-flex h-2 w-2 rounded-full ${
                    liveConnected ? "bg-emerald-500" : "bg-muted-foreground/50"
                  }`}
                />
              </span>
              <span
                className={`hidden text-[10px] font-black sm:inline ${
                  liveConnected ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
                }`}
              >
                {liveConnected ? "اتصال زنده" : "قطع"}
              </span>
              <span className="sr-only">
                {liveConnected ? "اتصال زنده فعال است" : "اتصال لحظه‌ای قطع است"}
              </span>
            </div>
            <ThemeToggle />
            <Button asChild variant="outline" size="sm" className="rounded-xl text-xs">
              <Link href="/">
                <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                مشاهده سایت
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={logout}
              className="rounded-xl text-xs text-destructive hover:text-destructive"
            >
              <LogOut className="ml-1.5 h-3.5 w-3.5" />
              خروج
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-5 px-4 py-5">
        {/* sidebar */}
        <aside
          className={`${
            sidebarOpen ? "fixed inset-y-0 right-0 z-50 w-72 translate-x-0 pt-20 shadow-2xl" : "hidden"
          } shrink-0 lg:sticky lg:top-20 lg:block lg:h-fit lg:w-60 lg:translate-x-0 lg:pt-0 lg:shadow-none`}
        >
          <nav className="flex flex-col gap-1 rounded-2xl border bg-card p-2" aria-label="ناوبری پنل">
            {TABS.map((t) => {
              const Icon = TAB_ICONS[t.key];
              return (
                <button
                  key={t.key}
                  onClick={() => {
                    setTab(t.key);
                    setSidebarOpen(false);
                  }}
                  className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-bold transition ${
                    tab === t.key
                      ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                      : "text-foreground/75 hover:bg-accent"
                  }`}
                >
                  <Icon className="h-4.5 w-4.5" />
                  {t.label}
                  {t.key === "orders" && (
                    <span className="mr-auto flex items-center gap-1">
                      <Badge variant="secondary" className="text-[10px]">زنده</Badge>
                      {live.newPaidOrders > 0 && (
                        <Badge className="animate-pulse bg-red-500 text-[10px] font-black text-white">
                          {toPersianDigits(live.newPaidOrders)}
                        </Badge>
                      )}
                    </span>
                  )}
                  {t.key === "reviews" && live.pendingReviews > 0 && (
                    <Badge className="mr-auto bg-gold text-[10px] font-black text-gold-foreground">
                      {toPersianDigits(live.pendingReviews)}
                    </Badge>
                  )}
                </button>
              );
            })}
            <div className="mt-2 rounded-xl border border-dashed bg-muted/40 p-3 text-[10px] leading-5 text-muted-foreground">
              🌴 نسخه ۱.۰ — سامانه سفارش هوشمند رستوران نخل رفسنجان
            </div>
          </nav>
        </aside>
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} aria-hidden />
        )}

        {/* content */}
        <main className="min-w-0 flex-1">
          {tab === "dashboard" && <AdminDashboard />}
          {tab === "analytics" && <AnalyticsView />}
          {tab === "menu" && (
            <MenuManager
              key={searchNav?.tab === "menu" ? `menu-${searchNav.nonce}` : "menu"}
              initialFilter={searchNav?.tab === "menu" ? searchNav.filter : undefined}
            />
          )}
          {tab === "orders" && (
            <OrdersManager
              key={searchNav?.tab === "orders" ? `orders-${searchNav.nonce}` : "orders"}
              initialFilter={searchNav?.tab === "orders" ? searchNav.filter : undefined}
            />
          )}
          {tab === "users" && (
            <UsersManager
              key={searchNav?.tab === "users" ? `users-${searchNav.nonce}` : "users"}
              initialFilter={searchNav?.tab === "users" ? searchNav.filter : undefined}
            />
          )}
          {tab === "coupons" && <CouponsManager />}
          {tab === "reviews" && <ReviewsManager />}
          {tab === "settings" && <AdminSettings />}
          {tab === "uploads" && <UploadsManager />}
          {tab === "audit" && <AuditLogView />}
        </main>
      </div>

      {/* global Cmd+K / Ctrl+K search palette — mounts once and is toggled by
          `searchOpen`. onSelect switches tabs + seeds the destination
          manager's `initialFilter` via `searchNav`. */}
      <AdminSearchPalette
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={handleSearchSelect}
      />
    </div>
  );
}
