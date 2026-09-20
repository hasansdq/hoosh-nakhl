import "server-only";
import { db } from "@/lib/db";
import { getSettings, type AISettings, type GeneralSettings } from "@/lib/settings";
import { chatCompletion, extractJson } from "@/lib/ai";
import { buildSystemPrompt, type ChatStage, type MenuCategoryData, type OrderDraft } from "./prompts";
import { deterministicParse, matchMenuItems, includesWord, type ParsedAction } from "./parser";
import { normalizePersian, formatToman } from "@/lib/fa";
import { extractAllergenPhrases, matchAllergens } from "@/lib/chat/allergens";
import { checkCoupon } from "@/lib/coupons";
import { safeParseDietaryPrefs } from "@/lib/api";

// ============ Types ============

export interface RichMenuPayload {
  title: string;
  categories: {
    id: string;
    name: string;
    items: {
      id: string;
      name: string;
      price: number;
      description?: string | null;
      imageUrl?: string | null;
      isAvailable: boolean;
      isSpecial: boolean;
      calories?: number | null;
      prepTime?: number | null;
    }[];
  }[];
}

export interface OrderSummaryPayload {
  items: { name: string; quantity: number; unitPrice: number; lineTotal: number }[];
  subtotal: number;
  deliveryFee: number;
  taxPercent: number;
  taxAmount: number;
  discount: number;
  couponCode?: string;
  couponTitle?: string;
  couponLabel?: string;
  total: number;
  deliveryMethod: "DELIVERY" | "PICKUP";
  address?: string;
  freeDelivery: boolean;
  orderId?: string;
  orderNumber?: string;
  paymentUrl?: string | null;
}

export interface TrackingPayload {
  orderNumber: string;
  status: string;
  statusLabel: string;
  paymentStatus: string;
  total: number;
  type: string;
  createdAt: string;
  paymentError?: string | null;
  items: { name: string; quantity: number }[];
  timeline: { status: string; label: string; at: string }[];
}

export interface EngineResult {
  assistantMessage: {
    content: string;
    type: string;
    metadata: {
      menu?: RichMenuPayload;
      orderSummary?: OrderSummaryPayload;
      tracking?: TrackingPayload;
      stage?: ChatStage;
      actionsApplied?: string[];
      fallback?: boolean;
      aiError?: string;
    };
  };
  stage: ChatStage;
}

export const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT: "در انتظار پرداخت",
  PAID: "پرداخت شده — در صف آماده‌سازی",
  PREPARING: "در حال آماده‌سازی 🍳",
  READY: "آماده تحویل ✅",
  DELIVERING: "در مسیر ارسال 🛵",
  DELIVERED: "تحویل داده شد 🎉",
  CANCELED: "لغو شده",
  PAYMENT_FAILED: "خطا در پرداخت",
};

// ============ Loaders ============

export async function loadMenuData(): Promise<MenuCategoryData[]> {
  const categories = await db.category.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    include: {
      items: {
        where: {},
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });
  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    items: c.items.map((i) => ({
      id: i.id,
      name: i.name,
      price: i.price,
      isAvailable: i.isAvailable,
      isSpecial: i.isSpecial,
      isDrink: i.isDrink,
      isVegetarian: i.isVegetarian,
      isSpicy: i.isSpicy,
      description: i.description,
      ingredients: i.ingredients,
    })),
  }));
}

export function parseDraft(raw: string | null | undefined): OrderDraft {
  if (!raw) return { items: [] };
  try {
    const d = JSON.parse(raw) as OrderDraft;
    return {
      items: Array.isArray(d.items) ? d.items : [],
      deliveryMethod: d.deliveryMethod,
      address: d.address,
      couponCode: d.couponCode,
    };
  } catch {
    return { items: [] };
  }
}

// ============ Action application ============

