/**
 * موتور مشترک CSV محصولات (درون‌ریزی/برون‌بری) — پنل مدیریت نخل
 * -----------------------------------------------------------------------------
 * این ماژول «بدون وابستگی به سرور» است تا هم پیش‌نمایش سمت کلاینت و هم
 * درون‌ریزی سمت سرور از یک منطق اعتبارسنجی واحد استفاده کنند.
 *
 * قواعد کلیدی:
 *  • پارسر RFC 4180 (فیلدهای نقل‌قولی، کاما/سمی‌کالن/تب به‌عنوان جداکننده، BOM)
 *  • تشخیص خودکار جداکننده (, ؛ \t) برای فایل‌های Excel فارسی
 *  • ارقام فارسی/عربی + جداکنندهٔ هزارگان در اعداد پذیرفته می‌شود
 *  • بولین‌ها: بله/خیر/yes/no/true/false/1/0/فعال/غیرفعال/دارد/ندارد/✓/✗ …
 *  • دادهٔ تصویر (imageUrl / gallery) هرگز وارد CSV نمی‌شود و هنگام
 *    به‌روزرسانی نیز دست نخورده باقی می‌ماند (تصاویر فقط از پنل مدیریت).
 *  • «تعداد سفارش» ستون اطلاعاتیِ فقط‌خواندنی است و در درون‌ریزی نادیده
 *    گرفته می‌شود (آمار واقعی از سفارش‌ها می‌آید).
 *  • ستون غایب ← فیلد در به‌روزرسانی دست‌نخورده؛ سلول خالی ← پاک‌شدن/پیش‌فرض.
 *    (خروجی همیشه همهٔ ستون‌ها را دارد ← رفت‌وبرگشت خروجی→ورودی = همگام کامل)
 */

import { toEnglishDigits, normalizePersian } from "@/lib/fa";

// ============ محدودیت‌ها ============

export const MAX_CSV_BYTES = 2 * 1024 * 1024; // ۲ مگابایت
export const MAX_CSV_ROWS = 5000;

// ============ انواع ============

export type ImportMode = "sync" | "create-only";

export interface ImportOptions {
  mode: ImportMode;
  /** دسته‌بندی ناموجود به‌صورت خودکار ساخته شود؟ */
  createCategories: boolean;
}

export type ProductField =
  | "id"
  | "name"
  | "category"
  | "price"
  | "description"
  | "isAvailable"
  | "isSpecial"
  | "isDrink"
  | "isVegetarian"
  | "isSpicy"
  | "calories"
  | "prepTime"
  | "ingredients"
  | "sortOrder";

export interface ProductCsvRecord {
  id: string | null;
  name: string;
  category: string;
  price: number;
  description: string | null;
  isAvailable: boolean;
  isSpecial: boolean;
  isDrink: boolean;
  isVegetarian: boolean;
  isSpicy: boolean;
  calories: number | null;
  prepTime: number | null;
  ingredients: string | null;
  sortOrder: number;
  /** کلیدهای ستونی که در فایل حضور داشتند — برای به‌روزرسانی جزئی */
  fieldsPresent: Set<ProductField>;
}

export interface ValidatedRow {
  /** شمارهٔ ردیف داده (بدون احتساب سرستون) — ۱ مبنا */
  row: number;
  record: ProductCsvRecord | null;
  errors: string[];
  warnings: string[];
}

export interface ColumnMapEntry {
  header: string;
  canonical: ProductField | "orderCount" | null;
}

export interface ProductsCsvValidation {
  fatal: string | null;
  delimiter: string;
  delimiterLabel: string;
  headerRow: string[];
  columns: ColumnMapEntry[];
  unknownColumns: string[];
  duplicateColumns: string[];
  missingRequired: string[];
  /** یادداشت‌های سطح‌فایل (مثلاً حضور ستون فقط‌خواندنی) */
  notes: string[];
  rows: ValidatedRow[];
  validCount: number;
  invalidCount: number;
}

export type ImportRowAction = "created" | "updated" | "skipped" | "error";

export interface ImportRowOutcome {
  row: number;
  name: string;
  action: ImportRowAction;
  message?: string;
}

export interface ImportOutcome {
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  rows: ImportRowOutcome[];
  categoriesCreated: { name: string; slug: string }[];
  durationMs: number;
}

export interface ProductCsvExportRow {
  id: string;
  name: string;
  category: string;
  price: number;
  description: string | null;
  isAvailable: boolean;
  isSpecial: boolean;
  isDrink: boolean;
  isVegetarian: boolean;
  isSpicy: boolean;
  calories: number | null;
  prepTime: number | null;
  ingredients: string | null;
  sortOrder: number;
  orderCount: number;
}

