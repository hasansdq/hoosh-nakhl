import { db } from "@/lib/db";
import { ok } from "@/lib/api";

export async function GET() {
  try {
    const [categories, ratingAgg] = await Promise.all([
      db.category.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        include: {
          items: {
            where: {},
            orderBy: [{ isSpecial: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
          },
        },
      }),
      db.review.groupBy({
        by: ["menuItemId"],
        where: { status: "APPROVED" },
        _avg: { rating: true },
        _count: { rating: true },
      }),
    ]);

    const ratingMap = new Map(
      ratingAgg.map((r) => [r.menuItemId, { avg: r._avg.rating ?? 0, count: r._count.rating }])
    );

    return ok({
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        items: c.items.map((i) => ({
          id: i.id,
          name: i.name,
          description: i.description,
          price: i.price,
          imageUrl: i.imageUrl,
          gallery: Array.isArray(i.gallery) ? (i.gallery as string[]) : [],
          isAvailable: i.isAvailable,
          isSpecial: i.isSpecial,
          isDrink: i.isDrink,
          isVegetarian: i.isVegetarian,
          isSpicy: i.isSpicy,
          ingredients: i.ingredients,
          orderCount: i.orderCount,
          calories: i.calories,
          prepTime: i.prepTime,
          rating: ratingMap.get(i.id)?.avg
            ? Math.round((ratingMap.get(i.id)!.avg ?? 0) * 10) / 10
            : null,
          ratingCount: ratingMap.get(i.id)?.count ?? 0,
        })),
      })),
    });
  } catch (e) {
    console.error("menu error:", e);
    return ok({ categories: [] });
  }
}
