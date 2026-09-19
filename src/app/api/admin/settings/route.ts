import { NextRequest } from "next/server";
import { ok, fail, requireAdmin, logAudit } from "@/lib/api";
import { getSettings, saveSettings, invalidateSettingsCache, maskSecrets, type SettingsGroup } from "@/lib/settings";
import { getClientIp } from "@/lib/auth";
import { z } from "zod";

const VALID_GROUPS = ["ai", "sms", "payment", "general"] as const;

function isSettingsGroup(value: string): value is SettingsGroup {
  return (VALID_GROUPS as readonly string[]).includes(value);
}

const groupSchemas: Record<string, z.ZodTypeAny> = {
  ai: z.object({
    provider: z.enum(["zai", "openai", "openrouter"]).optional(),
    apiKey: z.string().max(300).optional(),
    model: z.string().max(120).optional(),
    baseUrl: z.string().max(300).optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().min(100).max(32000).optional(),
    topP: z.number().min(0).max(1).optional(),
    presencePenalty: z.number().min(-2).max(2).optional(),
    frequencyPenalty: z.number().min(-2).max(2).optional(),
    systemPromptExtra: z.string().max(3000).optional(),
    maxHistoryMessages: z.number().int().min(2).max(50).optional(),
    requestTimeout: z.number().int().min(10).max(300).optional(),
    friendlyTone: z.boolean().optional(),
    suggestBestSellers: z.boolean().optional(),
    allowSmallTalk: z.boolean().optional(),
    maxItemsPerOrder: z.number().int().min(1).max(50).optional(),
  }),
  sms: z.object({
    provider: z.enum(["none", "melipayamak", "smsir"]).optional(),
    devMode: z.boolean().optional(),
    otpTemplate: z.string().max(500).optional(),
    otpTtlMinutes: z.number().int().min(1).max(15).optional(),
    otpLength: z.number().int().min(4).max(8).optional(),
    melipayamakAuthType: z.enum(["apikey", "password"]).optional(),
    melipayamakApiKey: z.string().max(300).optional(),
    melipayamakUsername: z.string().max(100).optional(),
    melipayamakPassword: z.string().max(100).optional(),
    melipayamakFrom: z.string().max(30).optional(),
    melipayamakPatternCode: z.string().max(30).optional(),
    smsirApiKey: z.string().max(300).optional(),
    smsirFrom: z.string().max(30).optional(),
    smsirTemplateId: z.string().max(30).optional(),
    smsirOtpParam: z.string().max(30).optional(),
  }),
  payment: z.object({
    merchantId: z.string().max(100).optional(),
    sandbox: z.boolean().optional(),
    simulationMode: z.boolean().optional(),
    currency: z.string().max(10).optional(),
    description: z.string().max(200).optional(),
    callbackUrl: z.string().max(300).optional(),
  }),
  general: z.object({
    restaurantName: z.string().max(100).optional(),
    restaurantTagline: z.string().max(200).optional(),
    address: z.string().max(300).optional(),
    phone: z.string().max(20).optional(),
    email: z.string().max(120).optional(),
    workingHours: z.string().max(200).optional(),
    taxPercent: z.number().min(0).max(30).optional(),
    deliveryFee: z.number().int().min(0).max(1_000_000).optional(),
    minOrderAmount: z.number().int().min(0).max(100_000_000).optional(),
    freeDeliveryOver: z.number().int().min(0).max(100_000_000).optional(),
    city: z.string().max(50).optional(),
    instagram: z.string().max(100).optional(),
    telegram: z.string().max(100).optional(),
    aboutText: z.string().max(2000).optional(),
  }),
};

export async function GET(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const group = new URL(req.url).searchParams.get("group") ?? "ai";
    if (!isSettingsGroup(group)) return fail("گروه تنظیمات نامعتبر است");

    const settings = await getSettings(group);
    return ok({ settings: maskSecrets(settings) });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const body = (await req.json().catch(() => ({}))) as { group?: string; values?: Record<string, unknown> };
    const group = body.group ?? "";
    if (!isSettingsGroup(group)) return fail("گروه تنظیمات نامعتبر است");
    if (!body.values || typeof body.values !== "object") return fail("مقادیر تنظیمات ارسال نشده است");

    const parsed = groupSchemas[group].safeParse(body.values);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "داده نامعتبر");

    // ignore masked values (unchanged secrets)
    const values: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed.data as Record<string, unknown>)) {
      if (typeof v === "string" && v.includes("•")) continue; // masked placeholder — keep existing
      values[k] = v;
    }

    await saveSettings(group, values);
    invalidateSettingsCache(group);

    await logAudit(session.admin.username, "SETTINGS_UPDATED", {
      entity: "settings",
      entityId: group,
      detail: { keys: Object.keys(values) },
      ip: getClientIp(req),
    });

    const fresh = await getSettings(group);
    return ok({ settings: maskSecrets(fresh) });
  } catch (e) {
    console.error("settings update error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}
