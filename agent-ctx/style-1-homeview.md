# Task: style-1 — HomeView overhaul (frontend subagent)

## Task ID: style-1
Agent: full-stack-developer (HomeView subagent)
Files touched (ONLY these two):
- `src/components/site/HomeView.tsx` (full overhaul)
- `src/components/site/StarRating.tsx` (new — reusable star rating display)

## What was implemented
1. **Coupon banner strip** — below hero: fetches `/api/coupons/active` once on mount (lint-safe `active` flag pattern). Gold gradient ticket (rounded-2xl, dashed border + inner dashed divider with punched notches), Ticket icon, title + label, copyable CODE badge (clipboard API + execCommand fallback → sonner toast "کد تخفیف کپی شد!" + Check icon for 2s), "سفارش با کد تخفیف" button → `goChat()`. Animated sheen sweep (`nakhl-sheen` keyframes in local `<style>` tag — globals.css untouched).
2. **Live menu search** — Input with Search icon above tabs in `#menu-preview`. Query normalized via `normalizePersian(toEnglishDigits())`; ≥2 chars → filtered results grid across ALL categories replaces tab content (Tabs stay mounted, hidden — state preserved). Results count badge ("۵ نتیجه برای «کباب»"), category chip on each result card, per-card "سفارش با هوش نخل" button, SearchX empty state + "پرسیدن از هوش نخل" CTA, X clear buttons (inline + header).
3. **StarRating component** — 5 lucide Stars, filled `fill-gold text-gold`, empty `text-muted-foreground/30`, Persian value (۴٫۵) + count (۲) + sr-only text. Used on specials + menu cards; unrated items get subtle dashed "جدید" chip. Live data confirmed rendering (e.g. کباب کوبیده ۴٫۵ (۲)).
4. **Stats band** — primary/gold-tinted rounded-3xl strip, 4 stats (۱۵+ سال تجربه / ۵۰٫۰۰۰+ سفارش موفق / ۴٫۹ رضایت مشتری / ۳۰ دقیقه میانگین ارسال) with Award/ShoppingBag/Star/Timer icons, staggered fade-up, grid-cols-2 → lg:grid-cols-4.
5. **About section** (`id="about"`) — two cols: "داستان نخل 🌴" + 2 paragraphs (Rafsanjan since ۱۳۸۸, Kermani kebabs, هوش نخل) + 3 feature chips (Leaf/ChefHat/HeartHandshake). Visual: hero.png in rotated-on-hover frame + floating "از ۱۳۸۸" badge card (float animation).
6. **FAQ section** (`id="faq"`) — shadcn Accordion (text-right trigger override), 5 Persian Q&As (ordering via AI chat, ZarinPal + ۱۰٪ VAT invoice, delivery cost/time, mid-chat changes, coupon code in chat).
7. **Contact section** (`id="contact"`) — 3 info cards (MapPin address, Phone dir=ltr ۰۳۴-۳۴۳۰۰۰۰۰, Clock hours) + stylized palm-pattern map placeholder card (pulse-ring MapPin, "روی نقشه نمایش" + ExternalLink, links to Google Maps search).
8. **Polish** — hero floating cards now perpetual float (`nakhl-float` / `nakhl-float-slow` keyframes, reduced-motion respected); consistent section headings with gradient underline bar (`h-1 w-12 bg-gradient-to-l from-primary to-gold`); menu cards hover:-translate-y-1; scroll-mt-28 on anchored sections; extracted shared `MenuCard` local component.

## Key conventions
- Local `<style>` tag inside HomeView defines namespaced keyframes (nakhl-float/nakhl-sheen) — globals.css NOT touched.
- Coupon fetch uses the sanctioned lint pattern: `useEffect(() => { let active = true; (async () => {...})(); return () => { active = false; }; }, [])`.
- No blue/indigo anywhere; theme = palm-green primary + date-gold; all classes theme-aware (verified in dark mode).

## Verification done
- `bun run lint` → clean (exit 0).
- `curl /` → HTTP 200; dev.log compile clean.
- agent-browser (isolated `style1` session): all sections present in DOM (about/FAQ/contact/stats/coupon PALM20); search "کباب" → "۵ نتیجه" with cards; gibberish → "نتیجه‌ای یافت نشد" empty state; coupon copy (trusted click) → success toast + Check icon; FAQ accordion opens; "سفارش با کد تخفیف" → auth modal (goChat path). Console clean, no page errors.
- VLM screenshot review (light full-page, dark top + dark contact, mobile 390px top + menu): clean layout, readable gold ticket in dark mode, no overflow/glitches.

## Notes for next agents
- HomeView now imports `StarRating` from `@/components/site/StarRating` — reuse it anywhere ratings display is needed.
- `MenuCard` is a local component inside HomeView.tsx (item + optional catName + optional onOrder) — consider promoting to a shared component if other views need identical cards.
- The coupon endpoint `/api/coupons/active` returns `{ success, coupon: {code,title,type,value,label} | null, activeCount }`.
