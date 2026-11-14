import { normalizePersian, toEnglishDigits } from "@/lib/fa";
import type { ChatStage, MenuCategoryData, OrderDraft } from "./prompts";

// ============ Persian number words ============

const NUMBER_WORDS: Record<string, number> = {
  "یک": 1, "یه": 1, "دونه": 1, "دوتا": 2, "دو": 2, "سه": 3, "سه تا": 3,
  "چهار": 4, "پنج": 5, "شش": 6, "شیش": 6, "هفت": 7, "هشت": 8,
  "نه تا": 9, "نه عدد": 9, "ده": 10, "یازده": 11, "دوازده": 12, "پونزده": 15,
  "بیست": 20, "سی": 30, "چهل": 40, "پنجاه": 50,
};
// نکته: «نه» به‌تنهایی حذف شد — در فارسی بیشتر معنی «no» می‌دهد تا ۹ («نه کباب» ≠ ۹ کباب)؛
// فقط با پسوند شمارنده («نه تا») معتبر است.

export interface ParsedAction {
  type: "ADD_ITEM" | "REMOVE_ITEM" | "CLEAR_ORDER" | "SET_DELIVERY" | "SET_ADDRESS" | "APPLY_COUPON" | "REMOVE_COUPON" | "RESET";
  itemId?: string;
  name?: string;
  quantity?: number;
  method?: "DELIVERY" | "PICKUP";
  address?: string;
  code?: string;
}

export interface DeterministicResult {
  actions: ParsedAction[];
  nextStage: ChatStage | null;
  reply: string | null;
  confidence: number;
}

function extractQuantity(text: string): number {
  // latin/persian digits like "2 عدد" or "۲تا"
  const digitMatch = text.match(/(\d+)\s*(?:تا|عدد|نفر|بند)?/);
  if (digitMatch) return Math.max(1, Math.min(30, parseInt(digitMatch[1], 10)));
  for (const [word, num] of Object.entries(NUMBER_WORDS)) {
    if (includesWord(text, word)) return num;
  }
  return 1;
}

/** Word-boundary-aware substring check for Persian text */
export function includesWord(haystack: string, needle: string): boolean {
  return lastIndexOfWord(haystack, needle) !== -1;
}

/** Last word-boundary occurrence of needle in haystack (−1 if none) —
 *  prevents «کوبیده» matching «ده» (10) or «دوغ» matching «دو» (2). */
function lastIndexOfWord(haystack: string, needle: string): number {
  if (!needle) return -1;
  let idx = haystack.lastIndexOf(needle);
  while (idx !== -1) {
    const before = idx > 0 ? haystack[idx - 1] : "";
    const after = idx + needle.length < haystack.length ? haystack[idx + needle.length] : "";
    const isLetter = (c: string) => /[\u0600-\u06FF\u200c]/.test(c);
    // match must not be embedded inside a longer word (e.g. "فسنجان" inside "رفسنجان")
    if (!isLetter(before) && !isLetter(after)) return idx;
    idx = haystack.lastIndexOf(needle, idx - 1);
  }
  return -1;
}