// ============ سرستون‌های رسمی (ترتیب ثابت خروجی) ============

export const PRODUCT_CSV_HEADERS: { key: ProductField | "orderCount"; label: string }[] = [
  { key: "id", label: "شناسه" },
  { key: "name", label: "نام" },
  { key: "category", label: "دسته‌بندی" },
  { key: "price", label: "قیمت (تومان)" },
  { key: "description", label: "توضیحات" },
  { key: "isAvailable", label: "موجود" },
  { key: "isSpecial", label: "پیشنهاد ویژه" },
  { key: "isDrink", label: "نوشیدنی" },
  { key: "isVegetarian", label: "گیاهی" },
  { key: "isSpicy", label: "تند" },
  { key: "calories", label: "کالری" },
  { key: "prepTime", label: "زمان آماده‌سازی (دقیقه)" },
  { key: "ingredients", label: "مواد تشکیل‌دهنده" },
  { key: "sortOrder", label: "ترتیب نمایش" },
  { key: "orderCount", label: "تعداد سفارش" },
];

/** نام‌های جایگزین مجاز برای هر سرستون (فارسی + انگلیسی) */
const HEADER_ALIASES: Partial<Record<ProductField | "orderCount", string[]>> = {
  id: ["شناسه", "کد", "کد محصول", "آیدی", "id", "productid"],
  name: ["نام", "نام غذا", "نام محصول", "عنوان", "name", "title", "productname"],
  category: ["دسته بندی", "دسته", "گروه", "category", "cat", "categoryname"],
  price: ["قیمت تومان", "قیمت", "مبلغ", "price", "pricetoman", "amount"],
  description: ["توضیحات", "توضیح", "شرح", "description", "desc"],
  isAvailable: ["موجود", "موجودی", "وضعیت موجودی", "آیا موجود است", "available", "isavailable", "instock"],
  isSpecial: ["پیشنهاد ویژه", "ویژه", "special", "isspecial"],
  isDrink: ["نوشیدنی", "نوشیدنی است", "drink", "isdrink"],
  isVegetarian: ["گیاهی", "گیاهی است", "vegetarian", "isvegetarian"],
  isSpicy: ["تند", "تند است", "spicy", "isspicy"],
  calories: ["کالری", "مقدار کالری", "calories", "cal"],
  prepTime: [
    "زمان آماده سازی (دقیقه)",
    "زمان آماده سازی",
    "زمان تهیه (دقیقه)",
    "زمان تهیه",
    "preptime",
    "preptimemin",
  ],
  ingredients: ["مواد تشکیل دهنده", "مواد اولیه", "مواد", "ingredients"],
  sortOrder: ["ترتیب نمایش", "ترتیب", "sortorder", "sort", "displayorder"],
  orderCount: ["تعداد سفارش", "تعداد فروش", "ordercount", "sales"],
};

const REQUIRED_FIELDS: ProductField[] = ["name", "category", "price"];

const FIELD_LABEL_FA = Object.fromEntries(
  PRODUCT_CSV_HEADERS.map((h) => [h.key, h.label])
) as Record<ProductField | "orderCount", string>;

// ============ ابزارهای عمومی ============

function normalizeHeader(h: string): { norm: string; squished: string } {
  const norm = normalizePersian(toEnglishDigits(h.trim()));
  return { norm, squished: norm.replace(/\s+/g, "") };
}

/** تشخیص سرستون بر اساس نام‌های جایگزین */
function matchHeader(header: string): ProductField | "orderCount" | null {
  const { norm, squished } = normalizeHeader(header);
  if (norm === "" || squished === "") return null;

  // ۱) برچسب‌های رسمی خودمان (تضمین رفت‌وبرگشت دقیق خروجی → ورودی)
  for (const h of PRODUCT_CSV_HEADERS) {
    const a = normalizeHeader(h.label);
    if (a.norm === norm || a.squished === squished) return h.key;
  }

  // ۲) نام‌های جایگزین فارسی/انگلیسی
  for (const [key, aliases] of Object.entries(HEADER_ALIASES) as [
    ProductField | "orderCount",
    string[],
  ][]) {
    for (const alias of aliases) {
      const a = normalizeHeader(alias);
      if (a.norm === norm || a.squished === squished) return key;
    }
  }
  return null;
}

