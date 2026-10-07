import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireAdmin } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const url = new URL(req.url);
    const search = url.searchParams.get("q");
    const status = url.searchParams.get("status");
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const pageSize = 15;

    const digits = search?.replace(/\D/g, "") ?? "";
    const where = {
      ...(status === "ACTIVE" || status === "BLOCKED" ? { status } : {}),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search } },
              { lastName: { contains: search } },
              ...(digits ? [{ phone: { contains: `98${digits}` } }, { phone: { contains: digits } }] : []),
            ],
          }
        : {}),
    };

    const [users, total] = await Promise.all([
      db.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, phone: true, firstName: true, lastName: true, nationalId: true,
          email: true, birthDate: true, gender: true, avatarUrl: true, status: true,
          lastLoginAt: true, createdAt: true,
          orders: { select: { total: true, paymentStatus: true } },
        },
      }),
      db.user.count({ where }),
    ]);

    return ok({
      users: users.map((u) => {
        const paidOrders = u.orders.filter((o) => o.paymentStatus === "PAID");
        return {
          id: u.id,
          phone: u.phone,
          firstName: u.firstName,
          lastName: u.lastName,
          nationalId: u.nationalId,
          email: u.email,
          birthDate: u.birthDate?.toISOString() ?? null,
          gender: u.gender,
          avatarUrl: u.avatarUrl,
          status: u.status,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          createdAt: u.createdAt.toISOString(),
          ordersCount: u.orders.length,
          totalSpent: paidOrders.reduce((s, o) => s + o.total, 0),
        };
      }),
      pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
    });
  } catch (e) {
    console.error("admin users error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}
