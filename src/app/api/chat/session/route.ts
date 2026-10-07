import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireUser } from "@/lib/api";
import { STAGE_LABELS, type ChatStage } from "@/lib/chat/prompts";

/** GET — active chat session with messages; ?sessionId=<id> loads (and
 *  activates) a specific conversation from the history sidebar. */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user) return fail("ابتدا وارد شوید", 401);

    const wantedId = new URL(req.url).searchParams.get("sessionId");

    let session = wantedId
      ? await db.chatSession.findFirst({
          where: { id: wantedId, userId: user.id },
        })
      : await db.chatSession.findFirst({
          where: { userId: user.id, status: "ACTIVE" },
          orderBy: { updatedAt: "desc" },
        });

    if (wantedId && !session) return fail("گفتگوی مورد نظر یافت نشد", 404);

    if (!session) {
      session = await db.chatSession.create({
        data: { userId: user.id, stage: "GREETING", draft: JSON.stringify({ items: [] }) },
      });
    } else if (wantedId && session.status !== "ACTIVE") {
      // switching to an old conversation → make it the single active one
      await db.chatSession.updateMany({
        where: { userId: user.id, status: "ACTIVE", id: { not: session.id } },
        data: { status: "ENDED" },
      });
      session = await db.chatSession.update({
        where: { id: session.id },
        data: { status: "ACTIVE" },
      });
    } else if (wantedId) {
      // already exists and belongs to the user — ensure it's the only ACTIVE one
      await db.chatSession.updateMany({
        where: { userId: user.id, status: "ACTIVE", id: { not: session.id } },
        data: { status: "ENDED" },
      });
    }

    const messages = await db.chatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
      take: 150,
    });

    return ok({
      sessionId: session.id,
      stage: session.stage,
      stageLabel: STAGE_LABELS[session.stage as ChatStage] ?? session.stage,
      title: session.title,
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

/** PATCH — rename a conversation { sessionId, title } */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user) return fail("ابتدا وارد شوید", 401);

    const body = (await req.json().catch(() => ({}))) as { sessionId?: string; title?: string };
    if (!body.sessionId) return fail("شناسه گفتگو الزامی است");
    const title = (body.title ?? "").trim().slice(0, 60);
    if (title.length < 2) return fail("عنوان گفتگو باید حداقل ۲ نویسه باشد");

    const session = await db.chatSession.findFirst({
      where: { id: body.sessionId, userId: user.id },
    });
    if (!session) return fail("گفتگوی مورد نظر یافت نشد", 404);

    await db.chatSession.update({
      where: { id: session.id },
      data: { title },
    });

    return ok({ sessionId: session.id, title });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}

/** DELETE — delete one conversation (?sessionId=...) or end all active */
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user) return fail("ابتدا وارد شوید", 401);

    const sessionId = new URL(req.url).searchParams.get("sessionId");
    if (sessionId) {
      const session = await db.chatSession.findFirst({
        where: { id: sessionId, userId: user.id },
      });
      if (!session) return fail("گفتگوی مورد نظر یافت نشد", 404);
      await db.chatSession.delete({ where: { id: session.id } });
      return ok({ message: "گفتگو حذف شد" });
    }

    await db.chatSession.updateMany({
      where: { userId: user.id, status: "ACTIVE" },
      data: { status: "ENDED" },
    });
    return ok({ message: "گفتگو پایان یافت" });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}
