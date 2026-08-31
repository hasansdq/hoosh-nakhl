# Task 2-b — WebSocket Real-Time Admin Notifications (notify-service)

## What was built

Replaced/augmented the admin panel's 30s-only polling notifications with real-time socket.io push notifications, keeping polling as an automatic fallback.

## Architecture

```
[payment success / review / status change]                [admin browser]
        Next.js API routes (port 3000)                    AdminPanel.tsx
                │ notifyAdmins() (src/lib/notify.ts)            ▲ io('/?XTransformPort=3003')
                │ POST http://localhost:3003/emit               │ via Caddy gateway
                │ header: x-notify-key                         │ admin-join { key } → room "admins"
                ▼                                              │
        ┌──────────────────────────────────────────────────────┘
        │  mini-services/notify-service  (bun, port 3003, socket.io path "/")
        │  - POST /emit  → io.to("admins").emit(event, payload)
        │  - socket room "admins" joined via shared-secret handshake
        └──────────────────────────────────────────────────────
```

## Files

- `mini-services/notify-service/package.json` — name "notify-service", `dev: bun --hot index.ts`, dependency: socket.io only
- `mini-services/notify-service/index.ts` — socket.io Server (path "/", port 3003 hardcoded, cors *) + POST /emit on the SAME port (request-listener wrapping: our handler answers /emit first, everything else delegates to socket.io's cached request listener — no interference, verified live with curl + socket clients; a second port was NOT needed)
- `src/lib/notify.ts` — server-only `notifyAdmins(event, payload)`; POST to localhost:3003/emit with x-notify-key, 1.5s AbortSignal.timeout, swallows ALL errors
- `src/app/api/admin/notify-key/route.ts` — GET (requireAdmin) → `{ key }` from `process.env.ADMIN_NOTIFY_KEY ?? "nakhl-notify-2024"`
- Wired emits:
  - `src/app/api/payment/simulate/route.ts` → `order:new-paid` {orderNumber,total,userName,type}
  - `src/app/api/payment/callback/route.ts` → `order:new-paid` (added user include)
  - `src/app/api/reviews/route.ts` → `review:new-pending` {id,itemName,userName,rating} (create + edit paths)
  - `src/app/api/admin/orders/[id]/route.ts` → `order:status-changed` {orderNumber,from,to}
- `src/components/admin/AdminPanel.tsx` — socket.io-client (dynamic import inside useEffect, type-only top import), admin-join after fetching key from /api/admin/notify-key, handlers:
  - `order:new-paid` → 🛎 toast + stats refetch + orders-list refresh (CustomEvent `nk:refresh-orders`) when on orders tab
  - `review:new-pending` → gold toast (var(--gold)/var(--gold-foreground)) + stats refetch
  - `order:status-changed` → subtle 🔁 toast (always shown) + refresh
  - "اتصال زنده" green pulsing pill in top bar (gray "قطع" when down, tooltip explains)
  - polling fallback kept: 30s when socket DOWN, relaxed to 60s while connected (livePushRef also suppresses duplicate polling toasts while push is up)
  - reconnection: infinite, 2s delay; manual `s.connect()` on "io server disconnect"; stops on "error: invalid key"; cleanup on unmount/logout
- `src/components/admin/OrdersManager.tsx` — listens for `nk:refresh-orders` CustomEvent (live list refresh)
- main `package.json` — added `socket.io-client@4.8.3`

## Shared secret decision

Chose the **shared-secret static key** approach (per task spec): env var `ADMIN_NOTIFY_KEY`, default `"nakhl-notify-2024"` on BOTH the service and Next.js side (no .env change needed — defaults match). The key is delivered to the logged-in admin browser via the admin-only endpoint and only grants LISTENING (room join); emitting requires the `x-notify-key` header which only the Next.js backend sends (server-to-server on localhost).

## Ports & restart

- notify-service: **3003** (socket.io path "/" + POST /emit, same port). No second port needed.
- Caddy gateway forwards browser `/?XTransformPort=3003` → :3003 (works for websocket + polling, verified).

IMPORTANT — plain `nohup ... &` background processes get killed between bash tool commands in this sandbox. Restart command that survives:

```bash
( setsid bash -c 'cd /home/z/my-project/mini-services/notify-service && exec bun run dev >> notify.log 2>&1' < /dev/null & )
```

Stop: `pkill -f "bun --hot index.ts"` (graceful SIGTERM; clients auto-reconnect).

## Gotcha discovered & fixed (important for future services)

A "graceful" shutdown that calls `io.disconnectSockets()` / `io.close()` sends a protocol-level disconnect packet → clients receive reason **"io server disconnect"** → socket.io clients do NOT auto-reconnect (silent offline forever). Fix: shutdown kills TCP connections instead (`httpServer.closeAllConnections()`), so clients see "transport close" and reconnect automatically. The client additionally self-heals via manual `s.connect()` on "io server disconnect". Verified with a controlled kill/restart test through the gateway: reconnect + re-join + push all work.

## Verification evidence (all done live)

- curl: POST /emit without key → 401; with key → 200 `{"ok":true,...,"recipients":N}`; GET /emit → 405; bad event → 400; engine.io handshake `/?EIO=4&transport=polling` (direct + through Caddy :81) → sid handshake OK
- agent-browser (isolated session, via gateway :81): admin login rayantech → "اتصال زنده" green pill (VLM-confirmed) → service log `admin joined (admins online: 1)` → curl emit `order:new-paid` NK-TEST1 → toast "🛎 سفارش جدید پرداخت‌شده: NK-TEST۱ (۱۲۳,۴۵۶ تومان)" appeared; curl emit `review:new-pending` → gold toast "⭐ نظر جدید در انتظار تأیید: کباب کوبیده" (VLM-confirmed gold)
- REAL end-to-end (no curl): the parallel 2-a agent's live cart checkout payment (NK-HCOP۸۲۳۰, ۵۸۳,۰۰۰ تومان, قاسم محمدی) pushed a toast into my open admin panel in real time; real admin status change (NK-0MJU4327 → PREPARING → DELIVERED) pushed 🔁 toasts; real user review (قاسم، ۵★ کباب برگ) pushed the gold ⭐ toast and updated the gold sidebar badge (نظرات ۱) — then approved (تأییدشده ۸)
- Resilience: killed service → indicator "قطع"; restarted → auto-reconnect + re-join + push received (controlled script test through gateway, recipients count confirmed)
- `bun run lint` exit 0; dev.log clean; no browser console errors

## QA state changes (intentional)

- NK-0MJU4327 progressed PAID → PREPARING → DELIVERED (live status-flow testing)
- قاسم محمدی's ۵★ review on کباب برگ submitted (was PENDING, then approved — now 8 approved reviews)
