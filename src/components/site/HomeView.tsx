"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Image from "next/image";
import { useAppStore, type MenuItemPublic, type MenuCategoryPublic } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { StarRating } from "@/components/site/StarRating";
import { Reveal } from "@/components/site/Reveal";
import { Lightbox } from "@/components/site/Lightbox";
import { ItemDetailDialog } from "@/components/site/ItemDetailDialog";
import { useCartStore } from "@/lib/cart-store";
import { useContent, RichText, ContentImage } from "@/lib/use-content";
import { formatToman, toPersianDigits, normalizePersian, toEnglishDigits } from "@/lib/fa";
import { prettyPhone } from "@/components/site/Header";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Bot,
  MessageSquareText,
  Bike,
  CreditCard,
  ShieldCheck,
  Clock,
  Flame,
  Star,
  ArrowLeft,
  Sparkles,
  ChefHat,
  Leaf,
  Ticket,
  Copy,
  Check,
  Search,
  SearchX,
  X,
  Award,
  ShoppingBag,
  Timer,
  HeartHandshake,
  MapPin,
  Phone,
  ExternalLink,
  HelpCircle,
  ShoppingCart,
  Images,
  ZoomIn,
  Heart,
  SlidersHorizontal,
  ChevronDown,
  RotateCcw,
  Wallet,
  ArrowDownWideNarrow,
} from "lucide-react";

// ============ local types & data ============

interface ActiveCoupon {
  code: string;
  title: string;
  type: string;
  value: number;
  label: string;
}

/** normalize text for search: Persian chars + digits unification */
const searchNorm = (s: string) => normalizePersian(toEnglishDigits(s));

// ============ small local components ============

function SectionHeading({
  icon: Icon,
  title,
  subtitle,
  center = false,
}: {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
  center?: boolean;
}) {
  return (
    <div className={center ? "text-center" : ""}>
      <h2 className={`flex items-center gap-2.5 text-xl font-extrabold sm:text-2xl ${center ? "justify-center" : ""}`}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-inner">
          <Icon className="h-5 w-5" />
        </span>
        {title}
      </h2>
      {subtitle && <p className={`mt-2.5 text-sm leading-7 text-muted-foreground ${center ? "mx-auto max-w-xl" : ""}`}>{subtitle}</p>}
      <div className={`mt-3.5 h-1 w-12 rounded-full bg-gradient-to-l from-primary to-gold ${center ? "mx-auto" : ""}`} />
    </div>
  );
}

/** compact add-to-cart button with brief success flash (parallel manual ordering path) */
function AddToCartButton({ item, className = "" }: { item: MenuItemPublic; className?: string }) {
  const addItem = useCartStore((s) => s.addItem);
  const recordRecentlyViewed = useAppStore((s) => s.recordRecentlyViewed);
  const [added, setAdded] = useState(false);

  const handleAdd = () => {
    if (!item.isAvailable) return;
    addItem({ itemId: item.id, name: item.name, price: item.price, imageUrl: item.imageUrl });
    recordRecentlyViewed(item.id);
    setAdded(true);
    toast.success(`${item.name} به سبد خرید اضافه شد 🛒`);
    window.setTimeout(() => setAdded(false), 1300);
  };

  return (
    <Button
      onClick={handleAdd}
      disabled={!item.isAvailable}
      size="sm"
      aria-label={`افزودن ${item.name} به سبد خرید`}
      className={`h-9 rounded-xl text-xs font-bold shadow-sm transition-all ${added ? "bg-emerald-600 text-white hover:bg-emerald-600" : ""} ${className}`}
    >
      {added ? <Check className="ml-1 h-4 w-4 animate-fade-up" /> : <ShoppingCart className="ml-1 h-4 w-4" />}
      {added ? "افزوده شد" : "افزودن به سبد"}
    </Button>
  );
}

/** Heart-shaped favorite toggle — sits over the image; opens AuthModal for guests */
function FavoriteToggle({
  itemId,
  itemName,
  positionClass,
}: {
  itemId: string;
  itemName: string;
  positionClass: string;
}) {
  const isFav = useAppStore((s) => s.favoriteIds.includes(itemId));
  const toggleFavorite = useAppStore((s) => s.toggleFavorite);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    void toggleFavorite(itemId);
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      title={isFav ? "حذف از علاقه‌مندی‌ها" : "افزودن به علاقه‌مندی‌ها"}
      aria-label={isFav ? `حذف ${itemName} از علاقه‌مندی‌ها` : `افزودن ${itemName} به علاقه‌مندی‌ها`}
      aria-pressed={isFav}
      className={`${positionClass} z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/30 text-white/90 backdrop-blur-sm transition-all hover:scale-110 hover:text-red-500 ${
        isFav ? "text-red-500 hover:text-red-600" : ""
      }`}
    >
      <Heart className={`h-4 w-4 ${isFav ? "fill-red-500" : ""}`} />
    </button>
  );
}

