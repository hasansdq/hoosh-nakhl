"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Command } from "cmdk";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { api } from "@/lib/client-api";
import { formatPhone, formatToman, timeAgo, toPersianDigits } from "@/lib/fa";
import {
  Search,
  Loader2,
  ShoppingBag,
  Users,
  UtensilsCrossed,
  Ticket,
  X,
  Clock,
  CornerDownLeft,
  ArrowUpDown,
} from "lucide-react";

// ============ Types ============

export type AdminSearchType = "order" | "user" | "menu" | "coupon";

export interface AdminSearchSelection {
  type: AdminSearchType;
  id: string;
  /** Optional display label for the picked row (e.g. NK-XXXX, phone, name). */
  label?: string;
  /** Pre-fill the destination manager's search box with this string. */
  filter?: string;
}

interface AdminSearchPaletteProps {
  open: boolean;
  onClose: () => void;
  onSelect: (sel: AdminSearchSelection) => void;
}

interface OrderResult {
  type: "order";
  id: string;
  orderNumber: string;
  userName: string;
  total: number;
  status: string;
  paymentStatus: string;
  createdAt: string;
}
interface UserResult {
  type: "user";
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string;
  createdAt: string;
}
interface MenuResult {
  type: "menu";
  id: string;
  name: string;
  price: number;
  isAvailable: boolean;
  isSpecial: boolean;
  imageUrl: string | null;
}
interface CouponResult {
  type: "coupon";
  id: string;
  code: string;
  title: string;
  couponType: string;
  value: number;
  isActive: boolean;
}

interface SearchResults {
  orders: OrderResult[];
  users: UserResult[];
  menuItems: MenuResult[];
  coupons: CouponResult[];
}

const EMPTY_RESULTS: SearchResults = {
  orders: [],
  users: [],
  menuItems: [],
  coupons: [],
};

// ============ Localized status maps ============

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

const PAYMENT_LABELS_FA: Record<string, string> = {
  PENDING: "در انتظار",
  PAID: "پرداخت‌شده",
  FAILED: "ناموفق",
};

// ============ Constants ============

const RECENT_KEY = "nakhl-admin-recent-searches";
const RECENT_MAX = 6;
const DEBOUNCE_MS = 200;
const MIN_QUERY = 2;

// ============ Component ============

