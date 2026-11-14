"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { formatToman, formatJalali, toPersianDigits, formatPhone, timeAgo } from "@/lib/fa";
import {
  Users, Search, ChevronLeft, Ban, CheckCircle2, Mail, Phone, Calendar, ShoppingBag,
  MapPin, Star, MessageCircle, Heart, FileText, Save, ShieldCheck, Wallet,
  TrendingUp, ClipboardList, Loader2,
} from "lucide-react";
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
  role: string;
  lastLoginAt: string | null;
  createdAt: string;
  ordersCount: number;
  totalSpent: number;
}

interface UserDetailOrder {
  orderNumber: string;
  status: string;
  type: string;
  total: number;
  paymentStatus: string;
  paymentRef: string | null;
  createdAt: string;
  baranFactorNumber: number | null;
  baranSentAt: string | null;
}

interface UserDetail {
  id: string;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  nationalId: string | null;
  email: string | null;
  birthDate: string | null;
  gender: string | null;
  avatarUrl: string | null;
  role: string;
  status: string;
  note: string | null;
  baranCustomerId: number | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  stats: {
    ordersCount: number;
    paidOrdersCount: number;
    canceledOrdersCount: number;
    totalSpent: number;
    avgOrder: number;
    firstOrderAt: string | null;
    lastOrderAt: string | null;
    favoritesCount: number;
    chatSessionsCount: number;
    reviewCount: number;
    avgRatingGiven: number | null;
  };
  orders: UserDetailOrder[];
  addresses: { id: string; title: string; fullAddress: string; postalCode: string | null; isDefault: boolean }[];
  recentReviews: { id: string; rating: number; comment: string | null; status: string; menuItemName: string; createdAt: string }[];
}

const GENDER_LABELS: Record<string, string> = { MALE: "مرد", FEMALE: "زن", OTHER: "سایر" };

const ORDER_STATUS_CHIPS: Record<string, string> = {
  PENDING_PAYMENT: "bg-amber-500/10 text-amber-600",
  PAID: "bg-emerald-500/10 text-emerald-600",
  PREPARING: "bg-sky-500/10 text-sky-600",
  READY: "bg-violet-500/10 text-violet-600",
  DELIVERING: "bg-blue-500/10 text-blue-600",
  DELIVERED: "bg-emerald-600/10 text-emerald-700",
  CANCELED: "bg-red-500/10 text-red-600",
  PAYMENT_FAILED: "bg-red-500/10 text-red-600",
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT: "در انتظار پرداخت",
  PAID: "پرداخت شده",
  PREPARING: "در حال آماده‌سازی",
  READY: "آماده تحویل",
  DELIVERING: "در مسیر ارسال",
  DELIVERED: "تحویل شده",
  CANCELED: "لغو شده",
  PAYMENT_FAILED: "خطای پرداخت",
};

