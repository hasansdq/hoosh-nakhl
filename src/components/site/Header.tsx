"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { motion, useScroll, useSpring, AnimatePresence } from "framer-motion";
import { useAppStore, type ViewName, type SiteSettings } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useCartStore, useCartHydrated, cartTotalCount } from "@/lib/cart-store";
import { Bot, Menu as MenuIcon, User as UserIcon, Package, PackageSearch, ShoppingCart, LogOut, Sparkles, Phone, Clock, LayoutDashboard, Instagram, ChevronLeft } from "lucide-react";
import { formatPhone, toPersianDigits } from "@/lib/fa";
import { fullName, api } from "@/lib/client-api";

const NAV_ITEMS: { key: ViewName; label: string; icon: React.ElementType }[] = [
  { key: "home", label: "خانه", icon: MenuIcon },
  { key: "chat", label: "هوش نخل", icon: Bot },
  { key: "cart", label: "سبد خرید", icon: ShoppingCart },
  { key: "orders", label: "سفارش‌ها", icon: Package },
  { key: "track", label: "رهگیری", icon: PackageSearch },
  { key: "profile", label: "پروفایل", icon: UserIcon },
];

/** Pretty-print a landline/mobile number stored in CMS: 03434300000 → ۰۳۴-۳۴۳۰۰۰۰۰ */
export function prettyPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) {
    return toPersianDigits(`${digits.slice(0, 3)}-${digits.slice(3)}`);
  }
  return toPersianDigits(raw);
}

export function NakhlLogo({ size = 40 }: { size?: number }) {
  return (
    <div
      className="relative flex items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25 transition-transform duration-300 group-hover:scale-105 group-hover:rotate-3"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {/* soft gold ring glow on hover */}
      <span className="pointer-events-none absolute -inset-1 rounded-[1.15rem] bg-gold/0 transition-all duration-300 group-hover:bg-gold/15 group-hover:shadow-[0_0_24px_var(--gold)]" />
      <svg viewBox="0 0 48 48" fill="none" className="w-2/3 h-2/3">
        <path d="M24 40V22" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <path d="M24 22C24 22 20 16 12 15C16 20 19 22 24 22Z" fill="currentColor" />
        <path d="M24 22C24 22 28 16 36 15C32 20 29 22 24 22Z" fill="currentColor" />
        <path d="M24 24C24 24 17 22 12 25C17 27 21 26 24 24Z" fill="currentColor" opacity="0.85" />
        <path d="M24 24C24 24 31 22 36 25C31 27 27 26 24 24Z" fill="currentColor" opacity="0.85" />
        <path d="M24 21C24 21 22 12 24 6C26 12 24 21 24 21Z" fill="currentColor" opacity="0.9" />
        <path d="M18 40h12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/** Thin gold progress bar under the header — fills as the page scrolls (RTL: grows right→left) */
function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 28, mass: 0.4 });
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[2.5px] origin-right bg-gradient-to-l from-primary via-gold to-primary"
      style={{ scaleX }}
    />
  );
}