export function AdminSearchPalette({ open, onClose, onSelect }: AdminSearchPaletteProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // monotonically-increasing request id — discards stale responses
  const reqIdRef = useRef(0);

  // ---------- lifecycle ----------

  // Load recent searches from localStorage whenever the palette opens.
  useEffect(() => {
    if (!open) return;
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot hydration of recent searches from localStorage when the palette opens
          setRecent(parsed.filter((r) => typeof r === "string").slice(0, RECENT_MAX));
        }
      }
    } catch {
      // ignore — corrupt localStorage entry
    }
  }, [open]);

  // Focus the input on open; reset everything on close.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset palette state on close
    setQuery("");
    setResults(EMPTY_RESULTS);
    setLoading(false);
  }, [open]);

  // ---------- search ----------

  const runSearch = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (q.length < MIN_QUERY) {
       
      setResults(EMPTY_RESULTS);
      setLoading(false);
      return;
    }
    const id = ++reqIdRef.current;
    setLoading(true);
    const res = await api<{ results: SearchResults }>(
      `/api/admin/search?q=${encodeURIComponent(q)}`
    );
    // discard if a newer search superseded this one
    if (id !== reqIdRef.current) return;
    setLoading(false);
    if (res.success && res.results) {
      setResults(res.results);
    } else {
      setResults(EMPTY_RESULTS);
    }
  }, []);

  // Debounced search trigger.
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < MIN_QUERY) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear results when query shrinks below the minimum length
      setResults(EMPTY_RESULTS);
      setLoading(false);
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(query), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, runSearch]);

  // ---------- helpers ----------

  const totalResults =
    results.orders.length +
    results.users.length +
    results.menuItems.length +
    results.coupons.length;

  const showRecent = query.trim().length < MIN_QUERY;

  const pushRecent = (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < MIN_QUERY) return;
    try {
      const next = [trimmed, ...recent.filter((r) => r !== trimmed)].slice(0, RECENT_MAX);
      setRecent(next);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // localStorage might be unavailable (private mode) — fail silently
    }
  };

  const handleSelect = (sel: AdminSearchSelection) => {
    if (query.trim().length >= MIN_QUERY) pushRecent(query);
    onSelect(sel);
  };

  const runRecent = (q: string) => {
    setQuery(q);
    void runSearch(q);
  };

  // ---------- render ----------

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="fixed top-[10vh] left-1/2 z-50 flex w-[calc(100%-1.5rem)] max-w-2xl -translate-x-1/2 translate-y-0 flex-col gap-0 overflow-hidden rounded-2xl border border-primary/20 bg-card p-0 shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 duration-200"
      >
        <DialogTitle className="sr-only">جستجوی سریع پنل مدیریت نخل</DialogTitle>
        <Command
          shouldFilter={false}
          loop
          className="flex flex-col"
        >
          {/* input row */}
          <div className="relative flex items-center border-b border-border bg-card">
            <Search className="pointer-events-none absolute right-4 h-5 w-5 text-muted-foreground" />
            <Command.Input
              ref={inputRef}
              value={query}
              onValueChange={setQuery}
              placeholder="جستجوی سفارش‌ها، کاربران، منو، کدهای تخفیف... (⌘K)"
              className="h-12 w-full border-0 bg-transparent pr-12 pl-12 text-base text-foreground placeholder:text-sm placeholder:text-muted-foreground focus:outline-none"
            />
            {loading ? (
              <Loader2 className="absolute left-4 h-4 w-4 animate-spin text-primary" />
            ) : query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                className="absolute left-3 flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label="پاک کردن جستجو"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          {/* list */}
          <Command.List
            className="nice-scroll max-h-[60vh] overflow-y-auto"
            aria-label="نتایج جستجوی پنل مدیریت"
          >
            {/* ---- empty query: recent searches / hint ---- */}
            {showRecent && (
              <>
                {recent.length > 0 ? (
                  <div className="p-3">
                    <div className="mb-2 flex items-center gap-1.5 px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      دیگر جستجو کرده‌اید
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {recent.map((r, i) => (
                        <button
                          key={`${r}-${i}`}
                          onClick={() => runRecent(r)}
                          className="rounded-full border bg-muted/40 px-3 py-1.5 text-xs font-semibold text-foreground transition hover:border-primary/40 hover:bg-primary/10"
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="p-10 text-center">
                    <Search className="mx-auto mb-3 h-9 w-9 text-muted-foreground/40" />
                    <p className="text-sm font-bold text-muted-foreground">
                      جستجوی سفارش با شماره یا نام مشتری
                    </p>
                    <p className="mt-2 text-xs leading-6 text-muted-foreground">
                      با تایپ نام غذا، نام مشتری، شماره سفارش یا کد تخفیف نتیجه را ببینید
                      <br />
                      با فشردن <kbd className="rounded border bg-muted px-1 text-[10px]">⌘K</kbd> (یا{" "}
                      <kbd className="rounded border bg-muted px-1 text-[10px]">Ctrl+K</kbd>) در هر زمان
                      این پنجره را باز کنید
                    </p>
                  </div>
                )}
              </>
            )}

            {/* ---- results ---- */}
            {!showRecent && (
              <>
                {totalResults === 0 && !loading && (
                  <Command.Empty className="p-10 text-center text-sm text-muted-foreground">
                    نتیجه‌ای برای «{query}» یافت نشد
                  </Command.Empty>
                )}

                {results.orders.length > 0 && (
                  <Command.Group
                    heading={
                      <SectionHeading
                        icon={ShoppingBag}
                        label="سفارش‌ها"
                        count={results.orders.length}
                      />
                    }
                  >
                    {results.orders.map((o) => (
                      <Command.Item
                        key={`o-${o.id}`}
                        value={`order:${o.id}:${o.orderNumber}`}
                        onSelect={() =>
                          handleSelect({
                            type: "order",
                            id: o.id,
                            label: o.orderNumber,
                            filter: o.orderNumber,
                          })
                        }
                        className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-right transition-colors hover:bg-primary/10 data-[selected=true]:bg-primary/15 data-[selected=true]:ring-1 data-[selected=true]:ring-primary/20"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <ShoppingBag className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 text-sm font-bold">
                              <span dir="ltr">{toPersianDigits(o.orderNumber)}</span>
                              <span className="text-[10px] font-semibold text-muted-foreground">کد سفارش</span>
                            </div>
                            <div className="mt-0.5 text-[11px] text-muted-foreground">
                              مشتری: {o.userName} • {timeAgo(o.createdAt)}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="secondary" className="text-[10px]">
                            {PAYMENT_LABELS_FA[o.paymentStatus] ?? o.paymentStatus}
                          </Badge>
                          <Badge className="text-[10px]">
                            {STATUS_LABELS_FA[o.status] ?? o.status}
                          </Badge>
                          <span className="text-xs font-black text-primary">
                            {formatToman(o.total)}
                          </span>
                        </div>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {results.users.length > 0 && (
                  <Command.Group
                    heading={
                      <SectionHeading
                        icon={Users}
                        label="کاربران"
                        count={results.users.length}
                      />
                    }
                  >
                    {results.users.map((u) => {
                      const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "بدون نام";
                      return (
                        <Command.Item
                          key={`u-${u.id}`}
                          value={`user:${u.id}:${u.phone}`}
                          onSelect={() =>
                            handleSelect({
                              type: "user",
                              id: u.id,
                              label: name,
                              filter: u.phone,
                            })
                          }
                          className="flex items-center gap-2.5 px-4 py-2.5 text-right transition-colors hover:bg-primary/10 data-[selected=true]:bg-primary/15 data-[selected=true]:ring-1 data-[selected=true]:ring-primary/20"
                        >
                          <Avatar className="h-8 w-8 border">
                            <AvatarFallback className="bg-primary/10 text-[10px] font-black text-primary">
                              {(u.firstName ?? "ن")[0]}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1">
                            <div className="text-sm font-bold">{name}</div>
                            <div
                              className="mt-0.5 text-[11px] text-muted-foreground"
                              dir="ltr"
                            >
                              {formatPhone(u.phone)}
                            </div>
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            {timeAgo(u.createdAt)}
                          </span>
                        </Command.Item>
                      );
                    })}
                  </Command.Group>
                )}

                {results.menuItems.length > 0 && (
                  <Command.Group
                    heading={
                      <SectionHeading
                        icon={UtensilsCrossed}
                        label="منو"
                        count={results.menuItems.length}
                      />
                    }
                  >
                    {results.menuItems.map((m) => (
                      <Command.Item
                        key={`m-${m.id}`}
                        value={`menu:${m.id}:${m.name}`}
                        onSelect={() =>
                          handleSelect({
                            type: "menu",
                            id: m.id,
                            label: m.name,
                            filter: m.name,
                          })
                        }
                        className="flex items-center gap-2.5 px-4 py-2.5 text-right transition-colors hover:bg-primary/10 data-[selected=true]:bg-primary/15 data-[selected=true]:ring-1 data-[selected=true]:ring-primary/20"
                      >
                        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-muted">
                          {m.imageUrl ? (
                            <Image
                              src={m.imageUrl}
                              alt={m.name}
                              fill
                              sizes="40px"
                              className="object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-lg">🍽</div>
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 text-sm font-bold">
                            {m.name}
                            {!m.isAvailable && (
                              <Badge variant="destructive" className="text-[10px]">
                                ناموجود
                              </Badge>
                            )}
                            {m.isSpecial && (
                              <Badge className="bg-gold text-[10px] text-white">ویژه</Badge>
                            )}
                          </div>
                        </div>
                        <span className="text-xs font-black text-primary">
                          {formatToman(m.price)}
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {results.coupons.length > 0 && (
                  <Command.Group
                    heading={
                      <SectionHeading
                        icon={Ticket}
                        label="کدهای تخفیف"
                        count={results.coupons.length}
                      />
                    }
                  >
                    {results.coupons.map((c) => (
                      <Command.Item
                        key={`c-${c.id}`}
                        value={`coupon:${c.id}:${c.code}`}
                        onSelect={() =>
                          handleSelect({
                            type: "coupon",
                            id: c.id,
                            label: c.code,
                            filter: c.code,
                          })
                        }
                        className="flex items-center gap-2.5 px-4 py-2.5 text-right transition-colors hover:bg-primary/10 data-[selected=true]:bg-primary/15 data-[selected=true]:ring-1 data-[selected=true]:ring-primary/20"
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold/15 text-gold-foreground">
                          <Ticket className="h-4 w-4" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className="rounded-lg border border-dashed border-gold/40 bg-gold/5 px-2 py-0.5 font-mono text-xs font-black tracking-wider"
                              dir="ltr"
                            >
                              {toPersianDigits(c.code)}
                            </span>
                            <span className="text-sm font-bold">{c.title}</span>
                            {!c.isActive && (
                              <Badge variant="secondary" className="text-[10px]">
                                غیرفعال
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Badge className="bg-gold text-[10px] text-gold-foreground">
                          {c.couponType === "PERCENT"
                            ? `${toPersianDigits(c.value)}٪`
                            : formatToman(c.value)}
                        </Badge>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
              </>
            )}
          </Command.List>

          {/* footer */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-3 py-2 text-[10px] text-muted-foreground">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1 rounded bg-card px-1.5 py-0.5">
                <ArrowUpDown className="h-3 w-3" />
                انتخاب
              </span>
              <span className="flex items-center gap-1 rounded bg-card px-1.5 py-0.5">
                <CornerDownLeft className="h-3 w-3" />
                رفتن
              </span>
              <span className="flex items-center gap-1 rounded bg-card px-1.5 py-0.5">
                <kbd>Esc</kbd> بستن
              </span>
            </div>
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-card px-1.5 py-0.5">⌘K</kbd>
              باز کردن
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

// ============ Section heading ============

function SectionHeading({
  icon: Icon,
  label,
  count,
}: {
  icon: React.ElementType;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-1.5 px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
      <Icon className="h-3.5 w-3.5" />
      {label}
      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-black text-foreground/70">
        {toPersianDigits(count)}
      </span>
    </div>
  );
}
