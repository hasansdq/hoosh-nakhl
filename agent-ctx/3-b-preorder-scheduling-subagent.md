# Task 3-b — Pre-order scheduling (پیش‌سفارش) subagent record

Task ID: 3-b | Agent: full-stack-developer (scheduling subagent)
Scope: schema field + validation helper + cart slot picker + checkout persistence + customer/track/admin surfaces + minimal chat-API support.

## Files created / edited

| File | Change |
|---|---|
| `prisma/schema.prisma` | `scheduledFor DateTime?` on Order (comment «زمان تحویل پیش‌سفارش»), pushed with `bun run db:push` + `touch next.config.ts` (dev server restart confirmed via "Ready in 1848ms") |
| `src/lib/schedule.ts` | NEW — `validateScheduleSlot()` (45-min lead / 7-day horizon / opening hours 12:00–23:59, Persian reasons), `SCHEDULE_SLOT_TIMES` (24 × 30-min slots 12:00–23:30), `isSlotSelectable()`, `relativeDayLabel()`, `formatScheduleFa()` («فردا، ۱۹:۳۰» / «سه‌شنبه ۱۰ شهریور، ۱۳:۰۰»). Pure & client-safe. |
| `src/lib/fa.ts` | + exported `weekdayName(date)` (reuses private WEEKDAYS) |
| `src/lib/cart-store.ts` | + `scheduleMode: "ASAP"\|"SCHEDULED"` + `scheduledFor: string\|null` (persisted in `nakhl-cart` localStorage), `setScheduleMode` (ASAP clears slot), `setScheduledFor` (implies SCHEDULED), `clearCart` resets both |
| `src/app/api/cart/checkout/route.ts` | accepts optional `scheduledFor` ISO → `validateScheduleSlot` → **400 + Persian reason**; persists on Order.create; first statusLog note = `سفارش از سبد خرید ثبت شد (پیش‌سفارش برای ۱۴۰۵/۰۶/۰۶ - ۱۹:۳۰)` — exact base substring kept intact; audit detail + scheduledFor |
| `src/components/site/CartView.tsx` | New «زمان تحویل سفارش» card under delivery-method radios: two option cards (ارسال همین حالا ⚡ default / زمان‌بندی برای بعد 🗓️ CalendarClock); when SCHEDULED → 8 date chips (امروز/فردا/پس‌فردا/weekday + Jalali day-month, up to +7d) + 24 time-slot chips ۱۲:۰۰–۲۳:۳۰ (grid-cols-4 sm:6, max-h-56 scroll); selected = primary bg, disabled = muted + line-through; slots < now+45min (or > +7d) disabled — `now` refreshed every 60s; day-click clears slot, slot-click sets ISO in store (survives view switches); sticky invoice gold line «زمان تحویل — فردا، ۱۹:۳۰» (both logged-in & guest branches) + amber hint when slot not picked; payDisabled + toast guard when SCHEDULED without slot; checkout body sends `scheduledFor` ISO |
| `src/app/api/orders/track/route.ts` | + `scheduledFor` ISO in public payload |
| `src/components/site/TrackView.tsx` | gold chip «پیش‌سفارش برای: فردا، ۱۹:۳۰» in result header when scheduledFor && status ∉ {DELIVERED, CANCELED} |
| `src/app/api/orders/route.ts` | + `scheduledFor` ISO in customer orders list |
| `src/components/site/OrdersView.tsx` | gold «📅 پیش‌سفارش» badge + Jalali datetime (formatJalali withTime) per order card; also fixed pre-existing TS error in handleReorder (`menuItemId as string`, guaranteed by filter) |
| `src/app/api/admin/orders/route.ts` | + `scheduledFor` ISO in admin list rows (detail GET returns full order incl. field automatically) |
| `src/components/admin/OrdersManager.tsx` | list row: gold «پیش‌سفارش» badge (CalendarClock) + «تحویل فردا، ۱۹:۳۰» suffix; detail dialog: gold box «زمان تحویل پیش‌سفارش: فردا، ۱۹:۳۰ (جمعه ۶ شهریور ۱۴۰۵)». Sorting/filtering untouched. Also removed redundant `dir="rtl"` Dialog prop (pre-existing TS error) |
| `src/app/api/payment/request/route.ts` | (optional chat path, clean minimal) accepts optional `scheduledFor` → validated → persisted; statusLog note suffix same pattern |
| `src/lib/chat/prompts.ts` | one added rule bullet: AI should tell users pre-order scheduling lives in سبد خرید («زمان‌بندی برای بعد», today→7 days, 12:00–23:30). No state-machine change |

