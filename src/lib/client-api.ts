"use client";

export async function api<T = Record<string, unknown>>(
  url: string,
  options?: { method?: string; body?: unknown; formData?: FormData }
): Promise<T & { success: boolean; error?: string }> {
  try {
    const init: RequestInit = {
      method: options?.method ?? (options?.body || options?.formData ? "POST" : "GET"),
    };
    if (options?.formData) {
      init.body = options.formData;
    } else if (options?.body !== undefined) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(options.body);
    }
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({ success: false, error: "پاسخ نامعتبر از سرور" }));
    return data as T & { success: boolean; error?: string };
  } catch {
    return { success: false, error: "خطا در ارتباط با سرور" } as T & { success: boolean; error?: string };
  }
}

export function fullName(user: { firstName: string | null; lastName: string | null } | null): string {
  if (!user) return "";
  return `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
}