/** Resolve an action's target menu item — by itemId first, then by fuzzy name match */
function resolveActionItem(action: ParsedAction, allItems: MenuCategoryData["items"][number][]): MenuCategoryData["items"][number] | null {
  // 1) explicit valid itemId
  if (action.itemId) {
    const byId = allItems.find((i) => i.id === action.itemId);
    if (byId) return byId;
  }
  // 2) fuzzy name match
  const name = action.name?.trim();
  if (name) {
    const norm = normalizePersian(name);
    const exact = allItems.find((i) => normalizePersian(i.name) === norm);
    if (exact) return exact;
    const contains = allItems.find((i) => norm.includes(normalizePersian(i.name)) || normalizePersian(i.name).includes(norm));
    if (contains) return contains;
    // token-based match
    const tokens = norm.split(" ").filter((t) => t.length > 2);
    const candidates = allItems
      .map((i) => {
        const itemNorm = normalizePersian(i.name);
        const score = tokens.filter((t) => itemNorm.includes(t)).length;
        return { item: i, score };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score);
    if (candidates.length > 0 && candidates[0].score >= Math.ceil(tokens.length / 2)) {
      return candidates[0].item;
    }
  }
  return null;
}

function applyActions(
  draft: OrderDraft,
  actions: ParsedAction[],
  categories: MenuCategoryData[],
  maxItems: number,
  allergenPhrases: string[] = []
): { draft: OrderDraft; log: string[]; warnings: string[] } {
  const allItems = categories.flatMap((c) => c.items);
  const log: string[] = [];
  const warnings: string[] = [];
  let items = [...draft.items];

  for (const action of actions) {
    switch (action.type) {
      case "ADD_ITEM": {
        const menu = resolveActionItem(action, allItems);
        if (!menu) {
          // last resort: match from the user's original intent if the model echoed a name in reply
          warnings.push("آیتم درخواستی در منو یافت نشد");
          break;
        }
        if (!menu.isAvailable) {
          warnings.push(`${menu.name} فعلاً ناموجود است`);
          break;
        }
        // deterministic allergen cross-check against the user's saved allergies
        const allergenHits = matchAllergens(menu.ingredients, allergenPhrases);
        if (allergenHits.length > 0) {
          warnings.push(`توجه! «${menu.name}» حاوی ${allergenHits.join(" و ")} است که در حساسیت‌های شما ثبت شده — لطفاً با احتیاط انتخاب کنید`);
        }
        const qty = Math.max(1, Math.min(30, action.quantity ?? 1));
        const existing = items.find((i) => i.itemId === menu.id);
        const currentCount = items.reduce((s, i) => s + i.quantity, 0);
        if (currentCount + qty > maxItems) {
          warnings.push(`حداکثر ${maxItems} آیتم در هر سفارش`);
          break;
        }
        if (existing) {
          existing.quantity = Math.min(30, existing.quantity + qty);
        } else {
          items.push({ itemId: menu.id, name: menu.name, price: menu.price, quantity: qty });
        }
        log.push(`افزودن ${menu.name} × ${qty}`);
        break;
      }
      case "REMOVE_ITEM": {
        const menu = resolveActionItem(action, allItems);
        if (!menu) break;
        const existing = items.find((i) => i.itemId === menu.id);
        if (!existing) break;
        const qty = action.quantity ?? 0;
        if (qty === 0 || qty >= existing.quantity) {
          items = items.filter((i) => i.itemId !== menu.id);
          log.push(`حذف ${menu.name}`);
        } else {
          existing.quantity -= qty;
          log.push(`کاهش ${menu.name} به ${existing.quantity}`);
        }
        break;
      }
      case "CLEAR_ORDER":
        items = [];
        log.push("خالی‌کردن سبد");
        break;
      case "SET_DELIVERY":
        draft.deliveryMethod = action.method === "PICKUP" ? "PICKUP" : "DELIVERY";
        log.push(draft.deliveryMethod === "DELIVERY" ? "ارسال با پیک" : "بیرونبر");
        break;
      case "SET_ADDRESS":
        if (action.address && action.address.trim().length >= 8) {
          draft.address = action.address.trim().slice(0, 500);
          log.push("ثبت آدرس");
        }
        break;
      case "RESET":
        items = [];
        draft.deliveryMethod = undefined;
        draft.address = undefined;
        draft.couponCode = undefined;
        log.push("شروع سفارش جدید");
        break;
      // APPLY_COUPON / REMOVE_COUPON handled async in processChatMessage (needs DB)
    }
  }
  return { draft: { ...draft, items }, log, warnings };
}

// ============ Stage machine validation ============

function validateStageTransition(current: ChatStage, suggested: ChatStage | null | undefined, draft: OrderDraft, categories: MenuCategoryData[]): ChatStage {
  const allItems = categories.flatMap((c) => c.items);
  const hasItems = draft.items.length > 0;
  const hasDrinks = draft.items.some((i) => allItems.find((m) => m.id === i.itemId)?.isDrink);
  const hasFood = draft.items.some((i) => !allItems.find((m) => m.id === i.itemId)?.isDrink);

  let next: ChatStage = current;

  switch (current) {
    case "GREETING":
      next = suggested === "TRACKING" && hasItems ? "TRACKING" : suggested === "TRACKING" ? "TRACKING" : "ORDERING";
      break;
    case "ORDERING": {
      if (suggested === "TRACKING") next = "TRACKING";
      else if (suggested === "DRINKS" && hasItems && !hasDrinks) next = "DRINKS";
      else if (suggested === "DRINKS" && hasItems && hasDrinks) next = "DELIVERY_METHOD"; // already has drinks → skip suggestion
      else if (suggested === "DELIVERY_METHOD" && hasItems) next = hasDrinks ? "DELIVERY_METHOD" : "DRINKS";
      else next = "ORDERING";
      break;
    }
    case "DRINKS":
      if (suggested === "DELIVERY_METHOD" && hasItems) next = "DELIVERY_METHOD";
      else if (suggested === "CONFIRMATION" && hasItems && draft.deliveryMethod) next = "CONFIRMATION";
      else if (suggested === "ORDERING" && hasItems) next = "ORDERING"; // user wants to add more food
      else next = "DRINKS";
      break;
    case "DELIVERY_METHOD":
      if (suggested === "ADDRESS" && draft.deliveryMethod === "DELIVERY") next = "ADDRESS";
      else if (suggested === "CONFIRMATION" && draft.deliveryMethod) next = "CONFIRMATION";
      else if (draft.deliveryMethod === "DELIVERY" && (suggested === "ADDRESS" || suggested === "CONFIRMATION")) next = "ADDRESS";
      else next = "DELIVERY_METHOD";
      break;
    case "ADDRESS":
      if (suggested === "CONFIRMATION" && draft.address) next = "CONFIRMATION";
      else next = "ADDRESS";
      break;
    case "CONFIRMATION":
      if (suggested === "ADDRESS" && draft.deliveryMethod === "DELIVERY") next = "ADDRESS";
      else if (suggested === "DELIVERY_METHOD") next = "DELIVERY_METHOD";
      else if (suggested === "ORDERING" || suggested === "DRINKS") next = suggested;
      else if (suggested === "TRACKING") next = "TRACKING";
      else next = "CONFIRMATION";
      break;
    case "TRACKING":
      if (suggested === "GREETING" || suggested === "ORDERING") next = "ORDERING";
      else next = "TRACKING";
      break;
  }
  return next;
}

// ============ Compute pricing ============

export function computePricing(
  draft: OrderDraft,
  general: GeneralSettings,
  discount = 0
) {
  const subtotal = draft.items.reduce((s, i) => s + i.price * i.quantity, 0);
  let deliveryFee = 0;
  if (draft.deliveryMethod === "DELIVERY" && subtotal > 0) {
    deliveryFee = general.freeDeliveryOver > 0 && subtotal >= general.freeDeliveryOver ? 0 : general.deliveryFee;
  }
  const safeDiscount = Math.max(0, Math.min(discount, subtotal));
  const taxableBase = subtotal - safeDiscount;
  const taxPercent = general.taxPercent;
  const taxAmount = Math.round((taxableBase * taxPercent) / 100);
  const total = taxableBase + deliveryFee + taxAmount;
  return { subtotal, deliveryFee, taxPercent, taxAmount, discount: safeDiscount, total };
}

// ============ Rich payloads ============

async function buildMenuPayload(categories: MenuCategoryData[], drinksOnly: boolean): Promise<RichMenuPayload> {
  const cats = await db.category.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    include: { items: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
  });
  const filtered = cats
    .filter((c) => (drinksOnly ? c.items.some((i) => i.isDrink) : true))
    .map((c) => ({
      id: c.id,
      name: c.name,
      items: c.items
        .filter((i) => (drinksOnly ? i.isDrink : true))
        .map((i) => ({
          id: i.id,
          name: i.name,
          price: i.price,
          description: i.description,
          imageUrl: i.imageUrl,
          isAvailable: i.isAvailable,
          isSpecial: i.isSpecial,
          calories: i.calories,
          prepTime: i.prepTime,
        })),
    }))
    .filter((c) => c.items.length > 0);
  return {
    title: drinksOnly ? "نوشیدنی‌های رستوران نخل 🥤" : "منوی کامل رستوران نخل 🌴",
    categories: filtered,
  };
}

