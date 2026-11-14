import "server-only";
import { db } from "@/lib/db";
import { getSettings, type AISettings, type GeneralSettings } from "@/lib/settings";
import { chatCompletion, extractJson } from "@/lib/ai";
import { buildSystemPrompt, type ChatStage, type MenuCategoryData, type OrderDraft, type OrderHistoryEntry, type TopFavoriteEntry } from "./prompts";
import { isMenuQuestion, deterministicParse, matchMenuItems, includesWord, detectStageNavIntent, wantsTracking, type ParsedAction } from "./parser";
import { normalizePersian, formatToman } from "@/lib/fa";
import { extractAllergenPhrases, matchAllergens } from "@/lib/chat/allergens";
import { checkCoupon } from "@/lib/coupons";
import { safeParseDietaryPrefs } from "@/lib/api";
import { dinnerOnlyMessage, isDinnerShiftNow } from "@/lib/hours";

// ============ Types ============

export interface RichMenuPayload {
  title: string;
  categories: {
    id: string;
    name: string;
    dinnerOnly?: boolean;
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
      dinnerOnly?: boolean;
    }[];
  }[];
}

export interface OrderSummaryPayload {
  items: { itemId?: string; name: string; quantity: number; unitPrice: number; lineTotal: number }[];
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
  paymentRef?: string | null;
  /** true when the order still awaits a successful payment (retry/edit allowed) */
  unpaid?: boolean;
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
  /** the persisted draft after this turn — the client mirrors it into the classic cart */
  draft: OrderDraft;
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
    dinnerOnly: c.dinnerOnly,
    items: c.items.map((i) => ({
      id: i.id,
      name: i.name,
      price: i.price,
      isAvailable: i.isAvailable,
      isSpecial: i.isSpecial,
      isDrink: i.isDrink,
      isVegetarian: i.isVegetarian,
      isSpicy: i.isSpicy,
      dinnerOnly: c.dinnerOnly || undefined,
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

// ============ Helpers: unpaid-order re-open ============

/** Heuristic — does the user want to modify an order that was already issued? */
function detectOrderEditIntent(message: string, categories: MenuCategoryData[]): boolean {
  const norm = normalizePersian(message);
  const EDIT_INTENT_WORDS = [
    "تغییر", "ویرایش", "اصلاح", "عوض", "کم کن", "اضافه کن", "بردار", "حذف",
    "پیک", "بیرونبر", "بیرون بر", "آدرس", "فاکتور", "برگرد", "بازگشت", "ادامه",
    "پرداخت", "کمتر", "بیشتر",
  ];
  if (EDIT_INTENT_WORDS.some((w) => norm.includes(w))) return true;
  // mentioning a concrete menu item while an unpaid order exists is also an edit signal
  if (matchMenuItems(message, categories).length > 0) return true;
  return false;
}

function applyActions(
  draft: OrderDraft,
  actions: ParsedAction[],
  categories: MenuCategoryData[],
  maxItems: number,
  allergenPhrases: string[] = [],
  dinnerBlockedMessage: string | null = null
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
        // ---- گیت «فقط شیفت شب»: خارج از سرویس شام، آیتم‌های دسته‌های dinner-only اضافه نمی‌شوند ----
        if (menu.dinnerOnly && dinnerBlockedMessage) {
          warnings.push(`«${menu.name}» ${dinnerBlockedMessage}`);
          break;
        }
        // deterministic allergen cross-check against the user's saved allergies
        const allergenHits = matchAllergens(menu.ingredients, allergenPhrases);
        if (allergenHits.length > 0) {
          warnings.push(`توجه! «${menu.name}» حاوی ${allergenHits.join(" و ")} است که در حساسیت‌های شما ثبت شده — لطفاً با احتیاط انتخاب کنید`);
        }
        const rawQty = action.quantity ?? 1;
        if (!Number.isInteger(rawQty) || rawQty < 1) break;
        const qty = Math.min(30, rawQty);
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
        if (!Number.isInteger(qty) || qty < 0) break;
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
          // an address only makes sense for courier delivery — default it so
          // the flow can never get stuck without a delivery method
          draft.deliveryMethod = draft.deliveryMethod ?? "DELIVERY";
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

/** An order can be re-opened for editing while it has not been paid yet */
export function isOrderEditable(order: { status: string; paymentStatus: string }): boolean {
  return (
    order.paymentStatus !== "PAID" &&
    (order.status === "PENDING_PAYMENT" || order.status === "PAYMENT_FAILED" || order.paymentStatus === "PENDING" || order.paymentStatus === "FAILED")
  );
}

/**
 * Permissive stage machine — the user may return to any previous step of the
 * order flow at any time (even after the invoice has been issued). Forward
 * moves are validated against the draft state so the flow can never skip
 * required information.
 */
function validateStageTransition(current: ChatStage, suggested: ChatStage | null | undefined, draft: OrderDraft, categories: MenuCategoryData[]): ChatStage {
  const allItems = categories.flatMap((c) => c.items);
  const hasItems = draft.items.length > 0;
  const hasDrinks = draft.items.some((i) => allItems.find((m) => m.id === i.itemId)?.isDrink);

  let next: ChatStage = current;

  switch (suggested) {
    case "GREETING":
      next = hasItems ? current : "GREETING";
      break;
    case "ORDERING":
      // backward navigation — reachable from ANY stage
      next = "ORDERING";
      break;
    case "DRINKS":
      next = hasItems ? (hasDrinks ? "DELIVERY_METHOD" : "DRINKS") : "ORDERING";
      break;
    case "DELIVERY_METHOD":
      next = hasItems ? "DELIVERY_METHOD" : "ORDERING";
      break;
    case "ADDRESS":
      next = hasItems ? (draft.deliveryMethod === "DELIVERY" ? "ADDRESS" : "DELIVERY_METHOD") : "ORDERING";
      break;
    case "CONFIRMATION":
      next = hasItems
        ? draft.deliveryMethod
          ? "CONFIRMATION" // address can still be completed inside the invoice card
          : "DELIVERY_METHOD"
        : "ORDERING";
      break;
    case "TRACKING":
      next = "TRACKING";
      break;
  }

  // ---- sanity clamps (draft state must always match the stage) ----
  if (!hasItems && next !== "GREETING" && next !== "TRACKING") next = "ORDERING";
  if (next === "ADDRESS" && draft.deliveryMethod !== "DELIVERY") next = "DELIVERY_METHOD";
  if (next === "CONFIRMATION" && !draft.deliveryMethod) next = "DELIVERY_METHOD";

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
      dinnerOnly: c.dinnerOnly || undefined,
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
          dinnerOnly: c.dinnerOnly || undefined,
        })),
    }))
    .filter((c) => c.items.length > 0);
  return {
    title: drinksOnly ? "نوشیدنی‌های رستوران نخل 🥤" : "منوی کامل رستوران نخل 🌴",
    categories: filtered,
  };
}

