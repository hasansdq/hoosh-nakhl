import { NextRequest } from "next/server";
import { ok, fail, requireAdmin, logAudit } from "@/lib/api";
import { getClientIp } from "@/lib/auth";
import { getSettings, saveSettings } from "@/lib/settings";
import { generateBaranApiKey } from "@/lib/baran";
import type { BaranSettings } from "@/lib/settings";

/**
 * تولید کلید API جدید برای اتصال باران — /api/admin/baran/rotate-key
 * نرم‌افزار باران باید بلافاصله با کلید جدید به‌روزرسانی شود.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const apiKey = generateBaranApiKey();
    await saveSettings("baran", { apiKey });

    await logAudit(session.admin.username, "BARAN_KEY_ROTATED", {
      entity: "settings",
      entityId: "baran",
      ip: getClientIp(req),
    });

    const settings = await getSettings<BaranSettings>("baran");
    return ok({ settings });
  } catch (e) {
    console.error("baran rotate-key error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}
