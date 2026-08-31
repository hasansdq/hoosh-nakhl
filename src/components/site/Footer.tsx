"use client";

import { useAppStore } from "@/lib/store";
import { NakhlLogo, AdminLink, prettyPhone } from "./Header";
import { Instagram, Send, MapPin, Phone, Clock, Heart, ShieldCheck, CreditCard, Timer, Mail } from "lucide-react";

export function SiteFooter() {
  const { setView, user, setAuthOpen, siteSettings } = useAppStore();

  const go = (v: "home" | "chat" | "cart" | "track" | "orders" | "profile") => {
    if ((v === "chat" || v === "orders" || v === "profile") && !user) {
      setAuthOpen(true, v);
      return;
    }
    // سبد خرید و رهگیری بدون نیاز به ورود در دسترس هستند
    setView(v);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const telHref = `tel:+98${siteSettings.phone.replace(/\D/g, "").replace(/^0/, "")}`;
  const instagramUrl = siteSettings.instagram
    ? `https://instagram.com/${siteSettings.instagram.replace(/^@/, "")}`
    : null;
  const telegramUrl = siteSettings.telegram
    ? `https://t.me/${siteSettings.telegram.replace(/^@/, "")}`
    : null;

  return (
    <footer className="mt-auto w-full border-t bg-card/60">
      {/* gradient hairline */}
      <div className="h-1 w-full bg-gradient-to-l from-primary/60 via-gold/50 to-primary/60" aria-hidden />

      <div className="mx-auto max-w-6xl px-4 pb-24 pt-10 sm:pb-10">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          {/* brand + about (CMS) */}
          <div>
            <div className="flex items-center gap-3">
              <NakhlLogo size={44} />
              <div>
                <div className="text-lg font-extrabold">{siteSettings.restaurantName}</div>
                <div className="text-xs text-muted-foreground">{siteSettings.restaurantTagline}</div>
              </div>
            </div>
            <p className="mt-4 text-sm leading-7 text-muted-foreground">{siteSettings.aboutText}</p>
            {(instagramUrl || telegramUrl) && (
              <div className="mt-4 flex items-center gap-2">
                <span className="text-xs font-bold text-muted-foreground">ما را دنبال کنید:</span>
                {instagramUrl && (
                  <a
                    href={instagramUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-10 w-10 items-center justify-center rounded-xl border text-muted-foreground transition hover:-translate-y-0.5 hover:border-primary hover:bg-primary/5 hover:text-primary hover:shadow-md active:scale-95"
                    aria-label="اینستاگرام رستوران نخل"
                  >
                    <Instagram className="h-5 w-5" />
                  </a>
                )}
                {telegramUrl && (
                  <a
                    href={telegramUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-10 w-10 items-center justify-center rounded-xl border text-muted-foreground transition hover:-translate-y-0.5 hover:border-primary hover:bg-primary/5 hover:text-primary hover:shadow-md active:scale-95"
                    aria-label="تلگرام رستوران نخل"
                  >
                    <Send className="h-5 w-5" />
                  </a>
                )}
              </div>
            )}
          </div>

          {/* quick links */}
          <div>
            <h3 className="mb-4 text-sm font-bold">دسترسی سریع</h3>
            <ul className="space-y-2.5 text-sm text-muted-foreground">
              <li><button onClick={() => go("home")} className="transition hover:text-primary">صفحه اصلی</button></li>
              <li><button onClick={() => go("chat")} className="transition hover:text-primary">سفارش با هوش نخل</button></li>
              <li><button onClick={() => go("cart")} className="transition hover:text-primary">سبد خرید</button></li>
              <li><button onClick={() => go("orders")} className="transition hover:text-primary">سفارش‌های من</button></li>
              <li><button onClick={() => go("track")} className="transition hover:text-primary">رهگیری سفارش</button></li>
              <li><button onClick={() => go("profile")} className="transition hover:text-primary">پروفایل من</button></li>
              <li><AdminLink /></li>
            </ul>
          </div>

          {/* contact (CMS) */}
          <div>
            <h3 className="mb-4 text-sm font-bold">تماس با ما</h3>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                {siteSettings.address}
              </li>
              {siteSettings.phone && (
                <li>
                  <a href={telHref} className="flex items-center gap-2 transition hover:text-primary">
                    <Phone className="h-4 w-4 shrink-0 text-primary" />
                    <span dir="ltr" className="font-semibold">{prettyPhone(siteSettings.phone)}</span>
                  </a>
                </li>
              )}
              {siteSettings.email && (
                <li>
                  <a href={`mailto:${siteSettings.email}`} className="flex items-center gap-2 transition hover:text-primary" dir="ltr">
                    <Mail className="h-4 w-4 shrink-0 text-primary" />
                    <span className="truncate">{siteSettings.email}</span>
                  </a>
                </li>
              )}
              <li className="flex items-start gap-2">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                {siteSettings.workingHours}
              </li>
            </ul>
          </div>
        </div>

        {/* trust strip */}
        <div className="mt-8 grid grid-cols-1 gap-3 rounded-2xl border bg-background/60 p-4 sm:grid-cols-3">
          <div className="flex items-center justify-center gap-2 text-xs font-semibold text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            پرداخت امن از طریق درگاه زرین‌پال
          </div>
          <div className="flex items-center justify-center gap-2 text-xs font-semibold text-muted-foreground">
            <CreditCard className="h-4 w-4 text-primary" />
            پشتیبانی {siteSettings.workingHours}
          </div>
          <div className="flex items-center justify-center gap-2 text-xs font-semibold text-muted-foreground">
            <Timer className="h-4 w-4 text-primary" />
            ارسال سریع در سراسر {siteSettings.city}
          </div>
        </div>

        <div className="mt-6 flex flex-col items-center justify-between gap-3 border-t pt-6 text-xs text-muted-foreground sm:flex-row">
          <span>© ۱۴۰۵ {siteSettings.restaurantName} {siteSettings.city} — تمامی حقوق محفوظ است.</span>
          <span className="flex items-center gap-1">
            ساخته شده با <Heart className="h-3.5 w-3.5 text-red-500" /> و هوش مصنوعی
          </span>
        </div>
      </div>
    </footer>
  );
}
