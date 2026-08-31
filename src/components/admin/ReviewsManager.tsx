"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatJalali, toPersianDigits } from "@/lib/fa";
import { toast } from "sonner";
import { Star, Check, X, RotateCcw, Trash2, Loader2, UtensilsCrossed, MessageSquareQuote } from "lucide-react";

interface ReviewRow {
  id: string;
  authorName: string;
  authorPhone: string;
  menuItemName: string;
  menuItemImage: string | null;
  rating: number;
  comment: string | null;
  status: string;
  createdAt: string;
}

interface Counts {
  pending: number;
  approved: number;
  rejected: number;
}

type StatusFilter = "PENDING" | "APPROVED" | "REJECTED" | "all";

const FILTERS: { key: StatusFilter; label: string; countKey: keyof Counts | null }[] = [
  { key: "PENDING", label: "در انتظار", countKey: "pending" },
  { key: "APPROVED", label: "تأییدشده", countKey: "approved" },
  { key: "REJECTED", label: "ردشده", countKey: "rejected" },
  { key: "all", label: "همه", countKey: null },
];

function Stars({ rating, size = "h-4 w-4" }: { rating: number; size?: string }) {
  return (
    <span className="flex items-center gap-0.5" dir="ltr" aria-label={`امتیاز ${toPersianDigits(rating)} از ۵`}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={`${size} ${s <= rating ? "fill-gold text-gold" : "fill-transparent text-muted-foreground/40"}`}
        />
      ))}
    </span>
  );
}

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  PENDING: { label: "در انتظار تأیید", className: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  APPROVED: { label: "تأییدشده", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  REJECTED: { label: "ردشده", className: "bg-red-500/10 text-red-700 dark:text-red-400" },
};

export function ReviewsManager() {
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [counts, setCounts] = useState<Counts>({ pending: 0, approved: 0, rejected: 0 });
  const [filter, setFilter] = useState<StatusFilter>("PENDING");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReviewRow | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await api<{ reviews: ReviewRow[]; counts: Counts }>(
        `/api/admin/reviews?status=${filter}`
      );
      if (active) {
        if (res.success) {
          setReviews(res.reviews ?? []);
          setCounts(res.counts ?? { pending: 0, approved: 0, rejected: 0 });
        }
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [filter]);

  const changeFilter = (f: StatusFilter) => {
    setFilter(f);
    setLoading(true);
  };

  const refresh = async () => {
    const res = await api<{ reviews: ReviewRow[]; counts: Counts }>(`/api/admin/reviews?status=${filter}`);
    if (res.success) {
      setReviews(res.reviews ?? []);
      setCounts(res.counts ?? { pending: 0, approved: 0, rejected: 0 });
    }
  };

  const setStatus = async (r: ReviewRow, status: "APPROVED" | "REJECTED" | "PENDING") => {
    setBusyId(r.id);
    const res = await api(`/api/admin/reviews/${r.id}`, { method: "PATCH", body: { status } });
    setBusyId(null);
    if (!res.success) return toast.error(res.error ?? "خطا در تغییر وضعیت");
    if (status === "APPROVED") toast.success("نظر تأیید و در سایت نمایش داده می‌شود ✅");
    else if (status === "REJECTED") toast.success("نظر رد شد");
    else toast.success("نظر به حالت انتظار بازگشت");
    // اگر در فیلتر فعلی نباشد از لیست خارج می‌شود — رفرش کامل
    refresh();
  };

  const remove = async (r: ReviewRow) => {
    setBusyId(r.id);
    const res = await api(`/api/admin/reviews/${r.id}`, { method: "DELETE" });
    setBusyId(null);
    setDeleteTarget(null);
    if (!res.success) return toast.error(res.error ?? "حذف ناموفق بود");
    toast.success("نظر حذف شد");
    refresh();
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-black">
          <Star className="h-6 w-6 fill-gold text-gold" />
          نظرات و امتیازها
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          بررسی و تأیید امتیازهای ثبت‌شده مشتری‌ها — فقط نظرات تأییدشده در سایت نمایش داده می‌شوند
        </p>
      </div>

      {/* filter tabs */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const count = f.countKey ? counts[f.countKey] : null;
          return (
            <button
              key={f.key}
              onClick={() => changeFilter(f.key)}
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition ${
                filter === f.key
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "border bg-card hover:bg-accent"
              }`}
            >
              {f.label}
              {count != null && count > 0 && (
                <span
                  className={`rounded-lg px-1.5 py-0.5 text-[10px] font-black ${
                    filter === f.key ? "bg-primary-foreground/20" : "bg-muted"
                  }`}
                >
                  {toPersianDigits(count)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="space-y-2.5">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      ) : reviews.length === 0 ? (
        <Card className="border-dashed p-12 text-center">
          <MessageSquareQuote className="mx-auto h-12 w-12 text-muted-foreground/40" />
          <p className="mt-3 font-bold">
            {filter === "PENDING"
              ? "نظری در انتظار بررسی نیست"
              : filter === "APPROVED"
                ? "هنوز نظری تأیید نشده"
                : filter === "REJECTED"
                  ? "نظری رد نشده"
                  : "هیچ نظری ثبت نشده"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {filter === "PENDING"
              ? "وقتی مشتری‌ها بعد از تحویل سفارش امتیاز بدهند، اینجا نمایش داده می‌شود"
              : "امتیازهای مشتری‌ها بعد از تحویل سفارش اینجا جمع می‌شود"}
          </p>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {reviews.map((r) => {
            const badge = STATUS_BADGES[r.status];
            const isPending = r.status === "PENDING";
            return (
              <Card key={r.id} className="rounded-2xl p-4">
                <div className="flex flex-wrap items-start gap-3">
                  {/* item image */}
                  <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border bg-muted">
                    {r.menuItemImage ? (
                      <Image
                        src={r.menuItemImage}
                        alt={r.menuItemName}
                        fill
                        sizes="64px"
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <UtensilsCrossed className="h-6 w-6 text-muted-foreground/50" />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-black">{r.menuItemName}</span>
                      {badge && <Badge className={`text-[10px] ${badge.className}`}>{badge.label}</Badge>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="font-bold text-foreground/70">{r.authorName}</span>
                      <span dir="ltr">{toPersianDigits(r.authorPhone)}</span>
                      <span>•</span>
                      <span>{formatJalali(r.createdAt, true)}</span>
                    </div>
                    <div className="mt-1.5">
                      <Stars rating={r.rating} />
                    </div>
                    {r.comment && (
                      <p className="mt-2 rounded-xl bg-muted/50 px-3 py-2 text-xs leading-6 text-foreground/85">
                        «{r.comment}»
                      </p>
                    )}
                  </div>

                  {/* actions */}
                  <div className="flex items-center gap-1.5">
                    {busyId === r.id ? (
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    ) : isPending ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() => setStatus(r, "APPROVED")}
                          className="h-8 rounded-xl bg-emerald-600 px-3 text-[11px] font-bold text-white hover:bg-emerald-700"
                        >
                          <Check className="ml-1 h-3.5 w-3.5" />
                          تأیید
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => setStatus(r, "REJECTED")}
                          className="h-8 rounded-xl px-3 text-[11px] font-bold"
                        >
                          <X className="ml-1 h-3.5 w-3.5" />
                          رد
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setStatus(r, "PENDING")}
                          className="h-8 rounded-xl px-3 text-[11px] font-bold"
                          title="بازگشت به حالت انتظار"
                        >
                          <RotateCcw className="ml-1 h-3.5 w-3.5" />
                          بازگشت
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDeleteTarget(r)}
                          className="h-8 w-8 rounded-xl p-0 text-destructive hover:text-destructive"
                          aria-label="حذف نظر"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف نظر؟</AlertDialogTitle>
            <AlertDialogDescription>
              نظر «{deleteTarget?.authorName}» برای «{deleteTarget?.menuItemName}» به‌طور کامل حذف می‌شود و قابل
              بازگشت نیست.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="rounded-xl">انصراف</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && remove(deleteTarget)}
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <Trash2 className="ml-1.5 h-4 w-4" />
              حذف کن
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
