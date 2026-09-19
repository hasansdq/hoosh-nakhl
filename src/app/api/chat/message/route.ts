import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireUser } from "@/lib/api";
import { processChatMessage } from "@/lib/chat/engine";
import { STAGE_LABELS, type ChatStage } from "@/lib/chat/prompts";
import { chatMessageSchema } from "@/lib/validators";
import { rateLimit, getClientIp } from "@/lib/auth";

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

    // find active session
    let session = await db.chatSession.findFirst({
      where: { userId: user.id, status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
    });
    if (!session) {
      session = await db.chatSession.create({
        data: { userId: user.id, stage: "GREETING", draft: JSON.stringify({ items: [] }) },
      });
    }

    // save user message
    await db.chatMessage.create({
      data: { sessionId: session.id, role: "USER", content: parsed.data.message, type: "TEXT" },
    });

    // process via engine
    const result = await processChatMessage(session, user.id, parsed.data.message);

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
    });
  } catch (e) {
    console.error("chat message error:", e);
    return fail("خطا در پردازش پیام. لطفاً دوباره تلاش کنید", 500);
  }
}
