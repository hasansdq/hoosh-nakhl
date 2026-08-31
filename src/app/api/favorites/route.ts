import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireUser } from "@/lib/api";
import { z } from "zod";

/** shape of a single favorite returned to the client (menuItem flattened) */
function mapFavorite(f: {
  id: string;
  menuItemId: string;
  menuItem: {
    id: string;
    name: string;
    description: string | null;
    price: number;
    imageUrl: string | null;
    gallery: unknown;
    isAvailable: boolean;
    isSpecial: boolean;
    isDrink: boolean;
    calories: number | null;
    prepTime: number | null;
  };
}) {
  return {
    id: f.id,
    menuItemId: f.menuItemId,
    menuItem: {
      id: f.menuItem.id,
      name: f.menuItem.name,
      description: f.menuItem.description,
      price: f.menuItem.price,
      imageUrl: f.menuItem.imageUrl,
      gallery: Array.isArray(f.menuItem.gallery) ? (f.menuItem.gallery as string[]) : [],
      isAvailable: f.menuItem.isAvailable,
      isSpecial: f.menuItem.isSpecial,
      isDrink: f.menuItem.isDrink,
      calories: f.menuItem.calories,
      prepTime: f.menuItem.prepTime,
    },
  };
}

/** GET /api/favorites — list current user's favorites (with menuItem flattened) */
export async function GET() {
  try {
    const user = await requireUser();
    if (!user) return fail("برای ذخیره علاقه‌مندی‌ها ابتدا وارد شوید", 401);

    const rows = await db.favorite.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        menuItem: {
          select: {
            id: true,
            name: true,
            description: true,
            price: true,
            imageUrl: true,
            gallery: true,
            isAvailable: true,
            isSpecial: true,
            isDrink: true,
            calories: true,
            prepTime: true,
          },
        },
      },
    });

    return ok({ favorites: rows.map(mapFavorite) });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}

const bodySchema = z.object({
  menuItemId: z.string().min(5, "شناسه غذا نامعتبر است"),
});

/** POST /api/favorites — add a menu item to the current user's favorites */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user) return fail("برای ذخیره علاقه‌مندی‌ها ابتدا وارد شوید", 401);

    const body = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "داده نامعتبر");

    const { menuItemId } = parsed.data;

    const item = await db.menuItem.findUnique({
      where: { id: menuItemId },
      select: { id: true, name: true, isAvailable: true },
    });
    if (!item) return fail("این غذا در منو وجود ندارد", 404);
    if (!item.isAvailable) return fail("این غذا فعلاً در منو ناموجود است");

    try {
      const created = await db.favorite.create({
        data: { userId: user.id, menuItemId },
        include: {
          menuItem: {
            select: {
              id: true,
              name: true,
              description: true,
              price: true,
              imageUrl: true,
              gallery: true,
              isAvailable: true,
              isSpecial: true,
              isDrink: true,
              calories: true,
              prepTime: true,
            },
          },
        },
      });
      return ok({ favorite: mapFavorite(created) });
    } catch (e) {
      // Prisma P2002 = unique constraint violation (already favorited) → return the existing row idempotently
      if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") {
        const existing = await db.favorite.findUnique({
          where: { userId_menuItemId: { userId: user.id, menuItemId } },
          include: {
            menuItem: {
              select: {
                id: true,
                name: true,
                description: true,
                price: true,
                imageUrl: true,
                gallery: true,
                isAvailable: true,
                isSpecial: true,
                isDrink: true,
                calories: true,
                prepTime: true,
              },
            },
          },
        });
        if (existing) return ok({ favorite: mapFavorite(existing), alreadyExists: true });
      }
      throw e;
    }
  } catch (e) {
    console.error("favorite create error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}
