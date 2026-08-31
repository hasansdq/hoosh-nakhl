"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useAppStore, type MenuItemPublic } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StarRating } from "@/components/site/StarRating";
import { Lightbox } from "@/components/site/Lightbox";
import { useCartStore } from "@/lib/cart-store";
import { api } from "@/lib/client-api";
import { formatToman, toPersianDigits, timeAgo } from "@/lib/fa";
import { toast } from "sonner";
import {
  Bot,
  Check,
  Clock,
  Flame,
  Leaf,
  MessageSquareText,
  Send,
  ShoppingCart,
  Sparkles,
  Star,
  UtensilsCrossed,
} from "lucide-react";

// ============ types ============

interface PublicReview {
  id: string;
  menuItemName: string;
  authorName: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}

interface ReviewsResponse {
  canReview: boolean;
  hasReviewed: boolean;
  reviews: PublicReview[];
}

// ============ interactive star picker (for review form) ============

function StarPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(0);
  const labels = ["", "خیلی بد", "بد", "معمولی", "خوب", "عالی"];
  const shown = hover || value;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex flex-row-reverse items-center gap-1" role="radiogroup" aria-label="انتخاب امتیاز از ۵">
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value === i}
            aria-label={`${toPersianDigits(i)} ستاره`}
            disabled={disabled}
            onMouseEnter={() => !disabled && setHover(i)}
            onMouseLeave={() => setHover(0)}
            onClick={() => !disabled && onChange(i)}
            className="rounded-md p-0.5 transition-transform hover:scale-125 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Star
              className={`h-7 w-7 transition-colors ${
                i <= shown ? "fill-gold text-gold" : "text-muted-foreground/30"
              }`}
            />
          </button>
        ))}
      </div>
      {shown > 0 && (
        <span className="animate-fade-up rounded-full bg-gold/15 px-2.5 py-1 text-xs font-bold text-gold-foreground">
          {labels[shown]}
        </span>
      )}
    </div>
  );
}

// ============ review form ============

function ReviewForm({
  item,
  initialHasReviewed,
  onSubmitted,
}: {
  item: MenuItemPublic;
  initialHasReviewed: boolean;
  onSubmitted: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(initialHasReviewed);

  const submit = async () => {
    if (rating < 1) {
      toast.error("لطفاً امتیاز را با ستاره‌ها انتخاب کنید");
      return;
    }
    setSubmitting(true);
    const res = await api<{ review?: { id: string } }>("/api/reviews", {
      body: { menuItemId: item.id, rating, comment: comment.trim() || undefined },
    });
    setSubmitting(false);
    if (res.success) {
      setDone(true);
      toast.success("نظر شما ثبت شد و پس از تأیید نمایش داده می‌شود 🌟");
      onSubmitted();
    } else {
      toast.error(res.error ?? "ثبت نظر ناموفق بود");
    }
  };

  if (done) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-emerald-600/25 bg-emerald-600/8 px-4 py-3 text-xs font-bold text-emerald-700 dark:text-emerald-400">
        <Check className="h-4 w-4 shrink-0" />
        نظر شما ثبت شده و در انتظار تأیید مدیر است؛ ممنون از همراهی‌تان 🙏
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-primary/15 bg-primary/4 p-4">
      <p className="text-xs font-extrabold">
        <MessageSquareText className="ml-1 inline h-4 w-4 text-primary" />
        تجربه‌تان از «{item.name}» را بنویسید
      </p>
      <StarPicker value={rating} onChange={setRating} disabled={submitting} />
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={600}
        rows={3}
        disabled={submitting}
        placeholder="نظرتان درباره طعم، کیفیت یا ارسال... (اختیاری)"
        aria-label="متن نظر"
        className="resize-none rounded-xl text-xs leading-6"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">
          {toPersianDigits(comment.length)}/{toPersianDigits(600)} نویسه
        </span>
        <Button
          onClick={submit}
          disabled={submitting || rating < 1}
          size="sm"
          className="h-9 rounded-xl px-5 text-xs font-bold"
        >
          <Send className="ml-1.5 h-3.5 w-3.5" />
          {submitting ? "در حال ثبت..." : "ثبت نظر"}
        </Button>
      </div>
    </div>
  );
}

