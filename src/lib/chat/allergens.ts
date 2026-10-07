// Shared allergen-matching helpers (usable from both server chat engine and client UI)
import { normalizePersian } from "@/lib/fa";

/** Generic filler words that should never be treated as an allergen keyword */
const STOP_WORDS = new Set([
  "حساسیت",
  "دارم",
  "ندارم",
  "ممنوع",
  "نباشه",
  "الکی",
  "همه",
  "علت",
  "مثلا",
  "مثلاً",
  "تقریبا",
  "چیز",
  "غذا",
  "غذای",
  "مواد",
  "نگذارید",
  "نگذارید",
  "خواهش",
  "لطفا",
]);

/**
 * Extract allergen keyword phrases from a free-form Persian allergies string.
 * "بادام‌زمینی و گلوتن، لاکتوز" → ["بادام زمینی", "گلوتن", "لاکتوز"]
 * Both full phrases and individual tokens are kept (min 3 chars).
 */
export function extractAllergenPhrases(allergies: string | null | undefined): string[] {
  if (!allergies) return [];
  const norm = normalizePersian(allergies);
  // split by Persian/English list separators and the standalone conjunction «و»
  const parts = norm
    .split(/[،,؛;\n\r()]/g)
    .flatMap((p) => p.split(/\s+و\s+/g))
    .map((p) => p.replace(/^(به|از|برای)\s+/g, "").trim())
    .filter((p) => p.length >= 3);
  // individual tokens too (e.g. "حساسیت به گردو" → "گردو")
  const tokens = parts.flatMap((p) => p.split(/\s+/).filter((t) => t.length >= 3));
  const all = [...parts, ...tokens]
    .map((p) => p.trim())
    .filter((p) => p.length >= 3 && !STOP_WORDS.has(p));
  return [...new Set(all)];
}

/**
 * Match an item's ingredients text against allergen phrases.
 * Matching is ZWNJ/space-insensitive (compact comparison) on normalized text.
 * Returns the matched phrases (display-ready, original casing of the phrase list).
 */
export function matchAllergens(
  ingredients: string | null | undefined,
  phrases: string[]
): string[] {
  if (!ingredients || phrases.length === 0) return [];
  const ing = normalizePersian(ingredients);
  const ingCompact = ing.replace(/\s+/g, "");
  const matched: string[] = [];
  for (const phrase of phrases) {
    const norm = normalizePersian(phrase);
    const compact = norm.replace(/\s+/g, "");
    if (compact.length < 3) continue;
    if (ing.includes(norm) || ingCompact.includes(compact)) {
      matched.push(phrase);
    }
  }
  return matched;
}
