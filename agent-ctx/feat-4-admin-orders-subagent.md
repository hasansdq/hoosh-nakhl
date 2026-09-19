# Work Record — feat-4 (frontend subagent)

Task ID: feat-4
Agent: full-stack-developer (orders/admin subagent)
Task: OrdersView rating UI + admin coupons/reviews tabs + live badge + CSV export

## Files changed

| File | Change |
|---|---|
| `src/lib/admin-store.ts` | Extended `AdminTab` type with `"coupons"` and `"reviews"` |
| `src/components/site/OrdersView.tsx` | Rating UI (star dialog + per-item badges), discount/coupon rows in totals, extended `OrderRow` |
| `src/components/admin/AdminPanel.tsx` | New tabs (کدهای تخفیف/نظرات), 30s stats polling with live badges, ThemeToggle in top bar, theme-aware loading screen |
| `src/components/admin/CouponsManager.tsx` | NEW — full coupon CRUD (create/edit dialog, activate switch, delete w/ AlertDialog, copy code) |
| `src/components/admin/ReviewsManager.tsx` | NEW — reviews moderation (filter tabs w/ counts, approve/reject/revert/delete) |
| `src/components/admin/UploadsAudit.tsx` | Added 3 CSV export buttons in AuditLogView (orders/users/reviews) + fixed pre-existing `unknown` ReactNode TS error |

## Implementation notes

- **Rating flow (customer)**: DELIVERED orders (`canReview`) render a gold dashed "امتیازدهی به غذاها" box; unrated items with a `menuItemId` get a "ثبت امتیاز" outline button, rated items get a gold badge "امتیاز شما: ★X". Dialog has an interactive 5-star picker (`StarPicker`, hover-fill, radiogroup a11y, gold fill), optional comment textarea (600 chars), submits `POST /api/reviews { menuItemId, rating, comment }`, toasts success "امتیاز شما ثبت شد و پس از تأیید نمایش داده می‌شود 🌟", closes and reloads orders.
- **Discount row**: shows `تخفیف (کد XXX)` with `−amount` in `text-primary` when `discount > 0`; coupon code kept in Latin (no digit conversion).
- **Live polling (AdminPanel)**: `useEffect` (deps `[admin]`) → immediate poll + `setInterval(poll, 30_000)`, cleanup via `clearInterval` + `active` flag. Reads `stats.newPaidOrders` (paid orders last 15 min) & `stats.pendingReviews`. Toast `🛎 سفارش جدید پرداخت‌شده دارید! (X)` fires only when count increases vs previous poll, count > 0, not first poll, and current tab ≠ orders (tab read via `useAdminStore.getState().tab` to avoid resetting the interval).
- **Badges**: "سفارش‌ها" keeps the "زنده" badge + red pulsing count badge when `newPaidOrders > 0`; "نظرات" gets gold count badge when `pendingReviews > 0`.
- **CouponsManager**: create/edit Dialog (code dir=ltr uppercase, readOnly when editing since PATCH has no code field; type Select درصدی/مبلغی; value with %/Toman suffix; maxDiscount only for PERCENT; usageLimit 0=∞ "X از Y / ∞"; perUserLimit; expiresAt date input). PATCH toggles isActive via Switch. DELETE via AlertDialog — API may return `{ deactivated: true, reason }` (has order history) → shown via `toast.info(reason)`. Code chip click → clipboard copy toast. Persian digit inputs parsed with `toEnglishDigits`.
- **ReviewsManager**: filter tabs (در انتظار/تأییدشده/ردشده/همه) with counts from API; cards show next/image thumb (fallback UtensilsCrossed), item name + status badge, author + phone (dir ltr), gold stars, comment, Jalali date. PENDING → تأیید (emerald) / رد (destructive); others → بازگشت به انتظار + delete (AlertDialog).
- **CSV export**: 3 buttons open `/api/admin/export?dataset=orders|users|reviews` via `window.open(url, "_blank")` in a bordered toolbar row at top of گزارش‌ها tab.
- **Lint/TS**: used the accepted async effect pattern (`let active = true; (async () => {...})(); return () => { active = false; }`) everywhere; removed redundant `dir="rtl"` Dialog props and stale string icon placeholders in AdminPanel to clear TS errors in my files. ESLint clean; `tsc --noEmit` clean for all my files.

## E2E verification (agent-browser, real flows)

1. Admin: coupons tab renders seeded coupons (PALM20/WELCOME50/NAKHL10) ✓; created "FEAT4TEST" (۱۵٪, minOrder 100k) via dialog → success toast + listed ✓; deleted it (AlertDialog) ✓.
2. Reviews: filter tabs + counts (تأییدشده ۶) ✓; approved Sara's new pending review → toast + list refresh ✓.
3. Live badge: gold "۱" appeared on نظرات tab when pendingReviews=1, disappeared after approval ✓.
4. Customer: set order NK-EETS9298 → DELIVERED (admin API), logged in as Sara (dev OTP), orders view shows rating box; کباب کوبیده showed "امتیاز شما: ★۵", دوغ محلی had ثبت امتیاز → dialog → 4 stars + comment → submit → success toast → badge now shows ★۴ ✓; review appeared in admin PENDING queue ✓.
5. Discount row verified by temporarily setting discount=80000/couponCode=PALM20 via Prisma (rendered "تخفیف (کد PALM20) −۸۰٫۰۰۰ تومان"), then **reverted to 0/null** to keep data consistent.
6. Theme toggle: toggles `document.documentElement.className` dark ↔ light ✓. CSV endpoints curl-verified (BOM + Persian headers + data).
7. `GET /` and `GET /nk-admin` → 200, no compile errors in dev.log.

## QA state notes for main agent

- Order NK-EETS9298 (سارا محمدی) is now **DELIVERED** (was DELIVERING) — enables rating UI testing.
- Sara's review for دوغ محلی (۴★ + comment) is **APPROVED** — will appear on public menu data.
- Test coupon FEAT4TEST was created and deleted (no leftovers).
