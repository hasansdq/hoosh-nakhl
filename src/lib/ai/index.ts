import "server-only";
import type { AISettings } from "@/lib/settings";

export interface ChatMessageInput {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiCompletionResult {
  success: boolean;
  content: string;
  error?: string;
  provider: string;
  model: string;
}

// ============ Endpoints ============

export const AI_PROVIDERS = {
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    modelsUrl: "https://api.openai.com/v1/models",
    docs: "platform.openai.com",
    defaultModel: "gpt-4o-mini",
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    modelsUrl: "https://openrouter.ai/api/v1/models",
    docs: "openrouter.ai",
    defaultModel: "openai/gpt-4o-mini",
  },
  zai: {
    label: "موتور داخلی نخل (GLM)",
    baseUrl: "",
    modelsUrl: "",
    docs: "",
    defaultModel: "glm-4.7",
  },
} as const;

function providerBaseUrl(settings: AISettings): string {
  if (settings.baseUrl) return settings.baseUrl.replace(/\/$/, "");
  const provider = AI_PROVIDERS[settings.provider];
  return provider.baseUrl;
}

function headersFor(settings: AISettings): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (settings.provider === "openai" && settings.apiKey) {
    h["Authorization"] = `Bearer ${settings.apiKey}`;
  }
  if (settings.provider === "openrouter" && settings.apiKey) {
    h["Authorization"] = `Bearer ${settings.apiKey}`;
    h["HTTP-Referer"] = "https://nakhl-rafsanjan.ir";
    h["X-Title"] = "Nakhl Restaurant AI";
  }
  return h;
}

// ============ Chat completion ============

export async function chatCompletion(
  settings: AISettings,
  messages: ChatMessageInput[],
  opts?: { temperature?: number; maxTokens?: number; jsonMode?: boolean }
): Promise<AiCompletionResult> {
  const model = settings.model || AI_PROVIDERS[settings.provider].defaultModel;

  // ---- Built-in ZAI engine ----
  if (settings.provider === "zai") {
    try {
      // The "zai" engine only exists inside the z.ai sandbox runtime (Node).
      // A computed module specifier keeps bundlers from embedding this
      // Node-only SDK into the Cloudflare Workers bundle — on Workers the
      // import simply fails and we return a provider error below (production
      // databases seed `openrouter` as the default provider, which is pure
      // fetch and works everywhere).
      const moduleId = "z-ai-web-dev-sdk";
      const { default: ZAI } = await import(/* webpackIgnore: true */ moduleId);
      const zai = await ZAI.create();
      const mapped = messages.map((m) => ({
        role: m.role === "assistant" ? ("assistant" as const) : (m.role as "user" | "system"),
        content: m.content,
      }));
      const completion = await zai.chat.completions.create({
        messages: mapped,
        thinking: { type: "disabled" },
      });
      const content = completion.choices[0]?.message?.content ?? "";
      if (!content.trim()) {
        return { success: false, content: "", error: "پاسخ خالی از موتور هوش مصنوعی", provider: "zai", model };
      }
      return { success: true, content, provider: "zai", model };
    } catch (e) {
      return {
        success: false,
        content: "",
        error: e instanceof Error ? `خطای موتور داخلی: ${e.message}` : "خطای موتور داخلی",
        provider: "zai",
        model,
      };
    }
  }

  // ---- OpenAI / OpenRouter ----
  if (!settings.apiKey) {
    return {
      success: false,
      content: "",
      error: "کلید API تنظیم نشده است. از پنل مدیریت → تنظیمات هوش مصنوعی آن را وارد کنید.",
      provider: settings.provider,
      model,
    };
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: opts?.temperature ?? settings.temperature,
    max_tokens: opts?.maxTokens ?? settings.maxTokens,
    top_p: settings.topP,
  };
  if (opts?.jsonMode && settings.provider === "openai") {
    body.response_format = { type: "json_object" };
  }

  try {
    const res = await fetch(`${providerBaseUrl(settings)}/chat/completions`, {
      method: "POST",
      headers: headersFor(settings),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout((settings.requestTimeout || 60) * 1000),
    });
    if (!res.ok) {
      const errBody = (await res.text().catch(() => "")) as string;
      let msg = `خطای ${res.status}`;
      try {
        const j = JSON.parse(errBody) as { error?: { message?: string } };
        if (j.error?.message) msg = j.error.message;
      } catch {
        if (errBody) msg = errBody.slice(0, 300);
      }
      return { success: false, content: "", error: msg, provider: settings.provider, model };
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    if (!content.trim()) {
      return { success: false, content: "", error: "پاسخ خالی از مدل", provider: settings.provider, model };
    }
    return { success: true, content, provider: settings.provider, model };
  } catch (e) {
    return {
      success: false,
      content: "",
      error: e instanceof Error ? `خطا در ارتباط با سرویس هوش مصنوعی: ${e.message}` : "خطای نامشخص",
      provider: settings.provider,
      model,
    };
  }
}

// ============ Models listing & connection test ============

export interface ModelInfo {
  id: string;
  name?: string;
  contextLength?: number;
}

export async function listModels(settings: AISettings): Promise<{ success: boolean; models: ModelInfo[]; error?: string }> {
  if (settings.provider === "zai") {
    return {
      success: true,
      models: [
        { id: "glm-4.7", name: "GLM 4.7 (موتور داخلی)" },
      ],
    };
  }
  if (!settings.apiKey) {
    return { success: false, models: [], error: "کلید API وارد نشده است" };
  }
  try {
    const res = await fetch(`${providerBaseUrl(settings)}/models`, {
      headers: headersFor(settings),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        success: false,
        models: [],
        error: `خطای ${res.status}: ${errText.slice(0, 200) || "عدم دسترسی"}`,
      };
    }
    const data = (await res.json()) as {
      data?: { id: string; name?: string; context_length?: number }[];
    };
    const models = (data.data ?? [])
      .map((m) => ({ id: m.id, name: m.name, contextLength: m.context_length }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return { success: true, models };
  } catch (e) {
    return {
      success: false,
      models: [],
      error: e instanceof Error ? e.message : "خطای نامشخص",
    };
  }
}

export async function testConnection(settings: AISettings): Promise<{
  success: boolean;
  message: string;
  models: ModelInfo[];
}> {
  const modelsRes = await listModels(settings);
  if (!modelsRes.success) {
    return { success: false, message: modelsRes.error || "اتصال ناموفق", models: [] };
  }
  // quick completion test
  const completion = await chatCompletion(settings, [
    { role: "system", content: "You are a test bot. Reply with the single word: OK" },
    { role: "user", content: "test" },
  ], { maxTokens: 10, temperature: 0 });
  if (!completion.success) {
    return { success: false, message: completion.error || "تست تولید متن ناموفق بود", models: modelsRes.models };
  }
  return {
    success: true,
    message: `اتصال برقرار است. مدل: ${settings.model || AI_PROVIDERS[settings.provider].defaultModel} — تست پاسخ: ${completion.content.slice(0, 40)}`,
    models: modelsRes.models,
  };
}

// ============ Robust JSON extraction ============

export function extractJson<T>(raw: string): T | null {
  if (!raw) return null;
  // strip markdown fences
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  // try direct parse
  try {
    return JSON.parse(text) as T;
  } catch {
    // find first { ... last }
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as T;
      } catch {
        // try fixing common issues: trailing commas
        const candidate = text
          .slice(start, end + 1)
          .replace(/,\s*([}\]])/g, "$1");
        try {
          return JSON.parse(candidate) as T;
        } catch {
          return null;
        }
      }
    }
    return null;
  }
}
