// Persian/Farsi utilities — digits, currency, Jalali dates
const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

export function toPersianDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

export function toEnglishDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

export function formatPrice(amount: number): string {
  return toPersianDigits(amount.toLocaleString("en-US"));
}

export function formatToman(amount: number): string {
  return `${formatPrice(amount)} تومان`;
}

export function normalizePersian(text: string): string {
  return text
    .replace(/[يى]/g, "ی")
    .replace(/[ك]/g, "ک")
    .replace(/[ۀة]/g, "ه")
    .replace(/[أإآ]/g, "ا")
    .replace(/\u200c|\u200f|\u200e/g, " ")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// ============ Jalali Calendar ============
function div(a: number, b: number) {
  return Math.floor(a / b);
}

const JALALI_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

const WEEKDAYS = [
  "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه",
];

/** Gregorian -> Jalali (jalaali-js algorithm) */
export function toJalali(date: Date): { jy: number; jm: number; jd: number } {
  const gy = date.getFullYear();
  const gm = date.getMonth() + 1;
  const gd = date.getDate();
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  const gy2 = gy <= 1600 ? gy - 621 : gy - 1600;
  let days =
    365 * gy2 +
    div(gy2 + 3, 4) -
    div(gy2 + 99, 100) +
    div(gy2 + 399, 400) -
    80 +
    gd +
    g_d_m[gm - 1];
  if (gm > 2 && ((gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0)) days += 1;
  jy += 33 * div(days, 12053);
  days %= 12053;
  jy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    jy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + div(days, 31) : 7 + div(days - 186, 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return { jy, jm, jd };
}

/** Jalali -> Gregorian (for parsing birthdate inputs) */
export function jalaliToGregorian(jy: number, jm: number, jd: number): Date {
  let gy = jy <= 979 ? 621 : 1600;
  const jy2 = jy <= 979 ? jy : jy - 979;
  let days =
    365 * jy2 +
    div(jy2, 33) * 8 +
    div((jy2 % 33) + 3, 4) +
    78 +
    jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  gy += 400 * div(days, 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * div(--days, 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    gy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const sal_a = [
    0,
    31,
    (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
  ];
  let gm = 0;
  for (gm = 1; gm <= 12 && gd > sal_a[gm]; gm++) gd -= sal_a[gm];
  return new Date(gy, gm - 1, gd);
}

export function formatJalali(date: Date | string, withTime = false): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const { jy, jm, jd } = toJalali(d);
  let out = `${toPersianDigits(jy)}/${toPersianDigits(String(jm).padStart(2, "0"))}/${toPersianDigits(String(jd).padStart(2, "0"))}`;
  if (withTime) {
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    out += ` - ${toPersianDigits(hh)}:${toPersianDigits(mm)}`;
  }
  return out;
}

export function formatJalaliLong(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const { jy, jm, jd } = toJalali(d);
  return `${WEEKDAYS[d.getDay()]} ${toPersianDigits(jd)} ${JALALI_MONTHS[jm - 1]} ${toPersianDigits(jy)}`;
}

/** نام روز هفته فارسی (بر اساس getDay جاوااسکریپت: یکشنبه=۰ … شنبه=۶) */
export function weekdayName(date: Date): string {
  return WEEKDAYS[date.getDay()];
}

export function jalaliMonthName(m: number): string {
  return JALALI_MONTHS[m - 1] ?? "";
}

/** "۱۴۰۳/۰۵/۱۲" or "1403/05/12" -> Date */
export function parseJalaliDate(input: string): Date | null {
  const s = toEnglishDigits(input).replace(/[^\d]/g, "/");
  const parts = s.split("/").map(Number).filter((n) => !isNaN(n));
  if (parts.length < 3) return null;
  const [jy, jm, jd] = parts;
  if (!jy || !jm || !jd || jm > 12 || jd > 31 || jy < 1200 || jy > 1600) return null;
  return jalaliToGregorian(jy, jm, jd);
}

export function timeAgo(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "لحظاتی پیش";
  if (diff < 3600) return `${toPersianDigits(Math.floor(diff / 60))} دقیقه پیش`;
  if (diff < 86400) return `${toPersianDigits(Math.floor(diff / 3600))} ساعت پیش`;
  if (diff < 2592000) return `${toPersianDigits(Math.floor(diff / 86400))} روز پیش`;
  return formatJalali(d);
}

// ============ Phone ============

/** Normalize Iranian phone: accepts 09xxxxxxxxx / +98... / 0098... -> 989xxxxxxxxx */
export function normalizePhone(input: string): string | null {
  const digits = toEnglishDigits(input).replace(/\D/g, "");
  let phone = digits;
  if (phone.startsWith("0098")) phone = phone.slice(4);
  else if (phone.startsWith("098")) phone = phone.slice(3);
  else if (phone.startsWith("98")) phone = phone.slice(2);
  else if (phone.startsWith("0")) phone = phone.slice(1);
  if (/^9\d{9}$/.test(phone)) return `98${phone}`;
  return null;
}

export function formatPhone(phone: string): string {
  const p = phone.replace(/\D/g, "");
  const local = p.startsWith("98") ? `0${p.slice(2)}` : p;
  return toPersianDigits(local.replace(/(\d{4})(\d{3})(\d{4})/, "$1 $2 $3"));
}

export function isValidNationalId(code: string): boolean {
  const c = toEnglishDigits(code).replace(/\D/g, "");
  if (!/^\d{10}$/.test(c)) return false;
  if (/^(\d)\1{9}$/.test(c)) return false;
  const check = Number(c[9]);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(c[i]) * (10 - i);
  const rem = sum % 11;
  return rem < 2 ? check === rem : check === 11 - rem;
}