/** Match user text against menu items with Persian fuzzy matching + per-item quantity */
export function matchMenuItems(
  text: string,
  categories: MenuCategoryData[]
): { item: MenuCategoryData["items"][number]; quantity: number }[] {
  // ارقام فارسی (۲/۳/…) هم باید به لاتین تبدیل شوند تا \d+ در استخراج تعداد بگیردشان
  const norm = normalizePersian(toEnglishDigits(text));
  const results: { item: MenuCategoryData["items"][number]; quantity: number; score: number }[] = [];

  for (const cat of categories) {
    // category hint, e.g. «خورشت‌های ایرانی» → «خورشت» — saying the category
    // plus the item's head word («خورشت قیمه») is a strong, intentional match
    const catHint = normalizePersian(cat.name).replace(/( های| ها|های|ها)( ایرانی| کرمان)?$/u, "").trim();

    for (const item of cat.items) {
      const itemName = normalizePersian(item.name);
      const tokens = itemName.split(" ").filter((t) => t.length > 2);
      const head = itemName.split(" ")[0] ?? "";

      let score = 0;
      let matchPos = -1;

      if (itemName.length >= 3 && includesWord(norm, itemName)) {
        score = 3;
        matchPos = norm.indexOf(itemName);
      } else if (tokens.length > 0 && tokens.every((t) => includesWord(norm, t))) {
        score = 2;
        matchPos = norm.indexOf(tokens[0]);
      } else if (head.length >= 3 && includesWord(norm, head)) {
        score = 1;
        matchPos = norm.indexOf(head);
      } else if (
        catHint.length >= 3 &&
        head.length >= 3 &&
        includesWord(norm, catHint) &&
        includesWord(norm, head)
      ) {
        // «خورشت قیمه» for the menu item «قیمه سیب» (category + head word)
        score = 2;
        matchPos = norm.indexOf(head);
      }

      if (score > 0 && matchPos >= 0) {
        const qty = extractQuantityAround(norm, matchPos, itemName);
        results.push({ item, quantity: qty, score });
      }
    }
  }

  // dedupe by item id keeping the highest score
  const best = new Map<string, { item: MenuCategoryData["items"][number]; quantity: number; score: number }>();
  for (const r of results) {
    const existing = best.get(r.item.id);
    if (!existing || r.score > existing.score) best.set(r.item.id, r);
  }

  // if full-name matches exist, prefer them over weak head-token matches of other items —
  // اما تطبیق‌های ضعیفی که سرکلمه‌شان جزء نام هیچ قلم قوی نیست باید نگه داشته شوند
  // (مثال: «2 کباب کوبیده و 1 دوغ» → دوغ فقط تطبیق سرکلمه دارد ولی واقعاً سفارش داده شده)
  const strong = [...best.values()].filter((r) => r.score >= 2);
  const filtered = strong.length > 0
    ? [
        ...strong,
        ...[...best.values()].filter((r) =>
          r.score < 2 &&
          !strong.some((s) =>
            includesWord(normalizePersian(s.item.name), normalizePersian(r.item.name).split(" ")[0] ?? "")
          )
        ),
      ]
    : [...best.values()];

  return filtered.map(({ item, quantity }) => ({ item, quantity }));
}

function extractQuantityAround(norm: string, matchPos: number, itemName: string): number {
  // numbers immediately before (take the closest = last) and after (first) the matched name
  const before = norm.slice(Math.max(0, matchPos - 14), matchPos);
  // «after» از بعدِ خود نام شروع می‌شود و در حرف ربط «و» متوقف می‌شود —
  // تعدادی که بعد از «و» می‌آید متعلق به قلم بعدی است («کباب کوبیده و ۱ دوغ» → ۱ برای دوغ است)
  const afterRaw = norm.slice(matchPos + itemName.length, matchPos + itemName.length + 12);
  const after = afterRaw.split(" و ")[0].trim();

  const digitMatchesBefore = [...before.matchAll(/(\d+)/g)];
  if (digitMatchesBefore.length > 0) {
    return Math.max(1, Math.min(30, parseInt(digitMatchesBefore[digitMatchesBefore.length - 1][1], 10)));
  }
  const digitMatchesAfter = [...after.matchAll(/(\d+)/g)];
  if (digitMatchesAfter.length > 0) {
    return Math.max(1, Math.min(30, parseInt(digitMatchesAfter[0][1], 10)));
  }

  // عدد-واژه‌ها: (۱) همهٔ واژه‌های قبل از نام بررسی می‌شوند و نزدیک‌ترین برنده می‌شود —
  // قبلی‌ها همیشه بر بعدی‌ها اولویت دارند («دو کباب و یک دوغ» → برای کباب «دو» یعنی ۲،
  // نه «یک» که بعد از نام آمده و مال دوغ است)؛ (۲) تطبیق با مرز واژه («کوبیده» ≠ ۱۰، «دوغ» ≠ ۲)
  let bestIdxB = -1;
  let bestNumB = 0;
  for (const [word, num] of Object.entries(NUMBER_WORDS)) {
    const idxB = lastIndexOfWord(before, word);
    if (idxB >= 0 && idxB > bestIdxB) { bestIdxB = idxB; bestNumB = num; }
  }
  if (bestIdxB >= 0) return bestNumB;
  for (const [word, num] of Object.entries(NUMBER_WORDS)) {
    if (includesWord(after, word)) return num;
  }
  return 1;
}