export async function buildOrderSummaryPayload(
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
        itemId: i.itemId,
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

/** Build the tracking-card payload from a loaded order (pure — no DB access) */
export function trackingPayloadFromOrder(order: {
  orderNumber: string;
  status: string;
  paymentStatus: string;
  total: number;
  type: string;
  createdAt: Date;
  paymentError?: string | null;
  paymentRef?: string | null;
  items: { name: string; quantity: number }[];
  statusLogs: { status: string; createdAt: Date }[];
}): TrackingPayload {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    statusLabel: ORDER_STATUS_LABELS[order.status] ?? order.status,
    paymentStatus: order.paymentStatus,
    total: order.total,
    type: order.type,
    createdAt: order.createdAt.toISOString(),
    paymentError: order.paymentError,
    paymentRef: order.paymentRef ?? null,
    unpaid: isOrderEditable(order),
    items: order.items.map((i) => ({ name: i.name, quantity: i.quantity })),
    timeline: order.statusLogs.map((l) => ({
      status: l.status,
      label: ORDER_STATUS_LABELS[l.status] ?? l.status,
      at: l.createdAt.toISOString(),
    })),
  };
}

async function buildTrackingPayload(userId: string): Promise<TrackingPayload | null> {
  const order = await db.order.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { items: true, statusLogs: { orderBy: { createdAt: "asc" } } },
  });
  if (!order) return null;
  return trackingPayloadFromOrder(order);
}

// ============ Main engine ============

