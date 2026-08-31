"use client";

/**
 * AuthPage v2 — تجربهٔ ورود/ثبت‌نام سینمایی رستوران نخل
 * ─────────────────────────────────────────────────────
 * ارتقای چندلایه نسبت به نسخهٔ قبل:
 * - چیدمان تمام‌صفحهٔ غوطه‌ور: کارت فرم + پنل برند تصویری (ken-burns + پارالاکس ماوس)
 * - اسپات‌لایت نرم دنبال‌کنندهٔ ماوس روی کارت فرم
 * - ورودی شماره با چیپ ‎+۹۸، تشخیص اپراتور (همراه اول/ایرانسل/رایتل) و نوار پیشرفت
 * - حباب «پیامک در راه است» با نقطه‌های تایپ + خط اسکن هنگام بررسی کد
 * - آواتار زندهٔ حروف اول نام، کنترل‌های سگمنتی، دکمه‌های گرادیانی با درخشش
 * - چرخانندهٔ نظر مشتریان + کاشی‌های شیشه‌ای ویژگی‌ها + آمار پایانی
 * - کاملاً راست‌چین، اعداد فارسی، سازگار با لایت/دارک و prefers-reduced-motion
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Image from "next/image";
import { useAppStore, type ViewName } from "@/lib/store";
import { api } from "@/lib/client-api";
import { NakhlLogo } from "@/components/site/Header";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  Check,
  Fingerprint,
  Info,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  MessageSquareHeart,
  Pencil,
  Phone,
  Quote,
  RotateCw,
  ShieldCheck,
  Signal,
  Smartphone,
  Sparkles,
  Star,
  Timer,
  Truck,
  User,
  UserRoundCheck,
} from "lucide-react";
import { toast } from "sonner";
import { formatPhone, toEnglishDigits, toPersianDigits } from "@/lib/fa";

type Step = "phone" | "otp" | "register" | "success";
type Purpose = "LOGIN" | "REGISTER" | null;

const RESEND_SECONDS = 120;

const INTENT_LABELS: Record<ViewName, string> = {
  home: "منوی رستوران",
  chat: "هوش نخل",
  cart: "سبد خرید",
  orders: "سفارش‌های من",
  track: "رهگیری سفارش",
  profile: "پروفایل",
};

const STEP_META = [
  { label: "شماره موبایل", icon: Smartphone },
  { label: "کد تأیید", icon: KeyRound },
  { label: "تکمیل اطلاعات", icon: UserRoundCheck },
];

/* گرادیان مشترک دکمه‌های اصلی (نخل → طلایی) */
const CTA_GRADIENT =
  "linear-gradient(to left, var(--primary) 0%, color-mix(in oklch, var(--primary) 68%, var(--gold)) 100%)";

/* ------------------------------------------------------------------ */
/*  تشخیص اپراتور از پیش‌شماره                                          */
/* ------------------------------------------------------------------ */
function detectOperator(digits: string): string | null {
  const d = digits.startsWith("0") ? digits : `0${digits}`;
  if (d.length < 4) return null;
  const p3 = d.slice(0, 3);
  if (p3 === "091" || p3 === "099") return "همراه اول";
  if (p3 === "093" || p3 === "090") return "ایرانسل";
  if (p3 === "092") return "رایتل";
  return null;
}

