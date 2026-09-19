# Task 2-a — Classic Shopping Cart + Public Order Tracking

**Agent:** full-stack-developer (cart+tracking subagent)
**Status:** COMPLETE — lint clean, E2E verified in browser (light/dark/mobile)

## What was built

### Feature 1: Classic Shopping Cart (سبد خرید) — parallel to AI-chat ordering
- **`src/app/api/cart/preview/route.ts`** (POST, login required): validates items against DB (isAvailable, authoritative prices via `db.menuItem`), merges duplicate itemIds, clamps qty 1–30, computes pricing with `computePricing` from `@/lib/chat/engine`, soft-validates coupon via `checkCoupon` (invalid coupon → `{couponValid:false, couponReason}` — request never fails), returns items + pricing + `baseDeliveryFee`/`freeDeliveryOver`/`freeDeliveryEligible`/`minOrderAmount`/`belowMinOrder` + `unavailableItems` list.
- **`src/app/api/cart/checkout/route.ts`** (POST, login required): mirrors `/api/payment/request` structure — `rateLimit("pay:${user.id}", 8, 5min)`, genOrderNumber, strict coupon (invalid → 400 fail), strict address (DELIVERY ≥10 chars), minOrder check, creates Order PENDING_PAYMENT with nested items + statusLog **"سفارش از سبد خرید ثبت شد"**, `zarinpalRequest`, paymentAuthority update, `logAudit` entity "order" with `detail.source: "cart"`. Returns same shape as chat checkout: `{orderId, orderNumber, total, authority, simulated, paymentUrl}`.
- **`src/lib/cart-store.ts`**: Zustand + `persist` (localStorage key `nakhl-cart`, `skipHydration: true`), items/deliveryMethod/address/couponCode + actions addItem/incrementItem/decrementItem/removeItem/removeItems/setDeliveryMethod/setAddress/setCouponCode/clearCart, pure helpers `cartTotalCount`/`cartSubtotal`, and `useCartHydrated()` SSR-safe hook (rehydrate after mount via onFinishHydration).
- **`src/components/site/CartView.tsx`**: full checkout page — item rows (next/image thumb + fallback 🍽, unit price, +/− stepper min-1, Trash remove, line total), delivery method radio-cards (پیک with live fee / بیرونبر free), address textarea + saved-address chips from `/api/profile/addresses`, coupon input (dir=ltr) + اعمال button with ✓/⚠ inline result, sticky invoice sidebar (جمع سفارش/تخفیف+code chip/پیک/مالیات ۱۰٪/مبلغ قابل پرداخت bold) with pulse shimmer while server recomputes (debounced 400ms, stale-request guard via requestKey+reqId), min-order warning + disabled pay, pay button → checkout → simulated gateway via `setPaymentSimulation` or `window.location.href = paymentUrl`, clearCart on success, empty state ("سبد شما خالی است" → مشاهده منو), logged-out state (login prompt card + optimistic local subtotal), unavailable items auto-removed with toast.
- **`src/components/site/HomeView.tsx`**: new local `AddToCartButton` (ShoppingCart icon, emerald flash + "افزوده شد" 1.3s, toast) added to EVERY menu card — specials grid, category-tabs grid, search results grid — alongside the kept "سفارش با هوش نخل" buttons (side-by-side, wrap on small screens; disabled when unavailable).
- **`src/components/site/Header.tsx`**: cart icon button (mobile+desktop) with gold Persian-digit count badge; NAV_ITEMS += سبد خرید (between هوش نخل و سفارش‌های من) and رهگیری سفارش; badge in desktop nav + mobile sheet; navClick auth-gate untouched (cart/track public).
- **`src/components/site/Footer.tsx`**: quick links += سبد خرید، رهگیری سفارش (no auth gate).
- **`src/lib/store.ts`**: `ViewName` += `"cart" | "track"` (nothing else changed). **`src/app/page.tsx`**: renders `<CartView/>` + `<TrackView/>`.

### Feature 2: Public Order Tracking (رهگیری سفارش)
- **`src/app/api/orders/track/route.ts`** (POST, PUBLIC): input `{orderNumber, phone}`; rate-limit `track:${ip}` 15/min via `getClientIp`; normalizes order number (Persian digits→EN, upper) and phone (`normalizePhone`); matches order owner by last-10-digits; 404 "سفارشی با این شماره یافت نشد" on missing/mismatch (no enumeration leak); returns public-safe payload (orderNumber, status+label, paymentStatus, type, totals, items, statusLogs asc) — no userId, no address.
- **`src/components/site/TrackView.tsx`**: public page — dir=ltr inputs (NK-XXXX + mobile), submit → result card with header (status label, order number ltr chip, پیک/بیرونبر + payment badges, Jalali date), vertical timeline stepper (per-status icons/colors: PENDING_PAYMENT amber, PAID emerald, PREPARING teal, READY primary, DELIVERING orange, DELIVERED emerald-filled, CANCELED/PAYMENT_FAILED destructive — NO blue/indigo; current step pulse-ring + "وضعیت فعلی" chip), items badges, totals block, رهگیری مجدد reset; inline not-found error card; SearchX empty state.

## Conventions kept
All Persian UI + Persian digits (`formatToman`/`toPersianDigits`/`formatJalali`), dir=ltr on code inputs, palm-green/gold CSS vars only, shadcn/ui + lucide, responsive 390px→desktop, sticky footer untouched.

## Verification evidence
- `bun run lint` exit 0 (fixed 2 `react-hooks/set-state-in-effect` hits by restructuring: addresses effect + hydration hook)
- tsc: only pre-existing errors elsewhere (Header Sheet `dir` prop etc. exist in git HEAD); my new files clean
- E2E (agent-browser, logged in as قاسم 09131234567):
  1. Home → added کباب کوبیده + کباب برگ → header/nav badges show **۲**
  2. Cart view → پیک (auto "ارسال رایگان 🎉" at ۵۸۰٬۰۰۰ subtotal) → address → coupon **WELCOME50** → invoice: ۵۸۰٬۰۰۰ − ۵۰٬۰۰۰ (code chip) + پیک رایگان + VAT ۵۳٬۰۰۰ = **۵۸۳٬۰۰۰** ✓ math exact
  3. Checkout → simulated ZarinPal → پرداخت موفق → success banner **NK-HCOP8230** → orders list shows it PAID with discount/coupon/address/ref 65595690
  4. DB: order persisted (PAID, couponCode WELCOME50, usedCount→1), statusLog "سفارش از سبد خرید ثبت شد", audit `PAYMENT_REQUESTED {…, source:"cart"}`
  5. Track view: NK-HCOP8230 + 09131234567 → full timeline (2 logs w/ notes, "وضعیت فعلی") + totals; wrong phone → inline "سفارشی با این شماره یافت نشد"
  6. Logged-out: cart viewable, add-to-cart works, login prompt + optimistic invoice; login from cart re-opens flow (AuthModal pre-existing redirect to chat; cart preserved & preview auto-loads after returning to cart)
  7. Invalid coupon: preview shows ⚠ warning inline; checkout rejects 400 (strict)
  8. Dark mode + mobile 390px screenshots (qa/*.png) — VLM review PASS ×3; no horizontal overflow; no console/page errors (only pre-existing DialogContent/hero-LCP warnings)

## Known notes
- AuthModal redirects to chat after login (pre-existing behavior, untouched) — cart survives and is reachable via header button.
- qa/ folder holds verification screenshots + VLM verdicts (not shipped code).
