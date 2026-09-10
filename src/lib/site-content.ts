import "server-only";
import { db } from "@/lib/db";
import {
  CONTENT_DEFS,
  CONTENT_MAX_LENGTH,
  getContentDef,
  defaultContentMap,
  type ContentGroup,
} from "@/lib/content-defs";

/**
 * Server-side site-content manager (CMS).
 *
 * Storage model: the code registry (content-defs.ts) defines every
 * manageable field with its default value; the `SiteContent` table holds
 * optional overrides. Reads merge both layers with a short-lived in-memory
 * cache so the storefront never touches D1 more than once per TTL window.
 */

const CACHE_TTL = 15_000; // 15s — matches the settings manager behaviour

interface ContentCacheEntry {
  overrides: Record<string, string>;
  loadedAt: number;
}

const globalCache = globalThis as unknown as {
  __nakhlSiteContent?: ContentCacheEntry;
};

function getCachedOverrides(): ContentCacheEntry | null {
  const cached = globalCache.__nakhlSiteContent;
  return cached && Date.now() - cached.loadedAt < CACHE_TTL ? cached : null;
}

/** Raw overrides stored in the DB (key → value), only for registry keys. */
async function loadOverrides(): Promise<Record<string, string>> {
  try {
    const rows = await db.siteContent.findMany();
    const overrides: Record<string, string> = {};
    for (const row of rows) {
      if (getContentDef(row.key) && row.value !== "") {
        overrides[row.key] = row.value;
      }
    }
    return overrides;
  } catch {
    // a broken read must never take the storefront down — defaults apply
    return {};
  }
}

/**
 * The effective content map: defaults merged with DB overrides.
 * Values are RAW (not yet placeholder-interpolated — the caller merges in
 * live settings variables, e.g. {city} / {restaurantName}).
 */
export async function getSiteContent(): Promise<Record<string, string>> {
  const cached = getCachedOverrides();
  const overrides = cached ? cached.overrides : await loadOverrides();
  if (!cached) {
    globalCache.__nakhlSiteContent = { overrides, loadedAt: Date.now() };
  }
  return { ...defaultContentMap(), ...overrides };
}

/** Invalidate the in-memory cache (called after admin saves). */
export function invalidateSiteContentCache(): void {
  globalCache.__nakhlSiteContent = undefined;
}

export interface ContentUpdateInput {
  key: string;
  value: string;
}

export interface SaveResult {
  saved: string[]; // keys stored as overrides
  reset: string[]; // keys whose override was removed (back to default)
  errors: { key: string; message: string }[];
}

/**
 * Persist a batch of admin edits.
 *   • value ""            → remove the override (revert to default)
 *   • value == default    → also stored as an override? No — collapsed to a
 *     removal so "reset" and "typed the default back" converge to the same
 *     clean state.
 * Image values must be a site-relative path (`/…`) or an absolute https URL.
 */
export async function saveSiteContent(
  updates: ContentUpdateInput[],
  updatedBy: string,
): Promise<SaveResult> {
  const result: SaveResult = { saved: [], reset: [], errors: [] };
  if (updates.length === 0) return result;
  if (updates.length > 200) {
    result.errors.push({ key: "*", message: "حداکثر ۲۰۰ فیلد در هر ذخیره" });
    return result;
  }

  for (const { key, value } of updates) {
    const def = getContentDef(key);
    if (!def) {
      result.errors.push({ key, message: "کلید ناشناخته است" });
      continue;
    }
    if (typeof value !== "string") {
      result.errors.push({ key, message: "مقدار نامعتبر" });
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length > CONTENT_MAX_LENGTH[def.type]) {
      result.errors.push({
        key,
        message: `حداکثر ${CONTENT_MAX_LENGTH[def.type]} کاراکتر مجاز است`,
      });
      continue;
    }
    if (def.type === "image" && trimmed !== "" && !isValidImageValue(trimmed)) {
      result.errors.push({
        key,
        message: "آدرس تصویر باید با «/» شروع شود یا آدرس https کامل باشد",
      });
      continue;
    }

    if (trimmed === "" || trimmed === def.default.trim()) {
      await db.siteContent.deleteMany({ where: { key } });
      result.reset.push(key);
    } else {
      await db.siteContent.upsert({
        where: { key },
        update: { value: trimmed, updatedBy, updatedAt: new Date() },
        create: { key, value: trimmed, updatedBy },
      });
      result.saved.push(key);
    }
  }

  invalidateSiteContentCache();
  return result;
}

/** Remove overrides — for specific keys or a whole group. */
export async function resetSiteContent(target: {
  keys?: string[];
  group?: ContentGroup;
}): Promise<string[]> {
  const keys = (target.keys ?? []).filter((k) => getContentDef(k));
  let where: object;
  if (keys.length > 0) {
    where = { key: { in: keys } };
  } else if (target.group) {
    const groupKeys = CONTENT_DEFS.filter((d) => d.group === target.group).map(
      (d) => d.key,
    );
    where = { key: { in: groupKeys } };
  } else {
    return [];
  }
  const deleted = await db.siteContent.deleteMany({ where });
  invalidateSiteContentCache();
  return deleted.count > 0 ? (keys.length > 0 ? keys : [target.group as string]) : [];
}

function isValidImageValue(v: string): boolean {
  return v.startsWith("/") || v.startsWith("https://");
}

/**
 * Admin listing: registry defs annotated with current DB state.
 * `value` is the effective value; `customized` marks real overrides.
 */
export async function listSiteContentForAdmin(): Promise<
  {
    key: string;
    group: ContentGroup;
    type: string;
    label: string;
    description: string | null;
    defaultValue: string;
    value: string;
    customized: boolean;
    updatedAt: string | null;
    updatedBy: string | null;
  }[]
> {
  let rows: { key: string; value: string; updatedAt: Date; updatedBy: string | null }[] = [];
  try {
    rows = await db.siteContent.findMany({
      select: { key: true, value: true, updatedAt: true, updatedBy: true },
    });
  } catch {
    rows = [];
  }
  const byKey = new Map(rows.map((r) => [r.key, r]));

  return CONTENT_DEFS.map((def) => {
    const row = byKey.get(def.key);
    const override = row && row.value !== "" ? row.value : null;
    return {
      key: def.key,
      group: def.group,
      type: def.type,
      label: def.label,
      description: def.description ?? null,
      defaultValue: def.default,
      value: override ?? def.default,
      customized: Boolean(override),
      updatedAt: row ? row.updatedAt.toISOString() : null,
      updatedBy: row?.updatedBy ?? null,
    };
  });
}
