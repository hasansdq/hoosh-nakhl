import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireUser } from "@/lib/api";
import { STAGE_LABELS, type ChatStage } from "@/lib/chat/prompts";

/** GET — get or create active chat session with messages */
export async function GET() {
  try {
    const user = await requireUser();
    if (!user) return fail("ابتدا وارد شوید", 401);

    let session = await db.chatSession.findFirst({
      where: { userId: user.id, status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
    });

    if (!session) {
      session = await db.chatSession.create({
        data: { userId: user.id, stage: "GREETING", draft: JSON.stringify({ items: [] }) },
      });
    }

    const messages = await db.chatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
      take: 100,
    });

    return ok({
      sessionId: session.id,
      stage: session.stage,
      stageLabel: STAGE_LABELS[session.stage as ChatStage] ?? session.stage,
      orderId: session.orderId,
      draft: session.draft ? JSON.parse(session.draft) : { items: [] },
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        type: m.type,
        metadata: m.metadata ? JSON.parse(m.metadata) : null,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    console.error("chat session GET error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

/** POST — start a new chat session (end previous) */
export async function POST() {
  try {
    const user = await requireUser();
    if (!user) return fail("ابتدا وارد شوید", 401);

    await db.chatSession.updateMany({
      where: { userId: user.id, status: "ACTIVE" },
      data: { status: "ENDED" },
    });

    const session = await db.chatSession.create({
      data: { userId: user.id, stage: "GREETING", draft: JSON.stringify({ items: [] }) },
    });

    return ok({ sessionId: session.id, stage: session.stage, messages: [] });
  } catch (e) {
    console.error("chat session POST error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user) return fail("ابتدا وارد شوید", 401);
    await db.chatSession.updateMany({
      where: { userId: user.id, status: "ACTIVE" },
      data: { status: "ENDED" },
    });
    return ok({ message: "گفتگو پایان یافت" });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}
