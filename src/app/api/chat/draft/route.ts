import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireUser } from "@/lib/api";
import { getSettings, type AISettings, type GeneralSettings } from "@/lib/settings";
import { parseDraft, buildOrderSummaryPayload } from "@/lib/chat/engine";
import type { ChatStage, OrderDraft } from "@/lib/chat/prompts";
import { rateLimit } from "@/lib/auth";
import { toPersianDigits } from "@/lib/fa";
import { z } from "zod";

/** Keep the session stage consistent with the (possibly edited) draft */
function validateDraftStage(current: string, draft: OrderDraft): ChatStage {
  const stage = current as ChatStage;
  if (draft.items.length === 0) return "ORDERING";
  if (!draft.deliveryMethod) {
    return stage === "GREETING" || stage === "ORDERING" || stage === "DRINKS" ? stage : "DELIVERY_METHOD";
  }
  switch (stage) {
    case "GREETING":
    case "ORDERING":
    case "DRINKS":
    case "DELIVERY_METHOD":
      return stage;
    case "ADDRESS":
      return draft.deliveryMethod === "DELIVERY" ? "ADDRESS" : "CONFIRMATION";
    case "TRACKING":
    case "CONFIRMATION":
      return "CONFIRMATION";
    default:
      return "ORDERING";
  }
}

/**
 * POST /api/chat/draft — direct invoice editing (quantity steppers, item
 * removal, delivery-method switch, address update) from the chat UI.
 *
 * The draft is the single source of truth for the NEXT order; every mutation
 * re-validates items against the live menu and recomputes pricing server-side,
 * then returns the fresh invoice payload for immediate re-render.
 */
