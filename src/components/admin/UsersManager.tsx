"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { formatToman, formatJalali, toPersianDigits, formatPhone, timeAgo } from "@/lib/fa";
import { Users, Search, ChevronLeft, Ban, CheckCircle2, Mail, Phone, Calendar, ShoppingBag } from "lucide-react";
import { toast } from "sonner";

interface UserRow {
  id: string;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  nationalId: string | null;
  email: string | null;
  birthDate: string | null;
  gender: string | null;
  avatarUrl: string | null;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  ordersCount: number;
  totalSpent: number;
}

interface UserDetail extends UserRow {
  note: string | null;
  orders: { orderNumber: string; status: string; total: number; paymentStatus: string; createdAt: string }[];
  addresses: { id: string; title: string; fullAddress: string; isDefault: boolean }[];
}

export function UsersManager({ initialFilter }: { initialFilter?: string } = {}) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  // skip the existing [page] effect on first render — the mount effect
  // handles the initial load (with optional initialFilter from the global
  // Cmd+K search palette) so we don't double-fetch on mount.
  const firstRender = useRef(true);

  const load = useCallback(
    async (p = 1, opts?: { search?: string }) => {
      const q = opts?.search ?? search;
      setLoading(true);
      const res = await api<{ users: UserRow[]; pagination: { pages: number } }>(
        `/api/admin/users?page=${p}&q=${encodeURIComponent(q)}`
      );
      if (res.success) {
        setUsers(res.users ?? []);
        setPages(res.pagination?.pages ?? 1);
      }
      setLoading(false);
    },
    [search]
  );

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetching (matches original UsersManager pattern)
    load(page);
  }, [page]);

  // Mount: if an initial filter is supplied by the Cmd+K palette (e.g. a
  // user's phone number picked from search results), seed the search box
  // with it and trigger an immediate filtered fetch.
  useEffect(() => {
    if (initialFilter) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- seed search box from Cmd+K palette selection
      setSearch(initialFilter);
      load(1, { search: initialFilter });
    } else {
      load(1);
    }
  }, []);

  const openDetail = async (u: UserRow) => {
    const res = await api<{ user: UserDetail }>(`/api/admin/users/${u.id}`);
    if (res.success) setDetail(res.user ?? null);
  };

  const toggleBlock = async (u: UserRow | UserDetail) => {
    const newStatus = u.status === "BLOCKED" ? "ACTIVE" : "BLOCKED";
    const res = await api(`/api/admin/users/${u.id}`, { method: "PUT", body: { status: newStatus } });
    if (!res.success) return toast.error(res.error ?? "خطا");
    toast.success(newStatus === "BLOCKED" ? "کاربر مسدود شد 🚫" : "کاربر آزاد شد ✅");
    setDetail(null);
    load(page);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-black">
          <Users className="h-6 w-6 text-primary" />
          مدیریت کاربران
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          مشاهده پروفایل، تاریخچه سفارش و مدیریت دسترسی کاربران — با حفظ حریم خصوصی
        </p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          onKeyDown={(e) => e.key === "Enter" && load(1)}
          placeholder="جستجو: نام، نام خانوادگی یا موبایل..."
          className="rounded-xl pr-9"
        />
      </div>

      <Card className="overflow-hidden rounded-2xl p-0">
        {loading ? (
          <div className="space-y-2 p-4">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : users.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">کاربری یافت نشد</div>
        ) : (
          <div className="divide-y">
            {users.map((u) => (
              <button
                key={u.id}
                onClick={() => openDetail(u)}
                className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-right transition hover:bg-muted/40"
              >
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10 border">
                    {u.avatarUrl ? <AvatarImage src={u.avatarUrl} alt="" /> : null}
                    <AvatarFallback className="bg-primary/10 text-xs font-black text-primary">
                      {(u.firstName ?? "ن")[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="flex items-center gap-2 text-sm font-bold">
                      {`${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "بدون نام"}
                      {u.status === "BLOCKED" && (
                        <Badge variant="destructive" className="text-[10px]">مسدود</Badge>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span dir="ltr">{formatPhone(u.phone)}</span>
                      <span>•</span>
                      <span>{toPersianDigits(u.ordersCount)} سفارش</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-left">
                    <div className="text-sm font-black text-primary">{formatToman(u.totalSpent)}</div>
                    <div className="text-[10px] text-muted-foreground">مجموع خرید</div>
                  </div>
                  <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-xl">
            قبلی
          </Button>
          <span className="text-sm font-bold">
            صفحه {toPersianDigits(page)} از {toPersianDigits(pages)}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-xl">
            بعدی
          </Button>
        </div>
      )}

      {/* user detail */}
      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto rounded-2xl" aria-describedby={undefined}>
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <Avatar className="h-12 w-12 border">
                    {detail.avatarUrl ? <AvatarImage src={detail.avatarUrl} alt="" /> : null}
                    <AvatarFallback className="bg-primary/10 font-black text-primary">
                      {(detail.firstName ?? "ن")[0]}
                    </AvatarFallback>
                  </Avatar>
                  {`${detail.firstName ?? ""} ${detail.lastName ?? ""}`.trim() || "کاربر نخل"}
                </DialogTitle>
                <DialogDescription>مشاهده و مدیریت حساب کاربر</DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <InfoBox icon={Phone} label="موبایل" value={formatPhone(detail.phone)} ltr />
                  <InfoBox icon={Mail} label="ایمیل" value={detail.email ?? "—"} ltr />
                  <InfoBox
                    icon={Calendar}
                    label="تاریخ تولد"
                    value={detail.birthDate ? formatJalali(detail.birthDate) : "—"}
                  />
                  <InfoBox icon={Calendar} label="عضویت" value={formatJalali(detail.createdAt)} />
                  {detail.nationalId && (
                    <InfoBox icon={Users} label="کد ملی" value={toPersianDigits(detail.nationalId)} />
                  )}
                  <InfoBox
                    icon={ShoppingBag}
                    label="آخرین ورود"
                    value={detail.lastLoginAt ? timeAgo(detail.lastLoginAt) : "—"}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-primary/5 p-3 text-center">
                    <div className="text-lg font-black text-primary">{toPersianDigits(detail.ordersCount)}</div>
                    <div className="text-[11px] text-muted-foreground">کل سفارش‌ها</div>
                  </div>
                  <div className="rounded-xl bg-gold/10 p-3 text-center">
                    <div className="text-lg font-black text-gold-foreground">{formatToman(detail.totalSpent)}</div>
                    <div className="text-[11px] text-muted-foreground">مجموع خرید موفق</div>
                  </div>
                </div>

                {/* orders */}
                {detail.orders?.length > 0 && (
                  <div>
                    <div className="mb-2 text-xs font-bold text-muted-foreground">آخرین سفارش‌ها</div>
                    <div className="space-y-1.5">
                      {detail.orders.slice(0, 6).map((o) => (
                        <div key={o.orderNumber} className="flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2 text-xs">
                          <span dir="ltr" className="font-bold">{o.orderNumber}</span>
                          <span className="text-muted-foreground">{timeAgo(o.createdAt)}</span>
                          <span className="font-black text-primary">{formatToman(o.total)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* addresses */}
                {detail.addresses?.length > 0 && (
                  <div>
                    <div className="mb-2 text-xs font-bold text-muted-foreground">آدرس‌های ذخیره‌شده</div>
                    <div className="space-y-1.5">
                      {detail.addresses.map((a) => (
                        <div key={a.id} className="rounded-xl bg-muted/50 px-3 py-2 text-xs leading-5">
                          <b>{a.title}:</b> {a.fullAddress}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <Button
                  onClick={() => toggleBlock(detail)}
                  variant={detail.status === "BLOCKED" ? "outline" : "destructive"}
                  className="w-full rounded-xl font-bold"
                >
                  {detail.status === "BLOCKED" ? (
                    <>
                      <CheckCircle2 className="ml-2 h-4 w-4" /> رفع مسدودی کاربر
                    </>
                  ) : (
                    <>
                      <Ban className="ml-2 h-4 w-4" /> مسدودسازی کاربر (اخراج از سامانه)
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoBox({ icon: Icon, label, value, ltr }: { icon: React.ElementType; label: string; value: string; ltr?: boolean }) {
  return (
    <div className="rounded-xl border px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-0.5 truncate text-xs font-bold" dir={ltr ? "ltr" : "rtl"}>
        {value}
      </div>
    </div>
  );
}
