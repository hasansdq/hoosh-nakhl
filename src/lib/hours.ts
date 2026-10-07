import { toPersianDigits } from "@/lib/fa";

/**
 * ============ ساعات کاری ساختاریافته (ناهار / شام) ============
 * منطق مشترک سرور و کلاینت — خالص و بدون وابستگی به DB.
 *
 * - زمان همیشه به «دقیقهٔ گذشته از نیمه‌شب» به وقت رسمی رستوران (Asia/Tehran)
 *   محاسبه می‌شود؛ یعنی روی هر سروری (حتی UTC) وضعیت باز/بسته درست است.
 * - هر بازه «HH:MM» است؛ پایان می‌تواند «24:00» (نیمه‌شب) باشد.
 * - اگر پایان کوچک‌تر از شروع باشد، بازه از نیمه‌شبِ روز بعد عبور می‌کند
 *   (مثلاً شام ۲۰:۰۰ تا ۰۱:۰۰).
 */

export const RESTAURANT_TZ = "Asia/Tehran";

export interface HoursPeriod {
  enabled: boolean;
  /** «HH:MM» — 24h */
  open: string;
  /** «HH:MM» — «24:00» یعنی نیمه‌شب */
  close: string;
}

export interface BusinessHours {
  lunch: HoursPeriod;
  dinner: HoursPeriod;
}

export const PERIOD_LABELS = {
  lunch: "ناهار",
  dinner: "شام",
} as const;

export type PeriodKey = keyof typeof PERIOD_LABELS;

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  lunch: { enabled: true, open: "12:00", close: "16:00" },
  dinner: { enabled: true, open: "19:00", close: "24:00" },
};

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
const HH_MM_24 = /^([01]\d|2[0-3]|24):[0-5]\d$/;

/** «12:00» → 720 • «24:00» → 1440 • نامعتبر → null */
export function parseHHMM(v: string): number | null {
  if (typeof v !== "string" || !HH_MM_24.test(v)) return null;
  const [h, m] = v.split(":").map(Number);
  return h * 60 + m;
}

export function isValidOpen(v: string): boolean {
  return typeof v === "string" && HH_MM.test(v);
}

export function isValidClose(v: string): boolean {
  return typeof v === "string" && HH_MM_24.test(v);
}

/** دقیقهٔ گذشته از نیمه‌شب به وقت رسمی رستوران (Asia/Tehran) */
export function nowMinutesInRestaurantTz(date: Date = new Date()): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: RESTAURANT_TZ,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
    const parts = fmt.formatToParts(date);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    // some engines render hour "24" for midnight in hour12:false mode
    const hh = h === 24 ? 0 : h;
    return hh * 60 + m;
  } catch {
    // extremely old engines without timeZone support — fall back to local time
    return date.getHours() * 60 + date.getMinutes();
  }
}

/** آیا بازهٔ داده‌شده الان باز است؟ (پشتیبانی از عبور از نیمه‌شب) */
export function isPeriodOpen(p: HoursPeriod | null | undefined, nowMin: number): boolean {
  if (!p || !p.enabled) return false;
  const o = parseHHMM(p.open);
  const c = parseHHMM(p.close);
  if (o === null || c === null || o === c) return false;
  return c > o ? nowMin >= o && nowMin < c : nowMin >= o || nowMin < c;
}

/** کدام بازه الان باز است؟ */
export function currentOpenPeriod(
  hours: BusinessHours | null | undefined,
  nowMin: number = nowMinutesInRestaurantTz()
): PeriodKey | null {
  if (!hours) return null;
  if (isPeriodOpen(hours.lunch, nowMin)) return "lunch";
  if (isPeriodOpen(hours.dinner, nowMin)) return "dinner";
  return null;
}

export function isOpenNow(
  hours: BusinessHours | null | undefined,
  nowMin: number = nowMinutesInRestaurantTz()
): boolean {
  return currentOpenPeriod(hours, nowMin) !== null;
}

/** آیا الان «شیفت شب» است؟ — مبنای مجوز سفارش آیتم‌های «فقط شام» */
export function isDinnerShiftNow(
  hours: BusinessHours | null | undefined,
  nowMin: number = nowMinutesInRestaurantTz()
): boolean {
  return currentOpenPeriod(hours, nowMin) === "dinner";
}

/**
 * پیام استاندارد گیت «فقط شیفت شب» — برای آیتم‌های دسته‌های dinner-only
 * وقتی شیفت شب باز نیست (شیفت ناهار یا خارج از ساعات کاری).
 */
export function dinnerOnlyMessage(hours: BusinessHours | null | undefined): string {
  const open = hours?.dinner?.enabled ? hours.dinner.open : null;
  const openFa = open ? formatPeriodTime(open) : null;
  return openFa
    ? `این غذا فقط در شیفت شب قابل سفارش است! 🌙 سرویس شام از ساعت ${openFa} آغاز می‌شود`
    : "این غذا فقط در شیفت شب قابل سفارش است! 🌙";
}

