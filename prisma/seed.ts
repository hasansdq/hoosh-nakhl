/**
 * Nakhl Restaurant — idempotent database seeder (prisma/seed.ts)
 * ----------------------------------------------------------------
 * Creates the initial production-ready data:
 *   • 7 categories + 30 menu items + coupons  (from prisma/seed-data.json)
 *   • Admin user (username/password from ADMIN_USERNAME / ADMIN_PASSWORD env,
 *     defaults: rayantech / CHANGE-ME — see .env.example)
 *   • Settings rows (ai / sms / payment / general) with PRODUCTION-SAFE values
 *     when NODE_ENV=production (no dev OTP, no sandbox, no payment simulation);
 *     in development the dev-friendly defaults are seeded instead.
 *
 * Safe to re-run (upserts everywhere — no duplicates).
 *
 * Usage:
 *   bun prisma/seed.ts                       # respects NODE_ENV
 *   NODE_ENV=production bun prisma/seed.ts    # production-safe settings
 *
 * In Docker this runs automatically on first boot (docker/entrypoint.sh)
 * when no database file exists yet.
 */
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import seedData from "./seed-data.json";

const db = new PrismaClient();

// ---------- helpers (mirror src/lib/auth.ts scrypt scheme) ----------

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

type SeedRow = Record<string, unknown>;

// ---------- 1. categories / menu items / coupons ----------

async function seedMenu(): Promise<{ categories: number; items: number; coupons: number }> {
  for (const c of seedData.categories as SeedRow[]) {
    await db.category.upsert({
      where: { id: c.id as string },
      update: {
        name: c.name as string,
        slug: c.slug as string,
        icon: (c.icon as string | null) ?? null,
        sortOrder: (c.sortOrder as number) ?? 0,
        isActive: (c.isActive as boolean) ?? true,
      },
      create: c as never,
    });
  }

  for (const i of seedData.items as SeedRow[]) {
    const item = {
      id: i.id as string,
      name: i.name as string,
      description: (i.description as string | null) ?? null,
      price: i.price as number,
      categoryId: i.categoryId as string,
      imageUrl: (i.imageUrl as string | null) ?? null,
      gallery: (i.gallery as object | null) ?? undefined,
      isAvailable: (i.isAvailable as boolean) ?? true,
      isSpecial: (i.isSpecial as boolean) ?? false,
      isDrink: (i.isDrink as boolean) ?? false,
      isVegetarian: (i.isVegetarian as boolean) ?? false,
      isSpicy: (i.isSpicy as boolean) ?? false,
      calories: (i.calories as number | null) ?? null,
      prepTime: (i.prepTime as number | null) ?? null,
      ingredients: (i.ingredients as string | null) ?? null,
      sortOrder: (i.sortOrder as number) ?? 0,
      orderCount: (i.orderCount as number) ?? 0,
    };
    await db.menuItem.upsert({
      where: { id: item.id },
      update: item,
      create: item,
    });
  }

  for (const c of seedData.coupons as SeedRow[]) {
    await db.coupon.upsert({
      where: { code: c.code as string },
      update: {
        title: c.title as string,
        type: c.type as string,
        value: c.value as number,
        minOrder: (c.minOrder as number) ?? 0,
        maxDiscount: (c.maxDiscount as number | null) ?? null,
        usageLimit: (c.usageLimit as number) ?? 0,
        perUserLimit: (c.perUserLimit as number) ?? 1,
        startsAt: (c.startsAt as string | null) ? new Date(c.startsAt as string) : null,
        expiresAt: (c.expiresAt as string | null) ? new Date(c.expiresAt as string) : null,
        isActive: (c.isActive as boolean) ?? true,
      },
      create: {
        code: c.code as string,
        title: c.title as string,
        type: c.type as string,
        value: c.value as number,
        minOrder: (c.minOrder as number) ?? 0,
        maxDiscount: (c.maxDiscount as number | null) ?? null,
        usageLimit: (c.usageLimit as number) ?? 0,
        perUserLimit: (c.perUserLimit as number) ?? 1,
        startsAt: (c.startsAt as string | null) ? new Date(c.startsAt as string) : null,
        expiresAt: (c.expiresAt as string | null) ? new Date(c.expiresAt as string) : null,
        isActive: (c.isActive as boolean) ?? true,
      },
    });
  }

  return {
    categories: (seedData.categories as SeedRow[]).length,
    items: (seedData.items as SeedRow[]).length,
    coupons: (seedData.coupons as SeedRow[]).length,
  };
}

