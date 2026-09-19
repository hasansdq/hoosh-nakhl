import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireAdmin } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const page = Math.max(1, Number(new URL(req.url).searchParams.get("page") ?? 1));
    const pageSize = 30;
    const [logs, total] = await Promise.all([
      db.auditLog.findMany({ orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      db.auditLog.count(),
    ]);

    return ok({
      logs: logs.map((l) => ({
        id: l.id, actor: l.actor, action: l.action, entity: l.entity, entityId: l.entityId,
        detail: l.detail ? safeParse(l.detail) : null, ip: l.ip, createdAt: l.createdAt.toISOString(),
      })),
      pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
    });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