async function buildOrderSummaryPayload(
  draft: OrderDraft,
  general: GeneralSettings,
  userId: string
): Promise<{ payload: OrderSummaryPayload; warnings: string[] }> {
  const warnings: string[] = [];
  let couponCode: string | undefined;
  let couponTitle: string | undefined;
  let couponLabel: string | undefined;
  let discount = 0;

  // re-validate coupon against final subtotal
  if (draft.couponCode) {
    const subtotal = draft.items.reduce((s, i) => s + i.price * i.quantity, 0);
    const check = await checkCoupon(draft.couponCode, userId, subtotal);
    if (check.valid && check.coupon) {
      couponCode = check.coupon.code;
      couponTitle = check.coupon.title;
      couponLabel = check.label;
      discount = check.discount;
    } else {
      warnings.push(`کد تخفیف ${draft.couponCode} دیگر معتبر نیست: ${check.reason ?? "نامشخص"}`);
      draft.couponCode = undefined;
    }
  }

  const pricing = computePricing(draft, general, discount);
  return {
    payload: {
      items: draft.items.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        unitPrice: i.price,
        lineTotal: i.price * i.quantity,
      })),
      ...pricing,
      couponCode,
      couponTitle,
      couponLabel,
      deliveryMethod: draft.deliveryMethod ?? "DELIVERY",
      address: draft.address,
      freeDelivery: general.freeDeliveryOver > 0 && pricing.subtotal >= general.freeDeliveryOver,
    },
    warnings,
  };
}

