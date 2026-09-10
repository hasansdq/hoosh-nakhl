# 🌴 راهنمای کامل دیپلوی «رستوران نخل» روی Cloudflare Workers

این پروژه به‌صورت کامل برای **Cloudflare Workers** آماده شده است:

| زیرساخت | سرویس Cloudflare | Binding |
|---|---|---|
| اجرای Next.js 16 | **Workers** (از طریق OpenNext رسمی: `@opennextjs/cloudflare`) | — |
| دیتابیس (جایگزین SQLite) | **D1** | `DB` |
| فایل‌های آپلودشده (جایگزین public/uploads) | **R2** | `R2` |
| اعلان‌های real-time (جایگزین Socket.IO :3003) | **Durable Objects + WebSocket** | `REALTIME` |
| کش ISR/صفحه | R2 (اختیاری) | `NEXT_INC_CACHE_R2_BUCKET` |

---

## ۱) پیش‌نیازها

- یک اکانت Cloudflare (پلن **Free** کافی است).
- نصب [Bun](https://bun.sh) و [Node.js ≥ 20](https://nodejs.org).
- لاگین: `bunx wrangler login` (مرورگر باز می‌شود).

## ۲) ساخت منابع در اکانت Cloudflare (یک‌بار)

```bash
# دیتابیس D1 — شناسه (database_id) چاپ‌شده را کپی کنید
bunx wrangler d1 create nakhl-db

# باکت R2 برای آپلودها (آواتار/تصاویر غذا)
bunx wrangler r2 bucket create nakhl-uploads

# باکت R2 برای کش OpenNext (اختیاری اما توصیه‌شده)
bunx wrangler r2 bucket create nakhl-restaurant-opennext-cache
```

سپس در `wrangler.jsonc` مقدار `REPLACE_WITH_YOUR_D1_DATABASE_ID` را با database_id واقعی جایگزین کنید.

> ⚠️ دو باکت اختیاری: اگر پلن R2 ندارید (R2 نیاز به فعال‌سازی پرداخت دارد)، می‌توانید در `wrangler.jsonc` بخش‌های `NEXT_INC_CACHE_R2_BUCKET` و `WORKER_SELF_REFERENCE` را حذف و در `open-next.config.ts` خط `incrementalCache` را بردارید. اپ بدون ISR هم کامل کار می‌کند (همه‌چیز dynamic رندر می‌شود).

## ۳) تنظیم Secrets و متغیرها

```bash
# کلید مشترک کانال اعلان real-time (اجباری — یک رشته تصادفی دلخواه)
bunx wrangler secret put ADMIN_NOTIFY_KEY

# (اختیاری، توصیه‌شده) اجبار درگاه واقعی زرین‌پال حتی اگر تنظیمات پنل هنوز sandbox باشد
bunx wrangler secret put ZARINPAL_FORCE_REAL        # مقدار: 1
```

- `vars` غیرحساس در `wrangler.jsonc` قرار دارند (الان: مقدار پیش‌فرض ADMIN_NOTIFY_KEY).
- **هیچ‌وقت** `NAKHL_EXPOSE_DEV_CODE` را در پروداکشن تنظیم نکنید (نمایش کد OTP در پاسخ API).
- کلیدهای OpenRouter / پیامک (ملی‌پیامک یا SMS.IR) / زرین‌پال از **پنل مدیریت** (بعد از اولین لاگین) داخل دیتابیس ذخیره می‌شوند — نیازی به env ندارند.

## ۴) مهاجرت دیتابیس + Seed (پروداکشن)

```bash
# ساخت اسکیمای D1 (از migrations/0001_init.sql)
bun run db:migrate:remote

# داده‌های اولیه: منو (۷ دسته / ۳۰ آیتم)، ۳ کوپن، ادمین، تنظیمات production-safe
bun run db:seed:remote
```

- ادمین پیش‌فرض: `rayantech` / `Hasan78484@` — **بلافاصله بعد از اولین ورود از پنل عوض کنید.**
- برای رمز دلخواه: `ADMIN_PASSWORD='رمز جدید' bun run db:seed:generate` سپس فقط فایل `seed/seed-core.sql` را با `--remote` اجرا کنید.
- تنظیمات production-safe یعنی: AI=OpenRouter (بدون کلید تا از پنل وارد کنید)، پیامک=none، پرداخت=درگاه واقعی (بدون شبیه‌سازی).

## ۵) بیلد و دیپلوی

```bash
bun run deploy        # = cf:build (بیلد OpenNext) + opennextjs-cloudflare deploy
```

بعد از دیپلوی:

- آدرس پیش‌فرض workers.dev: `https://nakhl-restaurant.<subdomain>.workers.dev`
- **دامنه سفارشی**: داشبورد Cloudflare → Workers → nakhl-restaurant → Settings → Domains & Routes → Add Custom Domain (TLS خودکار).
- برای تست لوکال قبل از دیپلوی: `bun run cf:dev` (اجرای کامل روی workerd محلی + `.dev.vars`).

## ۶) بعد از دیپلوی (چک‌لیست)

1. `/api/health` → `{"ok":true,"db":"up"}` چک کنید.
2. ورود به `/nk-admin` با ادمین seed شده → تغییر رمز.
3. پنل → تنظیمات پیامک (ملی‌پیامک یا SMS.IR) → فعال‌سازی.
4. پنل → تنظیمات پرداخت → merchantId واقعی زرین‌پال + `callbackUrl` با دامنه نهایی:
   `https://<your-domain>/api/payment/callback`
5. پنل → تنظیمات هوش مصنوعی → کلید OpenRouter.
6. یک سفارش آزمایشی ثبت کنید و اعلان real-time در پنل ادمین را ببینید (WebSocket سبز شود).
7. PWA: در هر دیپلوی جدید نسخه `VERSION` در `public/sw.js` را bump کنید (`nakhl-v3` → …).

## ۷) دستورات روزمره

| کار | دستور |
|---|---|
| بیلد Workers | `bun run cf:build` |
| اجرای محلی بیلد | `bun run cf:dev` |
| دیپلوی | `bun run deploy` |
| لاگ زنده پروداکشن | `bun run cf:tail` |
| مهاجرت D1 (remote) | `bun run db:migrate:remote` |
| Seed مجدد (idempotent) | `bun run db:seed:remote` |
| تغییر اسکیمای Prisma | `prisma/schema.prisma` را ویرایش → `bun run db:generate` → SQL جدید: `bunx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > migrations/000X_change.sql` → `bun run db:migrate:remote` |

## ۸) معماری و نکات فنی

- **مسیر کد dev/prod یکی است**: `next dev` محلی با Miniflare واقعی (D1/R2/DO با state در `.wrangler/state`) اجرا می‌شود — همان bindingهایی که پروداکشن استفاده می‌کند.
- **Real-time**: مرورگر به `wss://<domain>/api/ws` وصل می‌شود؛ آپگرید WebSocket در `src/worker.js` (پیش از ورود به Next.js) به Durable Object `NakhlRealtime` روتر می‌شود. اتاق‌ها: `admins` (با کلید ADMIN_NOTIFY_KEY) و `customer:NK-XXXX`. emit سمت سرور از `src/lib/notify.ts` مستقیماً از طریق binding انجام می‌شود.
- **Prisma**: کلاینت بدون engine (کامپایلر WASM) در `src/generated/prisma` + آداپتور `@prisma/adapter-d1`. این پوشه **در git نیست** — با `prisma generate` ساخته می‌شود و به‌صورت خودکار در `postinstall` (بعد از `bun install`) و ابتدای `cf:build` اجرا می‌گردد؛ بنابراین Cloudflare Builds نیازی به کار اضافه ندارد. فایل باینری بی‌استفاده `*.so.node` که generator کنار کلاینت می‌گذارد به‌صورت خودکار حذف می‌شود.
- **اسکیمای Prisma**: `url` دیتاسورس فقط placeholder متنی برای CLI است (`file:./cli-only.db` — هرگز ساخته نمی‌شود)؛ هیچ `DATABASE_URL` لازم نیست و runtime همیشه از binding D1 استفاده می‌کند.
- **آپلود**: ذخیره در R2 با کلید `food|avatar|general-<uuid>.<ext>` و سرو از مسیر `/f/<key>` (immutable cache).
- **تصاویر**: بهینه‌سازی `_next/image` روی Cloudflare غیرفعال است (سرویس Cloudflare Images پولی است) — تصاویر اصلی سرو می‌شوند. برای فعال‌سازی، binding `IMAGES` اضافه کرده و `images.unoptimized` را در `next.config.ts` بردارید.
- **هشدار بی‌ضرر بیلد**: در خروجی `cf:build` پیام «NakhlRealtime … not exported» مربوط به worker داخلی OpenNext است؛ دیپلوی واقعی از `src/worker.js` استفاده می‌کند که کلاس را export کرده (تست E2E تأیید شده).
- **توسعه لوکال**: `bun run dev` (پورت 3000) از D1/R2 محلی Miniflare استفاده می‌کند؛ برای state تازه: `rm -rf .wrangler` سپس `bun run db:migrate:local && bun run db:seed:local`.

## ۹) عیب‌یابی

| مشکل | راه‌حل |
|---|---|
| 500 در APIها | `bun run cf:tail` را باز کنید؛ معمولاً یعنی D1 مهاجرت نشده (بخش ۴) |
| ورود ادمین کار نمی‌کند | seed اجرا شده؟ (`db:seed:remote`)؛ هش رمز scrypt است و روی Workers تأیید شده |
| WebSocket وصل نمی‌شود | `ADMIN_NOTIFY_KEY` در secret با مقدار پنل یکسان است؟ (`wrangler secret list`) |
| پرداخت واقعی نمی‌شود | پنل → پرداخت: sandbox/simulation خاموش + ZARINPAL_FORCE_REAL=1 |
| OTP ارسال نمی‌شود | پنل → پیامک: provider و کلیدها؛ در تست لوکال devCode نمایش داده می‌شود |

## ۱۰) استقرار در z-space (پیش‌نمایش z.ai) — معماری یکسان با Cloudflare

خط‌لوله‌ی استقرار z-space (اسکریپت‌های `.zscripts/` که پلتفرم اجرا می‌کند) پس از مهاجرت Cloudflare بازنویسی شده و **دقیقاً همان worker پروداکشن را روی workerd اجرا می‌کند**:

- **بیلد** (`.zscripts/build.sh`): `bun install` → `bun run cf:build` (همان بیلد OpenNext) → بسته‌بندی: `.open-next/` (worker خودکفا + assets) + `src/worker.js` + `src/do/realtime.ts` (ورودی DO/WS) + `wrangler.jsonc` + `migrations/` + `seed/` + `runtime/` (ابزار wrangler/workerd که در زمان بیلد نصب و داخل بسته می‌آید — سردِ‌استارتِ کانتینر بدون شبکه) + `start.sh` + `Caddyfile` → یک فایل `tar.gz` (~۷۹MB).
- **اجرا** (`.zscripts/start.sh`): `wrangler d1 migrations apply DB --local` + seed (idempotent) → `wrangler dev` روی `127.0.0.1:3000` (workerd + D1/R2/DO محلی؛ حلقه‌ی supervisor برای خودترمیمی) → Caddy گیت‌وی `:81 → :3000` (پیش‌زمینه).
- **Realtime**: همان Durable Object `NakhlRealtime` — بدون mini-service/Socket.IO.
- **تنظیمات z**: seed با `settings-dev.sql` (OTP توسعه قابل مشاهده → قابل تست کامل؛ معادل رفتار قبلی که دیتابیس dev سندباکس را بسته‌بندی می‌کرد). پروداکشن واقعی Cloudflare → بخش ۶ همین سند.
- تست‌شده به‌صورت E2E روی بسته‌ی خروجی: صفحه‌ها/API/D1/favicon/assets/R2-route/ارتقای WebSocket ‏۱۰۱ به DO — همه سبز.

> نکته: دیگر `output: "standalone"` وجود ندارد؛ گارد قدیمی build.sh که به‌دلیل کامنتِ فایلِ next.config به‌اشتباه fail می‌شد، با حذف آن مسیر و بازنویسی کامل بیلد رفع شد.
