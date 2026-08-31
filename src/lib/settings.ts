import { db } from "@/lib/db";

// ============ Settings type definitions ============

export interface AISettings {
  provider: "zai" | "openai" | "openrouter";
  apiKey: string;
  model: string;
  baseUrl: string; // optional custom base URL override
  temperature: number;
  maxTokens: number;
  topP: number;
  presencePenalty: number;
  frequencyPenalty: number;
  systemPromptExtra: string; // additional instructions from admin
  maxHistoryMessages: number; // chat context window
  requestTimeout: number; // seconds
  friendlyTone: boolean;
  suggestBestSellers: boolean;
  allowSmallTalk: boolean;
  maxItemsPerOrder: number;
}

export interface SMSSettings {
  provider: "none" | "melipayamak" | "smsir";
  devMode: boolean; // show OTP in UI (for testing)
  otpTemplate: string; // message template with {code} placeholder
  otpTtlMinutes: number;
  otpLength: number;
  // Melipayamak
  melipayamakAuthType: "apikey" | "password";
  melipayamakApiKey: string;
  melipayamakUsername: string;
  melipayamakPassword: string;
  melipayamakFrom: string;
  // SMS.IR
  smsirApiKey: string;
  smsirFrom: string;
  smsirTemplateId: string;
  smsirOtpParam: string;
}

export interface PaymentSettings {
  merchantId: string;
  sandbox: boolean;
  simulationMode: boolean; // simulate gateway locally (no real merchant needed)
  currency: string;
  description: string;
  callbackUrl: string;
}

export interface GeneralSettings {
  restaurantName: string;
  restaurantTagline: string;
  address: string;
  phone: string;
  email: string;
  workingHours: string;
  taxPercent: number; // VAT percent (10)
  deliveryFee: number; // Toman
  minOrderAmount: number;
  freeDeliveryOver: number; // 0 = disabled
  city: string;
  instagram: string;
  telegram: string;
  aboutText: string;
}

// ============ Defaults ============

export const DEFAULT_AI_SETTINGS: AISettings = {
  provider: "zai",
  apiKey: "",
  model: "",
  baseUrl: "",
  temperature: 0.7,
  maxTokens: 900,
  topP: 0.95,
  presencePenalty: 0,
  frequencyPenalty: 0,
  systemPromptExtra: "",
  maxHistoryMessages: 14,
  requestTimeout: 60,
  friendlyTone: true,
  suggestBestSellers: true,
  allowSmallTalk: true,
  maxItemsPerOrder: 30,
};

export const DEFAULT_SMS_SETTINGS: SMSSettings = {
  provider: "none",
  devMode: true,
  otpTemplate: "رستوران نخل\nکد تأیید شما: {code}\nاین کد تا {ttl} دقیقه معتبر است.",
  otpTtlMinutes: 3,
  otpLength: 5,
  melipayamakAuthType: "apikey",
  melipayamakApiKey: "",
  melipayamakUsername: "",
  melipayamakPassword: "",
  melipayamakFrom: "",
  smsirApiKey: "",
  smsirFrom: "",
  smsirTemplateId: "",
  smsirOtpParam: "CODE",
};

export const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = {
  merchantId: "",
  sandbox: true,
  simulationMode: true,
  currency: "IRR",
  description: "پرداخت سفارش رستوران نخل",
  callbackUrl: "",
};

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
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
  aboutText:
    "رستوران نخل رفسنجان با بیش از یک دهه تجربه در ارائه غذاهای اصیل ایرانی، اکنون با هوش مصنوعی «هوش نخل» تجربه سفارش‌دهی جدیدی را به شما هدیه می‌دهد. مثل حضوری سفارش بدهید، اما از هر جای شهر!",
};

// ============ Manager ============

type SettingsGroup = "ai" | "sms" | "payment" | "general";

interface SettingsCache {
  data: Record<string, unknown>;
  loadedAt: number;
}

const CACHE_TTL = 15_000; // 15s — settings change rarely
const globalCache = globalThis as unknown as {
  __nakhlSettings?: Map<string, SettingsCache>;
};
const cache: Map<string, SettingsCache> = (globalCache.__nakhlSettings ??= new Map());

function deepMerge<T>(base: T, override: Partial<T> | null | undefined): T {
  if (!override) return base;
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    if (v !== undefined) result[k] = v;
  }
  return result as T;
}

export async function getSettings<T>(group: SettingsGroup): Promise<T> {
  const defaults =
    group === "ai"
      ? DEFAULT_AI_SETTINGS
      : group === "sms"
        ? DEFAULT_SMS_SETTINGS
        : group === "payment"
          ? DEFAULT_PAYMENT_SETTINGS
          : DEFAULT_GENERAL_SETTINGS;

  const cached = cache.get(group);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL) {
    return deepMerge(defaults, cached.data as Partial<T>);
  }

  try {
    const row = await db.setting.findUnique({ where: { key: group } });
    const parsed = row ? (JSON.parse(row.value) as Record<string, unknown>) : {};
    cache.set(group, { data: parsed, loadedAt: Date.now() });
    return deepMerge(defaults, parsed as Partial<T>);
  } catch {
    return defaults as T;
  }
}

export async function saveSettings(
  group: SettingsGroup,
  values: Record<string, unknown>
): Promise<void> {
  const current = await db.setting.findUnique({ where: { key: group } });
  const merged = current
    ? { ...JSON.parse(current.value), ...values }
    : values;
  await db.setting.upsert({
    where: { key: group },
    update: { value: JSON.stringify(merged), group },
    create: { key: group, value: JSON.stringify(merged), group },
  });
  cache.delete(group);
}

export function invalidateSettingsCache(group?: SettingsGroup): void {
  if (group) cache.delete(group);
  else cache.clear();
}

/** Mask sensitive settings before sending to client */
export function maskSecrets<T extends Record<string, unknown>>(obj: T): T {
  const masked = { ...obj };
  const secretKeys = [
    "apiKey",
    "password",
    "melipayamakPassword",
    "melipayamakApiKey",
    "smsirApiKey",
    "merchantId",
  ];
  for (const key of secretKeys) {
    if (key in masked && typeof masked[key] === "string" && masked[key]) {
      const val = masked[key] as string;
      (masked as Record<string, unknown>)[key] =
        val.length > 6 ? `${val.slice(0, 3)}${"•".repeat(Math.min(val.length - 6, 12))}${val.slice(-3)}` : "••••••";
    }
  }
  return masked;
}