const FINISH_WORDS = ["همین", "همینا", "همین ها", "بسه", "کافیه", "کافی", "نهایی", "نهاییش", "ثبت", "تمومه", "تمام", "دیگه نمیخوام", "بریم مرحله بعد", "بابا اینا"];
const DRINK_SKIP_WORDS = ["نمیخوام", "نداد", "بی خیال", "بیخیال", "لازم نیست", "نه ممنون", "نه خودم", "سبکم", "چیزی نمیخوام", "نه دیگه"];
const DELIVERY_WORDS = ["پیک", "ارسال", "ارسال کن", "درب منزل", "تحویل در", "خونه", "منزل", "آدرس"];
/** عبارات صریح انتخاب پیک — خارج از مرحلهٔ روش تحویل هم معتبرند (سوالات رایج مثل «هزینه ارسال چقدره؟» یا «منو رو بفرست» باید بی‌اثر بمانند) */
const STRONG_DELIVERY_PHRASES = [
  "با پیک", "پیک بفرست", "پیک باشه", "پیک لطفا", "پیک میخوام", "پیک می‌خوام",
  "ارسال با پیک", "ارسال باشه", "درب منزل", "تحویل در آدرس",
  "به آدرسم", "به آدرس", "به خونه", "خونه بفرست", "به منزل", "منزل بفرست",
];
const PICKUP_WORDS = ["بیرونبر", "بیرون بر", "حضوری", "خودم میام", "خودم میایم", "سر خودم", "بیرون بر"];
const RESET_WORDS = ["سفارش جدید", "از اول", "شروع جدید", "سفارش جدیدی", "دوباره سفارش"];
const TRACK_WORDS = ["وضعیت سفارش", "کجاست سفارش", "پیگیری", "سفارشم چطور", "سفارش کجاست", "order status", "وضعیت سفارشم", "رسیده"];

/**
 * آیا پیام کاربر صراحتاً وضعیت/رهگیری سفارش را می‌خواهد؟
 * در EVERY stage استفاده می‌شود — «وضعیت سفارشم رو بگو» از هر مرحله‌ای باید
 * کارت رهگیری را بیاورد، نه فقط وقتی از قبل در TRACKING هستیم.
 * (موتور چک می‌کند سفارشی وجود دارد؛ وگرنه خودش به مرحلهٔ سفارش برمی‌گردد.)
 */
export function wantsTracking(message: string): boolean {
  const norm = normalizePersian(toEnglishDigits(message));
  return TRACK_WORDS.some((w) => norm.includes(normalizePersian(w)));
}
const REMOVE_WORDS = ["حذف", "بردار", "کنسل", "لغو", "کم کن", "نمیخوامش", "ندید"];
const COUPON_WORDS = ["کد تخفیف", "کدتخفیف", "تخفیف دارم", "کوپن", "کد تخفيف", "تخفیف"];
const COUPON_REMOVE_WORDS = ["کد تخفیف رو بردار", "تخفیف رو بردار", "کد رو حذف", "کد تخفیف رو حذف", "بدون تخفیف", "کد تخفیف رو لغو"];

// ---- canned stage-navigation intents (also used by the chat UI step chips) ----
const NAV_EDIT_ORDER = ["غذاهای سفارش", "غذاهام رو تغییر", "سفارشم رو تغییر", "سفارش رو ویرایش", "تغییر بدم", "برگردیم به انتخاب", "برگرد به انتخاب", "غذا اضافه کنم", "آیتم اضافه"];
const NAV_DRINKS = ["نوشیدنی هم میخوام", "نوشیدنی میخوام", "نوشیدنی بده", "یه نوشیدنی", "نوشیدنی هم اضافه"];
const NAV_DELIVERY = ["روش ارسال", "روش تحویل", "نحوه ارسال", "پیک یا بیرونبر", "ارسال رو عوض"];
const NAV_ADDRESS = ["آدرس رو عوض", "آدرس رو تغییر", "آدرسم رو عوض", "آدرس جدید", "آدرس رو ویرایش"];
const NAV_INVOICE = ["فاکتور نهایی رو نشون", "فاکتور رو نشون", "فاکتور نشونم بده", "فاکتور رو ببینم", "فاکتور نهایی", "سبد نهایی", "فاکتور رو نشونم بده"];