/** عدد صحیح از متن — ارقام فارسی/عربی، جداکنندهٔ هزارگان و فاصله پاک می‌شود */
export function parseCsvInteger(
  raw: string
): { ok: true; value: number } | { ok: false; reason: "empty" | "invalid" } {
  const cleaned = toEnglishDigits(raw)
    .replace(/[,\u066C\u0020\u00A0\u200F\u200E'’`]/g, "")
    .trim();
  if (cleaned === "") return { ok: false, reason: "empty" };
  if (!/^\d+$/.test(cleaned)) return { ok: false, reason: "invalid" };
  const n = Number(cleaned);
  if (!Number.isSafeInteger(n)) return { ok: false, reason: "invalid" };
  return { ok: true, value: n };
}

const TRUE_WORDS = new Set(["بله", "yes", "true", "1", "فعال", "دارد", "است", "✓", "✔", "✅", "+", "y"]);
const FALSE_WORDS = new Set(["خیر", "no", "false", "0", "غیرفعال", "ندارد", "نیست", "✗", "✖", "❌", "-", "—", "n"]);

/** بولین — خالی = undefined (پیش‌فرض)، مقدار ناشناخته = null (خطا) */
export function parseCsvBoolean(raw: string): boolean | null | undefined {
  const v = normalizePersian(toEnglishDigits(raw)).trim();
  if (v === "") return undefined;
  if (TRUE_WORDS.has(v)) return true;
  if (FALSE_WORDS.has(v)) return false;
  return null;
}

function boolFa(v: boolean): string {
  return v ? "بله" : "خیر";
}

export function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r;]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

export function toCsv(rows: (string | number | null)[][]): string {
  return rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
}

// ============ پارسر CSV (RFC 4180 + تشخیص جداکننده) ============

export function detectDelimiter(text: string): string {
  // بررسی اولین خطِ غیرخالی — شمارش , ؛ \t خارج از نقل‌قول
  let i = 0;
  let inQuotes = false;
  let started = false;
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') i++;
        else inQuotes = false;
      }
      i++;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (started) break;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      started = true;
    } else if (ch in counts) {
      counts[ch]++;
      started = true;
    } else if (ch.trim() !== "") {
      started = true;
    }
    i++;
  }
  if (counts[";"] > counts[","] && counts[";"] >= counts["\t"]) return ";";
  if (counts["\t"] > counts[","] && counts["\t"] > counts[";"]) return "\t";
  return ",";
}

export function delimiterLabel(d: string): string {
  if (d === ";") return "سمی‌کالن ( ; )";
  if (d === "\t") return "تب";
  return "کاما ( , )";
}

export function parseCsv(input: string): { delimiter: string; rows: string[][] } {
  let text = input;
  // حذف BOM (فایل‌های Excel/UTF-8)
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const delimiter = detectDelimiter(text);

  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawContent = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      sawContent = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      cur.push(field);
      field = "";
      sawContent = true;
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = "";
      sawContent = false;
      i++;
      continue;
    }
    field += ch;
    sawContent = true;
    i++;
  }
  if (field !== "" || cur.length > 0 || sawContent) {
    cur.push(field);
    rows.push(cur);
  }

  // حذف ردیف‌های کاملاً خالی (خطوط انتهایی/میانی)
  const cleaned = rows.filter((r) => r.some((c) => c.trim() !== ""));
  return { delimiter, rows: cleaned };
}

// ============ نگاشت سرستون‌ها ============

export interface ColumnMap {
  /** ایندکس ستون ← کلید canon */
  byIndex: Map<number, ProductField | "orderCount">;
  unknownColumns: string[];
  duplicateColumns: string[];
  missingRequired: string[];
}

export function buildColumnMap(headers: string[]): ColumnMap {
  const byIndex = new Map<number, ProductField | "orderCount">();
  const seen = new Set<ProductField | "orderCount">();
  const unknownColumns: string[] = [];
  const duplicateColumns: string[] = [];

  headers.forEach((h, idx) => {
    const key = matchHeader(h);
    if (!key) {
      if (h.trim() !== "") unknownColumns.push(h.trim());
      return;
    }
    if (seen.has(key)) {
      duplicateColumns.push(FIELD_LABEL_FA[key]);
      return; // اولین ستون برنده است
    }
    seen.add(key);
    byIndex.set(idx, key);
  });

  const missingRequired = REQUIRED_FIELDS.filter((f) => !seen.has(f)).map((f) => FIELD_LABEL_FA[f]);
  return { byIndex, unknownColumns, duplicateColumns, missingRequired };
}

// ============ اعتبارسنجی ردیف ============

function cellAt(cells: string[], idx: number): string {
  return idx < cells.length ? cells[idx] : "";
}

