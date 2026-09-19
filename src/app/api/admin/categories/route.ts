import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireAdmin, logAudit } from "@/lib/api";
import { categorySchema } from "@/lib/validators";
import { getClientIp } from "@/lib/auth";

function slugify(name: string): string {
  return (
    "cat-" +
    Buffer.from(name).toString("base64url").slice(0, 12) +
    "-" +
    Math.random().toString(36).slice(2, 6)
  );
}

export async function GET() {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const categories = await db.category.findMany({
      orderBy: { sortOrder: "asc" },
      include: { _count: { select: { items: true } } },
    });
    return ok({
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        icon: c.icon,
        sortOrder: c.sortOrder,
        isActive: c.isActive,
        itemsCount: c._count.items,
      })),
    });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const body = await req.json().catch(() => ({}));
    const parsed = categorySchema.safeParse(body);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "داده نامعتبر");

    const category = await db.category.create({
      data: {
        name: parsed.data.name,
        slug: slugify(parsed.data.name),
        icon: parsed.data.icon || null,
        sortOrder: parsed.data.sortOrder ?? 99,
        isActive: parsed.data.isActive ?? true,
      },
    });

    await logAudit(session.admin.username, "CATEGORY_CREATED", {
      entity: "category",
      entityId: category.id,
      ip: getClientIp(req),
    });
    return ok({ category });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}
