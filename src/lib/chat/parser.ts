import { normalizePersian, toEnglishDigits } from "@/lib/fa";
import type { ChatStage, MenuCategoryData, OrderDraft } from "./prompts";

// ============ Persian number words ============

const NUMBER_WORDS: Record<string, number> = {
  "یک": 1, "یه": 1, "دونه": 1, "دوتا": 2, "دو": 2, "سه": 3, "سه تا": 3,
  "چهار": 4, "پنج": 5, "شش": 6, "شیش": 6, "هفت": 7, "هشت": 8,
  "نه": 9, "ده": 10, "یازده": 11, "دوازده": 12, "پونزده": 15,
  "بیست": 20, "سی": 30, "چهل": 40, "پنجاه": 50,
};

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
    if (text.includes(word)) return num;
  }
  return 1;
}

/** Word-boundary-aware substring check for Persian text */
export function includesWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    const before = idx > 0 ? haystack[idx - 1] : "";
    const after = idx + needle.length < haystack.length ? haystack[idx + needle.length] : "";
    const isLetter = (c: string) => /[\u0600-\u06FF\u200c]/.test(c);
    // match must not be embedded inside a longer word (e.g. "فسنجان" inside "رفسنجان")
    if (!isLetter(before) && !isLetter(after)) return true;
    idx = haystack.indexOf(needle, idx + 1);
  }
  return false;
}

/** Match user text against menu items with Persian fuzzy matching + per-item quantity */
export function matchMenuItems(
  text: string,
  categories: MenuCategoryData[]
): { item: MenuCategoryData["items"][number]; quantity: number }[] {
  const norm = normalizePersian(text);
  const results: { item: MenuCategoryData["items"][number]; quantity: number; score: number }[] = [];

  for (const cat of categories) {
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

  // if full-name matches exist, prefer them over weak head-token matches of other items
  const hasStrong = [...best.values()].some((r) => r.score >= 2);
  const filtered = hasStrong
    ? [...best.values()].filter((r) => r.score >= 2)
    : [...best.values()];

  return filtered.map(({ item, quantity }) => ({ item, quantity }));
}

function extractQuantityAround(norm: string, matchPos: number, itemName: string): number {
  // numbers immediately before (take the closest = last) and after (first) the matched name
  const before = norm.slice(Math.max(0, matchPos - 14), matchPos);
  const after = norm.slice(matchPos, matchPos + itemName.length + 10);

  const digitMatchesBefore = [...before.matchAll(/(\d+)/g)];
  if (digitMatchesBefore.length > 0) {
    return Math.max(1, Math.min(30, parseInt(digitMatchesBefore[digitMatchesBefore.length - 1][1], 10)));
  }
  const digitMatchesAfter = [...after.matchAll(/(\d+)/g)];
  if (digitMatchesAfter.length > 0) {
    return Math.max(1, Math.min(30, parseInt(digitMatchesAfter[0][1], 10)));
  }

  // number words — check closest occurrence
  for (const [word, num] of Object.entries(NUMBER_WORDS)) {
    const idxB = before.lastIndexOf(word);
    const idxA = after.indexOf(word);
    if (idxB >= 0 || idxA >= 0) return num;
  }
  return 1;
}

const FINISH_WORDS = ["همین", "همینا", "همین ها", "بسه", "کافیه", "کافی", "نهایی", "نهاییش", "ثبت", "تمومه", "تمام", "دیگه نمیخوام", "بریم مرحله بعد", "بابا اینا"];
const DRINK_SKIP_WORDS = ["نمیخوام", "نداد", "بی خیال", "بیخیال", "لازم نیست", "نه ممنون", "نه خودم", "سبکم", "چیزی نمیخوام", "نه دیگه"];
const DELIVERY_WORDS = ["پیک", "ارسال", "ارسال کن", "درب منزل", "تحویل در", "خونه", "منزل", "آدرس"];
const PICKUP_WORDS = ["بیرونبر", "بیرون بر", "حضوری", "خودم میام", "خودم میایم", "سر خودم", "بیرون بر"];
const RESET_WORDS = ["سفارش جدید", "از اول", "شروع جدید", "سفارش جدیدی", "دوباره سفارش"];
const TRACK_WORDS = ["وضعیت سفارش", "کجاست سفارش", "پیگیری", "سفارشم چطور", "سفارش کجاست", "order status", "وضعیت سفارشم", "رسیده"];
const REMOVE_WORDS = ["حذف", "بردار", "کنسل", "لغو", "کم کن", "نمیخوامش", "ندید"];
const COUPON_WORDS = ["کد تخفیف", "کدتخفیف", "تخفیف دارم", "کوپن", "کد تخفيف", "تخفیف"];
const COUPON_REMOVE_WORDS = ["کد تخفیف رو بردار", "تخفیف رو بردار", "کد رو حذف", "کد تخفیف رو حذف", "بدون تخفیف", "کد تخفیف رو لغو"];

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

  // --- TRACK ---
  if (TRACK_WORDS.some((w) => norm.includes(normalizePersian(w))) && stage === "TRACKING") {
    return { actions: [], nextStage: "TRACKING", reply: null, confidence: 0.85 };
  }

  // --- Delivery method ---
  if (stage === "DELIVERY_METHOD") {
    if (DELIVERY_WORDS.some((w) => norm.includes(normalizePersian(w)))) {
      actions.push({ type: "SET_DELIVERY", method: "DELIVERY" });
      nextStage = "ADDRESS";
      reply = "عالی! برای ارسال با پیک، لطفاً آدرس کاملتون رو بنویسید (محله، خیابان، کوچه، پلاک و واحد) 🛵";
      confidence = 0.9;
      return { actions, nextStage, reply, confidence };
    }
    if (PICKUP_WORDS.some((w) => norm.includes(normalizePersian(w)))) {
      actions.push({ type: "SET_DELIVERY", method: "PICKUP" });
      nextStage = "CONFIRMATION";
      reply = "خیلی خب! سفارشتون رو برای بیرونبر آماده می‌کنیم. فاکتور نهایی آماده‌ست، دکمه پرداخت رو بزنید 🌿";
      confidence = 0.9;
      return { actions, nextStage, reply, confidence };
    }
  }

  // --- Address capture ---
  if (stage === "ADDRESS" && message.trim().length >= 15) {
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