function MenuCard({ item, catName, onOrder }: { item: MenuItemPublic; catName?: string; onOrder?: () => void }) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const recordRecentlyViewed = useAppStore((s) => s.recordRecentlyViewed);
  const galleryImages = item.imageUrl
    ? [item.imageUrl, ...(item.gallery ?? [])]
    : [...(item.gallery ?? [])];
  const hasGallery = (item.gallery?.length ?? 0) > 0;

  const openLightbox = () => {
    if (galleryImages.length > 0) {
      recordRecentlyViewed(item.id);
      setLightboxOpen(true);
    }
  };

  const openDetail = () => {
    setDetailOpen(true);
  };

  return (
    <div
      className={`group card-lift flex h-full flex-col overflow-hidden rounded-2xl border bg-card transition-all hover:-translate-y-1 ${
        !item.isAvailable ? "opacity-60" : ""
      }`}
    >
      {item.imageUrl && (
        <div
          className={`relative h-40 shrink-0 overflow-hidden ${hasGallery ? "cursor-zoom-in" : ""}`}
          onClick={hasGallery ? openLightbox : undefined}
          role={hasGallery ? "button" : undefined}
          tabIndex={hasGallery ? 0 : undefined}
          onKeyDown={
            hasGallery
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openLightbox();
                  }
                }
              : undefined
          }
          aria-label={hasGallery ? `دیدن گالری ${item.name}` : undefined}
        >
          <Image
            src={item.imageUrl}
            alt={item.name}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover transition duration-500 group-hover:scale-110"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card/95 to-transparent" />
          {hasGallery && (
            <span className="pointer-events-none absolute bottom-2 left-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-white opacity-0 backdrop-blur-sm transition-opacity duration-300 group-hover:opacity-100" aria-hidden>
              <ZoomIn className="h-3.5 w-3.5" />
            </span>
          )}
          {/* left-side stacked badges: catName → ویژه → گیاهی → تند (dynamic offsets, no overlap) */}
          {[
            ...(catName
              ? [(
                  <Badge key="b-cat" variant="secondary" className="rounded-full bg-card/90 text-[10px] font-bold shadow-sm backdrop-blur">
                    {catName}
                  </Badge>
                )]
              : []),
            ...(item.isSpecial
              ? [(
                  <Badge key="b-special" className="rounded-full bg-gold px-2 text-[10px] font-bold text-gold-foreground shadow-sm">
                    ★ ویژه
                  </Badge>
                )]
              : []),
            ...(item.isVegetarian
              ? [(
                  <Badge key="b-veg" className="rounded-full bg-emerald-600 px-2 text-[10px] font-bold text-white shadow-sm">
                    <Leaf className="ml-0.5 h-3 w-3" />
                    گیاهی
                  </Badge>
                )]
              : []),
            ...(item.isSpicy
              ? [(
                  <Badge key="b-spicy" className="rounded-full bg-red-600 px-2 text-[10px] font-bold text-white shadow-sm">
                    <Flame className="ml-0.5 h-3 w-3" />
                    تند
                  </Badge>
                )]
              : []),
          ].map((badge, i) => (
            <div key={i} className="absolute left-2.5" style={{ top: `${0.625 + i * 1.55}rem` }}>
              {badge}
            </div>
          ))}
          {hasGallery && (
            <Badge className="pointer-events-none absolute bottom-2.5 left-2.5 gap-1 rounded-full bg-black/65 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm backdrop-blur">
              <Images className="h-3 w-3" />
              {toPersianDigits(item.gallery!.length)}
            </Badge>
          )}
          <FavoriteToggle
            itemId={item.id}
            itemName={item.name}
            positionClass="absolute right-2.5 top-2.5"
          />
        </div>
      )}
      <div className="flex flex-1 flex-col p-4">
        {catName && !item.imageUrl && (
          <Badge variant="secondary" className="mb-1.5 w-fit rounded-full bg-muted text-[10px] font-bold">
            {catName}
          </Badge>
        )}
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[15px] font-extrabold leading-7">
            <button
              type="button"
              onClick={openDetail}
              className="text-right transition-colors hover:text-primary"
              aria-label={`دیدن جزئیات و نظرات ${item.name}`}
            >
              <span className="decoration-primary/40 decoration-dotted underline-offset-4 transition-decoration hover:underline">
                {item.name}
              </span>
            </button>
          </h3>
          <span className="shrink-0 rounded-lg bg-primary/8 px-2 py-0.5 text-xs font-black text-primary">
            {formatToman(item.price)}
          </span>
        </div>
        {item.description && (
          <p className="mt-1.5 line-clamp-2 text-[11px] leading-[1.8] text-muted-foreground">{item.description}</p>
        )}
        <div className="mt-2.5 flex min-h-5 items-center">
          {item.rating != null ? (
            <StarRating rating={item.rating} count={item.ratingCount} size={13} />
          ) : (
            <span className="rounded-full border border-dashed border-muted-foreground/30 px-2 py-0.5 text-[9px] font-bold text-muted-foreground/80">
              جدید
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
          {item.prepTime != null && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {toPersianDigits(item.prepTime)} دقیقه
            </span>
          )}
          {item.calories != null && (
            <span className="flex items-center gap-1">
              <Flame className="h-3 w-3" />
              {toPersianDigits(item.calories)} کالری
            </span>
          )}
          {!item.isAvailable && <span className="font-bold text-destructive">فعلاً ناموجود</span>}
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
          <AddToCartButton item={item} className="min-w-36 flex-1" />
          {onOrder && (
            <Button
              onClick={onOrder}
              variant="ghost"
              size="sm"
              className="h-9 min-w-36 flex-1 rounded-xl text-xs font-bold text-primary hover:bg-primary/10 hover:text-primary"
            >
              سفارش با هوش نخل
              <Bot className="mr-1.5 h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
      {detailOpen && (
        <ItemDetailDialog
          item={item}
          catName={catName}
          onClose={() => setDetailOpen(false)}
          onOrder={onOrder}
        />
      )}
      {lightboxOpen && (
        <Lightbox
          images={galleryImages}
          initialIndex={0}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  );
}

function SpecialCard({ item, onOrder }: { item: MenuItemPublic; onOrder?: () => void }) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const recordRecentlyViewed = useAppStore((s) => s.recordRecentlyViewed);
  const galleryImages = item.imageUrl
    ? [item.imageUrl, ...(item.gallery ?? [])]
    : [...(item.gallery ?? [])];
  const hasGallery = (item.gallery?.length ?? 0) > 0;

  const openLightbox = () => {
    if (galleryImages.length > 0) {
      recordRecentlyViewed(item.id);
      setLightboxOpen(true);
    }
  };

  return (
    <Card className="card-lift group h-full gap-0 overflow-hidden rounded-2xl p-0 transition-all hover:-translate-y-1">
      <div
        className={`relative h-44 overflow-hidden ${hasGallery ? "cursor-zoom-in" : ""}`}
        onClick={hasGallery ? openLightbox : undefined}
        role={hasGallery ? "button" : undefined}
        tabIndex={hasGallery ? 0 : undefined}
        onKeyDown={
          hasGallery
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openLightbox();
                }
              }
            : undefined
        }
        aria-label={hasGallery ? `دیدن گالری ${item.name}` : undefined}
      >
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt={item.name}
            fill
            sizes="(max-width: 640px) 100vw, 33vw"
            className="object-cover transition duration-500 group-hover:scale-110"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-primary/10 text-5xl">🍽</div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card/95 to-transparent" />
        <Badge className="absolute right-3 top-3 gap-1 bg-gold text-white shadow-lg">
          <Star className="h-3.5 w-3.5" /> ویژه
        </Badge>
        {hasGallery && (
          <span className="pointer-events-none absolute right-3 bottom-3 flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-white opacity-0 backdrop-blur-sm transition-opacity duration-300 group-hover:opacity-100" aria-hidden>
            <ZoomIn className="h-3.5 w-3.5" />
          </span>
        )}
        {hasGallery && (
          <Badge className="pointer-events-none absolute bottom-3 left-3 gap-1 rounded-full bg-black/65 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm backdrop-blur">
            <Images className="h-3 w-3" />
            {toPersianDigits(item.gallery!.length)}
          </Badge>
        )}
        <FavoriteToggle
          itemId={item.id}
          itemName={item.name}
          positionClass="absolute left-3 top-3"
        />
      </div>
      <CardContent className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-extrabold">{item.name}</h3>
          <span className="shrink-0 rounded-lg bg-primary/8 px-2 py-0.5 text-xs font-black text-primary">
            {formatToman(item.price)}
          </span>
        </div>
        {item.rating != null && (
          <div className="mt-1.5">
            <StarRating rating={item.rating} count={item.ratingCount} />
          </div>
        )}
        <p className="mt-1.5 line-clamp-2 text-xs leading-6 text-muted-foreground">{item.description}</p>
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
          <AddToCartButton item={item} className="min-w-36 flex-1" />
          {onOrder && (
            <Button
              onClick={onOrder}
              variant="ghost"
              size="sm"
              className="h-9 min-w-36 flex-1 rounded-xl text-xs font-bold text-primary hover:bg-primary/10 hover:text-primary"
            >
              سفارش با هوش نخل
              <Bot className="mr-1.5 h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </CardContent>
      {lightboxOpen && (
        <Lightbox
          images={galleryImages}
          initialIndex={0}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </Card>
  );
}

// ============ menu filter types & helpers ============

type MenuSortKey = "default" | "price-asc" | "price-desc" | "popular" | "rating";

interface MenuFilters {
  vegetarian: boolean;
  spicy: boolean;
  maxPrice: number | null;
  maxCalories: number | null;
  sort: MenuSortKey;
}

const DEFAULT_FILTERS: MenuFilters = {
  vegetarian: false,
  spicy: false,
  maxPrice: null,
  maxCalories: null,
  sort: "default",
};

const SORT_OPTIONS: { key: MenuSortKey; label: string }[] = [
  { key: "default", label: "پیش‌فرض" },
  { key: "price-asc", label: "ارزان‌ترین" },
  { key: "price-desc", label: "گران‌ترین" },
  { key: "popular", label: "پرفروش‌ترین" },
  { key: "rating", label: "پرامتیازترین" },
];

function countActiveFilters(f: MenuFilters): number {
  let n = 0;
  if (f.vegetarian) n++;
  if (f.spicy) n++;
  if (f.maxPrice != null) n++;
  if (f.maxCalories != null) n++;
  if (f.sort !== "default") n++;
  return n;
}

function applyMenuFilters(items: MenuItemPublic[], f: MenuFilters): MenuItemPublic[] {
  const filtered = items.filter((it) => {
    if (f.vegetarian && !it.isVegetarian) return false;
    if (f.spicy && !it.isSpicy) return false;
    if (f.maxPrice != null && it.price > f.maxPrice) return false;
    if (f.maxCalories != null && it.calories != null && it.calories > f.maxCalories) return false;
    return true;
  });
  const sorted = [...filtered];
  switch (f.sort) {
    case "price-asc":
      sorted.sort((a, b) => a.price - b.price);
      break;
    case "price-desc":
      sorted.sort((a, b) => b.price - a.price);
      break;
    case "popular":
      sorted.sort((a, b) => (b.orderCount ?? 0) - (a.orderCount ?? 0));
      break;
    case "rating":
      sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
      break;
  }
  return sorted;
}

// ============ main view ============

export function HomeView() {
  const { menu, user, setView, setAuthOpen, siteSettings } = useAppStore();
  const { t, img } = useContent();
  const favorites = useAppStore((s) => s.favorites);
  const recentlyViewed = useAppStore((s) => s.recentlyViewed);
  const hydrateRecentlyViewed = useAppStore((s) => s.hydrateRecentlyViewed);

  // active coupon banner (fetched once)
  const [coupon, setCoupon] = useState<ActiveCoupon | null>(null);
  const [copied, setCopied] = useState(false);
  // coupon dismissal: stored in localStorage per code+day (24h)
  const [couponHidden, setCouponHidden] = useState(false);

  // live menu search
  const [query, setQuery] = useState("");

  // advanced menu filters
  const [filters, setFilters] = useState<MenuFilters>(DEFAULT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // hydrate recently-viewed list from localStorage on first client mount
  useEffect(() => {
    hydrateRecentlyViewed();
  }, [hydrateRecentlyViewed]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/coupons/active");
        const data = await res.json();
        if (active && data?.success && data.coupon) {
          setCoupon(data.coupon as ActiveCoupon);
          // check dismissal state once the coupon is known
          const key = `nakhl-coupon-hidden-${data.coupon.code}`;
          const hiddenAt = Number(localStorage.getItem(key) || 0);
          // 24h dismissal
          if (hiddenAt && Date.now() - hiddenAt < 24 * 60 * 60 * 1000) {
            setCouponHidden(true);
          }
        }
      } catch {
        /* coupon banner is optional decoration */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const dismissCoupon = () => {
    if (!coupon) return;
    setCouponHidden(true);
    try {
      localStorage.setItem(
        `nakhl-coupon-hidden-${coupon.code}`,
        String(Date.now())
      );
    } catch {
      /* localStorage may be unavailable in private mode */
    }
    toast.message("بنر تخفیف بسته شد. کد را هر زمان از منو دوباره خواهید یافت.", {
      duration: 3000,
    });
  };

  const copyCoupon = async () => {
    if (!coupon) return;
    let copiedOk = false;
    try {
      await navigator.clipboard.writeText(coupon.code);
      copiedOk = true;
    } catch {
      // legacy fallback for browsers without clipboard API permission
      try {
        const ta = document.createElement("textarea");
        ta.value = coupon.code;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        copiedOk = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        copiedOk = false;
      }
    }
    if (copiedOk) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      toast.success("کد تخفیف کپی شد!");
    } else {
      toast.error("کپی کد ممکن نشد؛ لطفاً کد را یادداشت کنید");
    }
  };

  const goChat = () => {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    setView("chat");
    window.scrollTo({ top: 0 });
  };

  const specials = menu.flatMap((c) => c.items).filter((i) => i.isSpecial && i.isAvailable).slice(0, 3);
  const drinksCat = menu.find((c) => c.slug === "drinks");
  const foodCats = menu.filter((c) => c.slug !== "drinks");

  // CMS-driven structured blocks (stats / steps / about chips / FAQs)
  const stats = [
    { icon: Award, value: t("home.stats1.value"), label: t("home.stats1.label") },
    { icon: ShoppingBag, value: t("home.stats2.value"), label: t("home.stats2.label") },
    { icon: Star, value: t("home.stats3.value"), label: t("home.stats3.label") },
    { icon: Timer, value: t("home.stats4.value"), label: t("home.stats4.label") },
  ];
  const howSteps = [
    { icon: MessageSquareText, title: t("home.how.step1.title"), desc: t("home.how.step1.desc") },
    { icon: ChefHat, title: t("home.how.step2.title"), desc: t("home.how.step2.desc") },
    { icon: Bike, title: t("home.how.step3.title"), desc: t("home.how.step3.desc") },
    { icon: CreditCard, title: t("home.how.step4.title"), desc: t("home.how.step4.desc") },
  ];
  const aboutChips = [
    { icon: Leaf, label: t("home.about.chip1") },
    { icon: ChefHat, label: t("home.about.chip2") },
    { icon: HeartHandshake, label: t("home.about.chip3") },
  ].filter((c) => c.label.trim() !== "");
  const faqs = [
    { q: t("home.faq.q1"), a: t("home.faq.a1") },
    { q: t("home.faq.q2"), a: t("home.faq.a2") },
    { q: t("home.faq.q3"), a: t("home.faq.a3") },
    { q: t("home.faq.q4"), a: t("home.faq.a4") },
    { q: t("home.faq.q5"), a: t("home.faq.a5") },
  ].filter((f) => f.q.trim() !== "");

  const normalizedQuery = useMemo(() => searchNorm(query.trim()), [query]);
  const searching = normalizedQuery.length >= 2;

  // highest price in menu — upper bound for the price slider
  const maxMenuPrice = useMemo(
    () => menu.reduce((m, c) => Math.max(m, ...c.items.map((i) => i.price)), 0),
    [menu]
  );
  const activeFilterCount = countActiveFilters(filters);
  const hasActiveFilters = activeFilterCount > 0;

  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    toast.message("فیلترها پاک شد", { duration: 1800 });
  };

  const searchResults = useMemo(() => {
    if (!searching) return [] as { item: MenuItemPublic; catName: string }[];
    return menu.flatMap((c) =>
      c.items
        .filter((item) => {
          const name = searchNorm(item.name);
          const desc = item.description ? searchNorm(item.description) : "";
          return name.includes(normalizedQuery) || desc.includes(normalizedQuery);
        })
        .map((item) => ({ item, catName: c.name }))
    );
  }, [menu, normalizedQuery, searching]);

  // search results AFTER advanced filters + sort
  const filteredSearchResults = useMemo(
    () =>
      applyMenuFilters(
        searchResults.map((r) => r.item),
        filters
      ).map((item) => ({ item, catName: menu.find((c) => c.items.some((i) => i.id === item.id))?.name ?? "" })),
    [searchResults, filters, menu]
  );

  // per-category filtered items for the tabs (all matches when filtering; top 9 otherwise)
  const filteredItemsFor = useCallback(
    (cat: MenuCategoryPublic) => {
      const base = hasActiveFilters ? cat.items : cat.items.slice(0, 9);
      return applyMenuFilters(base, filters);
    },
    [filters, hasActiveFilters]
  );

  return (
    <div>
      {/* local keyframes — floating hero cards + coupon sheen (namespaced to avoid collisions) */}
      <style>{`
        @keyframes nakhl-float {
          0% { transform: translateY(-4px); }
          100% { transform: translateY(6px); }
        }
        .nakhl-float { animation: nakhl-float 3s ease-in-out infinite alternate; }
        .nakhl-float-slow { animation: nakhl-float 3.6s ease-in-out -0.9s infinite alternate; }
        @keyframes nakhl-sheen {
          0% { transform: translateX(-180%) skewX(-18deg); opacity: 0; }
          12% { opacity: 1; }
          50% { opacity: 1; }
          100% { transform: translateX(720%) skewX(-18deg); opacity: 0; }
        }
        .nakhl-sheen {
          position: absolute;
          top: -10%;
          bottom: -10%;
          left: 0;
          width: 16%;
          background: linear-gradient(90deg, transparent, rgb(255 255 255 / 0.45), transparent);
          animation: nakhl-sheen 4.2s ease-in-out infinite;
          pointer-events: none;
        }
        @media (prefers-reduced-motion: reduce) {
          .nakhl-float, .nakhl-float-slow, .nakhl-sheen { animation: none; }
        }
      `}</style>

      {/* ============ HERO ============ */}
      <section className="relative overflow-hidden">
        <div className="palm-pattern absolute inset-0 opacity-60" aria-hidden />
        {/* ambient drifting palm dots */}
        <div className="ambient-particles" aria-hidden>
          <span style={{ left: "8%", animationDuration: "8s", animationDelay: "0s" }} />
          <span style={{ left: "18%", animationDuration: "11s", animationDelay: "1.2s" }} />
          <span style={{ left: "32%", animationDuration: "9s", animationDelay: "2.4s" }} />
          <span style={{ left: "47%", animationDuration: "13s", animationDelay: "0.5s" }} />
          <span style={{ left: "62%", animationDuration: "10s", animationDelay: "3s" }} />
          <span style={{ left: "73%", animationDuration: "12s", animationDelay: "1.8s" }} />
          <span style={{ left: "85%", animationDuration: "9.5s", animationDelay: "2.2s" }} />
          <span style={{ left: "93%", animationDuration: "11.5s", animationDelay: "0.8s" }} />
        </div>
        <div
          className="absolute -top-32 left-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl"
          aria-hidden
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 pb-14 pt-10 md:grid-cols-2 md:pt-20">
          <div className="text-center md:text-right">
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05, type: "spring", stiffness: 120, damping: 18 }}
            >
            <Badge className="mb-4 gap-1.5 rounded-full bg-gradient-to-l from-primary to-gold px-3.5 py-1.5 text-xs sm:px-4 sm:text-sm text-white shadow-lg">
              <Sparkles className="h-4 w-4 shrink-0" />
              {t("home.hero.badge")}
            </Badge>
            </motion.div>
            <motion.h1
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.14, type: "spring", stiffness: 110, damping: 18 }}
              className="text-[2rem] font-black leading-[1.35] sm:text-4xl sm:leading-[1.25] md:text-5xl md:leading-[1.2]"
            >
              <RichText text={t("home.hero.title")} />
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.22, type: "spring", stiffness: 110, damping: 18 }}
              className="mx-auto mt-4 max-w-md text-[15px] leading-8 text-muted-foreground sm:mt-5 sm:text-base md:mx-0"
            >
              {t("home.hero.subtitle")}
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, type: "spring", stiffness: 110, damping: 18 }}
              className="mt-7 flex flex-col items-center gap-3 sm:flex-row sm:justify-center md:justify-start"
            >
              <Button size="lg" onClick={goChat} className="shine-sweep h-14 rounded-2xl px-7 text-base font-extrabold shadow-xl shadow-primary/30 transition-transform hover:scale-[1.02]">
                <Bot className="ml-2 h-6 w-6" />
                {t("home.hero.ctaPrimary")}
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => document.getElementById("menu-preview")?.scrollIntoView({ behavior: "smooth" })}
                className="h-14 rounded-2xl px-7 text-base font-bold"
              >
                {t("home.hero.ctaSecondary")}
                <ArrowLeft className="mr-2 h-5 w-5" />
              </Button>
            </motion.div>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.45, duration: 0.5 }}
              className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground md:justify-start"
            >
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-primary" />
                {t("home.hero.trustPayment")}
              </span>
              <span className="flex items-center gap-1.5">
                <Bike className="h-4 w-4 text-primary" />
                {t("home.hero.trustDelivery")}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-primary" />
                {t("home.hero.trustHours")}
              </span>
            </motion.div>
          </div>

          {/* hero visual */}
          <motion.div
            initial={{ opacity: 0, scale: 0.94, rotate: 1.5 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 90, damping: 16 }}
            className="relative mx-auto w-full max-w-md"
          >
            <div className="relative overflow-hidden rounded-[2rem] border-4 border-card shadow-2xl shadow-primary/20">
              <ContentImage
                src={img("home.hero.image")}
                alt={t("home.hero.imageCaptionTitle")}
                width={720}
                height={360}
                priority
                className="h-auto w-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 pt-10 text-white">
                <div className="text-sm font-bold">{t("home.hero.imageCaptionTitle")}</div>
                <div className="text-xs opacity-90">{t("home.hero.imageCaptionSubtitle")}</div>
              </div>
            </div>
            {/* floating cards */}
            <Card className="nakhl-float absolute -right-1 -top-3 gap-0 rounded-2xl p-2.5 shadow-xl sm:-right-8 sm:p-3">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <MessageSquareText className="h-4.5 w-4.5" />
                </div>
                <div className="text-[11px] leading-5 sm:text-xs">{t("home.hero.chatBubble")}</div>
              </div>
            </Card>
            <Card className="nakhl-float-slow absolute -bottom-4 -left-1 rounded-2xl p-2.5 shadow-xl sm:-left-6 sm:p-3">
              <div className="flex items-center gap-2 text-xs">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gold text-white">
                  <Star className="h-4.5 w-4.5" />
                </div>
                <div className="leading-5">
                  <b>{t("home.hero.ratingTitle")}</b>
                  <div className="text-muted-foreground">{t("home.hero.ratingSubtitle")}</div>
                </div>
              </div>
            </Card>
          </motion.div>
        </div>
      </section>

      {/* ============ COUPON BANNER ============ */}
      {coupon && !couponHidden && (
        <section aria-label="کد تخفیف ویژه" className="mx-auto max-w-6xl px-4 pb-2">
          <div className="animate-fade-up relative overflow-hidden rounded-2xl border-2 border-dashed border-gold-foreground/30 bg-gradient-to-l from-gold via-gold/95 to-gold/85 px-4 py-3.5 shadow-lg shadow-gold/25 sm:px-5">
            <span className="nakhl-sheen" aria-hidden />
            {/* dismiss button */}
            <button
              type="button"
              onClick={dismissCoupon}
              title="بستن بنر تخفیف"
              aria-label="بستن بنر تخفیف"
              className="absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-gold-foreground/10 text-gold-foreground/70 transition hover:bg-gold-foreground/20 hover:text-gold-foreground focus-visible:outline-2 focus-visible:outline-gold-foreground"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="relative flex flex-col items-stretch gap-3 pl-8 sm:flex-row sm:items-center sm:pl-0">
              {/* title */}
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gold-foreground/15 text-gold-foreground shadow-inner">
                  <Ticket className="h-5.5 w-5.5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-gold-foreground">{coupon.title}</p>
                  <p className="mt-0.5 text-xs font-bold leading-5 text-gold-foreground/75">
                    {coupon.label} — کد را در گفتگو به هوش نخل بگویید
                  </p>
                </div>
              </div>
              {/* actions */}
              <div className="flex flex-wrap items-center gap-2.5 sm:justify-end">
                <button
                  type="button"
                  onClick={copyCoupon}
                  title="برای کپی کلیک کنید"
                  aria-label={`کپی کد تخفیف ${coupon.code}`}
                  className="inline-flex items-center gap-2 rounded-xl border-2 border-dashed border-gold-foreground/40 bg-white/55 px-3.5 py-2 text-sm font-black tracking-[0.18em] text-gold-foreground transition-all hover:bg-white/85 hover:shadow-md"
                >
                  <span dir="ltr">{coupon.code}</span>
                  {copied ? (
                    <Check className="h-4 w-4 shrink-0" />
                  ) : (
                    <Copy className="h-4 w-4 shrink-0 opacity-70 transition-opacity hover:opacity-100" />
                  )}
                </button>
                {/* ticket divider */}
                <span className="relative hidden h-10 w-px self-center border-r-2 border-dashed border-gold-foreground/30 sm:block" aria-hidden>
                  <span className="absolute -top-3 left-1/2 h-4 w-4 -translate-x-1/2 rounded-full bg-background" />
                  <span className="absolute -bottom-3 left-1/2 h-4 w-4 -translate-x-1/2 rounded-full bg-background" />
                </span>
                <Button onClick={goChat} size="sm" className="h-10 rounded-xl px-4 text-xs font-black shadow-md">
                  سفارش با کد تخفیف
                  <ArrowLeft className="mr-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ============ SPECIALS ============ */}
      {specials.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-6">
          <Reveal>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2.5 text-xl font-extrabold sm:text-2xl">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gold/15 text-gold shadow-inner">
                  <Flame className="h-5 w-5" />
                </span>
                {t("home.specials.title")}
              </h2>
              <div className="mt-3 h-1 w-12 rounded-full bg-gradient-to-l from-primary to-gold" />
            </div>
            <Badge variant="secondary" className="gap-1 bg-gold/15 text-gold-foreground">
              <Star className="h-3.5 w-3.5 text-gold" />
              {t("home.specials.badge")}
            </Badge>
          </div>
          </Reveal>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {specials.map((item, i) => (
              <Reveal key={item.id} delay={i * 90}>
                <SpecialCard item={item} onOrder={goChat} />
              </Reveal>
            ))}
          </div>
        </section>
      )}

      {/* ============ USER FAVORITES ============ */}
      {user && favorites.length > 0 && (
        <section aria-label="موردعلاقه‌های شما" className="mx-auto max-w-6xl px-4 py-6">
          <Reveal>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2.5 text-xl font-extrabold sm:text-2xl">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-red-500/15 text-red-500 shadow-inner">
                    <Heart className="h-5 w-5 fill-red-500" />
                  </span>
                  موردعلاقه‌های شما ❤️
                </h2>
                <div className="mt-3 h-1 w-12 rounded-full bg-gradient-to-l from-red-500 to-gold" />
              </div>
              <Badge variant="secondary" className="gap-1 bg-red-500/10 text-red-500">
                <Heart className="h-3.5 w-3.5" />
                {toPersianDigits(favorites.length)} مورد
              </Badge>
            </div>
          </Reveal>
          <div className="flex gap-4 overflow-x-auto pb-3 nice-scroll">
            {favorites.map((fav, i) => (
              <Reveal key={fav.id} delay={Math.min(i * 60, 240)} className="h-full w-72 shrink-0 sm:w-80">
                <MenuCard item={fav.menuItem} onOrder={goChat} />
              </Reveal>
            ))}
          </div>
        </section>
      )}

      {/* ============ RECENTLY VIEWED ============ */}
      {recentlyViewed.length > 0 && (
        <section aria-label="اخیراً دیده‌شده‌ها" className="mx-auto max-w-6xl px-4 py-6">
          <Reveal>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2.5 text-xl font-extrabold sm:text-2xl">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-inner">
                    <Sparkles className="h-5 w-5" />
                  </span>
                  اخیراً دیده‌شده‌ها 👀
                </h2>
                <div className="mt-3 h-1 w-12 rounded-full bg-gradient-to-l from-primary to-gold" />
              </div>
              <Badge variant="secondary" className="gap-1 bg-primary/10 text-primary">
                {toPersianDigits(recentlyViewed.length)} مورد
              </Badge>
            </div>
          </Reveal>
          {(() => {
            const allItems = menu.flatMap((c) => c.items);
            const recentItems = recentlyViewed
              .map((id) => allItems.find((i) => i.id === id))
              .filter((it): it is MenuItemPublic => Boolean(it));
            if (recentItems.length === 0) {
              return (
                <p className="rounded-2xl border border-dashed border-muted-foreground/30 px-4 py-6 text-center text-xs text-muted-foreground">
                  موارد دیده‌شده در منوی فعلی دیگر در دسترس نیست.
                </p>
              );
            }
            return (
              <div className="flex gap-4 overflow-x-auto pb-3 nice-scroll">
                {recentItems.map((item, i) => (
                  <Reveal key={item.id} delay={Math.min(i * 60, 240)} className="h-full w-72 shrink-0 sm:w-80">
                    <MenuCard item={item} onOrder={goChat} />
                  </Reveal>
                ))}
              </div>
            );
          })()}
        </section>
      )}

      {/* ============ STATS BAND ============ */}
      <section aria-label="آمار رستوران نخل" className="mx-auto max-w-6xl px-4 py-6">
        <Reveal>
        <div className="grid grid-cols-2 gap-3 rounded-3xl border border-primary/15 bg-gradient-to-l from-primary/10 via-primary/5 to-gold/10 p-4 sm:gap-4 sm:p-6 lg:grid-cols-4">
          {stats.map((s, i) => (
            <div
              key={s.label}
              className="animate-fade-up flex items-center gap-3 rounded-2xl bg-card/60 p-3 transition-transform duration-300 hover:scale-[1.03] sm:p-4"
              style={{ animationDelay: `${i * 0.1}s` }}
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-inner sm:h-14 sm:w-14">
                <s.icon className="h-6 w-6 sm:h-7 sm:w-7" />
              </span>
              <div>
                <div className="text-base font-black leading-6 sm:text-lg">{s.value}</div>
                <div className="text-[11px] font-semibold text-muted-foreground sm:text-xs">{s.label}</div>
              </div>
            </div>
          ))}
        </div>
        </Reveal>
      </section>

      {/* ============ HOW IT WORKS ============ */}
      <section className="mx-auto max-w-6xl px-4 py-10">
        <div className="mb-8 text-center">
          <Reveal>
          <h2 className="text-2xl font-black">{t("home.how.title")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("home.how.subtitle")}</p>
          <div className="mx-auto mt-3.5 h-1 w-12 rounded-full bg-gradient-to-l from-primary to-gold" />
          </Reveal>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {howSteps.map((step, i) => (
            <Reveal key={i} delay={i * 80} className="h-full">
            <Card className="relative h-full gap-0 overflow-hidden rounded-2xl p-5 text-center transition-all hover:-translate-y-1 hover:shadow-lg">
              {/* faded step watermark for depth */}
              <span
                className="pointer-events-none absolute -top-3 left-2 select-none text-6xl font-black text-primary/6"
                aria-hidden
              >
                {toPersianDigits(i + 1)}
              </span>
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-inner">
                <step.icon className="h-7 w-7" />
              </div>
              <h3 className="font-extrabold">{step.title}</h3>
              <p className="mt-1.5 text-xs leading-6 text-muted-foreground">{step.desc}</p>
            </Card>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ============ MENU PREVIEW + LIVE SEARCH ============ */}
      <section id="menu-preview" className="mx-auto max-w-6xl scroll-mt-28 px-4 py-8">
        <Reveal>
        <div className="mb-5 flex items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2.5 text-xl font-extrabold sm:text-2xl">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-inner">
                <Leaf className="h-5 w-5" />
              </span>
              {t("home.menu.title")}
            </h2>
            <div className="mt-3 h-1 w-12 rounded-full bg-gradient-to-l from-primary to-gold" />
          </div>
          <Button onClick={goChat} size="sm" className="rounded-xl font-bold">
            <Bot className="ml-1.5 h-4 w-4" />
            {t("home.menu.cta")}
          </Button>
        </div>
        </Reveal>

        {/* live search box */}
        <div className="relative mb-5">
          <Search className="absolute right-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("home.menu.searchPlaceholder")}
            className="h-12 rounded-2xl border-primary/20 bg-card pr-11 pl-11 text-sm shadow-sm"
            aria-label="جستجو در منوی رستوران"
          />
          {query !== "" && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute left-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-muted text-muted-foreground transition hover:bg-destructive/15 hover:text-destructive"
              aria-label="پاک کردن جستجو"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* ============ advanced filter bar ============ */}
        <div className="mb-5 rounded-2xl border border-primary/12 bg-card/70 p-3 shadow-sm backdrop-blur-sm">
          {/* quick chips row */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFilters((f) => ({ ...f, vegetarian: !f.vegetarian }))}
              aria-pressed={filters.vegetarian}
              className={`flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-xs font-bold transition-all ${
                filters.vegetarian
                  ? "border-emerald-600 bg-emerald-600 text-white shadow-sm"
                  : "border-muted-foreground/25 bg-card text-muted-foreground hover:border-emerald-600/50 hover:text-emerald-700 dark:hover:text-emerald-400"
              }`}
            >
              <Leaf className="h-3.5 w-3.5" />
              گیاهی
            </button>
            <button
              type="button"
              onClick={() => setFilters((f) => ({ ...f, spicy: !f.spicy }))}
              aria-pressed={filters.spicy}
              className={`flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-xs font-bold transition-all ${
                filters.spicy
                  ? "border-red-600 bg-red-600 text-white shadow-sm"
                  : "border-muted-foreground/25 bg-card text-muted-foreground hover:border-red-600/50 hover:text-red-600"
              }`}
            >
              <Flame className="h-3.5 w-3.5" />
              تند
            </button>

            <div className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden />

            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              aria-expanded={filtersOpen}
              className={`flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-xs font-bold transition-all ${
                filtersOpen || activeFilterCount > 2
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-muted-foreground/25 bg-card text-muted-foreground hover:border-primary/40 hover:text-primary"
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              فیلترهای بیشتر
              {activeFilterCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-black text-primary-foreground">
                  {toPersianDigits(activeFilterCount)}
                </span>
              )}
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform duration-300 ${filtersOpen ? "rotate-180" : ""}`}
              />
            </button>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="flex h-9 items-center gap-1 rounded-full px-3 text-xs font-bold text-destructive/90 transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                پاک کردن فیلترها
              </button>
            )}

            {/* live match count */}
            {hasActiveFilters && !searching && (
              <span className="mr-auto flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
                <Badge className="rounded-full bg-primary px-2 text-[10px] font-black text-primary-foreground">
                  {toPersianDigits(menu.reduce((n, c) => n + filteredItemsFor(c).length, 0))}
                </Badge>
                غذا با فیلترهای فعلی
              </span>
            )}
          </div>

          {/* active filter chips (removable) */}
          {hasActiveFilters && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-dashed border-border/70 pt-2.5">
              {filters.vegetarian && (
                <button
                  type="button"
                  onClick={() => setFilters((f) => ({ ...f, vegetarian: false }))}
                  className="group flex h-7 items-center gap-1 rounded-full bg-emerald-600/12 px-2.5 text-[10px] font-bold text-emerald-700 transition-colors hover:bg-emerald-600/20 dark:text-emerald-400"
                >
                  <Leaf className="h-3 w-3" />
                  گیاهی
                  <X className="h-3 w-3 opacity-60 transition-opacity group-hover:opacity-100" />
                </button>
              )}
              {filters.spicy && (
                <button
                  type="button"
                  onClick={() => setFilters((f) => ({ ...f, spicy: false }))}
                  className="group flex h-7 items-center gap-1 rounded-full bg-red-600/12 px-2.5 text-[10px] font-bold text-red-700 transition-colors hover:bg-red-600/20 dark:text-red-400"
                >
                  <Flame className="h-3 w-3" />
                  تند
                  <X className="h-3 w-3 opacity-60 transition-opacity group-hover:opacity-100" />
                </button>
              )}
              {filters.maxPrice != null && (
                <button
                  type="button"
                  onClick={() => setFilters((f) => ({ ...f, maxPrice: null }))}
                  className="group flex h-7 items-center gap-1 rounded-full bg-primary/10 px-2.5 text-[10px] font-bold text-primary transition-colors hover:bg-primary/20"
                >
                  <Wallet className="h-3 w-3" />
                  تا {formatToman(filters.maxPrice)}
                  <X className="h-3 w-3 opacity-60 transition-opacity group-hover:opacity-100" />
                </button>
              )}
              {filters.maxCalories != null && (
                <button
                  type="button"
                  onClick={() => setFilters((f) => ({ ...f, maxCalories: null }))}
                  className="group flex h-7 items-center gap-1 rounded-full bg-gold/15 px-2.5 text-[10px] font-bold text-gold-foreground transition-colors hover:bg-gold/25"
                >
                  <Flame className="h-3 w-3" />
                  تا {toPersianDigits(filters.maxCalories)} کالری
                  <X className="h-3 w-3 opacity-60 transition-opacity group-hover:opacity-100" />
                </button>
              )}
              {filters.sort !== "default" && (
                <button
                  type="button"
                  onClick={() => setFilters((f) => ({ ...f, sort: "default" }))}
                  className="group flex h-7 items-center gap-1 rounded-full bg-primary/10 px-2.5 text-[10px] font-bold text-primary transition-colors hover:bg-primary/20"
                >
                  <ArrowDownWideNarrow className="h-3 w-3" />
                  {SORT_OPTIONS.find((o) => o.key === filters.sort)?.label}
                  <X className="h-3 w-3 opacity-60 transition-opacity group-hover:opacity-100" />
                </button>
              )}
            </div>
          )}

          {/* expanded panel: price / calories / sort */}
          <div
            className={`grid transition-all duration-300 ease-out ${
              filtersOpen ? "mt-3 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
            }`}
            aria-hidden={!filtersOpen}
            inert={!filtersOpen}
          >
            <div className={`overflow-hidden ${filtersOpen ? "" : "pointer-events-none invisible"}`}>
              <div className="grid gap-4 rounded-xl bg-muted/40 p-4 sm:grid-cols-2">
                {/* max price slider */}
                <div>
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <label htmlFor="filter-price" className="flex items-center gap-1.5 font-extrabold">
                      <Wallet className="h-3.5 w-3.5 text-primary" />
                      حداکثر قیمت
                    </label>
                    <span className="rounded-lg bg-primary/10 px-2 py-0.5 font-black text-primary">
                      {filters.maxPrice == null ? "همه" : `${formatToman(filters.maxPrice)}▼`}
                    </span>
                  </div>
                  <input
                    id="filter-price"
                    type="range"
                    min={0}
                    max={Math.max(maxMenuPrice, 10000)}
                    step={5000}
                    value={filters.maxPrice ?? Math.max(maxMenuPrice, 10000)}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setFilters((f) => ({ ...f, maxPrice: v >= Math.max(maxMenuPrice, 10000) ? null : v }));
                    }}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted-foreground/20 accent-primary"
                    dir="rtl"
                    aria-label="حداکثر قیمت"
                  />
                  <div className="mt-1 flex justify-between text-[9px] font-bold text-muted-foreground/70">
                    <span>{formatToman(maxMenuPrice)}</span>
                    <span>۰ تومان</span>
                  </div>
                </div>

                {/* max calories slider */}
                <div>
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <label htmlFor="filter-calories" className="flex items-center gap-1.5 font-extrabold">
                      <Flame className="h-3.5 w-3.5 text-gold" />
                      حداکثر کالری
                    </label>
                    <span className="rounded-lg bg-gold/15 px-2 py-0.5 font-black text-gold-foreground">
                      {filters.maxCalories == null ? "همه" : `${toPersianDigits(filters.maxCalories)} کالری`}
                    </span>
                  </div>
                  <input
                    id="filter-calories"
                    type="range"
                    min={0}
                    max={1500}
                    step={50}
                    value={filters.maxCalories ?? 1500}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setFilters((f) => ({ ...f, maxCalories: v >= 1500 ? null : v }));
                    }}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted-foreground/20 accent-primary"
                    dir="rtl"
                    aria-label="حداکثر کالری"
                  />
                  <div className="mt-1 flex justify-between text-[9px] font-bold text-muted-foreground/70">
                    <span>۱۵۰۰</span>
                    <span>۰</span>
                  </div>
                </div>

                {/* sort chips */}
                <div className="sm:col-span-2">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-extrabold">
                    <ArrowDownWideNarrow className="h-3.5 w-3.5 text-primary" />
                    مرتب‌سازی
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {SORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setFilters((f) => ({ ...f, sort: opt.key }))}
                        aria-pressed={filters.sort === opt.key}
                        className={`flex h-8 items-center rounded-full border px-3 text-[11px] font-bold transition-all ${
                          filters.sort === opt.key
                            ? "border-primary bg-primary text-primary-foreground shadow-sm"
                            : "border-muted-foreground/25 bg-card text-muted-foreground hover:border-primary/40 hover:text-primary"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* search results (replaces tab content while searching) */}
        {searching && (
          <div className="animate-fade-up">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-bold">
                <Badge className="rounded-full bg-primary px-2.5 text-primary-foreground">
                  {toPersianDigits(filteredSearchResults.length)}
                </Badge>
                نتیجه برای «{query.trim()}»
                {hasActiveFilters && (
                  <span className="text-[10px] font-bold text-muted-foreground">(با فیلترهای فعال)</span>
                )}
              </p>
              <Button variant="ghost" size="sm" onClick={() => setQuery("")} className="rounded-xl text-muted-foreground">
                <X className="ml-1 h-4 w-4" />
                پاک کردن جستجو
              </Button>
            </div>
            {filteredSearchResults.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-muted-foreground/25 px-6 py-14 text-center">
                <SearchX className="h-11 w-11 text-muted-foreground/40" />
                <p className="text-sm font-extrabold">نتیجه‌ای یافت نشد</p>
                <p className="max-w-sm text-xs leading-6 text-muted-foreground">
                  عبارت دیگری امتحان کنید یا از هوش نخل بپرسید؛ شاید غذای موردنظرتان با اسم دیگری در منو باشد!
                </p>
                <Button onClick={goChat} variant="outline" size="sm" className="mt-1 rounded-xl font-bold text-primary">
                  <Bot className="ml-1.5 h-4 w-4" />
                  پرسیدن از هوش نخل
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredSearchResults.map(({ item, catName }) => (
                  <MenuCard key={item.id} item={item} catName={catName} onOrder={goChat} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* category tabs (kept mounted, hidden while searching) */}
        <div className={searching ? "hidden" : ""}>
          <Tabs defaultValue={foodCats[0]?.id ?? "all"} dir="rtl">
            <TabsList className="h-auto w-full flex-wrap justify-start gap-1 rounded-2xl bg-muted/60 p-1.5">
              {foodCats.map((cat) => (
                <TabsTrigger
                  key={cat.id}
                  value={cat.id}
                  className="rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground sm:text-sm"
                >
                  {cat.name}
                </TabsTrigger>
              ))}
              {drinksCat && (
                <TabsTrigger value={drinksCat.id} className="rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground sm:text-sm">
                  {drinksCat.name}
                </TabsTrigger>
              )}
            </TabsList>

            {menu.map((cat) => (
              <TabsContent key={cat.id} value={cat.id} className="mt-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredItemsFor(cat).map((item) => (
                    <MenuCard key={item.id} item={item} />
                  ))}
                </div>
                {filteredItemsFor(cat).length === 0 && (
                  <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-muted-foreground/20 px-6 py-10 text-center">
                    <SearchX className="h-8 w-8 text-muted-foreground/35" />
                    <p className="text-xs font-extrabold">هیچ غذایی در «{cat.name}» با فیلترهای فعلی مطابقت ندارد</p>
                    <Button
                      onClick={resetFilters}
                      variant="outline"
                      size="sm"
                      className="mt-1 rounded-xl text-xs font-bold text-primary"
                    >
                      <RotateCcw className="ml-1.5 h-3.5 w-3.5" />
                      پاک کردن فیلترها
                    </Button>
                  </div>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </section>

      {/* ============ ABOUT ============ */}
      <section id="about" className="mx-auto max-w-6xl scroll-mt-28 px-4 py-12">
        <div className="grid items-center gap-12 md:grid-cols-2">
          {/* text side */}
          <Reveal>
          <div>
            <SectionHeading icon={Sparkles} title={t("home.about.title")} />
            <p className="mt-5 text-sm leading-8 text-muted-foreground">
              {siteSettings.aboutText}
            </p>
            <p className="mt-4 text-sm leading-8 text-muted-foreground">
              {t("home.about.text")}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {aboutChips.map((chip) => (
                <span
                  key={chip.label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3.5 py-1.5 text-xs font-bold text-primary transition-transform hover:scale-105"
                >
                  <chip.icon className="h-4 w-4" />
                  {chip.label}
                </span>
              ))}
            </div>
          </div>
          </Reveal>

          {/* visual side */}
          <Reveal delay={120} className="mx-auto w-full max-w-md">
          <div className="relative mx-auto w-full max-w-md">
            <div className="absolute -inset-4 rounded-[2.4rem] bg-gradient-to-l from-primary/15 to-gold/25 blur-2xl" aria-hidden />
            <div className="relative overflow-hidden rounded-[2rem] border-4 border-card shadow-2xl shadow-primary/20 transition-transform duration-500 hover:rotate-1 hover:scale-[1.01]">
              <ContentImage
                src={img("home.about.image")}
                alt={t("home.about.imageCaptionTitle")}
                width={720}
                height={540}
                className="h-72 w-full object-cover sm:h-80"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent p-4 pt-10 text-white">
                <div className="text-sm font-bold">{t("home.about.imageCaptionTitle")}</div>
                <div className="text-xs opacity-90">{t("home.about.imageCaptionSubtitle")}</div>
              </div>
            </div>
            <Card className="nakhl-float absolute -bottom-5 right-4 gap-0 rounded-2xl border-gold/40 p-3.5 shadow-xl">
              <div className="flex items-center gap-2.5 text-xs">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold text-white">
                  <Award className="h-5 w-5" />
                </span>
                <div className="leading-5">
                  <b className="text-sm">{t("home.about.badgeTitle")}</b>
                  <div className="text-muted-foreground">{t("home.about.badgeSubtitle")}</div>
                </div>
              </div>
            </Card>
          </div>
          </Reveal>
        </div>
      </section>

      {/* ============ FAQ ============ */}
      <section id="faq" className="mx-auto max-w-3xl scroll-mt-28 px-4 py-12">
        <Reveal>
        <SectionHeading
          icon={HelpCircle}
          title={t("home.faq.title")}
          subtitle={t("home.faq.subtitle")}
          center
        />
        </Reveal>
        <Reveal delay={100}>
        <Card className="mt-7 gap-0 rounded-2xl px-3 py-2 sm:px-5">
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((f, i) => (
              <AccordionItem key={i} value={`faq-${i}`}>
                <AccordionTrigger className="text-right text-sm font-extrabold sm:text-base">{f.q}</AccordionTrigger>
                <AccordionContent className="text-xs leading-7 text-muted-foreground sm:text-sm">{f.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Card>
        </Reveal>
      </section>

      {/* ============ CONTACT ============ */}
      <section id="contact" className="mx-auto max-w-6xl scroll-mt-28 px-4 py-12">
        <Reveal>
        <SectionHeading icon={Phone} title={t("home.contact.title")} subtitle={t("home.contact.subtitle")} />
        </Reveal>
        <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            {
              icon: MapPin,
              title: "آدرس رستوران",
              content: siteSettings.address,
              ltr: false,
            },
            {
              icon: Phone,
              title: "تلفن سفارش",
              content: prettyPhone(siteSettings.phone),
              ltr: true,
            },
            {
              icon: Clock,
              title: "ساعات کاری",
              content: siteSettings.workingHours,
              ltr: false,
            },
          ].map((info, i) => (
            <Reveal key={info.title} delay={i * 90} className="h-full">
            <Card className="group h-full gap-0 rounded-2xl p-5 text-center transition-all hover:-translate-y-1 hover:shadow-lg">
              <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-inner transition-transform group-hover:scale-110">
                <info.icon className="h-6 w-6" />
              </span>
              <h3 className="text-sm font-extrabold">{info.title}</h3>
              <p
                className={`mt-1.5 text-xs font-bold leading-6 text-muted-foreground ${info.ltr ? "tracking-wide" : ""}`}
                dir={info.ltr ? "ltr" : undefined}
              >
                {info.content}
              </p>
            </Card>
            </Reveal>
          ))}
        </div>

        {/* stylized map placeholder */}
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${siteSettings.restaurantName} ${siteSettings.city} ${siteSettings.address}`)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="group relative mt-4 flex h-56 items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-primary/25 bg-primary/5 transition-all hover:border-primary/50 hover:shadow-xl sm:h-64"
          aria-label="نمایش آدرس رستوران نخل روی نقشه گوگل‌مپ"
        >
          <div className="palm-pattern absolute inset-0 opacity-80" aria-hidden />
          <div className="relative flex flex-col items-center gap-2.5 text-center">
            <span className="animate-pulse-ring flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform group-hover:scale-110">
              <MapPin className="h-7 w-7" />
            </span>
            <span className="text-sm font-extrabold">{siteSettings.restaurantName} {siteSettings.city}</span>
            <span className="max-w-xs px-4 text-xs leading-6 text-muted-foreground">{siteSettings.address}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-4 py-1.5 text-xs font-bold text-primary shadow-sm transition-transform group-hover:scale-105">
              روی نقشه نمایش
              <ExternalLink className="h-3.5 w-3.5" />
            </span>
          </div>
        </a>
      </section>

      {/* ============ CTA ============ */}
      <section className="mx-auto max-w-6xl px-4 py-10">
        <Reveal>
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-l from-primary via-primary to-primary/80 px-6 py-12 text-center text-primary-foreground shadow-2xl shadow-primary/30">
          <div className="palm-pattern absolute inset-0 opacity-15" aria-hidden />
          <div className="relative">
            <Bot className="mx-auto mb-4 h-14 w-14" />
            <h2 className="text-2xl font-black md:text-3xl">{t("home.cta.title")}</h2>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-7 opacity-90">
              {t("home.cta.subtitle")}
            </p>
            <Button
              onClick={goChat}
              size="lg"
              className="mt-6 h-14 rounded-2xl bg-white px-8 text-base font-black text-primary shadow-xl transition-transform hover:scale-105"
            >
              <Bot className="ml-2 h-6 w-6" />
              {t("home.cta.button")}
            </Button>
          </div>
        </div>
        </Reveal>
      </section>
    </div>
  );
}
