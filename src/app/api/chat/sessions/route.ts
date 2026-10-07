import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireUser } from "@/lib/api";
import { STAGE_LABELS, type ChatStage } from "@/lib/chat/prompts";

export const dynamic = "force-dynamic";

/** GET — recent conversations of the logged-in user (for the chat sidebar).
 *  `?q=` → جستجوی داخل عنوان گفتگوها «و» متن پیام‌ها؛ برای هر نتیجه
 *  یک snippet از اولین پیام منطبق برگردانده می‌شود. */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user) return fail("ابتدا وارد شوید", 401);

    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();

    if (q.length >= 2) {
      // ---- search mode: title match OR any message-content match ----
      const matched = await db.chatSession.findMany({
        where: {
          userId: user.id,
          OR: [
            { title: { contains: q } },
            { messages: { some: { content: { contains: q } } } },
          ],
        },
        orderBy: { updatedAt: "desc" },
        take: 20,
        include: { _count: { select: { messages: true } } },
      });

      // first matching message per session (single query, newest conversations first)
      const hitMessages = await db.chatMessage.findMany({
        where: {
          session: { userId: user.id },
          content: { contains: q },
        },
        orderBy: { createdAt: "asc" },
        select: { sessionId: true, content: true, role: true },
        take: 400,
      });
      const snippetBySession = new Map<string, string>();
      for (const m of hitMessages) {
        if (!snippetBySession.has(m.sessionId)) {
          const idx = m.content.indexOf(q);
          const from = Math.max(0, idx - 24);
          const raw = m.content.slice(from, from + 90).replace(/\s+/g, " ").trim();
          snippetBySession.set(m.sessionId, (from > 0 ? "…" : "") + raw);
        }
      }

      return ok({
        query: q,
        sessions: matched.map((s) => ({
          id: s.id,
          title: s.title,
          stage: s.stage,
          stageLabel: STAGE_LABELS[s.stage as ChatStage] ?? s.stage,
          status: s.status,
          orderId: s.orderId,
          messageCount: s._count.messages,
          updatedAt: s.updatedAt.toISOString(),
          createdAt: s.createdAt.toISOString(),
          matchedInTitle: Boolean(s.title?.includes(q)),
          snippet: snippetBySession.get(s.id) ?? null,
        })),
      });
    }

    const sessions = await db.chatSession.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 40,
      include: { _count: { select: { messages: true } } },
    });

    return ok({
      sessions: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        stage: s.stage,
        stageLabel: STAGE_LABELS[s.stage as ChatStage] ?? s.stage,
        status: s.status,
        orderId: s.orderId,
        messageCount: s._count.messages,
        updatedAt: s.updatedAt.toISOString(),
        createdAt: s.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    console.error("chat sessions list error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}
