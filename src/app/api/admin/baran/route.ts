import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireAdmin, logAudit } from "@/lib/api";
import { getClientIp } from "@/lib/auth";
import { getSettings, saveSettings } from "@/lib/settings";
import { generateBaranApiKey } from "@/lib/baran";
import type { BaranSettings } from "@/lib/settings";

/**
 * مدیریت اتصال باران — /api/admin/baran
 * ---------------------------------------------------------------------------
 * GET  → تنظیمات + آمار همگام‌سازی + لاگ فراخوانی‌ها + اقلام متصل
 * PUT  → ذخیرهٔ تنظیمات (whitelist دقیق؛ فعال‌سازی بدون کلید → کلید خودکار)
 */

const SENDABLE = ["PAID", "PREPARING", "READY", "DELIVERING", "DELIVERED"];

export async function GET() {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const settings = await getSettings<BaranSettings>("baran");
    const sendable = settings.includePendingOrders
      ? [...SENDABLE, "PENDING_PAYMENT"]
      : SENDABLE;

    const [productsSynced, categoriesLinked, imagesReceived, ordersPending, ordersSent, maxSync, logs, items] =
      await Promise.all([
        db.menuItem.count({ where: { baranProductId: { not: null } } }),
        db.category.count({ where: { baranGroupId: { not: null } } }),
        db.baranAsset.count(),
        db.order.count({ where: { baranSentAt: null, status: { in: sendable } } }),
        db.order.count({ where: { baranSentAt: { not: null } } }),
        db.menuItem.aggregate({ _max: { baranSyncedAt: true } }),
        db.baranSyncLog.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
        db.menuItem.findMany({
          where: { baranProductId: { not: null } },
          orderBy: { baranSyncedAt: "desc" },
          take: 60,
          include: { category: { select: { name: true } } },
        }),
      ]);

    return ok({
      settings,
      stats: {
        productsSynced,
        categoriesLinked,
        imagesReceived,
        ordersPending,
        ordersSent,
        lastProductSyncAt: maxSync._max.baranSyncedAt?.toISOString() ?? null,
      },
      logs: logs.map((l) => ({
        id: l.id,
        method: l.method,
        totalCount: l.totalCount,
        okCount: l.okCount,
        failCount: l.failCount,
        message: l.message,
        ip: l.ip,
        createdAt: l.createdAt.toISOString(),
      })),
      items: items.map((i) => ({
        id: i.id,
        name: i.name,
        baranProductId: i.baranProductId,
        price: i.price,
        isAvailable: i.isAvailable,
        hasImage: !!i.imageUrl,
        baranUnit: i.baranUnit,
        categoryName: i.category.name,
        syncedAt: i.baranSyncedAt?.toISOString() ?? null,
      })),
      apiPath: "/api/ApiServiceBaran/",
    });
  } catch (e) {
    console.error("baran admin GET error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const body = await req.json().catch(() => ({}));

    const values: Record<string, unknown> = {};
    if (typeof body.enabled === "boolean") values.enabled = body.enabled;
    if (typeof body.requireKey === "boolean") values.requireKey = body.requireKey;
    if (typeof body.stockSync === "boolean") values.stockSync = body.stockSync;
    if (typeof body.hideDeleted === "boolean") values.hideDeleted = body.hideDeleted;
    if (typeof body.includePendingOrders === "boolean")
      values.includePendingOrders = body.includePendingOrders;
    if (body.categoryLevel === "group" || body.categoryLevel === "main")
      values.categoryLevel = body.categoryLevel;

    const current = await getSettings<BaranSettings>("baran");

    // فعال‌سازی با کلید الزامی اما بدون کلید → تولید خودکار (fail-safe)
    const willBeEnabled = (values.enabled as boolean | undefined) ?? current.enabled;
    const willRequire = (values.requireKey as boolean | undefined) ?? current.requireKey;
    let generatedKey = false;
    if (willBeEnabled && willRequire && !current.apiKey) {
      values.apiKey = generateBaranApiKey();
      generatedKey = true;
    }

    await saveSettings("baran", values);

    const settings = await getSettings<BaranSettings>("baran");
    await logAudit(session.admin.username, "BARAN_SETTINGS_UPDATED", {
      entity: "settings",
      entityId: "baran",
      detail: { ...values, apiKey: values.apiKey ? "[set]" : undefined },
      ip: getClientIp(req),
    });

    return ok({ settings, generatedKey });
  } catch (e) {
    console.error("baran admin PUT error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}
