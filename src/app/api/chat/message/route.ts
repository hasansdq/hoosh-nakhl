import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireUser } from "@/lib/api";
import { processChatMessage } from "@/lib/chat/engine";
import { STAGE_LABELS, type ChatStage } from "@/lib/chat/prompts";
import { chatMessageSchema } from "@/lib/validators";
import { rateLimit, getClientIp } from "@/lib/auth";
import { getSettings, type GeneralSettings } from "@/lib/settings";
import { isOpenNow, openStatusText } from "@/lib/hours";

/** Derive a sidebar title from the first user message of a conversation */
function titleFromMessage(message: string): string | null {
  const t = message
    .replace(/\s+/g, " ")
    .replace(/^(سلام|درود|هی|های)[ !،]?/u, "")
    .trim();
  return t ? t.slice(0, 48) : null;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user) return fail("ابتدا وارد شوید", 401);

    const ip = getClientIp(req);
    const rl = rateLimit(`chat:${user.id}`, 30, 60 * 1000); // 30 msgs/min
    if (!rl.ok) return fail("پیام‌ها را کمی آهسته‌تر بفرستید 🙂", 429);

    const body = await req.json().catch(() => ({}));
    const parsed = chatMessageSchema.safeParse(body);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "داده نامعتبر");

    // find session — the client may pin a specific conversation (sidebar switch)
    let session = parsed.data.sessionId
      ? await db.chatSession.findFirst({
          where: { id: parsed.data.sessionId, userId: user.id },
        })
      : await db.chatSession.findFirst({
          where: { userId: user.id, status: "ACTIVE" },
          orderBy: { updatedAt: "desc" },
        });

    if (!session) {
      session = await db.chatSession.create({
        data: { userId: user.id, stage: "GREETING", draft: JSON.stringify({ items: [] }) },
      });
    } else if (parsed.data.sessionId) {
      // make sure the pinned session is the single ACTIVE one
      await db.chatSession.updateMany({
        where: { userId: user.id, status: "ACTIVE", id: { not: session.id } },
        data: { status: "ENDED" },
      });
      if (session.status !== "ACTIVE") {
        session = await db.chatSession.update({
          where: { id: session.id },
          data: { status: "ACTIVE" },
        });
      }
    }

    // auto-title the conversation from its first user message
    if (!session.title) {
      const t = titleFromMessage(parsed.data.message);
      if (t) {
        await db.chatSession.update({ where: { id: session.id }, data: { title: t } });
      }
    }

    // save user message
    const savedUserMessage = await db.chatMessage.create({
      data: { sessionId: session.id, role: "USER", content: parsed.data.message, type: "TEXT" },
    });

    // process via engine
    const result = await processChatMessage(session, user.id, parsed.data.message, savedUserMessage.id);

    // ---- گیت اطلاع‌رسانی ساعات کاری ----
    // خارج از ناهار/شام، پاسخ هوش نخل قطعاً شامل «رستوران بسته است» می‌شود
    // (پرامپت LLM را پوشش می‌دهد؛ اگر خود پاسخ بازگو نکرده باشد، اینجا افزوده می‌شود).
    // سبد/فاکتور حفظ می‌شود — گیت سخت پرداخت در /api/payment/request است.
    const generalHours = await getSettings<GeneralSettings>("general");
    if (!isOpenNow(generalHours.businessHours)) {
      const status = openStatusText(generalHours.businessHours);
      const content = result.assistantMessage.content ?? "";
      if (!/بسته|ساعات کاری/.test(content)) {
        result.assistantMessage.content = `${content}\n\n🚫 رستوران الان بسته است! ${status.detail} — سفارش شما حفظ می‌شود و در ساعات کاری می‌توانید پرداخت را کامل کنید.`;
      }
    }

    // save assistant message
    const saved = await db.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "ASSISTANT",
        content: result.assistantMessage.content,
        type: result.assistantMessage.type,
        metadata: JSON.stringify(result.assistantMessage.metadata),
      },
    });

    return ok({
      message: {
        id: saved.id,
        role: "ASSISTANT",
        content: saved.content,
        type: saved.type,
        metadata: result.assistantMessage.metadata,
        createdAt: saved.createdAt.toISOString(),
      },
      stage: result.stage,
      stageLabel: STAGE_LABELS[result.stage as ChatStage] ?? result.stage,
      // the fresh draft after this turn — the client mirrors it into the classic cart
      draft: {
        items: result.draft.items,
        deliveryMethod: result.draft.deliveryMethod ?? null,
        address: result.draft.address ?? null,
        couponCode: result.draft.couponCode ?? null,
      },
    });
  } catch (e) {
    console.error("chat message error:", e);
    return fail("خطا در پردازش پیام. لطفاً دوباره تلاش کنید", 500);
  }
}