// ---------- 2. admin user ----------

async function seedAdmin(): Promise<string> {
  const username = process.env.ADMIN_USERNAME || "rayantech";
  const password = process.env.ADMIN_PASSWORD || "Hasan78484@";

  const existing = await db.adminUser.findUnique({ where: { username } });
  if (existing) {
    console.log(`[seed] admin "${username}" already exists — skipped (password unchanged)`);
    return username;
  }

  await db.adminUser.create({
    data: {
      username,
      passwordHash: hashPassword(password),
      displayName: "مدیر رستوران نخل",
    },
  });
  console.log(
    `[seed] admin "${username}" created${password === "Hasan78484@" ? " (DEFAULT PASSWORD — change it from the admin panel immediately!)" : ""}`
  );
  return username;
}

// ---------- 3. settings ----------

async function seedSettings(): Promise<void> {
  const isProd = process.env.NODE_ENV === "production";

  const groups: Array<{ key: string; group: string; value: Record<string, unknown> }> = [
    {
      key: "ai",
      group: "ai",
      value: isProd
        ? {
            // "zai" provider only exists inside the z.ai sandbox — production
            // uses OpenRouter (key configured later in the admin panel).
            provider: "openrouter",
            apiKey: "",
            model: "",
          }
        : { provider: "zai", apiKey: "", model: "" },
    },
    {
      key: "sms",
      group: "sms",
      value: isProd
        ? {
            provider: "none", // configure Melipayamak / SMS.IR from the admin panel
            devMode: false, // NEVER leak OTP codes in production API responses
          }
        : { provider: "none", devMode: true },
    },
    {
      key: "payment",
      group: "payment",
      value: isProd
        ? {
            merchantId: "", // real ZarinPal merchant id goes in the admin panel
            sandbox: false,
            simulationMode: false, // real gateway only
          }
        : { merchantId: "", sandbox: true, simulationMode: true },
    },
    {
      key: "general",
      group: "general",
      value: {
        restaurantName: "رستوران نخل",
        restaurantTagline: "طعم اصیل رفسنجان، با نوآوری هوش مصنوعی",
        address: "رفسنجان، بلوار شهید مطهری، نبش کوچه نخل، پلاک ۱۲",
        phone: "03434300000",
        email: "info@nakhl-rafsanjan.ir",
        workingHours: "همه روزه از ساعت ۱۲ ظهر تا ۱۲ شب",
        taxPercent: 10,
        deliveryFee: 35000,
        minOrderAmount: 100000,
        freeDeliveryOver: 500000,
        city: "رفسنجان",
        instagram: "nakhl.rafsanjan",
        telegram: "nakhl_restaurant",
      },
    },
  ];

  for (const g of groups) {
    // only insert if missing — never clobber live admin-panel configuration
    const existing = await db.setting.findUnique({ where: { key: g.key } });
    if (!existing) {
      await db.setting.create({ data: { key: g.key, group: g.group, value: JSON.stringify(g.value) } });
      console.log(`[seed] settings "${g.key}" seeded (${isProd ? "production-safe" : "dev"} values)`);
    } else {
      console.log(`[seed] settings "${g.key}" already exists — skipped`);
    }
  }
}

// ---------- run ----------

async function main(): Promise<void> {
  console.log("┌─────────────────────────────────────────────┐");
  console.log("│  Nakhl Restaurant — database seed           │");
  console.log(`│  mode: ${process.env.NODE_ENV === "production" ? "production (safe defaults)" : "development"}`);
  console.log("└─────────────────────────────────────────────┘");

  const menu = await seedMenu();
  console.log(`[seed] menu: ${menu.categories} categories, ${menu.items} items, ${menu.coupons} coupons`);
  await seedAdmin();
  await seedSettings();
  console.log("[seed] done ✔");
}

main()
  .catch((e) => {
    console.error("[seed] FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