export async function processChatMessage(
  session: { id: string; stage: string; draft: string | null; orderId: string | null },
  userId: string,
  userMessage: string,
  currentMessageId?: string
): Promise<EngineResult> {
  const [aiSettings, general] = await Promise.all([
    getSettings<AISettings>("ai"),
    getSettings<GeneralSettings>("general"),
  ]);

  const categories = await loadMenuData();
  let draft = parseDraft(session.draft);
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

  // ---- order history + personalized favorites (for the AI's memory) ----
  const historyOrders = await db.order.findMany({
    where: { userId, status: { notIn: ["PENDING_PAYMENT", "PAYMENT_FAILED", "CANCELED"] } },
    orderBy: { createdAt: "desc" },
    take: 6,
    include: { items: true },
  });
  const orderHistory: OrderHistoryEntry[] = historyOrders
    .slice()
    .reverse()
    .map((o) => ({
      orderNumber: o.orderNumber,
      createdAt: o.createdAt,
      total: o.total,
      status: o.status,
      items: o.items.map((i) => ({ name: i.name, quantity: i.quantity })),
    }));
  const favoritesMap = new Map<string, number>();
  for (const o of historyOrders) {
    for (const it of o.items) {
      favoritesMap.set(it.name, (favoritesMap.get(it.name) ?? 0) + it.quantity);
    }
  }
  const topFavorites: TopFavoriteEntry[] = [...favoritesMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // ---------- 0) TRACKING + unpaid order → re-open it for editing ----------
  // The user asked for changes after the invoice was issued (payment not
  // completed yet) — rebuild the draft from that order so the invoice becomes
  // editable again. The stale unpaid order is canceled to avoid duplicates.
  let restoredFromOrder = false;
  if (
    currentStage === "TRACKING" &&
    latestOrder &&
    isOrderEditable(latestOrder) &&
    draft.items.length === 0 &&
    detectOrderEditIntent(userMessage, categories)
  ) {
    const orderItems = await db.orderItem.findMany({ where: { orderId: latestOrder.id } });
    const menuById = new Map(categories.flatMap((c) => c.items).map((i) => [i.id, i]));
    const restoredItems = orderItems
      .filter((oi) => oi.menuItemId && menuById.has(oi.menuItemId))
      .map((oi) => {
        const mi = menuById.get(oi.menuItemId!)!;
        return { itemId: mi.id, name: mi.name, price: mi.price, quantity: Math.max(1, Math.min(30, oi.quantity)) };
      });
    if (restoredItems.length > 0) {
      draft = {
        items: restoredItems,
        deliveryMethod: latestOrder.type === "PICKUP" ? "PICKUP" : "DELIVERY",
        address: latestOrder.address ?? undefined,
        couponCode: latestOrder.couponCode ?? undefined,
      };
      await db.order.update({
        where: { id: latestOrder.id },
        data: { status: "CANCELED" },
      });
      await db.orderStatusLog.create({
        data: { orderId: latestOrder.id, status: "CANCELED", note: "بازگشت به ویرایش در هوش نخل — سفارش پرداخت‌نشده بود" },
      });
      restoredFromOrder = true;
    }
  }

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
    orderHistory,
    topFavorites,
    addressSuggestions: addresses.map((a) => a.fullAddress),
  });

  // recent history
  const history = await db.chatMessage.findMany({
    where: { sessionId: session.id, ...(currentMessageId ? { id: { not: currentMessageId } } : {}) },
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
    if (typeof parsed?.reply === "string" && parsed.reply.trim()) {
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

  // ---------- 2.2) Explicit tracking intent — from ANY stage ----------
  // «وضعیت سفارشم رو بگو» باید از هر مرحله‌ای کارت رهگیری بیاورد — حتی وقتی
  // مدل با متن پاسخ داده و suggestedStage نفرستیده است. موتور بعداً خودش چک
  // می‌کند سفارشی وجود دارد (وگرنه به مرحلهٔ سفارش برمی‌گردد) و اگر درفت
  // اقلام دارد (سفارش در جریان) TRACKING به ORDERING بازدهی می‌شود.
  if (wantsTracking(userMessage) && suggestedStage !== "TRACKING") {
    suggestedStage = "TRACKING";
  }

  // ---------- 2.5) Anti-hallucination filter + safety net for ADD_ITEM ----------
  const allMenuItems = categories.flatMap((c) => c.items);
  const normUserMsg = normalizePersian(userMessage);
  // category hints, e.g. «خورشت‌های ایرانی» → «خورشت» — mentioning the category
  // plus the item's head word («خورشت قیمه» for «قیمه سیب») is explicit intent
  const categoryHints = categories
    .map((c) => normalizePersian(c.name).replace(/( های| ها|های|ها)( ایرانی| کرمان)?$/u, "").trim())
    .filter((h) => h.length >= 3);
  const isMentioned = (itemName: string): boolean => {
    const n = normalizePersian(itemName);
    // strict word-boundary check on the user's own message
    if (includesWord(normUserMsg, n)) return true;
    const tokens = n.split(" ").filter((t) => t.length > 2);
    // token-level fallback (e.g. "کوبیده" for "کباب کوبیده")
    if (tokens.length > 0 && tokens.every((t) => includesWord(normUserMsg, t))) return true;
    // head word + a matching category hint («خورشت قیمه» → «قیمه سیب»)
    const head = tokens[0] ?? "";
    if (head.length >= 3 && includesWord(normUserMsg, head) && categoryHints.some((h) => includesWord(normUserMsg, h))) {
      return true;
    }
    return false;
  };

  actions = actions.filter((a) => {
    if (a.type !== "ADD_ITEM") return true;
    const item = resolveActionItem(a, allMenuItems);
    if (!item) return false; // unresolvable → drop (safety net may re-add correct one)
    return !isMenuQuestion(userMessage) && isMentioned(item.name);
  });

  // Safety net: items the user clearly ordered/removed but AI missed → merge
  // deterministically. Runs at EVERY stage — the user may edit the order even
  // after the invoice was issued (confirmation) or re-open an unpaid order.
  {
    const det = deterministicParse(userMessage, currentStage, categories, draft);
    const aiTouchedIds = new Set(
      actions
        .filter((a) => a.type === "ADD_ITEM" || a.type === "REMOVE_ITEM")
        .map((a) => resolveActionItem(a, allMenuItems)?.id)
        .filter(Boolean)
    );
    for (const a of det.actions) {
      if (a.type === "ADD_ITEM" && a.itemId && !aiTouchedIds.has(a.itemId)) {
        actions.push(a);
      } else if (a.type === "REMOVE_ITEM" && a.itemId && !aiTouchedIds.has(a.itemId)) {
        actions.push(a);
      }
    }
  }

  // ---------- 2.6b) Stage-navigation safety net ----------
  // The UI step chips send canned navigation messages; guarantee they always
  // reach the right stage even if the AI model is unavailable or confused.
  // navForced distinguishes the user's EXPLICIT step choice (chips / «روش
  // ارسال رو عوض کنم») from the model's own stage suggestions.
  let navForced = false;
  const navIntent = detectStageNavIntent(userMessage, draft, categories);
  if (navIntent && suggestedStage !== navIntent.stage) {
    suggestedStage = navIntent.stage;
    navForced = true;
    if (usedFallback && !replyText.trim()) replyText = navIntent.reply;
  }

  // ---------- 2.7) Safety nets for delivery method & address ----------
  // The AI sometimes confirms in text ("invoice ready!") but forgets the
  // SET_DELIVERY / SET_ADDRESS action — catch those deterministically.
  if (!actions.some((a) => a.type === "SET_DELIVERY") && !draft.deliveryMethod) {
    const det = deterministicParse(userMessage, currentStage, categories, draft);
    const detDelivery = det.actions.find((a) => a.type === "SET_DELIVERY");
    if (detDelivery) {
      actions = [...actions, detDelivery];
      // the parser found explicit courier/pickup intent → advance the flow
      // (its nextStage is more specific than a generic model suggestion)
      suggestedStage = det.nextStage ?? suggestedStage;
    }
  }
  if (!actions.some((a) => a.type === "SET_ADDRESS")) {
    // any stage — the model often confirms the address in text but forgets
    // the action; the parser's conservative looksLikeAddress guard protects
    // against false positives (food mentions never count as addresses)
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

  const { draft: newDraft, log, warnings } = applyActions(
    draft,
    itemActions,
    categories,
    aiSettings.maxItemsPerOrder,
    allergenPhrases,
    // آیتم‌های «فقط شیفت شب» فقط در سرویس شام قابل افزودن‌اند — پیام گیت مشترک با سایت
    isDinnerShiftNow(general.businessHours) ? null : dinnerOnlyMessage(general.businessHours)
  );

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
  let nextStage = validateStageTransition(currentStage, suggestedStage, newDraft, categories);

  // A re-opened unpaid order lands directly on the (editable) invoice
  if (restoredFromOrder && nextStage === "TRACKING") {
    nextStage =
      newDraft.items.length === 0
        ? "ORDERING"
        : suggestedStage === "ADDRESS" && newDraft.deliveryMethod === "DELIVERY"
          ? "ADDRESS"
          : newDraft.deliveryMethod
            ? "CONFIRMATION"
            : "DELIVERY_METHOD";
  }

  // Draft gained items while tracking → the user is ordering again
  if (!restoredFromOrder && nextStage === "TRACKING" && newDraft.items.length > 0) {
    nextStage = "ORDERING";
  }

  // ---------- 4.5) Cashier guarantee ----------
  // A real cashier always ends at the register: once the draft holds every
  // required piece (items + delivery method + address for courier), the flow
  // deterministically lands on the invoice — even if the model forgets to
  // suggest CONFIRMATION. The invoice box with the pay button is therefore
  // ALWAYS shown before payment. Explicit backward navigation (step chips /
  // «روش ارسال رو عوض کنم») is never overridden — the user stays in control.
  const draftComplete =
    newDraft.items.length > 0 &&
    !!newDraft.deliveryMethod &&
    (newDraft.deliveryMethod === "PICKUP" || (newDraft.address ?? "").trim().length >= 10);
  // explicit backward = the USER asked for an earlier step (nav chips), or the
  // model deliberately keeps the flow browsing (ordering/drinks). A model
  // suggestion of DELIVERY_METHOD/ADDRESS with a complete draft is treated as
  // forgetfulness and healed to CONFIRMATION — the invoice must always land.
  // For a re-opened unpaid order even an ORDERING suggestion is healed (the
  // whole point of the re-open is editing the invoice).
  const explicitBackward =
    navForced ||
    (!restoredFromOrder &&
      (suggestedStage === "GREETING" || suggestedStage === "ORDERING" || suggestedStage === "DRINKS"));
  if (
    draftComplete &&
    !explicitBackward &&
    nextStage !== "TRACKING" &&
    (restoredFromOrder ||
      nextStage === "DELIVERY_METHOD" ||
      nextStage === "ADDRESS" ||
      nextStage === "CONFIRMATION")
  ) {
    // a re-opened unpaid order exists precisely to be edited → its invoice
    // must come back LIVE (with the pay button) right after the edit, even
    // when the model suggested staying on ORDERING
    nextStage = "CONFIRMATION";
  }

  // If AI suggested TRACKING but there is no order, force ordering
  if (nextStage === "TRACKING" && !latestOrder) {
    nextStage = newDraft.items.length > 0 ? "ORDERING" : "GREETING";
    replyText += "\n\n(فعلاً سفارش ثبت‌شده‌ای برای شما پیدا نکردم — بگید چه چیزی میل دارید؟)";
  }

  // Surface the re-opened order in the reply
  if (restoredFromOrder && !normalizePersian(replyText).includes("ویرایش")) {
    replyText = `سفارشتون رو دوباره به حالت ویرایش آوردم ✏️ هر تغییری خواستید بگید یا از دکمه‌های روی فاکتور استفاده کنید — بعد دوباره پرداخت می‌کنیم.\n\n${replyText}`;
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

  // Order summary attachment — the invoice shows whenever the flow reaches the
  // confirmation step OR whenever the user edits the order while an invoice is
  // already on screen (prices always recomputed server-side)
  const draftChanged = log.length > 0;
  const showInvoice =
    newDraft.items.length > 0 &&
    newDraft.deliveryMethod != null &&
    (nextStage === "CONFIRMATION" || (currentStage === "CONFIRMATION" && draftChanged) || restoredFromOrder);
  if (showInvoice) {
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
      // a re-opened order was canceled — the next payment creates a fresh one
      ...(restoredFromOrder ? { orderId: null } : {}),
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
    draft: newDraft,
  };
}