function validateRow(cells: string[], map: ColumnMap, rowNumber: number): ValidatedRow {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fieldsPresent = new Set<ProductField>();

  const get = (key: ProductField | "orderCount"): { present: boolean; value: string } => {
    for (const [idx, k] of map.byIndex) {
      if (k === key) return { present: true, value: cellAt(cells, idx).trim() };
    }
    return { present: false, value: "" };
  };

  // --- شناسه ---
  const idCell = get("id");
  let id: string | null = null;
  if (idCell.present && idCell.value !== "") {
    if (idCell.value.length > 64) errors.push("شناسه بیش از حد بلند است");
    else id = idCell.value;
    fieldsPresent.add("id");
  }

  // --- نام (الزامی) ---
  const nameCell = get("name");
  let name = "";
  if (nameCell.value === "") {
    errors.push("نام محصول خالی است");
  } else if (nameCell.value.length < 2 || nameCell.value.length > 80) {
    errors.push("نام باید بین ۲ تا ۸۰ نویسه باشد");
  } else {
    name = nameCell.value;
  }
  if (nameCell.present) fieldsPresent.add("name");

  // --- دسته‌بندی (الزامی) ---
  const catCell = get("category");
  let category = "";
  if (catCell.value === "") {
    errors.push("دسته‌بندی خالی است");
  } else if (catCell.value.length > 80) {
    errors.push("نام دسته‌بندی بیش از حد بلند است");
  } else {
    category = catCell.value;
  }
  if (catCell.present) fieldsPresent.add("category");

  // --- قیمت (الزامی) ---
  const priceCell = get("price");
  let price = 0;
  if (priceCell.value === "") {
    errors.push("قیمت خالی است");
  } else {
    const p = parseCsvInteger(priceCell.value);
    if (!p.ok) {
      errors.push("قیمت عدد معتبری نیست (ارقام فارسی و جداکنندهٔ هزارگان مجاز است)");
    } else if (p.value < 1000) {
      errors.push("قیمت حداقل ۱,۰۰۰ تومان است");
    } else if (p.value > 500_000_000) {
      errors.push("قیمت حداکثر ۵۰۰,۰۰۰,۰۰۰ تومان است");
    } else {
      price = p.value;
    }
  }
  if (priceCell.present) fieldsPresent.add("price");

  // --- توضیحات ---
  const descCell = get("description");
  let description: string | null = null;
  if (descCell.value !== "") {
    if (descCell.value.length > 600) errors.push("توضیحات حداکثر ۶۰۰ نویسه است");
    else description = descCell.value;
  }
  if (descCell.present) fieldsPresent.add("description");

  // --- بولین‌ها ---
  const bools: [ProductField, string, boolean][] = [
    ["isAvailable", "موجود", true],
    ["isSpecial", "پیشنهاد ویژه", false],
    ["isDrink", "نوشیدنی", false],
    ["isVegetarian", "گیاهی", false],
    ["isSpicy", "تند", false],
  ];
  const boolValues: Record<string, boolean> = {};
  for (const [key, label, def] of bools) {
    const cell = get(key);
    if (!cell.present) {
      boolValues[key] = def; // ستون غایب ← پیش‌فرض
      continue;
    }
    fieldsPresent.add(key);
    const v = parseCsvBoolean(cell.value);
    if (v === null) {
      errors.push(`مقدار «${label}» نامعتبر است (بله/خیر)`);
      boolValues[key] = def;
    } else {
      boolValues[key] = v ?? def; // سلول خالی ← پیش‌فرض
    }
  }

  // --- اعداد اختیاری ---
  const optInts: [ProductField, string, number, number, number | null][] = [
    ["calories", "کالری", 0, 5000, null],
    ["prepTime", "زمان آماده‌سازی", 0, 600, null],
    ["sortOrder", "ترتیب نمایش", 0, 999, 0],
  ];
  const intValues: Record<string, number | null> = {};
  for (const [key, label, min, max, emptyDefault] of optInts) {
    const cell = get(key);
    if (!cell.present) {
      intValues[key] = emptyDefault;
      continue;
    }
    fieldsPresent.add(key);
    if (cell.value === "") {
      intValues[key] = emptyDefault;
      continue;
    }
    const n = parseCsvInteger(cell.value);
    if (!n.ok) {
      errors.push(`${label} عدد معتبری نیست`);
      intValues[key] = emptyDefault;
    } else if (n.value < min || n.value > max) {
      errors.push(`${label} باید بین ${min.toLocaleString("en-US")} و ${max.toLocaleString("en-US")} باشد`);
      intValues[key] = emptyDefault;
    } else {
      intValues[key] = n.value;
    }
  }

  // --- مواد تشکیل‌دهنده ---
  const ingCell = get("ingredients");
  let ingredients: string | null = null;
  if (ingCell.value !== "") {
    if (ingCell.value.length > 600) errors.push("مواد تشکیل‌دهنده حداکثر ۶۰۰ نویسه است");
    else ingredients = ingCell.value;
  }
  if (ingCell.present) fieldsPresent.add("ingredients");

  const record: ProductCsvRecord | null =
    errors.length === 0
      ? {
          id,
          name,
          category,
          price,
          description,
          isAvailable: boolValues.isAvailable,
          isSpecial: boolValues.isSpecial,
          isDrink: boolValues.isDrink,
          isVegetarian: boolValues.isVegetarian,
          isSpicy: boolValues.isSpicy,
          calories: intValues.calories,
          prepTime: intValues.prepTime,
          ingredients,
          sortOrder: intValues.sortOrder ?? 0,
          fieldsPresent,
        }
      : null;

  return { row: rowNumber, record, errors, warnings };
}