Did NOT touch: AdminPanel.tsx, admin-store.ts, api/admin/analytics, AnalyticsView.tsx, HomeView.tsx, api/cart/preview (it does not echo request data; the invoice line is rendered from client store state — documented deviation, nothing needed).

## Verification

- `bun run lint` → exit 0. `tsc --noEmit` → zero errors in all my files.
- Helper unit checks (bun): past/40min → 45-min reason; 11:30 → opening-hours reason; +8d → 7-day reason; +7d 12:00 OK, +7d 23:30 rejected; garbage/null handled; formats «فردا، ۱۹:۳۰» / «سه‌شنبه ۱۰ شهریور، ۱۳:۰۰».
- curl API rejections (logged-in via dev OTP): past → 400 «زمان تحویل باید حداقل ۴۵ دقیقه بعد از اکنون باشد»; 11:30 → 400 «ساعت تحویل باید بین ۱۲ ظهر تا ۱۲ شب باشد»; +8d → 400 «پیش‌سفارش حداکثر تا ۷ روز آینده امکان‌پذیر است»; no-session → 401 «ابتدا وارد شوید» (auth precedes validation).
- E2E (agent-browser, isolated `--session scheduler`, port 81): login 09131234567 dev-OTP → added کباب کوبیده + کباب برگ → سبد → «زمان‌بندی برای بعد» → «فردا» + «۱۹:۳۰» → invoice «زمان تحویل — فردا، ۱۹:۳۰» → بیرونبر → پرداخت (simulated ZarinPal موفق) → order **NK-DLTM6299** (۶۳۸٬۰۰۰ تومان، scheduledFor=2026-08-28T19:30Z).
  - Today slots: ۱۲:۰۰ & ۱۲:۳۰ disabled at 12:12 UTC (now+45min), ۱۳:۰۰+ enabled.
  - «سفارش‌های من»: «📅 پیش‌سفارش ۱۴۰۵/۰۶/۰۶ - ۱۹:۳۰» badge ✓; رهگیری: gold chip «پیش‌سفارش برای: فردا، ۱۹:۳۰» + timeline note «سفارش از سبد خرید ثبت شد (پیش‌سفارش برای ۱۴۰۵/۰۶/۰۶ - ۱۹:۳۰)» ✓; admin سفارش‌ها: badge + «تحویل فردا، ۱۹:۳۰» in row + gold box in detail dialog ✓.
- Screenshots: `qa/schedule-1-picker.png` (picker + invoice line), `qa/schedule-2-order-badge.png` (orders view badge), `qa/schedule-3-admin-detail.png` (admin detail), `qa/schedule-4-today-disabled-slots.png` (disabled today chips).
- dev.log clean (no ⨯ / runtime errors). Dev server restart after db:push confirmed; agent 3-a unaffected.

## QA state notes

- Order NK-DLTM6299 (قاسم محمدی, PICKUP, PAID 638,000) is a **scheduled pre-order for جمعه ۶ شهریور ۱۴۰۵ - ۱۹:۳۰ (2026-08-28T19:30Z)** — useful demo data for the پیش‌سفارش badge.
- Scheduler browser session cart cleared after QA.