async function buildTrackingPayload(userId: string): Promise<TrackingPayload | null> {
  const order = await db.order.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { items: true, statusLogs: { orderBy: { createdAt: "asc" } } },
  });
  if (!order) return null;
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    statusLabel: ORDER_STATUS_LABELS[order.status] ?? order.status,
    paymentStatus: order.paymentStatus,
    total: order.total,
    type: order.type,
    createdAt: order.createdAt.toISOString(),
    paymentError: order.paymentError,
    items: order.items.map((i) => ({ name: i.name, quantity: i.quantity })),
    timeline: order.statusLogs.map((l) => ({
      status: l.status,
      label: ORDER_STATUS_LABELS[l.status] ?? l.status,
      at: l.createdAt.toISOString(),
    })),
  };
}

// ============ Main engine ============

export async function processChatMessage(
  session: { id: string; stage: string; draft: string | null; orderId: string | null },
  userId: string,
  userMessage: string
): Promise<EngineResult> {
  const [aiSettings, general] = await Promise.all([
    getSettings<AISettings>("ai"),
    getSettings<GeneralSettings>("general"),
  ]);

  const categories = await loadMenuData();
  const draft = parseDraft(session.draft);
  const currentStage = (session.stage as ChatStage) || "GREETING";

  const user = await db.user.findUnique({ where: { id: userId } });
  const dietaryPrefs = safeParseDietaryPrefs(user?.dietaryPrefs);
  const allergenPhrases = extractAllergenPhrases(dietaryPrefs?.allergies);
  const addresses = await db.address.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    take: 5,
  });
  const latestOrder = await db.order.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  // ---------- 1) Try AI ----------
  let replyText = "";
  let suggestedStage: ChatStage | null = null;
  let actions: ParsedAction[] = [];
  let usedFallback = false;
  let aiError: string | undefined;

  const systemPrompt = buildSystemPrompt(aiSettings, {
    stage: currentStage,
    categories,
    draft,
    userName: user?.firstName ?? null,
    general,
    dietaryPrefs,
    latestOrder: latestOrder
      ? {
          orderNumber: latestOrder.orderNumber,
          status: latestOrder.status,
          statusLabel: ORDER_STATUS_LABELS[latestOrder.status] ?? latestOrder.status,
          paymentStatus: latestOrder.paymentStatus,
          total: latestOrder.total,
          paymentError: latestOrder.paymentError,
          type: latestOrder.type,
        }
      : null,
    addressSuggestions: addresses.map((a) => a.fullAddress),
  });

  // recent history
  const history = await db.chatMessage.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: "desc" },
    take: Math.max(4, aiSettings.maxHistoryMessages),
  });
  const historyMessages = history
    .reverse()
    .filter((m) => m.type === "TEXT" || m.type === "ERROR")
    .map((m) => ({ role: m.role === "USER" ? ("user" as const) : ("assistant" as const), content: m.content }));

  const completion = await chatCompletion(aiSettings, [
    { role: "system", content: systemPrompt },
    ...historyMessages,
    { role: "user", content: userMessage },
  ], { jsonMode: true });

  if (completion.success) {
    const parsed = extractJson<{
      reply?: string;
      stage?: string;
      actions?: ParsedAction[];
    }>(completion.content);
    if (parsed?.reply) {
      replyText = parsed.reply;
      const VALID_STAGES = ["GREETING", "ORDERING", "DRINKS", "DELIVERY_METHOD", "ADDRESS", "CONFIRMATION", "TRACKING"];
      suggestedStage = VALID_STAGES.includes(parsed.stage ?? "") ? (parsed.stage as ChatStage) : null;
      actions = Array.isArray(parsed.actions) ? parsed.actions.filter((a) => a && typeof a.type === "string") : [];
    } else {
      // model replied without JSON — use raw text as reply
      replyText = completion.content.trim().slice(0, 1200);
      usedFallback = false;
    }
  } else {
    aiError = completion.error;
  }

  // ---------- 2) Deterministic fallback ----------
  if (!replyText.trim()) {
    const det = deterministicParse(userMessage, currentStage, categories, draft);
    if (det.reply || det.actions.length > 0) {
      replyText = det.reply ?? "چیزی نفهمیدم؛ میشه دقیق‌تر بگید چه چیزی میل دارید؟ 🌿";
      suggestedStage = det.nextStage ?? suggestedStage;
      actions = det.actions.length > 0 ? det.actions : actions;
      usedFallback = true;
    } else {
      replyText = "ببخشید، الان اتصالم به مغز هوشم یکم قطع و وصله 🌱 همین الان دوباره امتحان می‌کنم. لطفاً سفارشتون رو بگید، مثلاً: «۲ عدد کباب کوبیده و یک دوغ»";
      usedFallback = true;
    }
  }

  // ---------- 2.5) Anti-hallucination filter + safety net for ADD_ITEM ----------
  const allMenuItems = categories.flatMap((c) => c.items);
  const normUserMsg = normalizePersian(userMessage);
  const normReply = normalizePersian(replyText);
  const isMentioned = (itemName: string): boolean => {
    const n = normalizePersian(itemName);
    // strict word-boundary check on the user's own message
    if (includesWord(normUserMsg, n)) return true;
    if (normReply.includes(n)) return true;
    // token-level fallback (e.g. "کوبیده" for "کباب کوبیده")
    const tokens = n.split(" ").filter((t) => t.length > 2);
    return tokens.length > 0 && tokens.every((t) => includesWord(normUserMsg, t) || normReply.includes(t));
  };

  actions = actions.filter((a) => {
    if (a.type !== "ADD_ITEM") return true;
    const item = resolveActionItem(a, allMenuItems);
    if (!item) return false; // unresolvable → drop (safety net may re-add correct one)
    return isMentioned(item.name);
  });

  // Safety net: items the user clearly ordered but AI missed → add deterministically
  // (only while ordering — never during address/confirmation/tracking stages)
  if (currentStage === "ORDERING" || currentStage === "DRINKS" || currentStage === "GREETING") {
    const det = deterministicParse(userMessage, currentStage, categories, draft);
    const detAdds = det.actions.filter((a) => a.type === "ADD_ITEM" && a.itemId);
    const aiAdds = actions.filter((a) => a.type === "ADD_ITEM");
    const aiNames = new Set(
      aiAdds
        .map((a) => resolveActionItem(a, allMenuItems))
        .filter(Boolean)
        .map((i) => i!.id)
    );
    const missing = detAdds.filter((a) => !aiNames.has(a.itemId!));
    if (missing.length > 0) {
      actions = [...actions, ...missing];
    }
  }

  // ---------- 2.7) Safety nets for delivery method & address ----------
  // The AI sometimes confirms in text ("invoice ready!") but forgets the
  // SET_DELIVERY / SET_ADDRESS action — catch those deterministically.
  if (!actions.some((a) => a.type === "SET_DELIVERY") && !draft.deliveryMethod) {
    const det = deterministicParse(userMessage, currentStage, categories, draft);
    const detDelivery = det.actions.find((a) => a.type === "SET_DELIVERY");
    if (detDelivery) {
      actions = [...actions, detDelivery];
      if (!suggestedStage && det.nextStage) suggestedStage = det.nextStage;
    }
  }
  if (currentStage === "ADDRESS" && !actions.some((a) => a.type === "SET_ADDRESS")) {
    const det = deterministicParse(userMessage, currentStage, categories, draft);
    const detAddr = det.actions.find((a) => a.type === "SET_ADDRESS");
    if (detAddr) {
      actions = [...actions, detAddr];
      if (!suggestedStage && det.nextStage) suggestedStage = det.nextStage;
    }
  }

  // ---------- 3) Apply actions ----------
  // Coupon actions need async DB validation → handle separately
  const couponApply = actions.find((a) => a.type === "APPLY_COUPON" && a.code);
  const couponRemove = actions.find((a) => a.type === "REMOVE_COUPON");
  const itemActions = actions.filter((a) => a.type !== "APPLY_COUPON" && a.type !== "REMOVE_COUPON");

  const { draft: newDraft, log, warnings } = applyActions(draft, itemActions, categories, aiSettings.maxItemsPerOrder, allergenPhrases);

  if (couponRemove) {
    if (newDraft.couponCode) {
      newDraft.couponCode = undefined;
      log.push("حذف کد تخفیف");
    }
  }
  if (couponApply?.code) {
    const subtotal = newDraft.items.reduce((s, i) => s + i.price * i.quantity, 0);
    const check = await checkCoupon(couponApply.code, userId, subtotal);
    if (check.valid && check.coupon) {
      newDraft.couponCode = check.coupon.code;
      log.push(`اعمال کد تخفیف ${check.coupon.code} (${check.label})`);
      // enrich reply when AI didn't confirm the code properly
      if (!replyText.includes(check.coupon.code)) {
        replyText += `\n🎁 کد تخفیف «${check.coupon.code}» اعمال شد — ${check.label}!`;
      }
    } else {
      replyText += `\n⚠️ کد تخفیف «${couponApply.code}» قابل اعمال نیست: ${check.reason}`;
    }
  }

  // ---------- 4) Stage transition ----------
  const nextStage = validateStageTransition(currentStage, suggestedStage, newDraft, categories);

  // If AI suggested TRACKING but there is no order, force ordering
  if (nextStage === "TRACKING" && !latestOrder) {
    replyText += "\n\n(فعلاً سفارش ثبت‌شده‌ای برای شما پیدا نکردم — بگید چه چیزی میل دارید؟)";
  }

  // ---------- 5) Build rich metadata ----------
  const metadata: EngineResult["assistantMessage"]["metadata"] = {
    stage: nextStage,
    actionsApplied: log,
    fallback: usedFallback || undefined,
    aiError,
  };

  // Tracking intent — attach tracking card
  if (nextStage === "TRACKING" || (suggestedStage === "TRACKING" && latestOrder)) {
    const tracking = await buildTrackingPayload(userId);
    if (tracking) metadata.tracking = tracking;
  }

  // Menu attachments
  const wantsFullMenu =
    nextStage === "GREETING" ||
    (currentStage === "GREETING" && nextStage === "ORDERING") ||
    (currentStage === "TRACKING" && (nextStage === "ORDERING" || actions.some((a) => a.type === "RESET")));
  if (wantsFullMenu) {
    metadata.menu = await buildMenuPayload(categories, false);
  }
  if (nextStage === "DRINKS" && currentStage !== "DRINKS") {
    metadata.menu = await buildMenuPayload(categories, true);
  }

  // Order summary attachment
  if (nextStage === "CONFIRMATION" && newDraft.items.length > 0) {
    const summary = await buildOrderSummaryPayload(newDraft, general, userId);
    metadata.orderSummary = summary.payload;
    warnings.push(...summary.warnings);
    // gentle remainder of min order
    if (general.minOrderAmount > 0 && computePricing(newDraft, general, summary.payload.discount).subtotal < general.minOrderAmount) {
      warnings.push(`حداقل مبلغ سفارش ${formatToman(general.minOrderAmount)} است`);
    }
  }

  // ---------- 5.5) Surface engine warnings in the reply (deduplicated) ----------
  const normReplyForWarnings = normalizePersian(replyText);
  const freshWarnings = warnings.filter((w) => {
    const nw = normalizePersian(w);
    return nw.length > 0 && !normReplyForWarnings.includes(nw);
  });
  if (freshWarnings.length > 0) {
    replyText += `\n\n${freshWarnings.map((w) => `⚠️ ${w}`).join("\n")}`;
  }

  // ---------- 6) Persist ----------
  await db.chatSession.update({
    where: { id: session.id },
    data: {
      stage: nextStage,
      draft: JSON.stringify(newDraft),
      updatedAt: new Date(),
    },
  });

  return {
    assistantMessage: {
      content: replyText,
      type: "TEXT",
      metadata,
    },
    stage: nextStage,
  };
}
