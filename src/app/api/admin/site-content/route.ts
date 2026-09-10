import { NextRequest } from "next/server";
import { ok, fail, requireAdmin, logAudit } from "@/lib/api";
import { getClientIp } from "@/lib/auth";
import { z } from "zod";
import type { ContentGroup } from "@/lib/content-defs";
import {
  listSiteContentForAdmin,
  saveSiteContent,
  resetSiteContent,
} from "@/lib/site-content";
import { CONTENT_GROUP_META } from "@/lib/content-defs";

const VALID_GROUPS = CONTENT_GROUP_META.map((g) => g.key) as ContentGroup[];

const updateSchema = z.object({
  key: z.string().min(1).max(120),
  value: z.string().max(4000),
});

const putBodySchema = z.object({
  updates: z.array(updateSchema).min(1).max(200),
});

const deleteBodySchema = z
  .object({
    keys: z.array(z.string().min(1).max(120)).max(200).optional(),
    group: z.enum(["home", "auth", "header", "footer", "seo"]).optional(),
  })
  .refine((v) => v.keys?.length || v.group, {
    message: "keys یا group لازم است",
  });

/** GET — full registry with current values (admin editor data source). */
export async function GET() {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const items = await listSiteContentForAdmin();
    return ok({ items, groups: CONTENT_GROUP_META });
  } catch (e) {
    console.error("site-content list error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

/** PUT — batch save edits (empty value ⇒ revert to default). */
export async function PUT(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const body = await req.json().catch(() => ({}));
    const parsed = putBodySchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "داده نامعتبر");
    }

    const result = await saveSiteContent(
      parsed.data.updates,
      session.admin.username,
    );

    if (result.errors.length > 0 && result.saved.length === 0 && result.reset.length === 0) {
      return fail(result.errors[0]?.message ?? "ذخیره انجام نشد");
    }

    await logAudit(session.admin.username, "SITE_CONTENT_UPDATED", {
      entity: "siteContent",
      detail: { saved: result.saved, reset: result.reset, errors: result.errors },
      ip: getClientIp(req),
    });

    const items = await listSiteContentForAdmin();
    return ok({
      savedCount: result.saved.length,
      resetCount: result.reset.length,
      errors: result.errors,
      items,
      groups: CONTENT_GROUP_META,
    });
  } catch (e) {
    console.error("site-content save error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

/** DELETE — reset keys (or a whole group) back to defaults. */
export async function DELETE(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const body = await req.json().catch(() => ({}));
    const parsed = deleteBodySchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "داده نامعتبر");
    }
    if (parsed.data.group && !VALID_GROUPS.includes(parsed.data.group)) {
      return fail("گروه محتوا نامعتبر است");
    }

    const affected = await resetSiteContent({
      keys: parsed.data.keys,
      group: parsed.data.group,
    });

    await logAudit(session.admin.username, "SITE_CONTENT_RESET", {
      entity: "siteContent",
      detail: { keys: parsed.data.keys ?? null, group: parsed.data.group ?? null },
      ip: getClientIp(req),
    });

    const items = await listSiteContentForAdmin();
    return ok({ resetCount: affected.length, items, groups: CONTENT_GROUP_META });
  } catch (e) {
    console.error("site-content reset error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}
