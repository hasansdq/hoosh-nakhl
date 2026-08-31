import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireAdmin } from "@/lib/api";

// ============ In-memory cache (30s TTL keyed by query) ============
// The project uses local memory caching per worklog. We bypass the cache for
// empty/short queries and rely on a 200ms client debounce to limit calls.
interface CacheEntry {
  ts: number;
  data: unknown;
}
const g = globalThis as unknown as { __nakhlAdminSearchCache?: Map<string, CacheEntry> };
const cache: Map<string, CacheEntry> = (g.__nakhlAdminSearchCache ??= new Map());
const CACHE_TTL_MS = 30_000;

export async function GET(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const started = Date.now();
    const url = new URL(req.url);
    const qRaw = url.searchParams.get("q") ?? "";
    const q = qRaw.trim();

    // short queries return an empty result set so the palette can show
    // "recent searches" without round-trips to the DB.
    if (q.length < 2) {
      return ok({
        results: { orders: [], users: [], menuItems: [], coupons: [] },
        took: 0,
      });
    }

    // cache hit?
    const cached = cache.get(q);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return ok({ results: cached.data, took: Date.now() - started });
    }

    // SQLite `contains` is case-sensitive for ASCII. Order numbers and coupon
    // codes are stored UPPERCASE (NK-XXXX / PALM20). We OR the original query
    // with its UPPERCASE form so a user typing "palm" still finds "PALM20".
    // Persian text has no case so the upper-cased form is identical.
    const qUpper = q.toUpperCase();

    const [orders, users, menuItems, coupons] = await Promise.all([
      db.order.findMany({
        where: {
          OR: [
            { orderNumber: { contains: qUpper } },
            { orderNumber: { contains: q } },
            {
              user: {
                OR: [
                  { firstName: { contains: q } },
                  { lastName: { contains: q } },
                  { phone: { contains: q } },
                ],
              },
            },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { user: { select: { firstName: true, lastName: true, phone: true } } },
      }),
      db.user.findMany({
        where: {
          OR: [
            { firstName: { contains: q } },
            { lastName: { contains: q } },
            { phone: { contains: q } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
      db.menuItem.findMany({
        where: {
          OR: [{ name: { contains: q } }, { description: { contains: q } }],
        },
        orderBy: { name: "asc" },
        take: 8,
      }),
      db.coupon.findMany({
        where: {
          OR: [
            { code: { contains: qUpper } },
            { code: { contains: q } },
            { title: { contains: q } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

    const data = {
      orders: orders.map((o) => ({
        type: "order" as const,
        id: o.id,
        orderNumber: o.orderNumber,
        userName: o.user
          ? `${o.user.firstName ?? ""} ${o.user.lastName ?? ""}`.trim() || o.user.phone
          : "-",
        total: o.total,
        status: o.status,
        paymentStatus: o.paymentStatus,
        createdAt: o.createdAt.toISOString(),
      })),
      users: users.map((u) => ({
        type: "user" as const,
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        phone: u.phone,
        createdAt: u.createdAt.toISOString(),
      })),
      menuItems: menuItems.map((m) => ({
        type: "menu" as const,
        id: m.id,
        name: m.name,
        price: m.price,
        isAvailable: m.isAvailable,
        isSpecial: m.isSpecial,
        imageUrl: m.imageUrl,
      })),
      coupons: coupons.map((c) => ({
        type: "coupon" as const,
        id: c.id,
        code: c.code,
        title: c.title,
        couponType: c.type,
        value: c.value,
        isActive: c.isActive,
      })),
    };

    cache.set(q, { ts: Date.now(), data });
    // bounded cleanup — keeps the cache from growing unbounded across many
    // unique queries during a long-lived server process.
    if (cache.size > 50) {
      const now = Date.now();
      for (const [k, v] of cache.entries()) {
        if (now - v.ts > CACHE_TTL_MS) cache.delete(k);
      }
    }

    return ok({ results: data, took: Date.now() - started });
  } catch (e) {
    console.error("admin search error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}