// ============ اعتبارسنجی کل فایل ============

export function validateProductsCsv(text: string): ProductsCsvValidation {
  const { delimiter, rows } = parseCsv(text);

  const base: ProductsCsvValidation = {
    fatal: null,
    delimiter,
    delimiterLabel: delimiterLabel(delimiter),
    headerRow: [],
    columns: [],
    unknownColumns: [],
    duplicateColumns: [],
    missingRequired: [],
    notes: [],
    rows: [],
    validCount: 0,
    invalidCount: 0,
  };

  if (rows.length === 0) {
    return { ...base, fatal: "فایل خالی است یا هیچ ردیفی ندارد" };
  }

  const headerRow = rows[0].map((h) => h.trim());
  const map = buildColumnMap(headerRow);
  const dataRows = rows.slice(1);

  const columns: ColumnMapEntry[] = headerRow.map((h, idx) => ({
    header: h,
    canonical: map.byIndex.get(idx) ?? null,
  }));

  if (dataRows.length > MAX_CSV_ROWS) {
    return {
      ...base,
      headerRow,
      columns,
      unknownColumns: map.unknownColumns,
      duplicateColumns: map.duplicateColumns,
      missingRequired: map.missingRequired,
      fatal: `تعداد ردیف‌ها (${dataRows.length.toLocaleString("en-US")}) بیش از حد مجاز (${MAX_CSV_ROWS.toLocaleString("en-US")}) است`,
    };
  }

  if (map.missingRequired.length > 0) {
    return {
      ...base,
      headerRow,
      columns,
      unknownColumns: map.unknownColumns,
      duplicateColumns: map.duplicateColumns,
      missingRequired: map.missingRequired,
      fatal: `ستون‌های الزامی یافت نشد: ${map.missingRequired.join("، ")}`,
    };
  }

  // یادداشت سطح‌فایل: ستون فقط‌خواندنی «تعداد سفارش»
  const notes: string[] = [];
  if (map.byIndex && Array.from(map.byIndex.values()).includes("orderCount")) {
    notes.push("ستون «تعداد سفارش» صرفاً اطلاعاتی است و در درون‌ریزی نادیده گرفته می‌شود (آمار واقعی از سفارش‌ها)");
  }

  const validated: ValidatedRow[] = [];
  for (let i = 0; i < dataRows.length; i++) {
    // ردیف‌های کاملاً خالی در parseCsv حذف شده‌اند
    validated.push(validateRow(dataRows[i], map, i + 1));
  }

  const validCount = validated.filter((r) => r.record !== null).length;

  return {
    ...base,
    headerRow,
    columns,
    unknownColumns: map.unknownColumns,
    duplicateColumns: map.duplicateColumns,
    missingRequired: map.missingRequired,
    notes,
    rows: validated,
    validCount,
    invalidCount: validated.length - validCount,
  };
}

// ============ خروجی CSV (برون‌بری) ============

export function productsToCsv(items: ProductCsvExportRow[]): string {
  const header = PRODUCT_CSV_HEADERS.map((h) => h.label);
  const body = items.map((r) => [
    r.id,
    r.name,
    r.category,
    r.price,
    r.description ?? "",
    boolFa(r.isAvailable),
    boolFa(r.isSpecial),
    boolFa(r.isDrink),
    boolFa(r.isVegetarian),
    boolFa(r.isSpicy),
    r.calories ?? "",
    r.prepTime ?? "",
    r.ingredients ?? "",
    r.sortOrder,
    r.orderCount,
  ]);
  // BOM برای نمایش صحیح فارسی در Excel
  return "\uFEFF" + toCsv([header, ...body]);
}