/* ------------------------------------------------------------------ */
/*  کادرهای کد یکبارمصرف — سفارشی، راست‌چین‌پسند و با انیمیشن          */
/* ------------------------------------------------------------------ */
function OtpBoxes({
  length,
  value,
  onChange,
  onComplete,
  error,
  disabled,
}: {
  length: number;
  value: string;
  onChange: (v: string) => void;
  onComplete: (v: string) => void;
  error: boolean;
  disabled: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [focusIdx, setFocusIdx] = useState(-1);
  const chars = value.split("");

  useEffect(() => {
    const t = setTimeout(() => refs.current[0]?.focus(), 380);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (error) refs.current[0]?.focus();
  }, [error]);

  const commit = (next: string[]) => {
    const joined = next.join("");
    onChange(joined);
    if (next.length === length && next.every((c) => c !== "")) onComplete(joined);
  };

  const handleChange = (i: number, raw: string) => {
    const digits = toEnglishDigits(raw).replace(/\D/g, "");
    if (digits.length === 0) {
      const next = chars.slice();
      next[i] = "";
      onChange(next.join(""));
      return;
    }
    const next = chars.slice();
    if (digits.length > 1) {
      next[i] = digits[digits.length - 1];
    } else {
      next[i] = digits;
    }
    commit(next);
    if (i < length - 1) refs.current[i + 1]?.focus();
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const next = chars.slice();
      if (chars[i]) {
        next[i] = "";
        onChange(next.join(""));
      } else if (i > 0) {
        next[i - 1] = "";
        onChange(next.join(""));
        refs.current[i - 1]?.focus();
      }
    } else if (e.key === "ArrowLeft" && i > 0) {
      e.preventDefault();
      refs.current[i - 1]?.focus();
    } else if (e.key === "ArrowRight" && i < length - 1) {
      e.preventDefault();
      refs.current[i + 1]?.focus();
    }
  };

  const handlePaste = (i: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const text = toEnglishDigits(e.clipboardData.getData("text")).replace(/\D/g, "");
    if (!text) return;
    const next = chars.slice();
    for (let k = 0; k < text.length && i + k < length; k++) next[i + k] = text[k];
    commit(next);
    refs.current[Math.min(i + text.length - 1, length - 1)]?.focus();
  };

  return (
    <div
      dir="ltr"
      className={`flex items-center justify-center gap-2 sm:gap-3.5 ${error ? "animate-shake-x" : ""}`}
      role="group"
      aria-label={`کد تأیید ${toPersianDigits(length)} رقمی`}
    >
      {Array.from({ length }).map((_, i) => {
        const char = chars[i] ?? "";
        const active = focusIdx === i && !disabled;
        return (
          <div
            key={i}
            className="animate-otp-pop relative"
            style={{ "--otp-delay": `${i * 65}ms` } as CSSProperties}
          >
            <input
              ref={(el) => {
                refs.current[i] = el;
              }}
              value={toPersianDigits(char)}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              onPaste={(e) => handlePaste(i, e)}
              onFocus={(e) => {
                setFocusIdx(i);
                e.target.select();
              }}
              onBlur={() => setFocusIdx((f) => (f === i ? -1 : f))}
              inputMode="numeric"
              autoComplete={i === 0 ? "one-time-code" : "off"}
              disabled={disabled}
              aria-label={`رقم ${toPersianDigits(i + 1)}`}
              className={`h-[4.25rem] w-12 rounded-2xl border-2 bg-background text-center text-2xl font-extrabold outline-none transition-all duration-200 sm:w-14 ${
                char ? "animate-otp-fill" : ""
              } ${
                error
                  ? "border-destructive bg-destructive/5 text-destructive"
                  : char
                    ? "border-primary/70 bg-primary/5 text-primary shadow-[0_6px_18px_-6px_color-mix(in_oklch,var(--primary)_45%,transparent)]"
                    : active
                      ? "border-primary ring-4 ring-primary/15"
                      : "border-border text-foreground hover:border-primary/40"
              } ${disabled ? "cursor-not-allowed opacity-60" : "cursor-text"} ${active ? "scale-105" : ""}`}
              style={{ caretColor: "transparent" }}
            />
            {active && !char && !error && (
              <span
                className="animate-otp-caret pointer-events-none absolute left-1/2 top-1/2 h-7 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
                aria-hidden
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  حلقهٔ شمارش معکوس ارسال مجدد                                        */
/* ------------------------------------------------------------------ */
function CountdownRing({ seconds, total }: { seconds: number; total: number }) {
  const R = 20;
  const C = 2 * Math.PI * R;
  const frac = total > 0 ? seconds / total : 0;
  return (
    <span
      className="relative inline-flex h-12 w-12 items-center justify-center"
      role="timer"
      aria-label={`${toPersianDigits(seconds)} ثانیه تا ارسال مجدد`}
    >
      <svg viewBox="0 0 48 48" className="h-12 w-12 -rotate-90">
        <circle cx="24" cy="24" r={R} fill="none" strokeWidth="4" className="stroke-muted" />
        <circle
          cx="24"
          cy="24"
          r={R}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          className="auth-countdown-ring stroke-primary"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - frac)}
        />
      </svg>
      <span className="absolute text-[11px] font-extrabold text-primary">{toPersianDigits(seconds)}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  نشانگر مراحل v2 — نوار مینیمال با اتصال‌های گرادیانی                */
/* ------------------------------------------------------------------ */
function StepIndicator({ current }: { current: number }) {
  return (
    <div className="relative rounded-2xl border border-border/70 bg-muted/40 px-3 py-3.5 sm:px-5">
      <ol className="flex items-start" aria-label="مراحل ورود">
        {STEP_META.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={s.label} className="flex flex-1 items-start">
              <div className="flex w-14 flex-col items-center gap-1.5 sm:w-20">
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all duration-300 ${
                    done
                      ? "animate-chip-pop border-transparent text-primary-foreground"
                      : active
                        ? "animate-pulse-ring border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground"
                  }`}
                  style={
                    done
                      ? { backgroundImage: "linear-gradient(135deg, var(--primary), color-mix(in oklch, var(--primary) 65%, var(--gold)))" }
                      : undefined
                  }
                  aria-current={active ? "step" : undefined}
                >
                  {done ? <Check className="h-4 w-4" /> : <s.icon className="h-4 w-4" />}
                </span>
                <span
                  className={`text-center text-[10px] font-bold leading-tight sm:text-[11px] ${
                    active ? "text-primary" : done ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {s.label}
                </span>
              </div>
              {i < STEP_META.length - 1 && (
                <div className="relative mx-1 mt-4 h-1 flex-1 overflow-hidden rounded-full bg-border/80" aria-hidden>
                  <div
                    className="absolute inset-y-0 right-0 rounded-full transition-all duration-500"
                    style={{
                      width: done ? "100%" : "0%",
                      backgroundImage: "linear-gradient(to left, var(--primary), color-mix(in oklch, var(--primary) 55%, var(--gold)))",
                    }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  چرخانندهٔ نظر مشتریان (پنل برند)                                    */
/* ------------------------------------------------------------------ */
const TESTIMONIALS = [
  {
    text: "سفارش گفتمانی با «هوش نخل» فوق‌العاده بود؛ فقط چت کردم و سفارشم دقیق و سریع ثبت شد.",
    author: "مهدی ر.",
    rating: 5,
  },
  {
    text: "کباب برگ دقیقاً سرِ زمان تعیین‌شده و داغ رسید. کیفیت گوشت و برنج واقعاً ممتازه.",
    author: "زهرا ک.",
    rating: 5,
  },
  {
    text: "بدون تماس تلفنی، بدون دردسر؛ عضو شدم و آدرسم ذخیره می‌شود. تجربهٔ سفارش آنلاین واقعی!",
    author: "حسین ع.",
    rating: 5,
  },
];

function TestimonialRotator() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % TESTIMONIALS.length), 5200);
    return () => clearInterval(t);
  }, []);

  const t = TESTIMONIALS[idx];

  return (
    <figure
      className="relative overflow-hidden rounded-2xl border border-white/15 bg-white/[0.07] p-4.5 backdrop-blur-md sm:p-5"
      aria-live="polite"
    >
      <Quote className="absolute -top-1 left-3 h-10 w-10 rotate-180 text-white/10" aria-hidden />
      <blockquote key={idx} className="animate-fade-up relative text-[13px] font-medium leading-6 text-white/90">
        «{t.text}»
      </blockquote>
      <figcaption className="mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-extrabold text-white"
            style={{ backgroundImage: "linear-gradient(135deg, color-mix(in oklch, var(--gold) 85%, white), var(--gold))" }}
            aria-hidden
          >
            {t.author.slice(0, 1)}
          </span>
          <span className="text-xs font-bold text-white/85">{t.author}</span>
        </div>
        <div className="flex items-center gap-1" aria-label={`امتیاز ${toPersianDigits(t.rating)} از ۵`}>
          {Array.from({ length: t.rating }).map((_, i) => (
            <Star key={i} className="h-3.5 w-3.5 fill-gold text-gold" aria-hidden />
          ))}
        </div>
      </figcaption>
      {/* نقاط نشانگر */}
      <div className="absolute bottom-1.5 left-1/2 flex -translate-x-1/2 gap-1.5" aria-hidden>
        {TESTIMONIALS.map((_, i) => (
          <span
            key={i}
            className={`h-1 rounded-full transition-all duration-500 ${
              i === idx ? "w-5 bg-gold" : "w-1.5 bg-white/30"
            }`}
          />
        ))}
      </div>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/*  پنل برند v2 (سمت چپ — فقط دسکتاپ)                                   */
/*  تصویر سینمایی + پارالاکس + کاشی‌های شیشه‌ای + نظرها + آمار          */
/* ------------------------------------------------------------------ */
function BrandPanel() {
  const parallaxRefs = useRef<(HTMLDivElement | null)[]>([]);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const onParallax = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (reduced.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const dx = (e.clientX - r.left) / r.width - 0.5; // -0.5..0.5
    const dy = (e.clientY - r.top) / r.height - 0.5;
    parallaxRefs.current.forEach((el, i) => {
      if (!el) return;
      const depth = 10 + i * 7;
      el.style.transition = "transform 0.15s linear";
      el.style.transform = `translate(${(-dx * depth).toFixed(1)}px, ${(-dy * depth).toFixed(1)}px)`;
    });
  }, []);

  const resetParallax = useCallback(() => {
    parallaxRefs.current.forEach((el) => {
      if (!el) return;
      el.style.transition = "transform 0.6s cubic-bezier(0.21, 1.02, 0.73, 1)";
      el.style.transform = "translate(0, 0)";
    });
  }, []);

  return (
    <aside
      className="relative hidden overflow-hidden rounded-[2.25rem] border border-white/10 shadow-2xl shadow-primary/20 lg:flex lg:flex-col lg:justify-between lg:p-8 xl:p-10"
      onMouseMove={onParallax}
      onMouseLeave={resetParallax}
      aria-hidden
    >
      {/* ── لایهٔ تصویر سینمایی ── */}
      <div className="absolute inset-0">
        <Image
          src="/food/hero.png"
          alt=""
          fill
          sizes="(min-width: 1024px) 46vw, 0px"
          className="animate-ken-burns object-cover"
          priority
        />
        {/* پوشش گرادیانی سبز نخل */}
        <div className="absolute inset-0 bg-gradient-to-b from-[oklch(0.24_0.055_160)]/70 via-[oklch(0.28_0.07_160)]/78 to-[oklch(0.2_0.05_163)]/92" />
        <div className="absolute inset-0 bg-gradient-to-t from-[oklch(0.18_0.04_165)]/60 via-transparent to-transparent" />
      </div>

      {/* لکه‌های نورانی متحرک */}
      <div className="animate-aurora pointer-events-none absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-gold/20 blur-3xl" />
      <div className="animate-aurora-slow pointer-events-none absolute -bottom-28 -left-16 h-80 w-80 rounded-full bg-[oklch(0.55_0.1_150)]/30 blur-3xl" />
      {/* الگوی نقطه‌ای نخل */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.1]"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.9) 1.5px, transparent 1.5px)",
          backgroundSize: "22px 22px",
        }}
      />
      {/* ذرات معلق */}
      <div className="ambient-particles">
        {Array.from({ length: 9 }).map((_, i) => (
          <span
            key={i}
            style={{
              right: `${8 + i * 10}%`,
              animationDuration: `${7 + (i % 4) * 2.5}s`,
              animationDelay: `${i * 1.1}s`,
            }}
          />
        ))}
      </div>

      {/* ── سربرگ برند ── */}
      <div className="relative flex items-center gap-3">
        <span className="rounded-2xl bg-white/10 p-1 backdrop-blur-md">
          <NakhlLogo size={46} />
        </span>
        <div>
          <div className="text-lg font-extrabold text-white">رستوران نخل</div>
          <div className="text-[11px] text-white/70">رفسنجان • سفارش آنلاین هوشمند</div>
        </div>
      </div>

      {/* ── محتوای میانی ── */}
      <div className="relative space-y-6 py-6">
        <div className="space-y-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-bold text-white backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-gold" />
            بدون رمز عبور؛ فقط یک پیامک!
          </span>
          <h2 className="text-[1.65rem] font-extrabold leading-snug text-white xl:text-4xl">
            به خانوادهٔ <span className="gold-gradient-text">نخل</span> بپیوندید
          </h2>
          <p className="max-w-md text-sm leading-7 text-white/80">
            با عضویت، سفارش‌هایتان را با «هوش نخل» ثبت کنید، آدرس‌ها و علاقه‌مندی‌هایتان را ذخیره کنید و
            تخفیف‌های ویژهٔ اعضا را از دست ندهید.
          </p>
        </div>

        {/* ردیف تصاویر غذای محبوب — با پارالاکس ماوس */}
        <div className="flex items-end justify-center gap-0 py-1">
          {[
            { src: "/food/barg.png", alt: "", caption: "چلوکباب برگ", rotate: "-rotate-6" },
            { src: "/food/koobideh.png", alt: "", caption: "کوبیده", rotate: "rotate-2" },
            { src: "/food/bastani.png", alt: "", caption: "بستنی سنتی", rotate: "-rotate-3" },
          ].map((f, i) => (
            <div
              key={f.src}
              ref={(el) => {
                parallaxRefs.current[i] = el;
              }}
              className={`relative ${i === 1 ? "z-10 -mx-3" : ""}`}
            >
              <figure
                className={`gentle-float w-24 rounded-2xl border border-white/25 bg-white/10 p-1.5 shadow-2xl backdrop-blur transition-transform duration-300 hover:scale-105 ${f.rotate} ${
                  i === 1 ? "mb-3 scale-110" : ""
                }`}
                style={{ animationDelay: `${i * 0.7}s` }}
              >
                <span className="relative block h-20 w-full overflow-hidden rounded-xl">
                  <Image src={f.src} alt={f.alt} fill sizes="96px" className="object-cover" />
                </span>
                <figcaption className="pt-1 text-center text-[10px] font-bold text-white/90">{f.caption}</figcaption>
              </figure>
            </div>
          ))}
        </div>

        {/* کاشی‌های شیشه‌ای ویژگی‌ها */}
        <ul className="grid grid-cols-3 gap-3">
          {[
            { icon: Bot, title: "سفارش گفتمانی", desc: "با هوش نخل، مثل حضوری" },
            { icon: Truck, title: "پیک سریع", desc: "داغ و به‌موقع در رفسنجان" },
            { icon: LockKeyhole, title: "پرداخت امن", desc: "درگاه رسمی زرین‌پال" },
          ].map((f) => (
            <li
              key={f.title}
              className="group flex flex-col items-center gap-2 rounded-2xl border border-white/15 bg-white/[0.08] px-3 py-4 text-center backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:border-white/30 hover:bg-white/[0.14]"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/20 bg-white/10 transition-transform duration-300 group-hover:scale-110">
                <f.icon className="h-5 w-5 text-gold" />
              </span>
              <div>
                <div className="text-xs font-extrabold text-white">{f.title}</div>
                <div className="mt-1 text-[10px] leading-4 text-white/65">{f.desc}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* ── پایین: نظر مشتری + آمار ── */}
      <div className="relative space-y-3.5">
        <TestimonialRotator />
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-white/15 bg-white/5 px-5 py-3 backdrop-blur">
          {[
            { v: "+۳۰", l: "غذای اصیل" },
            { v: "۷ روز", l: "در هفته" },
            { v: "۱۲ تا ۱۲", l: "ظهر تا شب" },
          ].map((s, i) => (
            <div
              key={s.l}
              className="animate-chip-pop text-center"
              style={{ "--chip-delay": `${900 + i * 140}ms` } as CSSProperties}
            >
              <div className="text-base font-extrabold text-gold">{s.v}</div>
              <div className="text-[10px] text-white/70">{s.l}</div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/*  نوار برند موبایل — تصویر + لوگو (فقط < lg)                          */
/* ------------------------------------------------------------------ */
function MobileBrandBand() {
  return (
    <div className="relative mb-5 h-44 overflow-hidden rounded-[1.75rem] border border-border/70 shadow-xl shadow-primary/10 sm:h-48 lg:hidden" aria-hidden>
      <Image src="/food/hero.png" alt="" fill sizes="92vw" className="object-cover" priority />
      <div className="absolute inset-0 bg-gradient-to-t from-[oklch(0.2_0.05_163)]/90 via-[oklch(0.26_0.06_160)]/45 to-transparent" />
      <div className="absolute bottom-0 right-0 flex w-full items-end justify-between p-4">
        <div className="flex items-center gap-3">
          <span className="rounded-2xl bg-white/10 p-1 backdrop-blur-md">
            <NakhlLogo size={40} />
          </span>
          <div>
            <div className="text-base font-extrabold text-white">رستوران نخل</div>
            <div className="text-[10px] text-white/75">رفسنجان • سفارش آنلاین هوشمند</div>
          </div>
        </div>
        <span className="hidden items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[10px] font-bold text-white backdrop-blur sm:inline-flex">
          <Sparkles className="h-3 w-3 text-gold" />
          فقط یک پیامک!
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  صفحهٔ اصلی ورود                                                      */
/* ------------------------------------------------------------------ */
export function AuthPage() {
  const { refreshUser, setView, setAuthOpen, authIntent } = useAppStore();

  const [step, setStep] = useState<Step>("phone");
  const [direction, setDirection] = useState<"fwd" | "back">("fwd");
  const [closing, setClosing] = useState(false);

  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpToken, setOtpToken] = useState("");
  const [purpose, setPurpose] = useState<Purpose>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [otpLength, setOtpLength] = useState(5);
  const [ttlMinutes, setTtlMinutes] = useState<number | null>(null);
  const [otpError, setOtpError] = useState(false);

  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [smsArriving, setSmsArriving] = useState(false);

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    nationalId: "",
    birthDate: "",
    gender: "",
    email: "",
  });

  // موفقیت
  const [welcomeName, setWelcomeName] = useState("");
  const [isNewMember, setIsNewMember] = useState(false);
  const [redirectProgress, setRedirectProgress] = useState(0);

  const phoneRef = useRef<HTMLInputElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const smsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const phoneDigits = toEnglishDigits(phone).replace(/\D/g, "");
  const phoneValid = /^09\d{9}$/.test(phoneDigits) || /^9\d{9}$/.test(phoneDigits);
  const operator = phoneDigits.length >= 4 ? detectOperator(phoneDigits) : null;

  const goStep = useCallback((s: Step, dir: "fwd" | "back" = "fwd") => {
    setDirection(dir);
    setStep(s);
    // حباب «پیامک در راه است» — ۲.۶ ثانیهٔ اول مرحلهٔ OTP
    if (smsTimerRef.current) clearTimeout(smsTimerRef.current);
    if (s === "otp") {
      setSmsArriving(true);
      smsTimerRef.current = setTimeout(() => setSmsArriving(false), 2600);
    } else {
      setSmsArriving(false);
    }
  }, []);

  /* ---------- اسپات‌لایت دنبال‌کنندهٔ ماوس روی کارت فرم ---------- */
  const onFormCardMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = glowRef.current;
    if (!el) return;
    const r = e.currentTarget.getBoundingClientRect();
    el.style.background = `radial-gradient(600px circle at ${e.clientX - r.left}px ${e.clientY - r.top}px, color-mix(in oklch, var(--primary) 7%, transparent), transparent 65%)`;
    el.style.opacity = "1";
  }, []);

  const onFormCardLeave = useCallback(() => {
    if (glowRef.current) glowRef.current.style.opacity = "0";
  }, []);

  /* ---------- چرخهٔ حیات صفحه ---------- */
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => phoneRef.current?.focus(), 420);
    return () => {
      document.body.style.overflow = prev;
      clearTimeout(t);
      if (smsTimerRef.current) clearTimeout(smsTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => setAuthOpen(false), 280);
  }, [closing, setAuthOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading && !verifying && step !== "success") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, loading, verifying, step]);

  /* ---------- مرحله ۱: ارسال کد ---------- */
  const sendOtp = useCallback(
    async (fromResend = false) => {
      if (!phoneValid) {
        toast.error("شماره موبایل را کامل وارد کنید (مثال: ۰۹۱۲۳۴۵۶۷۸۹)");
        return;
      }
      setLoading(true);
      setOtpError(false);
      const res = await api<{ purpose?: Purpose; ttlMinutes?: number; devCode?: string }>(
        "/api/auth/send-otp",
        { body: { phone: phoneDigits } }
      );
      setLoading(false);
      if (!res.success) {
        toast.error(res.error ?? "خطا در ارسال کد");
        return;
      }
      setPurpose((res.purpose as Purpose) ?? null);
      setTtlMinutes(res.ttlMinutes ?? null);
      setDevCode(res.devCode ?? null);
      if (res.devCode) setOtpLength(String(res.devCode).length);
      setOtp("");
      setCountdown(RESEND_SECONDS);
      if (!fromResend) goStep("otp");
      toast.success(fromResend ? "کد جدید پیامک شد 📩" : "کد تأیید پیامک شد 📩");
    },
    [phoneDigits, phoneValid, goStep]
  );

  /* ---------- مرحله ۲: تأیید کد ---------- */
  const verifyOtp = useCallback(
    async (value?: string) => {
      const code = (value ?? otp).replace(/\D/g, "");
      if (code.length < 4) {
        toast.error("کد تأیید را کامل وارد کنید");
        return;
      }
      setVerifying(true);
      const res = await api<{ registered: boolean; otpToken?: string }>("/api/auth/verify-otp", {
        body: { phone: phoneDigits, code },
      });
      setVerifying(false);
      if (!res.success) {
        toast.error(res.error ?? "کد نادرست است");
        setOtp("");
        setOtpError(true);
        setTimeout(() => setOtpError(false), 650);
        return;
      }
      if (res.registered) {
        await refreshUser();
        const me = useAppStore.getState().user;
        setWelcomeName(me?.firstName ?? "");
        setIsNewMember(false);
        goStep("success");
      } else {
        setOtpToken(res.otpToken ?? "");
        goStep("register");
      }
    },
    [otp, phoneDigits, refreshUser, goStep]
  );

  const handleOtpChange = useCallback((v: string) => {
    setOtp(v);
    setOtpError(false);
  }, []);

  const handleOtpComplete = useCallback(
    (v: string) => {
      if (!verifying) void verifyOtp(v);
    },
    [verifying, verifyOtp]
  );

  /* ---------- مرحله ۳: ثبت‌نام ---------- */
  const register = useCallback(async () => {
    if (form.firstName.trim().length < 2 || form.lastName.trim().length < 2) {
      toast.error("نام و نام خانوادگی را کامل وارد کنید");
      return;
    }
    const nid = form.nationalId.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
    if (nid && !/^\d{10}$/.test(nid)) {
      toast.error("کد ملی باید ۱۰ رقم باشد");
      return;
    }
    setLoading(true);
    const res = await api("/api/auth/register", {
      body: {
        phone: phoneDigits,
        otpToken,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        nationalId: nid,
        birthDate: form.birthDate,
        gender: form.gender,
        email: form.email,
      },
    });
    setLoading(false);
    if (!res.success) {
      toast.error(res.error ?? "خطا در ثبت‌نام");
      return;
    }
    await refreshUser();
    const me = useAppStore.getState().user;
    setWelcomeName(me?.firstName ?? form.firstName.trim());
    setIsNewMember(true);
    goStep("success");
  }, [form, otpToken, phoneDigits, refreshUser, goStep]);

  /* ---------- مرحله ۴: موفقیت و انتقال ---------- */
  useEffect(() => {
    if (step !== "success") return;
    const raf = requestAnimationFrame(() => setRedirectProgress(100));
    const finish = setTimeout(() => {
      toast.success(isNewMember ? "ثبت‌نام با موفقیت انجام شد! خوش آمدید 🌴" : "خوش آمدید! 🌴");
      setView(authIntent);
      close();
      setTimeout(() => window.scrollTo({ top: 0 }), 340);
    }, 2100);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(finish);
    };
  }, [step]);

  const stepIndex = step === "phone" ? 0 : step === "otp" ? 1 : 2;
  const initials = `${form.firstName.trim().slice(0, 1)}${form.lastName.trim().slice(0, 1)}`.trim();

  /* ================================================================ */
  return (
    <div
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="ورود و ثبت‌نام رستوران نخل"
      className={`nice-scroll fixed inset-0 z-[70] overflow-y-auto bg-background ${
        closing ? "animate-auth-page-out" : "animate-auth-page-in"
      }`}
    >
      <h1 className="sr-only">ورود و ثبت‌نام رستوران نخل</h1>

      {/* ── پس‌زمینهٔ محیطی ── */}
      <div className="pointer-events-none fixed inset-0" aria-hidden>
        <div className="palm-pattern absolute inset-0 opacity-50" />
        <div className="animate-aurora absolute -right-32 -top-32 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="animate-aurora-slow absolute -bottom-40 -left-32 h-[28rem] w-[28rem] rounded-full bg-gold/10 blur-3xl" />
        {/* وینیت لطیف برای عمق */}
        <div
          className="absolute inset-0"
          style={{ background: "radial-gradient(120% 90% at 50% 0%, transparent 55%, color-mix(in oklch, var(--foreground) 5%, transparent))" }}
        />
      </div>

      <div className="relative z-10 flex min-h-full flex-col">
        {/* ── نوار بالا ── */}
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <button
            type="button"
            onClick={close}
            className="group flex items-center gap-2 rounded-xl border border-transparent px-3 py-2 text-sm font-bold text-muted-foreground transition-all hover:border-border hover:bg-accent hover:text-foreground"
          >
            <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
            <span className="hidden sm:inline">بازگشت به رستوران</span>
            <span className="sm:hidden">بازگشت</span>
          </button>

          <div className="flex items-center gap-2.5">
            {/* چیپ مرحله */}
            {step !== "success" && (
              <span className="animate-fade-up hidden items-center gap-1.5 rounded-full border border-primary/25 bg-primary/5 px-3.5 py-1.5 text-[11px] font-extrabold text-primary sm:inline-flex">
                <Sparkles className="h-3.5 w-3.5" />
                مرحلهٔ {toPersianDigits(stepIndex + 1)} از {toPersianDigits(3)}
              </span>
            )}
            <ThemeToggle />
          </div>
        </div>

        {/* ── بدنهٔ اصلی ── */}
        <main className="flex flex-1 items-center justify-center px-4 pb-2 pt-1 sm:px-6">
          <div className="w-full max-w-6xl">
            <MobileBrandBand />

            <div className="grid items-stretch gap-6 lg:grid-cols-[1fr_1.02fr] lg:gap-7">
              {/* ══════════ کارت فرم ══════════ */}
              <div
                onMouseMove={onFormCardMove}
                onMouseLeave={onFormCardLeave}
                className="group relative overflow-hidden rounded-[2rem] border border-border/70 bg-card/90 p-6 shadow-2xl shadow-primary/10 backdrop-blur-sm transition-shadow duration-500 hover:shadow-primary/15 sm:p-8 lg:p-9"
              >
                {/* اسپات‌لایت ماوس */}
                <div
                  ref={glowRef}
                  aria-hidden
                  className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-700"
                />
                {/* درخشش نفس‌کشندهٔ گوشهٔ پایین */}
                <div
                  className="animate-glow-breathe pointer-events-none absolute -bottom-20 -left-20 h-56 w-56 rounded-full bg-gold/10 blur-3xl"
                  aria-hidden
                />

                {step !== "success" && (
                  <div className="auth-stagger relative" style={{ "--auth-delay": "80ms" } as CSSProperties}>
                    <StepIndicator current={stepIndex} />
                  </div>
                )}

                <div
                  key={`${step}-${direction}`}
                  className={`relative mt-6 ${direction === "back" ? "animate-auth-step-back" : "animate-auth-step-fwd"}`}
                >
                  {/* ============ مرحله ۱: شماره موبایل ============ */}
                  {step === "phone" && (
                    <div className="space-y-6">
                      <div className="space-y-2.5 text-center">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/5 px-3.5 py-1 text-[11px] font-bold text-primary">
                          <Sparkles className="h-3.5 w-3.5" />
                          بدون رمز عبور — فقط با پیامک!
                        </span>
                        <h2 className="text-[1.55rem] font-extrabold leading-snug sm:text-3xl">
                          ورود <span className="text-muted-foreground/60">|</span>{" "}
                          <span className="gold-gradient-text animate-gradient-pan">ثبت‌نام</span>
                        </h2>
                        <p className="mx-auto max-w-sm text-sm leading-7 text-muted-foreground">
                          شماره موبایل خود را وارد کنید تا کد تأیید برایتان پیامک شود؛ حساب ندارید؟ همین مسیر
                          عضویت می‌سازد.
                        </p>
                      </div>

                      <div className="space-y-2.5">
                        <label htmlFor="auth-phone" className="flex items-center gap-1.5 text-sm font-bold">
                          <Smartphone className="h-4 w-4 text-primary" />
                          شماره موبایل
                        </label>

                        {/* ورودی با چیپ ‎+۹۸ */}
                        <div
                          className={`relative flex h-16 items-center overflow-hidden rounded-2xl border-2 bg-background transition-all duration-300 ${
                            phoneValid
                              ? "border-primary/70 shadow-[0_8px_24px_-8px_color-mix(in_oklch,var(--primary)_40%,transparent)]"
                              : "border-border focus-within:border-primary focus-within:shadow-[0_8px_24px_-10px_color-mix(in_oklch,var(--primary)_35%,transparent)]"
                          }`}
                        >
                          {/* چیپ پیش‌شماره */}
                          <span
                            className="flex h-full items-center gap-2 self-stretch px-4 text-sm font-extrabold text-primary-foreground"
                            style={{ backgroundImage: "linear-gradient(135deg, var(--primary), color-mix(in oklch, var(--primary) 62%, var(--gold)))" }}
                            aria-hidden
                          >
                            <Phone className="h-4 w-4" />
                            <span className="tracking-wide">+۹۸</span>
                          </span>
                          <span className="h-full w-px self-stretch bg-border" aria-hidden />
                          <input
                            id="auth-phone"
                            ref={phoneRef}
                            dir="ltr"
                            inputMode="tel"
                            autoComplete="tel"
                            placeholder="0912 345 6789"
                            value={phone}
                            onChange={(e) => setPhone(toEnglishDigits(e.target.value).replace(/\D/g, "").slice(0, 11))}
                            onKeyDown={(e) => e.key === "Enter" && phoneValid && !loading && sendOtp()}
                            className="h-full min-w-0 flex-1 bg-transparent px-4 text-start text-lg font-bold tracking-[0.1em] outline-none placeholder:text-muted-foreground/50 sm:text-xl"
                            aria-describedby="auth-phone-hint"
                          />
                          {phoneValid && (
                            <span className="animate-badge-pop flex pe-4" aria-hidden>
                              <BadgeCheck className="h-6 w-6 text-primary" />
                            </span>
                          )}
                        </div>

                        {/* نوار پیشرفت شماره */}
                        <div className="h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              phoneValid ? "auth-progress-active" : ""
                            }`}
                            style={{
                              width: `${Math.min(100, (phoneDigits.length / 11) * 100)}%`,
                              backgroundImage: "linear-gradient(to left, var(--primary), color-mix(in oklch, var(--primary) 55%, var(--gold)))",
                            }}
                          />
                        </div>

                        {/* راهنما + اپراتور */}
                        <div className="flex min-h-5 flex-wrap items-center justify-between gap-1.5">
                          <p id="auth-phone-hint" className="text-xs text-muted-foreground" aria-live="polite">
                            {phoneValid
                              ? "✓ شماره معتبر است؛ دکمهٔ زیر را بزنید"
                              : `مثال: ۰۹۱۲۳۴۵۶۷۸۹ — ${toPersianDigits(phoneDigits.length)} رقم وارد شده`}
                          </p>
                          {operator && (
                            <span
                              className="animate-badge-pop inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/5 px-2.5 py-0.5 text-[10px] font-extrabold text-primary"
                            >
                              <Signal className="h-3 w-3" />
                              {operator}
                            </span>
                          )}
                        </div>
                      </div>

                      <Button
                        onClick={() => sendOtp()}
                        disabled={loading || !phoneValid}
                        className="shine-sweep h-14 w-full rounded-2xl border-0 text-base font-extrabold shadow-lg shadow-primary/30 transition-all duration-200 hover:brightness-110 active:scale-[0.98]"
                        style={{ backgroundImage: CTA_GRADIENT }}
                      >
                        {loading ? (
                          <>
                            <Loader2 className="ml-2 h-5 w-5 animate-spin" />
                            در حال ارسال…
                          </>
                        ) : (
                          <>
                            <MessageSquareHeart className="ml-2 h-5 w-5" />
                            دریافت کد تأیید
                          </>
                        )}
                      </Button>

                      <p className="text-center text-[11px] leading-5 text-muted-foreground">
                        با ورود یا ثبت‌نام،{" "}
                        <a
                          href="#"
                          onClick={(e) => e.preventDefault()}
                          className="font-bold text-primary underline underline-offset-2"
                        >
                          قوانین رستوران نخل
                        </a>{" "}
                        را می‌پذیرید.
                      </p>
                    </div>
                  )}

                  {/* ============ مرحله ۲: کد تأیید ============ */}
                  {step === "otp" && (
                    <div className="space-y-5">
                      {/* حباب پیامک */}
                      <div className="animate-sms-in mx-auto flex w-fit max-w-full items-center gap-3 rounded-3xl rounded-br-lg border border-border/80 bg-muted/60 py-2.5 pe-5 ps-3">
                        <span
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-primary-foreground"
                          style={{ backgroundImage: CTA_GRADIENT }}
                          aria-hidden
                        >
                          <MessageSquareHeart className="h-5 w-5" />
                        </span>
                        <div className="min-w-0 text-xs font-bold leading-5">
                          {smsArriving ? (
                            <span className="flex items-center gap-2 text-muted-foreground">
                              پیامک در راه است
                              <span className="flex gap-1" aria-hidden>
                                <span className="typing-dot" />
                                <span className="typing-dot" />
                                <span className="typing-dot" />
                              </span>
                            </span>
                          ) : (
                            <span>
                              کد {toPersianDigits(otpLength)} رقمی به{" "}
                              <span className="mx-0.5 inline-block rounded-lg bg-card px-2 py-0.5 font-bold text-foreground" dir="ltr">
                                {formatPhone(phoneDigits)}
                              </span>{" "}
                              پیامک شد
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setOtp("");
                            setDevCode(null);
                            goStep("phone", "back");
                          }}
                          className="ms-1 inline-flex min-h-9 shrink-0 items-center gap-1 rounded-xl px-2.5 py-1.5 text-[11px] font-extrabold text-primary transition-all hover:bg-primary/10 active:scale-95"
                          title="تغییر شماره موبایل"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          ویرایش
                        </button>
                      </div>

                      <div className="space-y-2 text-center">
                        <h2 className="text-2xl font-extrabold sm:text-[1.7rem]">کد تأیید را وارد کنید</h2>
                        <p className="text-xs leading-6 text-muted-foreground">
                          {purpose === "REGISTER"
                            ? "این شماره جدید است — پس از تأیید، عضویتتان تکمیل می‌شود"
                            : "با تکمیل کد، به‌صورت خودکار بررسی می‌شود"}
                        </p>
                      </div>

                      {/* کد آزمایشی (حالت توسعه) */}
                      {devCode && (
                        <button
                          type="button"
                          onClick={() => {
                            setOtp(devCode);
                            toast.info("کد به‌صورت خودکار وارد و تأیید شد");
                            void verifyOtp(devCode);
                          }}
                          className="group flex w-full items-start gap-3 rounded-2xl border-2 border-dashed border-gold/60 bg-gold/10 p-3.5 text-right transition-colors hover:bg-gold/15"
                          dir="rtl"
                        >
                          <Info className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
                          <span className="flex-1 text-xs leading-6">
                            <b>حالت آزمایشی:</b> درگاه پیامک هنوز متصل نشده؛ کد تأیید:{" "}
                            <span className="mx-1 rounded-lg bg-card px-2 py-0.5 font-mono text-base font-extrabold tracking-widest text-primary" dir="ltr">
                              {devCode}
                            </span>
                            <span className="font-bold text-gold group-hover:underline">(برای درج خودکار کلیک کنید)</span>
                          </span>
                        </button>
                      )}

                      <div className="relative">
                        <OtpBoxes
                          length={otpLength}
                          value={otp}
                          onChange={handleOtpChange}
                          onComplete={handleOtpComplete}
                          error={otpError}
                          disabled={verifying}
                        />
                        {/* خط اسکن هنگام بررسی */}
                        {verifying && (
                          <div className="absolute -bottom-1.5 right-[12%] left-[12%] h-0.5 overflow-hidden rounded-full" aria-hidden>
                            <span
                              className="animate-scan-x absolute inset-y-0 w-1/2 rounded-full"
                              style={{ backgroundImage: "linear-gradient(to left, transparent, var(--primary), color-mix(in oklch, var(--primary) 50%, var(--gold)), transparent)" }}
                            />
                          </div>
                        )}
                      </div>

                      <p className="h-5 text-center text-xs font-bold" role="alert" aria-live="assertive">
                        {otpError ? (
                          <span className="animate-fade-up text-destructive">کد واردشده درست نبود؛ دوباره تلاش کنید</span>
                        ) : verifying ? (
                          <span className="flex items-center justify-center gap-1.5 text-primary">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            در حال بررسی کد…
                          </span>
                        ) : (
                          <span className="text-muted-foreground">کد را از پیامک وارد کنید</span>
                        )}
                      </p>

                      <Button
                        onClick={() => verifyOtp()}
                        disabled={verifying || otp.length < otpLength}
                        className="h-14 w-full rounded-2xl border-0 text-base font-extrabold shadow-lg shadow-primary/30 transition-all duration-200 hover:brightness-110 active:scale-[0.98]"
                        style={{ backgroundImage: CTA_GRADIENT }}
                      >
                        {verifying ? (
                          <>
                            <Loader2 className="ml-2 h-5 w-5 animate-spin" />
                            در حال بررسی…
                          </>
                        ) : (
                          <>
                            <ShieldCheck className="ml-2 h-5 w-5" />
                            تأیید و ادامه
                          </>
                        )}
                      </Button>

                      {/* ارسال مجدد */}
                      <div className="flex items-center justify-center gap-3 pt-1">
                        {countdown > 0 ? (
                          <div className="flex items-center gap-3 rounded-full bg-muted/60 py-1.5 pl-4 pr-1.5">
                            <CountdownRing seconds={countdown} total={RESEND_SECONDS} />
                            <span className="text-xs font-bold leading-5 text-muted-foreground">
                              امکان ارسال مجدد کد
                              <br />
                              پس از پایان شمارش
                            </span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => sendOtp(true)}
                            disabled={loading}
                            className="animate-pulse-ring flex items-center gap-2 rounded-full border-2 border-primary/30 px-5 py-2.5 text-sm font-extrabold text-primary transition-colors hover:bg-primary/5 disabled:opacity-60"
                          >
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
                            ارسال مجدد کد
                          </button>
                        )}
                      </div>

                      {ttlMinutes && (
                        <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                          <Timer className="h-3.5 w-3.5" />
                          کد تا {toPersianDigits(ttlMinutes)} دقیقه اعتبار دارد
                        </p>
                      )}
                    </div>
                  )}

                  {/* ============ مرحله ۳: تکمیل اطلاعات ============ */}
                  {step === "register" && (
                    <div className="space-y-5">
                      {/* آواتار زندهٔ حروف اول نام */}
                      <div className="flex flex-col items-center gap-2">
                        <span
                          key={initials || "empty"}
                          className="animate-badge-pop flex h-16 w-16 items-center justify-center rounded-full border-2 border-border/60 text-xl font-extrabold text-primary-foreground shadow-lg shadow-primary/25"
                          style={{ backgroundImage: CTA_GRADIENT }}
                          aria-hidden
                        >
                          {initials ? initials : <User className="h-7 w-7" />}
                        </span>
                        <h2 className="text-2xl font-extrabold">تکمیل اطلاعات</h2>
                        <p className="mx-auto max-w-sm text-center text-xs leading-6 text-muted-foreground">
                          عضویت با{" "}
                          <span className="font-bold text-foreground" dir="ltr">
                            {formatPhone(phoneDigits)}
                          </span>{" "}
                          — تقریباً تمام است! فقط چند مشخصِ ساده مانده.
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label htmlFor="reg-first" className="flex items-center gap-1.5 text-xs font-bold">
                            <User className="h-3.5 w-3.5 text-primary" />
                            نام *
                          </label>
                          <input
                            id="reg-first"
                            value={form.firstName}
                            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                            placeholder="مثال: حسین"
                            className="h-12 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none transition-all hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label htmlFor="reg-last" className="flex items-center gap-1.5 text-xs font-bold">
                            <User className="h-3.5 w-3.5 text-primary" />
                            نام خانوادگی *
                          </label>
                          <input
                            id="reg-last"
                            value={form.lastName}
                            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                            placeholder="مثال: رضایی"
                            className="h-12 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none transition-all hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10"
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label htmlFor="reg-nid" className="flex items-center gap-1.5 text-xs font-bold">
                          <Fingerprint className="h-3.5 w-3.5 text-primary" />
                          کد ملی (اختیاری)
                        </label>
                        <input
                          id="reg-nid"
                          dir="ltr"
                          inputMode="numeric"
                          value={form.nationalId}
                          onChange={(e) => setForm({ ...form, nationalId: e.target.value.replace(/[^\d۰-۹]/g, "") })}
                          placeholder="کد ۱۰ رقمی"
                          className="h-12 w-full rounded-xl border border-input bg-background px-3.5 text-center text-sm tracking-widest outline-none transition-all hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label htmlFor="reg-birth" className="flex items-center gap-1.5 text-xs font-bold">
                            <Sparkles className="h-3.5 w-3.5 text-primary" />
                            تاریخ تولد (اختیاری)
                          </label>
                          <input
                            id="reg-birth"
                            placeholder="۱۳۷۵/۰۳/۱۲"
                            value={form.birthDate}
                            onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
                            className="h-12 w-full rounded-xl border border-input bg-background px-3.5 text-center text-sm outline-none transition-all hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <span className="flex items-center gap-1.5 text-xs font-bold">
                            <UserRoundCheck className="h-3.5 w-3.5 text-primary" />
                            جنسیت (اختیاری)
                          </span>
                          <div className="flex gap-1.5" role="group" aria-label="جنسیت">
                            {[
                              { v: "MALE", l: "آقا" },
                              { v: "FEMALE", l: "خانم" },
                            ].map((g) => (
                              <button
                                key={g.v}
                                type="button"
                                onClick={() => setForm({ ...form, gender: form.gender === g.v ? "" : g.v })}
                                aria-pressed={form.gender === g.v}
                                className={`h-12 flex-1 rounded-xl border text-sm font-bold transition-all duration-200 active:scale-95 ${
                                  form.gender === g.v
                                    ? "border-transparent text-primary-foreground shadow-md shadow-primary/25"
                                    : "border-input bg-background hover:border-primary/50 hover:bg-accent"
                                }`}
                                style={
                                  form.gender === g.v
                                    ? { backgroundImage: CTA_GRADIENT }
                                    : undefined
                                }
                              >
                                {g.l}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label htmlFor="reg-email" className="flex items-center gap-1.5 text-xs font-bold">
                          <Mail className="h-3.5 w-3.5 text-primary" />
                          ایمیل (اختیاری)
                        </label>
                        <input
                          id="reg-email"
                          dir="ltr"
                          type="email"
                          value={form.email}
                          onChange={(e) => setForm({ ...form, email: e.target.value })}
                          placeholder="you@example.com"
                          className="h-12 w-full rounded-xl border border-input bg-background px-3.5 text-center text-sm outline-none transition-all hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10"
                        />
                      </div>

                      <Button
                        onClick={register}
                        disabled={loading}
                        className="h-14 w-full rounded-2xl border-0 text-base font-extrabold shadow-lg shadow-primary/30 transition-all duration-200 hover:brightness-110 active:scale-[0.98]"
                        style={{ backgroundImage: CTA_GRADIENT }}
                      >
                        {loading ? (
                          <>
                            <Loader2 className="ml-2 h-5 w-5 animate-spin" />
                            در حال ثبت…
                          </>
                        ) : (
                          <>
                            <UserRoundCheck className="ml-2 h-5 w-5" />
                            تکمیل ثبت‌نام و ورود
                          </>
                        )}
                      </Button>
                    </div>
                  )}

                  {/* ============ مرحله ۴: موفقیت ============ */}
                  {step === "success" && (
                    <div className="flex flex-col items-center gap-6 py-6 text-center">
                      <div className="animate-success-ring relative flex h-28 w-28 items-center justify-center rounded-full bg-primary/10">
                        <svg viewBox="0 0 120 120" className="h-24 w-24" aria-hidden>
                          <circle
                            cx="60"
                            cy="60"
                            r="54"
                            fill="none"
                            strokeWidth="6"
                            strokeLinecap="round"
                            className="animate-check-circle stroke-primary"
                            transform="rotate(-90 60 60)"
                          />
                          <path
                            d="M38 62 L54 78 L84 46"
                            fill="none"
                            strokeWidth="8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="animate-check-path stroke-primary"
                          />
                        </svg>
                        {/* ذرات جشن */}
                        <div className="pointer-events-none absolute inset-0" aria-hidden>
                          {[
                            { tx: "-90px", ty: "-70px", c: "var(--gold)", s: "8px", d: "850ms" },
                            { tx: "80px", ty: "-90px", c: "var(--primary)", s: "6px", d: "900ms" },
                            { tx: "-110px", ty: "20px", c: "var(--gold)", s: "5px", d: "800ms" },
                            { tx: "105px", ty: "30px", c: "var(--primary)", s: "7px", d: "950ms" },
                            { tx: "-60px", ty: "95px", c: "var(--gold)", s: "6px", d: "875ms" },
                            { tx: "70px", ty: "100px", c: "var(--primary)", s: "5px", d: "925ms" },
                            { tx: "0px", ty: "-115px", c: "var(--gold)", s: "7px", d: "850ms" },
                            { tx: "130px", ty: "-30px", c: "var(--primary)", s: "5px", d: "900ms" },
                            { tx: "-130px", ty: "-40px", c: "var(--gold)", s: "6px", d: "950ms" },
                            { tx: "15px", ty: "110px", c: "var(--primary)", s: "8px", d: "875ms" },
                          ].map((p, i) => (
                            <span
                              key={i}
                              className="confetti-dot"
                              style={
                                {
                                  "--tx": p.tx,
                                  "--ty": p.ty,
                                  "--c": p.c,
                                  "--s": p.s,
                                  "--d": p.d,
                                } as CSSProperties
                              }
                            />
                          ))}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <h2 className="text-2xl font-extrabold sm:text-3xl">
                          {isNewMember ? (
                            <>
                              عضو خانوادهٔ <span className="gold-gradient-text">نخل</span> شدید! 🌴
                            </>
                          ) : (
                            <>
                              <span className="gold-gradient-text">خوش آمدید!</span> 🌴
                            </>
                          )}
                        </h2>
                        <p className="text-sm leading-7 text-muted-foreground">
                          {welcomeName ? `${welcomeName} عزیز، ` : ""}
                          {isNewMember
                            ? "ثبت‌نامتان کامل شد و از این پس سفارش‌ها سریع‌تر انجام می‌شود."
                            : "همیشه خوشحالیم که می‌بینیمتان."}
                        </p>
                      </div>

                      <div className="w-full max-w-xs space-y-2">
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                          <div
                            className="h-full rounded-full transition-all duration-[1900ms] ease-linear"
                            style={{
                              width: `${redirectProgress}%`,
                              backgroundImage: "linear-gradient(to left, var(--primary), var(--gold))",
                            }}
                          />
                        </div>
                        <p className="text-xs font-bold text-muted-foreground">
                          در حال انتقال به «{INTENT_LABELS[authIntent]}»…
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ══════════ پنل برند ══════════ */}
              <BrandPanel />
            </div>
          </div>
        </main>

        {/* ── نوار اعتماد پایین ── */}
        <div className="relative z-10 mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-6 gap-y-2 px-4 pb-6 pt-2 sm:gap-x-8 sm:px-6">
          {[
            { icon: ShieldCheck, text: "ورود امن با کد یکبارمصرف پیامکی" },
            { icon: LockKeyhole, text: "بدون نیاز به رمز عبور" },
            { icon: Timer, text: "اعتبار کد محدود است" },
          ].map((item, i) => (
            <span
              key={item.text}
              className="animate-chip-pop flex items-center gap-1.5 rounded-full border border-border/60 bg-card/70 px-3.5 py-1.5 text-[10px] font-bold text-muted-foreground backdrop-blur-sm transition-colors hover:text-foreground sm:text-xs"
              style={{ "--chip-delay": `${1400 + i * 120}ms` } as CSSProperties}
            >
              <item.icon className="h-3.5 w-3.5 text-primary" />
              {item.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