export function SiteHeader() {
  const { user, view, setView, setAuthOpen, siteSettings } = useAppStore();
  const cartHydrated = useCartHydrated();
  const cartItems = useCartStore((s) => s.items);
  const cartCount = cartHydrated ? cartTotalCount(cartItems) : 0;
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleLogout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  };

  const navClick = (v: ViewName) => {
    setMobileOpen(false);
    if ((v === "chat" || v === "orders" || v === "profile") && !user) {
      setAuthOpen(true, v);
      return;
    }
    // «سبد خرید» و «رهگیری سفارش» عمومی هستند و نیازی به ورود ندارند
    setView(v);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const tel = useMemo(() => {
    const d = siteSettings.phone.replace(/\D/g, "");
    return d ? `+98${d.replace(/^0/, "")}` : "";
  }, [siteSettings.phone]);

  return (
    <motion.header
      initial={{ y: -28, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 160, damping: 22 }}
      className={`sticky top-0 z-40 w-full transition-all duration-300 ${
        scrolled
          ? "glass-card border-b border-border/80 shadow-[0_8px_30px_-12px_oklch(0.24_0.02_130/0.18)]"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      {/* ── info strip (md+): tagline + CMS phone/hours ── */}
      <div className="hidden overflow-hidden bg-gradient-to-l from-primary via-primary to-primary/90 text-primary-foreground md:block">
        {/* subtle sheen */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.06]" aria-hidden />
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-1.5 text-[11px]">
          <motion.span
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 }}
            className="flex items-center gap-1.5 font-semibold"
          >
            <Sparkles className="h-3.5 w-3.5 text-gold" />
            با «هوش نخل» سفارش بده؛ مثل حضوری!
          </motion.span>
          <motion.span
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.25 }}
            className="flex items-center gap-3"
          >
            {tel && (
              <a
                href={`tel:${tel}`}
                className="flex items-center gap-1 transition-opacity hover:opacity-80"
                aria-label={`تماس با رستوران: ${prettyPhone(siteSettings.phone)}`}
              >
                <Phone className="h-3.5 w-3.5 text-gold/90" />
                <span dir="ltr" className="font-semibold tracking-wide">
                  {prettyPhone(siteSettings.phone)}
                </span>
              </a>
            )}
            <span className="opacity-40">|</span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 text-gold/90" />
              {siteSettings.workingHours}
            </span>
          </motion.span>
        </div>
      </div>

      {/* ── main bar ── */}
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
        {/* brand */}
        <button
          onClick={() => navClick("home")}
          className="group flex min-w-0 items-center gap-2.5 sm:gap-3"
          aria-label={`${siteSettings.restaurantName} — صفحه اصلی`}
        >
          <span className="origin-right scale-95 sm:scale-100">
            <NakhlLogo size={44} />
          </span>
          <div className="min-w-0 text-right leading-tight">
            <div className="truncate text-base font-extrabold sm:text-lg">{siteSettings.restaurantName}</div>
            <div className="hidden text-[11px] text-muted-foreground sm:block">
              {siteSettings.city} • سفارش آنلاین هوشمند
            </div>
          </div>
        </button>

        {/* desktop nav — sliding active pill */}
        <nav className="hidden items-center gap-0.5 md:flex lg:gap-1" aria-label="ناوبری اصلی">
          {NAV_ITEMS.map((item) => {
            const active = view === item.key;
            return (
              <button
                key={item.key}
                onClick={() => navClick(item.key)}
                aria-current={active ? "page" : undefined}
                className={`relative flex items-center rounded-xl px-2.5 py-2 text-[13px] font-semibold transition-colors lg:px-3.5 lg:text-sm ${
                  active ? "text-primary-foreground" : "text-foreground/75 hover:text-foreground"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="nav-active-pill"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    className="absolute inset-0 rounded-xl bg-primary shadow-lg shadow-primary/25"
                    aria-hidden
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  {item.key === "chat" && <Bot className="h-4 w-4" />}
                  {item.label}
                  {item.key === "cart" && cartCount > 0 && (
                    <span
                      key={cartCount}
                      className="animate-badge-pop inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-black text-white shadow-sm"
                    >
                      {toPersianDigits(cartCount)}
                    </span>
                  )}
                </span>
                {active && (
                  <span
                    className="absolute -bottom-[5px] right-1/2 h-1.5 w-1.5 translate-x-1/2 rounded-full bg-gold shadow-sm"
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* actions */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* cart quick-access (mobile + desktop) */}
          <button
            onClick={() => navClick("cart")}
            className={`relative flex h-10 w-10 items-center justify-center rounded-xl border shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md active:scale-95 ${
              view === "cart"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-foreground hover:border-primary/40"
            }`}
            aria-label={`سبد خرید${cartCount > 0 ? ` (${toPersianDigits(cartCount)} قلم)` : ""}`}
          >
            <ShoppingCart className="h-5 w-5" />
            <AnimatePresence>
              {cartCount > 0 && (
                <motion.span
                  key={cartCount}
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.4, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 500, damping: 20 }}
                  className="absolute -top-1.5 -left-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-black text-white shadow-md"
                >
                  {toPersianDigits(cartCount)}
                </motion.span>
              )}
            </AnimatePresence>
          </button>

          {/* theme toggle — visible on every breakpoint */}
          <ThemeToggle />

          {user ? (
            <DropdownMenu dir="rtl">
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-2 rounded-full border bg-card p-1 pl-2.5 shadow-sm transition hover:shadow-md active:scale-95 sm:pl-3"
                  aria-label="حساب کاربری"
                >
                  <Avatar className="h-9 w-9">
                    {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="آواتار" /> : null}
                    <AvatarFallback className="bg-primary/10 text-primary text-sm font-bold">
                      {(user.firstName ?? "ن").slice(0, 1)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden max-w-24 truncate text-sm font-semibold sm:block">
                    {fullName(user) || formatPhone(user.phone)}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {fullName(user) || "کاربر نخل"}
                  <div className="font-normal" dir="ltr">{formatPhone(user.phone)}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navClick("profile")}>
                  <UserIcon className="ml-2 h-4 w-4" /> پروفایل من
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navClick("orders")}>
                  <Package className="ml-2 h-4 w-4" /> سفارش‌های من
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navClick("chat")}>
                  <Bot className="ml-2 h-4 w-4" /> هوش نخل
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
                  <LogOut className="ml-2 h-4 w-4" /> خروج از حساب
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              onClick={() => setAuthOpen(true)}
              className="shine-sweep h-10 rounded-xl px-4 text-[13px] font-bold shadow-lg shadow-primary/20 sm:text-sm"
            >
              ورود / ثبت‌نام
            </Button>
          )}

          <Sheet dir="rtl" open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="rounded-xl md:hidden" aria-label="منوی موبایل">
                <MenuIcon className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 overflow-y-auto p-5">
              <SheetTitle className="text-right">رستوران نخل</SheetTitle>

              {/* CMS contact mini-card */}
              <div className="mt-4 space-y-2 rounded-2xl border bg-muted/40 p-3 text-xs text-muted-foreground">
                {tel && (
                  <a href={`tel:${tel}`} className="flex items-center gap-2 transition hover:text-primary">
                    <Phone className="h-3.5 w-3.5 text-primary" />
                    <span dir="ltr" className="font-bold">{prettyPhone(siteSettings.phone)}</span>
                  </a>
                )}
                <div className="flex items-start gap-2">
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  {siteSettings.workingHours}
                </div>
                {siteSettings.instagram && (
                  <a
                    href={`https://instagram.com/${siteSettings.instagram}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 transition hover:text-primary"
                  >
                    <Instagram className="h-3.5 w-3.5 text-primary" />
                    {siteSettings.instagram}
                  </a>
                )}
              </div>

              <nav className="mt-5 flex flex-col gap-1.5" aria-label="ناوبری موبایل">
                <div className="flex items-center justify-between px-4 py-2">
                  <span className="text-xs text-muted-foreground">ظاهر سایت</span>
                  <ThemeToggle />
                </div>
                {NAV_ITEMS.map((item, i) => (
                  <motion.button
                    key={item.key}
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.05 * i }}
                    onClick={() => navClick(item.key)}
                    className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition ${
                      view === item.key ? "bg-primary text-primary-foreground shadow-md shadow-primary/20" : "hover:bg-accent"
                    }`}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                    {item.key === "cart" && cartCount > 0 && (
                      <span className="mr-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-black text-white shadow-sm">
                        {toPersianDigits(cartCount)}
                      </span>
                    )}
                    {item.key !== "cart" && <ChevronLeft className="mr-auto h-4 w-4 opacity-30" />}
                  </motion.button>
                ))}
                {!user && (
                  <Button onClick={() => { setMobileOpen(false); setAuthOpen(true); }} className="mt-3 font-bold">
                    ورود / ثبت‌نام
                  </Button>
                )}
                {user && (
                  <Button variant="outline" onClick={handleLogout} className="mt-3 text-destructive border-destructive/30">
                    خروج از حساب
                  </Button>
                )}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      <ScrollProgress />
    </motion.header>
  );
}

export function AdminLink() {
  return (
    <Link href="/nk-admin" className="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-primary">
      <LayoutDashboard className="h-3.5 w-3.5" />
      پنل مدیریت
    </Link>
  );
}
