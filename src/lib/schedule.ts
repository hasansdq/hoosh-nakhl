// پیش‌سفارش — Pre-order scheduling helpers (pure, client & server safe)
// Rules: at least 45 minutes ahead, at most 7 days ahead,
// delivery hour must fall within opening hours 12:00–23:59.

import {
  toPersianDigits,
  weekdayName,
  toJalali,
  jalaliMonthName,
} from "@/lib/fa";

/** حداقل فاصله ثبت تا تحویل: ۴۵ دقیقه */
export const SCHEDULE_MIN_LEAD_MS = 45 * 60 * 1000;
/** حداکثر افق پیش‌سفارش: ۷ روز */
export const SCHEDULE_MAX_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;
/** ساعت شروع تحویل (۱۲ ظهر) — دقیقه از نیمه‌شب */
export const OPENING_START_MINUTES = 12 * 60;
/** ساعت پایان تحویل (۱۲ شب / ۲۳:۵۹) — دقیقه از نیمه‌شب */
export const OPENING_END_MINUTES = 23 * 60 + 59;

/** شیارهای ۳۰ دقیقه‌ای از ۱۲:۰۰ تا ۲۳:۳۰ (مبنای چیپ‌های انتخاب ساعت) */
export const SCHEDULE_SLOT_TIMES: string[] = Array.from({ length: 24 }, (_, i) => {
  const totalMinutes = 12 * 60 + i * 30; // 720 … 1410
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
});

export type ScheduleValidation =
  | { ok: true; date: Date }
  | { ok: false; reason: string };

/**
 * اعتبارسنجی زمان تحویل پیش‌سفارش.
 * ورودی تاریخ/رشته ISO؛ خروجی یا تاریخ معتبر یا دلیل رد به فارسی.
 */
export function validateScheduleSlot(input: Date | string | null | undefined): ScheduleValidation {
  if (input === null || input === undefined || input === "") {
    return { ok: false, reason: "زمان تحویل پیش‌سفارش مشخص نشده است" };
  }
  const date = input instanceof Date ? new Date(input.getTime()) : new Date(String(input));
  if (isNaN(date.getTime())) {
    return { ok: false, reason: "زمان تحویل نامعتبر است" };
  }
  const now = Date.now();
  const t = date.getTime();
  if (t < now + SCHEDULE_MIN_LEAD_MS) {
    return { ok: false, reason: "زمان تحویل باید حداقل ۴۵ دقیقه بعد از اکنون باشد" };
  }
  if (t > now + SCHEDULE_MAX_AHEAD_MS) {
    return { ok: false, reason: "پیش‌سفارش حداکثر تا ۷ روز آینده امکان‌پذیر است" };
  }
  const minutesOfDay = date.getHours() * 60 + date.getMinutes();
  if (minutesOfDay < OPENING_START_MINUTES || minutesOfDay > OPENING_END_MINUTES) {
    return { ok: false, reason: "ساعت تحویل باید بین ۱۲ ظهر تا ۱۲ شب باشد" };
  }
  return { ok: true, date };
}

/** آیا شیار زمانی (ساخته‌شده از روز + ساعت) قابل انتخاب است؟ (منطق غیروابط‌خورده با سرور) */
export function isSlotSelectable(slotDate: Date, now: Date = new Date()): boolean {
  return (
    slotDate.getTime() >= now.getTime() + SCHEDULE_MIN_LEAD_MS &&
    slotDate.getTime() <= now.getTime() + SCHEDULE_MAX_AHEAD_MS
  );
}

/** برچسب نسبی روز: امروز / فردا / پس‌فردا / نام روز هفته */
export function relativeDayLabel(date: Date, now: Date = new Date()): string {
  const a = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diff = Math.round((a - b) / (24 * 60 * 60 * 1000));
  if (diff === 0) return "امروز";
  if (diff === 1) return "فردا";
  if (diff === 2) return "پس‌فردا";
  return weekdayName(date);
}

/** قالب فارسی زمان تحویل: «فردا، ۱۹:۳۰» یا «دوشنبه ۲۰ آبان، ۱۹:۳۰» */
export function formatScheduleFa(input: Date | string, now: Date = new Date()): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (isNaN(d.getTime())) return "";
  const time = toPersianDigits(
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  );
  const dayLabel = relativeDayLabel(d, now);
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diff = Math.round((a - b) / (24 * 60 * 60 * 1000));
  if (diff >= 0 && diff <= 2) return `${dayLabel}، ${time}`;
  const { jd, jm } = toJalali(d);
  return `${dayLabel} ${toPersianDigits(jd)} ${jalaliMonthName(jm)}، ${time}`;
}

/** تاریخ + ساعت جلالی کامل برای بج‌ها: «۱۴۰۴/۰۶/۰۵ - ۱۹:۳۰» (formatJalali خودش اجرا می‌شود) */
export function isScheduleActive(mode: string, scheduledFor: string | null): boolean {
  return mode === "SCHEDULED" && !!scheduledFor;
}