export interface NextOpening {
  period: PeriodKey;
  /** دقیقه از نیمه‌شب (امروز یا فردا — برای نمایش «فردا ساعت …») */
  atMinutes: number;
  tomorrow: boolean;
}

/**
 * نزدیک‌ترین لحظهٔ باز شدن بعد از الان (وقتی بسته است).
 * ترتیب طبیعی روز: ناهار، شام، [ناهارِ فردا، …]
 */
export function nextOpening(
  hours: BusinessHours | null | undefined,
  nowMin: number = nowMinutesInRestaurantTz()
): NextOpening | null {
  if (!hours) return null;
  const candidates: { period: PeriodKey; at: number; tomorrow: boolean }[] = [];
  const push = (key: PeriodKey, p: HoursPeriod, dayOffset: 0 | 1) => {
    if (!p.enabled) return;
    const o = parseHHMM(p.open);
    if (o === null) return;
    const at = o + dayOffset * 1440;
    if (at > nowMin) candidates.push({ period: key, at, tomorrow: dayOffset === 1 });
  };
  push("lunch", hours.lunch, 0);
  push("dinner", hours.dinner, 0);
  push("lunch", hours.lunch, 1);
  push("dinner", hours.dinner, 1);
  candidates.sort((a, b) => a.at - b.at);
  const first = candidates[0];
  if (!first) return null;
  return { period: first.period, atMinutes: first.at % 1440, tomorrow: first.tomorrow };
}

/** «12:00» → «۱۲:۰۰» */
export function formatPeriodTime(v: string): string {
  return toPersianDigits(v);
}

/** دقیقه → «HH:MM» */
export function minutesToHHMM(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function periodText(p: HoursPeriod): string {
  return `${formatPeriodTime(p.open)} تا ${formatPeriodTime(p.close)}`;
}

/** «ناهار ۱۲:۰۰ تا ۱۶:۰۰ • شام ۱۹:۰۰ تا ۲۴:۰۰» — برای فوتر/SEO/بدنهٔ متنی */
export function describeBusinessHours(hours: BusinessHours | null | undefined): string {
  if (!hours) return "ساعات کاری تنظیم نشده است";
  const parts: string[] = [];
  if (hours.lunch?.enabled) parts.push(`ناهار ${periodText(hours.lunch)}`);
  if (hours.dinner?.enabled) parts.push(`شام ${periodText(hours.dinner)}`);
  if (parts.length === 0) return "فعلاً سفارش آنلاین پذیرش نمی‌شود";
  return parts.join(" • ");
}

/** برچسب وضعیت لحظه‌ای — برای بج هدر و بنر سبد خرید */
export function openStatusText(
  hours: BusinessHours | null | undefined,
  nowMin: number = nowMinutesInRestaurantTz()
): { open: boolean; label: string; detail: string } {
  const cur = currentOpenPeriod(hours, nowMin);
  if (cur) {
    const p = hours![cur];
    return {
      open: true,
      label: "الان باز است",
      detail: `${PERIOD_LABELS[cur]} تا ساعت ${formatPeriodTime(p.close)}`,
    };
  }
  const next = nextOpening(hours, nowMin);
  if (!next) {
    return { open: false, label: "الان بسته است", detail: "سفارش آنلاین موقتاً غیرفعال است" };
  }
  return {
    open: false,
    label: "الان بسته است",
    detail: `${next.tomorrow ? "فردا" : "امروز"} ${PERIOD_LABELS[next.period]} از ساعت ${formatPeriodTime(
      minutesToHHMM(next.atMinutes)
    )} باز می‌شویم`,
  };
}

/** متن خطای استاندارد برای گیت سرور — با ساعات کامل برای شفافیت */
export function closedMessage(hours: BusinessHours | null | undefined): string {
  const { detail } = openStatusText(hours);
  return `رستوران الان بسته است! 🚫 ${detail} — ساعات کاری: ${describeBusinessHours(hours)}`;
}

/** نرمال‌سازی مقدار ذخیره‌شده/پیش‌فرض — مقاوم در برابر دادهٔ ناقص */
export function normalizeBusinessHours(raw: unknown): BusinessHours {
  const src = (raw ?? {}) as Partial<Record<PeriodKey, Partial<HoursPeriod>>>;
  const fix = (p: Partial<HoursPeriod> | undefined, def: HoursPeriod): HoursPeriod => ({
    enabled: typeof p?.enabled === "boolean" ? p.enabled : def.enabled,
    open: isValidOpen(String(p?.open ?? "")) ? String(p!.open) : def.open,
    close: isValidClose(String(p?.close ?? "")) ? String(p!.close) : def.close,
  });
  return {
    lunch: fix(src.lunch, DEFAULT_BUSINESS_HOURS.lunch),
    dinner: fix(src.dinner, DEFAULT_BUSINESS_HOURS.dinner),
  };
}