// ============ main dialog ============

export function ItemDetailDialog({
  item,
  catName,
  onClose,
  onOrder,
}: {
  item: MenuItemPublic | null;
  catName?: string;
  onClose: () => void;
  onOrder?: () => void;
}) {
  const user = useAppStore((s) => s.user);
  const setAuthOpen = useAppStore((s) => s.setAuthOpen);
  const recordRecentlyViewed = useAppStore((s) => s.recordRecentlyViewed);
  const addItem = useCartStore((s) => s.addItem);
  const [added, setAdded] = useState(false);

  const [reviewsData, setReviewsData] = useState<ReviewsResponse | null>(null);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const galleryImages = useMemo(
    () => (item?.imageUrl ? [item.imageUrl, ...(item.gallery ?? [])] : [...(item.gallery ?? [])]),
    [item]
  );

  const loadReviews = useCallback(async (menuItemId: string) => {
    setReviewsLoading(true);
    try {
      const res = await api<ReviewsResponse>(`/api/reviews?menuItemId=${encodeURIComponent(menuItemId)}`);
      if (res.success) {
        setReviewsData({ canReview: res.canReview, hasReviewed: res.hasReviewed, reviews: res.reviews ?? [] });
      } else {
        setReviewsData({ canReview: false, hasReviewed: false, reviews: [] });
      }
    } catch {
      setReviewsData({ canReview: false, hasReviewed: false, reviews: [] });
    } finally {
      setReviewsLoading(false);
    }
  }, []);

  // reset per-item state whenever the dialog opens with a new item
  useEffect(() => {
    if (item) {
      recordRecentlyViewed(item.id);
      setReviewsData(null);
      setAdded(false);
      setLightboxOpen(false);
      setLightboxIndex(0);
      void loadReviews(item.id);
    }
  }, [item?.id]);

  if (!item) return null;

  const openLightbox = (index: number) => {
    if (galleryImages.length > 0) {
      setLightboxIndex(index);
      setLightboxOpen(true);
    }
  };

  const handleAddToCart = () => {
    if (!item.isAvailable) return;
    addItem({ itemId: item.id, name: item.name, price: item.price, imageUrl: item.imageUrl });
    setAdded(true);
    toast.success(`${item.name} به سبد خرید اضافه شد 🛒`);
    window.setTimeout(() => setAdded(false), 1300);
  };

  const avgFromList =
    reviewsData && reviewsData.reviews.length > 0
      ? reviewsData.reviews.reduce((sum, r) => sum + r.rating, 0) / reviewsData.reviews.length
      : null;

  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        dir="rtl"
        className="max-h-[92dvh] gap-0 overflow-y-auto overscroll-contain rounded-b-none rounded-t-3xl p-0 sm:max-w-2xl sm:rounded-2xl"
      >
        {/* ---- hero image + gallery ---- */}
        <div className="relative">
          {item.imageUrl ? (
            <button
              type="button"
              onClick={() => openLightbox(0)}
              className="relative block h-52 w-full cursor-zoom-in overflow-hidden sm:h-64"
              aria-label={`دیدن تصویر بزرگ ${item.name}`}
            >
              <Image
                src={item.imageUrl}
                alt={item.name}
                fill
                sizes="(max-width: 640px) 100vw, 672px"
                className="object-cover"
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/55 to-transparent" />
            </button>
          ) : (
            <div className="flex h-36 w-full items-center justify-center bg-primary/8">
              <UtensilsCrossed className="h-12 w-12 text-primary/30" />
            </div>
          )}
          {/* badges over image */}
          <div className="pointer-events-none absolute right-3 top-3 flex flex-wrap gap-1.5">
            {item.isSpecial && (
              <Badge className="rounded-full bg-gold px-2.5 text-[10px] font-bold text-gold-foreground shadow-sm">
                ★ ویژه
              </Badge>
            )}
            {item.isVegetarian && (
              <Badge className="rounded-full bg-emerald-600 px-2.5 text-[10px] font-bold text-white shadow-sm">
                <Leaf className="ml-1 h-3 w-3" />
                گیاهی
              </Badge>
            )}
            {item.isSpicy && (
              <Badge className="rounded-full bg-red-600 px-2.5 text-[10px] font-bold text-white shadow-sm">
                <Flame className="ml-1 h-3 w-3" />
                تند
              </Badge>
            )}
            {catName && (
              <Badge variant="secondary" className="rounded-full bg-card/90 text-[10px] font-bold shadow-sm backdrop-blur">
                {catName}
              </Badge>
            )}
          </div>
          {!item.isAvailable && (
            <div className="absolute inset-x-0 bottom-0 bg-destructive/90 py-1.5 text-center text-xs font-black text-white">
              فعلاً ناموجود
            </div>
          )}
        </div>

        {/* gallery thumbnails */}
        {(item.gallery?.length ?? 0) > 0 && (
          <div className="flex gap-2 overflow-x-auto px-5 pt-3 pb-1" dir="rtl">
            {galleryImages.map((src, i) => (
              <button
                key={`${src}-${i}`}
                type="button"
                onClick={() => openLightbox(i)}
                className="relative h-14 w-20 shrink-0 overflow-hidden rounded-lg border-2 border-transparent transition-all hover:border-gold"
                aria-label={`تصویر ${toPersianDigits(i + 1)} از ${item.name}`}
              >
                <Image src={src} alt="" fill sizes="80px" className="object-cover" />
              </button>
            ))}
          </div>
        )}

        {/* ---- header ---- */}
        <DialogHeader className="space-y-2 px-5 pt-4 pb-0">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <DialogTitle className="text-lg font-black leading-8">{item.name}</DialogTitle>
            <span className="shrink-0 rounded-xl bg-primary/10 px-3 py-1 text-sm font-black text-primary">
              {formatToman(item.price)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {item.rating != null && <StarRating rating={item.rating} count={item.ratingCount} size={15} />}
            {item.prepTime != null && (
              <span className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                {toPersianDigits(item.prepTime)} دقیقه
              </span>
            )}
            {item.calories != null && (
              <span className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground">
                <Flame className="h-3.5 w-3.5" />
                {toPersianDigits(item.calories)} کالری
              </span>
            )}
          </div>
          <DialogDescription asChild>
            <div>
              {item.description && (
                <p className="pt-1 text-xs leading-7 text-muted-foreground">{item.description}</p>
              )}
              {item.ingredients && (
                <p className="mt-2 rounded-xl bg-muted/50 px-3.5 py-2.5 text-[11px] leading-7 text-muted-foreground">
                  <Sparkles className="ml-1 inline h-3.5 w-3.5 text-gold" />
                  <b className="text-foreground">مواد تشکیل‌دهنده: </b>
                  {item.ingredients}
                </p>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        {/* ---- reviews section ---- */}
        <section className="mt-4 px-5 pb-2" aria-label="نظرات مشتریان">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h4 className="flex items-center gap-2 text-sm font-extrabold">
              <MessageSquareText className="h-4 w-4 text-primary" />
              نظر مشتریان
              {reviewsData && reviewsData.reviews.length > 0 && (
                <Badge className="rounded-full bg-primary/10 px-2 text-[10px] font-bold text-primary">
                  {toPersianDigits(reviewsData.reviews.length)}
                </Badge>
              )}
            </h4>
            {avgFromList != null && (
              <span className="text-[11px] font-bold text-muted-foreground">
                میانگین {toPersianDigits(avgFromList.toFixed(1)).replace(".", "٫")} از ۵
              </span>
            )}
          </div>

          {/* review form / eligibility */}
          <div className="mb-4">
            {!user ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-muted-foreground/30 px-4 py-3">
                <p className="text-[11px] font-bold text-muted-foreground">
                  برای ثبت نظر ابتدا وارد حساب خود شوید
                </p>
                <Button
                  onClick={() => {
                    onClose();
                    setAuthOpen(true, "home");
                  }}
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg text-[11px] font-bold"
                >
                  ورود / ثبت‌نام
                </Button>
              </div>
            ) : reviewsLoading && !reviewsData ? (
              <div className="flex items-center gap-2 px-1 py-2 text-[11px] text-muted-foreground">
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                در حال بررسی شرایط ثبت نظر...
              </div>
            ) : reviewsData?.canReview ? (
              <ReviewForm
                key={`${item.id}-${reviewsData.hasReviewed}`}
                item={item}
                initialHasReviewed={reviewsData.hasReviewed}
                onSubmitted={() => void loadReviews(item.id)}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-muted-foreground/30 px-4 py-3 text-[11px] leading-6 text-muted-foreground">
                {reviewsData?.hasReviewed ? (
                  <>
                    <Check className="ml-1 inline h-3.5 w-3.5 text-emerald-600" />
                    شما برای این غذا نظر ثبت کرده‌اید؛ پس از تأیید مدیر نمایش داده می‌شود.
                  </>
                ) : (
                  <>
                    <ShoppingCart className="ml-1 inline h-3.5 w-3.5" />
                    ثبت نظر برای این غذا پس از تحویل سفارشی که شامل آن باشد، فعال می‌شود.
                  </>
                )}
              </div>
            )}
          </div>

          {/* reviews list */}
          {reviewsLoading && !reviewsData ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="skeleton h-20 rounded-xl" />
              ))}
            </div>
          ) : reviewsData && reviewsData.reviews.length > 0 ? (
            <ul className="max-h-64 space-y-2.5 overflow-y-auto pl-1" style={{ scrollbarWidth: "thin" }}>
              {reviewsData.reviews.map((r) => (
                <li
                  key={r.id}
                  className="rounded-xl border bg-muted/25 p-3.5 transition-colors hover:border-primary/25"
                >
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <span className="text-xs font-extrabold">{r.authorName}</span>
                    <StarRating rating={r.rating} showCount={false} size={12} />
                  </div>
                  {r.comment && (
                    <p className="mt-1.5 text-[11px] leading-6 text-muted-foreground">{r.comment}</p>
                  )}
                  <span className="mt-1 block text-[10px] text-muted-foreground/70">
                    {timeAgo(r.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-xl border-2 border-dashed border-muted-foreground/20 px-4 py-6 text-center">
              <Star className="mx-auto h-6 w-6 text-muted-foreground/30" />
              <p className="mt-2 text-[11px] font-bold text-muted-foreground">
                هنوز نظری برای این غذا ثبت نشده؛ اولین نفر باشید!
              </p>
            </div>
          )}
        </section>

        {/* ---- footer actions ---- */}
        <div className="sticky bottom-0 mt-2 flex items-center gap-2 border-t bg-card/95 p-4 pb-5 backdrop-blur">
          <Button
            onClick={handleAddToCart}
            disabled={!item.isAvailable}
            className={`h-11 flex-1 rounded-xl text-sm font-bold shadow-sm ${
              added ? "bg-emerald-600 text-white hover:bg-emerald-600" : ""
            }`}
          >
            {added ? (
              <>
                <Check className="ml-1.5 h-4.5 w-4.5 animate-fade-up" />
                افزوده شد
              </>
            ) : (
              <>
                <ShoppingCart className="ml-1.5 h-4.5 w-4.5" />
                افزودن به سبد
              </>
            )}
          </Button>
          {onOrder && (
            <Button
              onClick={() => {
                onClose();
                onOrder();
              }}
              variant="outline"
              className="h-11 flex-1 rounded-xl border-primary/30 text-sm font-bold text-primary hover:bg-primary/10 hover:text-primary"
            >
              <Bot className="ml-1.5 h-4.5 w-4.5" />
              سفارش با هوش نخل
            </Button>
          )}
        </div>
      </DialogContent>

      {lightboxOpen && (
        <Lightbox
          images={galleryImages}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </Dialog>
  );
}