const opSchema = z.object({
  op: z.enum(["INC_ITEM", "DEC_ITEM", "REMOVE_ITEM", "SET_DELIVERY", "SET_ADDRESS", "CLEAR", "REORDER"]),
  itemId: z.string().optional(),
  method: z.enum(["DELIVERY", "PICKUP"]).optional(),
  address: z.string().max(500).optional(),
  /** REORDER: شماره سفارش قبلی که باید دوباره به سبد ریخته شود */
  orderNumber: z.string().max(20).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user) return fail("ابتدا وارد شوید", 401);

    const rl = rateLimit(`draft:${user.id}`, 60, 60 * 1000);
    if (!rl.ok) return fail("درخواست‌های بیش از حد مجاز", 429);

    const body = opSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return fail(body.error.issues[0]?.message ?? "داده نامعتبر");
    const { op, itemId, method, address, orderNumber } = body.data;

    const session = await db.chatSession.findFirst({
      where: { userId: user.id, status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
    });
    if (!session) return fail("گفتگوی فعالی یافت نشد");

    const [aiSettings, general] = await Promise.all([
      getSettings<AISettings>("ai"),
      getSettings<GeneralSettings>("general"),
    ]);

    // authoritative live menu (availability + prices never trusted from client)
    const categories = await db.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      include: { items: true },
    });
    const allItems = categories.flatMap((c) => c.items);
    const menuById = new Map(allItems.map((i) => [i.id, i]));

    const draft = parseDraft(session.draft);
    const warnings: string[] = [];
    let logLine: string | null = null;

    // extra return value only produced by REORDER — a persisted assistant
    // message so the new invoice appears in the conversation history too
    let reorderMessage: Awaited<ReturnType<typeof db.chatMessage.create>> | undefined;

    switch (op) {
      case "INC_ITEM":
      case "DEC_ITEM": {
        if (!itemId || !menuById.has(itemId)) return fail("آیتم در منو یافت نشد");
        const menu = menuById.get(itemId)!;
        const line = draft.items.find((i) => i.itemId === itemId);
        if (!line) {
          if (op !== "INC_ITEM") return fail("این آیتم در سبد نیست");
          if (!menu.isAvailable) return fail(`${menu.name} فعلاً ناموجود است`);
          draft.items.push({ itemId: menu.id, name: menu.name, price: menu.price, quantity: 1 });
          logLine = `افزودن ${menu.name}`;
        } else {
          const delta = op === "INC_ITEM" ? 1 : -1;
          const nextQty = line.quantity + delta;
          if (nextQty <= 0) {
            draft.items = draft.items.filter((i) => i.itemId !== itemId);
            logLine = `حذف ${menu.name}`;
          } else {
            line.quantity = Math.min(30, nextQty);
            logLine = `${menu.name} × ${line.quantity}`;
          }
        }
        break;
      }
      case "REMOVE_ITEM": {
        if (!itemId) return fail("آیتم نامعتبر است");
        const line = draft.items.find((i) => i.itemId === itemId);
        if (!line) return fail("این آیتم در سبد نیست");
        draft.items = draft.items.filter((i) => i.itemId !== itemId);
        logLine = `حذف ${line.name}`;
        break;
      }
      case "SET_DELIVERY": {
        if (method !== "DELIVERY" && method !== "PICKUP") return fail("روش ارسال نامعتبر است");
        if (draft.items.length === 0) return fail("سبد سفارش خالی است");
        draft.deliveryMethod = method;
        if (method === "PICKUP") draft.address = undefined;
        logLine = method === "DELIVERY" ? "ارسال با پیک" : "بیرونبر";
        break;
      }
      case "SET_ADDRESS": {
        const addr = (address ?? "").trim();
        if (addr.length < 10) return fail("آدرس کامل نیست (حداقل ۱۰ نویسه)");
        draft.address = addr;
        draft.deliveryMethod = draft.deliveryMethod ?? "DELIVERY";
        logLine = "ثبت آدرس";
        break;
      }
      case "CLEAR": {
        draft.items = [];
        draft.couponCode = undefined;
        logLine = "خالی‌کردن سبد";
        break;
      }
      case "REORDER": {
        // تکرار سفارش قبلی از کارت رهگیری — مالکیت چک می‌شود، اقلام با
        // قیمت/موجودی «الانِ» منو اعتبارسنجی می‌شوند و روش ارسال + آدرس
        // همان سفارش قبلی carried over می‌شود تا فاکتور قطعیِ قابل پرداخت
        // بلافاصله ساخته شود (تجربهٔ صندوقدار).
        const orderNo = (orderNumber ?? "").trim();
        if (!orderNo) return fail("شماره سفارش ارسال نشده است");
        const order = await db.order.findFirst({
          where: { orderNumber: orderNo, userId: user.id },
          include: { items: true },
        });
        if (!order) return fail("سفارشی با این شماره برای شما یافت نشد", 404);

        const lines = order.items.filter((i) => i.menuItemId);
        if (lines.length === 0) return fail("اقلام این سفارش دیگر در منو موجود نیست");

        const resolved: typeof draft.items = [];
        const unavailable: string[] = [];
        for (const line of lines) {
          const menu = menuById.get(line.menuItemId as string);
          if (!menu || !menu.isAvailable) {
            unavailable.push(line.name);
            continue;
          }
          const existing = resolved.find((r) => r.itemId === menu.id);
          if (existing) {
            existing.quantity = Math.min(30, existing.quantity + line.quantity);
          } else {
            resolved.push({ itemId: menu.id, name: menu.name, price: menu.price, quantity: line.quantity });
          }
        }
        if (resolved.length === 0) {
          return fail(`فعلاً هیچ‌کدام از اقلام این سفارش موجود نیست${unavailable.length ? ` (${unavailable.join("، ")})` : ""}`);
        }

        // کپی قیمت‌های به‌روز؛ روش ارسال و آدرس از سفارش قبلی
        draft.items = resolved;
        draft.deliveryMethod = order.type === "PICKUP" ? "PICKUP" : "DELIVERY";
        draft.address = order.type === "DELIVERY" ? (order.address ?? undefined) : undefined;
        if (unavailable.length > 0) {
          warnings.push(`این اقلام فعلاً ناموجود بود و اضافه نشد: ${unavailable.join("، ")}`);
        }
        logLine = `تکرار سفارش ${order.orderNumber}`;
        break;
      }
    }

    // max items guard
    const totalQty = draft.items.reduce((s, i) => s + i.quantity, 0);
    if (totalQty > aiSettings.maxItemsPerOrder) {
      return fail(`حداکثر ${aiSettings.maxItemsPerOrder} آیتم در هر سفارش`);
    }

    const nextStage = validateDraftStage(session.stage, draft);

    await db.chatSession.update({
      where: { id: session.id },
      data: {
        stage: nextStage,
        draft: JSON.stringify(draft),
        updatedAt: new Date(),
      },
    });

    // fresh invoice payload (prices/coupon re-validated server-side)
    let orderSummary: Awaited<ReturnType<typeof buildOrderSummaryPayload>>["payload"] | undefined;
    if (draft.items.length > 0 && draft.deliveryMethod) {
      const summary = await buildOrderSummaryPayload(draft, general, user.id);
      orderSummary = summary.payload;
      warnings.push(...summary.warnings);
    }

    // REORDER: a persisted assistant message makes the fresh invoice part of
    // the conversation history (survives reload / session switch) — same shape
    // the /api/chat/message endpoint produces.
    if (op === "REORDER" && orderSummary) {
      const qty = draft.items.reduce((s, i) => s + i.quantity, 0);
      const note =
        warnings.length > 0
          ? `سفارش قبلی‌تان دوباره آماده شد — ${warnings.join(" ")} هر چیزی خواستی تغییر بده، اینجا بنویس ✏️`
          : `همین سفارش قبلی‌تان دوباره به سبد اضافه شد (${toPersianDigits(qty)} عدد) 🌴 اگر چیزی خواستی تغییرش بده، همین‌جا بگو ✏️`;
      reorderMessage = await db.chatMessage.create({
        data: {
          sessionId: session.id,
          role: "ASSISTANT",
          content: note,
          type: "ORDER_SUMMARY",
          metadata: JSON.stringify({ orderSummary }),
        },
      });
    }

    return ok({
      stage: nextStage,
      stageLabel: nextStage,
      orderSummary,
      message: reorderMessage
        ? {
            id: reorderMessage.id,
            role: reorderMessage.role,
            content: reorderMessage.content,
            type: reorderMessage.type,
            metadata: { orderSummary },
            createdAt: reorderMessage.createdAt.toISOString(),
          }
        : undefined,
      actionsApplied: logLine ? [logLine] : [],
      warnings,
    });
  } catch (e) {
    console.error("chat draft error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}