/** Extract a coupon-like token from user text (Latin letters/digits, 3-24 chars) */
export function extractCouponCode(text: string): string | null {
  const norm = toEnglishDigits(text).toUpperCase();
  // explicit patterns first: "کد X", «X», 'X'
  const quoted = norm.match(/[«"'\u0027]([A-Z0-9\u0621-\u064A-]{3,24})[»"'\u0027]/);
  if (quoted) return quoted[1].replace(/\s+/g, "");
  // any latin-ish token of length >= 3 containing at least one letter or digit
  const tokens = norm.match(/[A-Z0-9][A-Z0-9_-]{2,23}/g);
  if (tokens && tokens.length > 0) {
    // skip pure number tokens that look like phone/qty (e.g. 09123456789, 2)
    const candidates = tokens.filter((t) => !(t.length >= 10 && /^\d+$/.test(t)));
    if (candidates.length > 0) return candidates[0];
  }
  return null;
}

/**
 * Detect an explicit stage-navigation intent (used by the UI step chips and
 * as a deterministic safety net so backward navigation always works — even
 * when the AI model is unavailable). Returns the stage the user asked to go
 * to, or null when the message is not a navigation request.
 */
export function detectStageNavIntent(
  message: string,
  draft: OrderDraft | null,
  categories: MenuCategoryData[]
): { stage: ChatStage; reply: string } | null {
  const norm = normalizePersian(toEnglishDigits(message));
  const has = (words: string[]) => words.some((w) => norm.includes(normalizePersian(w)));
  const hasItems = (draft?.items?.length ?? 0) > 0;

  // NOTE: messages that name a concrete menu item («یک نوشابه دیگه اضافه کن»)
  // are ADD/REMOVE actions, NOT navigation — they are intentionally excluded
  // here so the deterministic add/remove branches (and the AI) handle them.
  if (has(NAV_EDIT_ORDER)) {
    return {
      stage: "ORDERING",
      reply: "باشه! برگشتیم به مرحلهٔ انتخاب غذا 🍽 بگید چه تغییری می‌خواهید — کم کنیم، اضافه کنیم یا حذف؟",
    };
  }
  if (has(NAV_DRINKS)) {
    return {
      stage: hasItems ? "DRINKS" : "ORDERING",
      reply: hasItems
        ? "حتماً! لیست نوشیدنی‌ها براتون بازه 🥤 چی میل دارید؟"
        : "اول یه چیزی برای خوردن انتخاب کنید، بعد نوشیدنی‌ها را با هم چک می‌کنیم 🌿",
    };
  }
  if (has(NAV_DELIVERY)) {
    if (!hasItems) {
      return { stage: "ORDERING", reply: "سبدتون هنوز خالیه! اول بگید چه چیزی میل دارید، بعد روش ارسال را انتخاب می‌کنیم 🌿" };
    }
    return {
      stage: "DELIVERY_METHOD",
      reply: "چشم! سفارش با پیک ارسال بشه یا حضوری بیرونبر تحویل می‌گیرید؟ 🛵",
    };
  }
  if (has(NAV_ADDRESS)) {
    if (!hasItems) {
      return { stage: "ORDERING", reply: "اول سفارشتون را بگید، بعد آدرس را با هم ثبت می‌کنیم 🌿" };
    }
    if (draft?.deliveryMethod !== "DELIVERY") {
      return { stage: "DELIVERY_METHOD", reply: "برای ثبت آدرس، اول روش ارسال باید پیک باشه. با پیک ارسال بشه؟ 🛵" };
    }
    return {
      stage: "ADDRESS",
      reply: "بفرمایید، آدرس جدید و کامل را بنویسید (محله، خیابان، کوچه، پلاک، واحد) 📍",
    };
  }
  if (has(NAV_INVOICE)) {
    if (!hasItems) {
      return { stage: "ORDERING", reply: "هنوز چیزی در سبد نیست! بگید چه چیزی میل دارید تا فاکتور براتون آماده کنم 🌿" };
    }
    if (!draft?.deliveryMethod) {
      return { stage: "DELIVERY_METHOD", reply: "قبل از فاکتور، بگید سفارش با پیک ارسال بشه یا بیرونبر تحویل می‌گیرید؟ 🛵" };
    }
    return {
      stage: "CONFIRMATION",
      reply: "بفرمایید، فاکتور به‌روز شده — جزئیات کامل و دکمهٔ پرداخت پایینشه 🧾",
    };
  }
  return null;
}

// Questions and recommendations must never mutate the basket.
export function isMenuQuestion(message: string): boolean {
  const n = normalizePersian(message);
  const question = /[?؟]|قیمت|چنده|چقد|موجود|پیشنهاد|ترکیب|مواد|کالری|حساسیت|تند|چی داره/.test(n);
  const explicitOrder = /می ?خوام|می ?خواهم|اضافه کن|بذار|بزار|سفارش بده|سفارش می ?دم/.test(n);
  return question && !explicitOrder;
}

export function deterministicParse(
  message: string,
  stage: ChatStage,
  categories: MenuCategoryData[],
  draft: OrderDraft | null
): DeterministicResult {
  const norm = normalizePersian(toEnglishDigits(message));
  const actions: ParsedAction[] = [];
  let nextStage: ChatStage | null = null;
  let reply: string | null = null;
  let confidence = 0;

  const hasDrinks = (draft?.items ?? []).some((i) =>
    categories.flatMap((c) => c.items).some((m) => m.id === i.itemId && m.isDrink)
  );
  const hasFood = (draft?.items ?? []).some((i) =>
    categories.flatMap((c) => c.items).some((m) => m.id === i.itemId && !m.isDrink)
  );

  // --- RESET ---
  if (RESET_WORDS.some((w) => norm.includes(normalizePersian(w)))) {
    return { actions: [{ type: "RESET" }], nextStage: "GREETING", reply: null, confidence: 0.9 };
  }

  // --- Stage navigation intents (work at EVERY stage — backward navigation) ---
  const navIntent = detectStageNavIntent(message, draft, categories);
  if (navIntent) {
    return { actions: [], nextStage: navIntent.stage, reply: navIntent.reply, confidence: 0.9 };
  }

  // --- TRACK ---
  if (TRACK_WORDS.some((w) => norm.includes(normalizePersian(w))) && stage === "TRACKING") {
    return { actions: [], nextStage: "TRACKING", reply: null, confidence: 0.85 };
  }
  // (در مراحل دیگر، wantsTracking توسط موتور اعمال می‌شود — حتی وقتی مدل
  //  با متن جواب داده و suggestedStage نفرستاده است.)

  // --- Delivery method ---
  // At the delivery step ANY mention counts; elsewhere (while no method is
  // chosen yet) only strong courier phrases / explicit pickup words register —
  // so questions like «هزینه ارسال چقدره؟» never hijack the flow into address
  // collection. When the draft already holds an address, choosing courier
  // lands directly on the invoice (nothing left to ask).
  const hasSavedAddress = !!draft?.address && draft.address.trim().length >= 10;
  const deliveryMatch =
    stage === "DELIVERY_METHOD"
      ? DELIVERY_WORDS.some((w) => norm.includes(normalizePersian(w)))
      : !draft?.deliveryMethod &&
        STRONG_DELIVERY_PHRASES.some((w) => norm.includes(normalizePersian(w)));
  const pickupMatch =
    !draft?.deliveryMethod && PICKUP_WORDS.some((w) => norm.includes(normalizePersian(w)));
  if (deliveryMatch || pickupMatch) {
    if (deliveryMatch) {
      actions.push({ type: "SET_DELIVERY", method: "DELIVERY" });
      nextStage = hasSavedAddress ? "CONFIRMATION" : "ADDRESS";
      reply = hasSavedAddress
        ? "عالی! سفارش با پیک به آدرس ثبت‌شده‌تان ارسال می‌شه — فاکتور به‌روز شد و دکمهٔ پرداخت آماده‌ست 🧾"
        : "عالی! برای ارسال با پیک، لطفاً آدرس کاملتون رو بنویسید (محله، خیابان، کوچه، پلاک و واحد) 🛵";
      confidence = 0.9;
      return { actions, nextStage, reply, confidence };
    }
    actions.push({ type: "SET_DELIVERY", method: "PICKUP" });
    nextStage = "CONFIRMATION";
    reply = "خیلی خب! سفارشتون رو برای بیرونبر آماده می‌کنیم. فاکتور نهایی آماده‌ست، دکمه پرداخت رو بزنید 🌿";
    confidence = 0.9;
    return { actions, nextStage, reply, confidence };
  }

  // --- Address capture (any stage) ---
  // The model sometimes claims «آدرس ثبت شد» without emitting the action, so
  // capture runs whenever the message genuinely looks like an address.
  // `mentionsFood` keeps food orders with numbers from being mistaken for one.
  if (message.trim().length >= 15) {
    const looksLikeAddress =
      /(پلاک|کوچه|خیابان|بلوار|محله|منزل|واحد|نبش|بن بست|فلکه|میدان)/.test(norm) ||
      /\d{2,}/.test(norm);
    const mentionsFood = matchMenuItems(message, categories).length > 0;
    if (looksLikeAddress && !mentionsFood) {
      actions.push({ type: "SET_ADDRESS", address: message.trim() });
      nextStage = "CONFIRMATION";
      reply = "آدرس ثبت شد! ✅ فاکتور نهایی با احتساب هزینه ارسال آماده‌ست؛ اگر همه‌چیز اوکیه دکمه پرداخت رو بزنید.";
      confidence = 0.85;
      return { actions, nextStage, reply, confidence };
    }
  }

  // --- Remove items ---
  if (REMOVE_WORDS.some((w) => norm.includes(normalizePersian(w)))) {
    const matches = matchMenuItems(message, categories);
    if (matches.length > 0 && draft && draft.items.length > 0) {
      for (const m of matches) {
        actions.push({ type: "REMOVE_ITEM", itemId: m.item.id, quantity: 0 });
      }
      const names = matches.map((m) => m.item.name).join("، ");
      reply = `باشه، ${names} از سفارش حذف شد. چیز دیگه‌ای میل دارید؟ 😊`;
      confidence = 0.85;
      return { actions, nextStage, reply, confidence };
    }
    if (norm.includes("همه") || norm.includes("کل") || norm.includes("سبد")) {
      actions.push({ type: "CLEAR_ORDER" });
      reply = "کل سبد سفارش خالی شد. دوباره از منو انتخاب می‌کنید؟ 🌿";
      confidence = 0.8;
      return { actions, nextStage: "ORDERING", reply, confidence };
    }
  }

  // --- Coupon ---
  if (COUPON_WORDS.some((w) => norm.includes(normalizePersian(w)))) {
    if (COUPON_REMOVE_WORDS.some((w) => norm.includes(normalizePersian(w)))) {
      return {
        actions: [{ type: "REMOVE_COUPON" }],
        nextStage: null,
        reply: "باشه، کد تخفیف از سفارش برداشته شد. فاکتور بدون تخفیف به‌روز شد 👌",
        confidence: 0.85,
      };
    }
    const code = extractCouponCode(message);
    if (code) {
      return {
        actions: [{ type: "APPLY_COUPON", code }],
        nextStage: null,
        reply: null,
        confidence: 0.85,
      };
    }
    if (!/\d/.test(norm)) {
      return {
        actions: [],
        nextStage: null,
        reply: "چه کد تخفیفی داری؟ کد رو همینجا بنویس تا برات اعمال کنم 🎁",
        confidence: 0.7,
      };
    }
  }

  if (isMenuQuestion(message)) {
    return { actions: [], nextStage: null, reply: "برای اضافه‌کردن غذا، نام و تعداد آن را بگویید؛ هنوز چیزی به سبد اضافه نشده است.", confidence: 0.8 };
  }

  // --- Add items ---
  const matched = matchMenuItems(message, categories);
  if (matched.length > 0) {
    for (const m of matched) {
      if (!m.item.isAvailable) continue;
      actions.push({ type: "ADD_ITEM", itemId: m.item.id, quantity: m.quantity });
    }
    if (actions.length > 0) {
      const names = matched.map((m) => `${m.item.name} × ${m.quantity}`).join("، ");
      reply = `ثبت شد! ✅ ${names} به سفارشتون اضافه شد.`;
      confidence = 0.9;

      // finishing right after adding?
      const wantsFinish = FINISH_WORDS.some((w) => norm.includes(normalizePersian(w)));
      if (wantsFinish) {
        nextStage = hasDrinks ? "DELIVERY_METHOD" : "DRINKS";
        reply = hasDrinks
          ? `ثبت شد! ✅ حالا بگید سفارش با پیک ارسال بشه یا حضوری بیرونبر تحویل می‌گیرید؟ 🛵`
          : `ثبت شد! ✅ پیش از ادامه، نوشیدنی هم میل دارید؟ نوشابه، دوغ، موهیتو و... از منوی کنار دستتون 🥤`;
      }
      return { actions, nextStage, reply, confidence };
    }
  }

  // --- Finish / proceed ---
  if (FINISH_WORDS.some((w) => norm.includes(normalizePersian(w)))) {
    if (stage === "ORDERING") {
      nextStage = (hasDrinks || hasFood === false) ? (hasDrinks ? "DELIVERY_METHOD" : "ORDERING") : "DRINKS";
      if (hasFood === false) {
        reply = "هنوز چیزی انتخاب نکردید! از منوی بالا هر چیز میل دارید بگید تا براتون ثبت کنم 😊";
        nextStage = "ORDERING";
      } else if (nextStage === "DRINKS") {
        reply = "پیش از ادامه، نوشیدنی هم میل دارید؟ نوشابه، دوغ، موهیتو و... از منوی کنار دستتون 🥤";
      } else {
        reply = "سفارش عالی شد! بگید با پیک ارسال بشه یا حضوری بیرونبر تحویل می‌گیرید؟ 🛵";
      }
      return { actions, nextStage, reply, confidence: 0.8 };
    }
    if (stage === "DRINKS") {
      return {
        actions: [],
        nextStage: "DELIVERY_METHOD",
        reply: "باشه، بدون نوشیدنی! بگید سفارش با پیک ارسال بشه یا بیرونبر تحویل می‌گیرید؟ 🛵",
        confidence: 0.8,
      };
    }
  }

  // --- Drink skip ---
  if (stage === "DRINKS" && DRINK_SKIP_WORDS.some((w) => norm.includes(normalizePersian(w)))) {
    return {
      actions: [],
      nextStage: "DELIVERY_METHOD",
      reply: "باشه بدون نوشیدنی! بگید با پیک ارسال بشه یا حضوری بیرونبر تحویل می‌گیرید؟ 🛵",
      confidence: 0.85,
    };
  }

  // --- Yes/No in DELIVERY_METHOD fallback ---
  if (stage === "DELIVERY_METHOD" && /^(اره|آره|بله|نه|نخیر)/.test(norm)) {
    return { actions, nextStage: null, reply: null, confidence: 0.3 };
  }

  // --- Greeting on first message ---
  if (stage === "GREETING") {
    return {
      actions: [],
      nextStage: "ORDERING",
      reply: "سلام و خوش‌آمدید به رستوران نخل! 🌴 من هوش نخلم و مثل یه گارسون واقعی سفارشتون رو می‌گیرم. منوی کامل براتون باز شده — بگید چه چیزی میل دارید؟",
      confidence: 0.7,
    };
  }

  return { actions, nextStage: null, reply: null, confidence: 0 };
}