export function UsersManager({ initialFilter }: { initialFilter?: string } = {}) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
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
    setDetailLoading(true);
    setDetail(null);
    const res = await api<{ user: UserDetail }>(`/api/admin/users/${u.id}`);
    setDetailLoading(false);
    if (res.success) {
      setDetail(res.user ?? null);
    } else {
      toast.error(res.error ?? "خطا در بارگذاری اطلاعات کاربر");
    }
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
          پروفایل کامل، سوابق سفارش و عملکرد و مدیریت دسترسی کاربران — با حفظ حریم خصوصی
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
                      {u.role === "ADMIN" && (
                        <Badge variant="outline" className="border-primary/40 text-[10px] text-primary">مدیر</Badge>
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

      {/* ---- user dossier dialog ---- */}
      <Dialog open={!!detail || detailLoading} onOpenChange={(open) => !open && (setDetail(null), setDetailLoading(false))}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto rounded-2xl" aria-describedby={undefined}>
          {detailLoading && (
            <div className="space-y-3 py-6">
              <DialogTitle className="sr-only">در حال بارگذاری پرونده کاربر…</DialogTitle>
              <Skeleton className="mx-auto h-16 w-16 rounded-full" />
              <Skeleton className="mx-auto h-5 w-40" />
              <div className="grid grid-cols-2 gap-2 pt-2">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
              </div>
              <Skeleton className="h-32 rounded-xl" />
            </div>
          )}
          {detail && (
            <UserDossier detail={detail} onToggleBlock={() => toggleBlock(detail)} onSaved={(note) => setDetail({ ...detail, note })} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Full user dossier — profile metadata + performance history + admin tools */
function UserDossier({
  detail,
  onToggleBlock,
  onSaved,
}: {
  detail: UserDetail;
  onToggleBlock: () => void;
  onSaved: (note: string) => void;
}) {
  const [noteDraft, setNoteDraft] = useState(detail.note ?? "");
  const [savingNote, setSavingNote] = useState(false);
  const fullName = `${detail.firstName ?? ""} ${detail.lastName ?? ""}`.trim() || "کاربر نخل";
  const s = detail.stats;

  const saveNote = async () => {
    setSavingNote(true);
    const res = await api(`/api/admin/users/${detail.id}`, { method: "PUT", body: { note: noteDraft } });
    setSavingNote(false);
    if (!res.success) return toast.error(res.error ?? "خطا");
    toast.success("یادداشت مدیر ذخیره شد ✅");
    onSaved(noteDraft);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-3">
          <Avatar className="h-14 w-14 border">
            {detail.avatarUrl ? <AvatarImage src={detail.avatarUrl} alt="" /> : null}
            <AvatarFallback className="bg-primary/10 text-lg font-black text-primary">
              {(detail.firstName ?? "ن")[0]}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              {fullName}
              {detail.status === "BLOCKED" ? (
                <Badge variant="destructive" className="text-[10px]">مسدود</Badge>
              ) : (
                <Badge className="bg-emerald-500/10 text-[10px] text-emerald-600 hover:bg-emerald-500/10">فعال</Badge>
              )}
              {detail.role === "ADMIN" && (
                <Badge variant="outline" className="border-primary/40 text-[10px] text-primary">مدیر سیستم</Badge>
              )}
            </div>
            <div className="mt-0.5 text-xs font-normal text-muted-foreground">
              پرونده مشتری — متادیتا و سوابق عملکرد
            </div>
          </div>
        </DialogTitle>
        <DialogDescription className="sr-only">مشاهده و مدیریت حساب کاربر</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {/* contact + identity metadata */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <InfoBox icon={Phone} label="موبایل" value={formatPhone(detail.phone)} ltr copyable />
          <InfoBox icon={Mail} label="ایمیل" value={detail.email ?? "—"} ltr />
          <InfoBox
            icon={Calendar}
            label="تاریخ تولد"
            value={detail.birthDate ? formatJalali(detail.birthDate) : "—"}
          />
          <InfoBox icon={Calendar} label="عضویت" value={formatJalali(detail.createdAt)} />
          {detail.nationalId && (
            <InfoBox icon={ShieldCheck} label="کد ملی" value={toPersianDigits(detail.nationalId)} />
          )}
          <InfoBox
            icon={Users}
            label="جنسیت"
            value={detail.gender ? GENDER_LABELS[detail.gender] ?? detail.gender : "—"}
          />
          <InfoBox
            icon={ShoppingBag}
            label="آخرین ورود"
            value={detail.lastLoginAt ? `${timeAgo(detail.lastLoginAt)}` : "—"}
          />
          {detail.baranCustomerId != null && (
            <InfoBox
              icon={FileText}
              label="شناسه باران"
              value={toPersianDigits(detail.baranCustomerId)}
              ltr
            />
          )}
        </div>

        {/* performance stats */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatChip icon={ClipboardList} label="کل سفارش‌ها" value={toPersianDigits(s.ordersCount)} sub={`${toPersianDigits(s.paidOrdersCount)} پرداخت‌شده${s.canceledOrdersCount ? ` · ${toPersianDigits(s.canceledOrdersCount)} لغو` : ""}`} />
          <StatChip icon={Wallet} label="مجموع خرید" value={formatToman(s.totalSpent)} tone="primary" />
          <StatChip icon={TrendingUp} label="میانگین سفارش" value={formatToman(s.avgOrder)} />
          <StatChip
            icon={Star}
            label="امتیاز داده‌شده"
            value={s.avgRatingGiven != null ? `${toPersianDigits(s.avgRatingGiven)} از ۵` : "—"}
            sub={s.reviewCount ? `${toPersianDigits(s.reviewCount)} نظر ثبت‌شده` : undefined}
          />
        </div>
        <div className="grid grid-cols-3 gap-2 text-[11px]">
          <div className="flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-muted-foreground">
            <MessageCircle className="h-3.5 w-3.5 text-primary" />
            گفتگو با هوش نخل: <b className="text-foreground">{toPersianDigits(s.chatSessionsCount)}</b>
          </div>
          <div className="flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-muted-foreground">
            <Heart className="h-3.5 w-3.5 text-red-400" />
            علاقه‌مندی‌ها: <b className="text-foreground">{toPersianDigits(s.favoritesCount)}</b>
          </div>
          <div className="flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 text-gold-foreground" />
            آدرس‌ها: <b className="text-foreground">{toPersianDigits(detail.addresses.length)}</b>
          </div>
        </div>
        {(s.firstOrderAt || s.lastOrderAt) && (
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 rounded-xl bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
            {s.firstOrderAt && <span>اولین سفارش: <b className="text-foreground">{formatJalali(s.firstOrderAt)}</b></span>}
            {s.lastOrderAt && <span>آخرین سفارش: <b className="text-foreground">{formatJalali(s.lastOrderAt, true)}</b></span>}
          </div>
        )}

        {/* activity tabs */}
        <Tabs defaultValue="orders">
          <TabsList className="w-full rounded-xl">
            <TabsTrigger value="orders" className="flex-1 rounded-lg text-xs">سفارش‌ها ({toPersianDigits(s.ordersCount)})</TabsTrigger>
            <TabsTrigger value="addresses" className="flex-1 rounded-lg text-xs">آدرس‌ها ({toPersianDigits(detail.addresses.length)})</TabsTrigger>
            <TabsTrigger value="reviews" className="flex-1 rounded-lg text-xs">نظرها ({toPersianDigits(s.reviewCount)})</TabsTrigger>
          </TabsList>

          <TabsContent value="orders" className="mt-2">
            {detail.orders.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
                این کاربر هنوز سفارشی ثبت نکرده است
              </div>
            ) : (
              <div className="max-h-72 space-y-1.5 overflow-y-auto pl-1">
                {detail.orders.map((o) => (
                  <div key={o.orderNumber} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/50 px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span dir="ltr" className="font-bold">{o.orderNumber}</span>
                      <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${ORDER_STATUS_CHIPS[o.status] ?? "bg-muted text-muted-foreground"}`}>
                        {ORDER_STATUS_LABELS[o.status] ?? o.status}
                      </span>
                      {o.type === "PICKUP" && (
                        <span className="rounded-md bg-gold/15 px-1.5 py-0.5 text-[10px] text-gold-foreground">بیرونبر</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-muted-foreground">
                      {o.baranFactorNumber != null && (
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-[10px] ${o.baranSentAt ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"}`}
                          title={o.baranSentAt ? `ثبت‌شده در باران — فاکتور ${o.baranFactorNumber}` : `در صف ارسال به باران — فاکتور ${o.baranFactorNumber}`}
                        >
                          باران: {toPersianDigits(o.baranFactorNumber)}
                        </span>
                      )}
                      <span title={formatJalali(o.createdAt, true)}>{timeAgo(o.createdAt)}</span>
                      <span className="font-black text-primary">{formatToman(o.total)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="addresses" className="mt-2">
            {detail.addresses.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
                آدرسی ذخیره نشده است
              </div>
            ) : (
              <div className="space-y-1.5">
                {detail.addresses.map((a) => (
                  <div key={a.id} className="rounded-xl bg-muted/50 px-3 py-2 text-xs leading-5">
                    <div className="flex items-center justify-between">
                      <b className="text-primary">{a.title}</b>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        {a.postalCode && <span dir="ltr">کدپستی {toPersianDigits(a.postalCode)}</span>}
                        {a.isDefault && <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600">پیش‌فرض</span>}
                      </div>
                    </div>
                    <div className="mt-0.5">{a.fullAddress}</div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="reviews" className="mt-2">
            {detail.recentReviews.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
                نظری ثبت نکرده است
              </div>
            ) : (
              <div className="space-y-1.5">
                {detail.recentReviews.map((r) => (
                  <div key={r.id} className="rounded-xl bg-muted/50 px-3 py-2 text-xs leading-5">
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <b>{r.menuItemName}</b>
                      <span className="flex items-center gap-1 text-gold-foreground">
                        {[...Array(5)].map((_, i) => (
                          <Star key={i} className={`h-3 w-3 ${i < r.rating ? "fill-current" : "opacity-25"}`} />
                        ))}
                      </span>
                    </div>
                    {r.comment && <div className="mt-0.5 text-muted-foreground">«{r.comment}»</div>}
                    <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>{formatJalali(r.createdAt)}</span>
                      <span className={`rounded-md px-1.5 py-0.5 ${
                        r.status === "APPROVED" ? "bg-emerald-500/10 text-emerald-600"
                        : r.status === "REJECTED" ? "bg-red-500/10 text-red-600"
                        : "bg-amber-500/10 text-amber-600"
                      }`}>
                        {r.status === "APPROVED" ? "تأییدشده" : r.status === "REJECTED" ? "ردشده" : "در انتظار بررسی"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* admin note */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
              <FileText className="h-3.5 w-3.5" />
              یادداشت مدیر (داخلی — برای مشتری نمایش داده نمی‌شود)
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={savingNote || noteDraft === (detail.note ?? "")}
              onClick={saveNote}
              className="h-7 rounded-lg px-2.5 text-[11px]"
            >
              {savingNote ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              ذخیره
            </Button>
          </div>
          <Textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="یادداشت داخلی درباره این مشتری..."
            className="min-h-16 rounded-xl text-xs leading-5"
            maxLength={500}
          />
        </div>

        <Button
          onClick={onToggleBlock}
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
  );
}

function InfoBox({ icon: Icon, label, value, ltr, copyable }: { icon: React.ElementType; label: string; value: string; ltr?: boolean; copyable?: boolean }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("کپی شد 📋");
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${copyable ? "cursor-pointer transition hover:border-primary/40" : ""}`} onClick={copyable ? copy : undefined}>
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

function StatChip({ icon: Icon, label, value, sub, tone }: { icon: React.ElementType; label: string; value: string; sub?: string; tone?: "primary" }) {
  return (
    <div className={`rounded-xl p-3 text-center ${tone === "primary" ? "bg-primary/5" : "bg-gold/10"}`}>
      <Icon className={`mx-auto h-4 w-4 ${tone === "primary" ? "text-primary" : "text-gold-foreground"}`} />
      <div className={`mt-1 text-sm font-black ${tone === "primary" ? "text-primary" : "text-gold-foreground"}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      {sub && <div className="mt-0.5 text-[9px] text-muted-foreground/70">{sub}</div>}
    </div>
  );
}
