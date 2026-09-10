# 🐳 استقرار رستوران نخل روی VPS با Docker (کنار دایرکت‌ادمین)

راهنمای کامل و گام‌به‌گام استقرار پروداکشن روی سرور مجازی که **دایرکت‌ادمین و آپاچی** روی آن نصب است
(پورت‌های ۸۰ و ۴۴۳ در اختیار دایرکت‌ادمین هستند و این استک **هرگز** آن‌ها را تصاحب نمی‌کند).

---

## ۱) معماری در یک نگاه

```
┌──────────────────────────────────────────── VPS (با DirectAdmin) ───────────────────────────────┐
│                                                                                                  │
│   کاربر اینترنت ──https:443──▶ آپاچیِ دایرکت‌ادمین (vhost دامنهٔ شما)                              │
│                                  │  ProxyPass  (فایل docker/directadmin/nakhl-proxy.conf)       │
│                                  ▼                                                               │
│                       127.0.0.1:8080  (فقط لوکال — از اینترنت غیرقابل‌دسترسی)                    │
│                                  │                                                              │
│                    ┌─────────────▼──────────────┐                                               │
│                    │  Docker Container «nakhl»  │  یک پروسهٔ Node.js:                            │
│                    │  • سایت Next.js standalone │  • آپلودها ← volume                           │
│                    │  • socket.io روی /api/ws   │  • دیتابیس SQLite (WAL) ← volume             │
│                    │  • POST /emit (realtime)   │  • بک‌اپ‌ها ← volume                           │
│                    └─────────────┬──────────────┘                                               │
│                                  │                                                              │
│                    Volume با نام «nakhl-data» (پایدار — در ری‌دیپلوی حذف نمی‌شود)                 │
│                    /app/data/nakhl.db  ·  /app/data/uploads/  ·  secrets.env  ·  backups/       │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**نکتهٔ کلیدی معماری:** یک پروسه، سه نقش (وب + کانال real-time + ذخیره‌سازی) — بدون سرویس جانبی.
دیتابیس، فایل‌های آپلودی، کلیدهای امنیتی و بک‌اپ‌ها همه در یک **volume پایدار** زندگی می‌کنند؛
بیلد و ری‌دیپلوی ایمیج به آن‌ها دست نمی‌زند.

### محافظت از داده‌ها (پاسخ مستقیم به نگرانی «حذف دیتابیس در آپدیت»)

| چیز | کجا ذخیره می‌شود | در `docker compose up -d --build` چه می‌شود؟ |
|---|---|---|
| دیتابیس (کاربران، سفارش‌ها، منو، تنظیمات، CMS) | `nakhl-data` volume | **دست‌نخورده** — مهاجرت‌ها فقط forward و تراکنشی‌اند |
| رمز/هش مدیر و سشن‌ها | داخل دیتابیس (volume) | **دست‌نخورده** — seed فقط وقتی جدول ادمین «خالی» باشد عمل می‌کند |
| تنظیمات تغییر‌یافته از پنل | جدول Setting (`INSERT OR IGNORE`) | **دست‌نخورده** |
| محتوای ویرایش‌شدهٔ CMS | جدول SiteContent | **دست‌نخورده** |
| تصاویر آپلودی | `data/uploads/` روی volume | **دست‌نخورده** |
| کلید کانال اعلان (`ADMIN_NOTIFY_KEY`) | `data/secrets.env` (تولید یک‌باره در اولین بوت) | **ثابت می‌ماند** |

تنها دستورهای خطرناک (که **هرگز** اجرا نکنید): `docker compose down -v` و `docker volume rm`.

---

## ۲) پیش‌نیازها

- VPS با دسترسی root (Debian/Ubuntu/CentOS — فرقی ندارد) که **دایرکت‌ادمین** روی آن نصب و فعال است.
- حداقل منابع: ۱GB RAM + ۲GB دیسک آزاد (اپ سبک است؛ SQLite + Next.js standalone).
- دسترسی به پنل دایرکت‌ادمین (سطح Admin برای Custom HTTPD) یا SSH با دسترسی ویرایش فایل‌های DA.
- یک دامنه یا ساب‌دامنه (مثلاً `order.example.ir`) که به IP سرور اشاره می‌کند.

## ۳) نصب Docker (اگر ندارید)

```bash
# روش رسمی (Debian/Ubuntu):
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
docker compose version   # باید v2 نمایش داده شود
```

> اگر دانلود از get.docker.com در سرور ایران مشکل داشت، داکر را از مخزن توزیع خود نصب کنید
> (`apt install docker.io docker-compose-v2`) یا از آینهٔ داخلی استفاده کنید.

## ۴) دریافت کد پروژه روی سرور

```bash
# مثال با گیت (یا فایل پروژه را با scp آپلود کنید):
cd /opt
git clone <آدرس-ریپو> nakhl
cd nakhl
```

## ۵) استقرار اولیه — سه دستور

```bash
cp docker/env.example .env    # ① فایل تنظیمات را بسازید
nano .env                     # ② NAKHL_PORT / ADMIN_PASSWORD / TZ را مرور کنید
bash docker/deploy.sh         # ③ بیلد + اجرا + انتظار برای healthy
```

`deploy.sh` پیش‌نیازها را چک می‌کند، ایمیج را می‌سازد (چند دقیقه — لایه‌ها کش می‌شوند)،
کانتینر را بالا می‌آورد، منتظر سلامت می‌ماند (اولین بوت: مهاجرت دیتابیس + سید + ساخت ادمین)
و در پایان راهنمای ورود را نشان می‌دهد.

### رمز مدیر — دو حالت

- **اگر `ADMIN_PASSWORD` در .env گذاشته باشید:** همان رمز فقط در اولین بوت برای ساخت ادمین استفاده می‌شود (هش scrypt در دیتابیس ذخیره می‌شود؛ خود رمز هرجا log نمی‌شود).
- **اگر خالی باشد:** رمز تصادفی قوی تولید و در فایل `data/initial-admin-credentials.txt` داخل volume نوشته می‌شود:
  ```bash
  docker compose exec app cat /app/data/initial-admin-credentials.txt
  ```

ورود: `https://YOUR-DOMAIN/nk-admin` — بعد از اولین ورود، از پنل، رمز را عوض کنید.

### تست سلامت قبل از اتصال دامنه

```bash
curl http://127.0.0.1:8080/api/health     # → {"ok":true,...,"db":"up"}
docker compose ps                          # STATUS باید healthy باشد
docker compose logs -f app                 # مشاهدهٔ لاگ زنده (Ctrl+C برای خروج)
```

## ۶) اتصال دامنه از دایرکت‌ادمین (پراکسی آپاچی)

استک داکر فقط روی `127.0.0.1:8080` (قابل‌تغییر با `NAKHL_PORT` در .env) گوش می‌دهد.
آپاچیِ دایرکت‌ادمین ترافیک دامنه را به آن پراکسی می‌کند:

### گام ۱ — ساخت دامنه در DirectAdmin

در پنل DA (سطح Admin یا Reseller → «Add New Domain» / User → «Domain Setup») دامنهٔ موردنظر را
ایجاد کنید. DocumentRoot هرچه باشد مهم نیست (آپاچی همهٔ درخواست‌ها را پراکسی می‌کند).

### گام ۲ — درج قالب پراکسی در vhost

1. وارد پنل دایرکت‌ادمین به‌عنوان **admin** شوید.
2. منوی **«Custom HTTPD Configurations»** را باز کنید.
3. دامنهٔ خود را از لیست انتخاب کنید.
4. محتوای فایل **`docker/directadmin/nakhl-proxy.conf`** را در قسمت کاستوم (textarea) درج و ذخیره کنید.
   - معادل دستیِ همان کار (اگر به فایل‌سیستم دسترسی دارید):
     ```bash
     nano /usr/local/directadmin/data/users/<USER>/domains/<DOMAIN>.cust_httpd
     # محتوای nakhl-proxy.conf را بچسبانید؛ سپس:
     cd /usr/local/directadmin/custombuild && ./build rewrite_confs
     ```
5. بررسی ماژول‌های لازم (در بیلد استاندارد CustomBuild فعال‌اند):
   ```bash
   httpd -M 2>/dev/null | grep -E 'proxy|wstunnel|headers'
   # باید شامل proxy_module, proxy_http_module, proxy_wstunnel_module, headers_module باشد
   ```

> قالب شامل قوانین جداگانه برای **`/api/ws` (WebSocket)** است که **باید قبل از قانون کلی `/`** بیاید
> (در فایل رعایت شده). این همان کانال اعلان لحظه‌ای سفارش‌ها به پنل مدیریت است.

### گام ۳ — SSL (Https) با Let's Encrypt

1. در DA → User level → **«SSL Certificates»** برای دامنه، گزینهٔ
   **«Free & automatic certificate from Let's Encrypt»** را انتخاب و فعال کنید.
2. تیک **«Force HTTPS»** را در همان صفحه بزنید (به https:443 ریدایرکت می‌شود — 443 را خود DA سرو می‌کند).
3. همان قالب پراکسی برای vhost سایتِ 443 هم اعمال می‌شود (cust_httpd روی هر دو) و هدر
   `X-Forwarded-Proto` به‌درستی تنظیم می‌شود.

### گام ۴ — تست نهایی

```bash
curl -I https://order.example.ir/                       # 200 + هدرهای امنیتی
curl https://order.example.ir/api/health                # {"ok":true,"db":"up"}
```

در مرورگر: صفحهٔ اصلی، ورود/OTP، افزودن به سبد، **پنل مدیریت → سفارش‌ها** — اعلان لحظه‌ای
«سفارش جدید» باید بدون refresh ظاهر شود (نشانهٔ سالم بودن WebSocket پشت پراکسی).

---

## ۷) عملیات روزمره

### به‌روزرسانی (بدون از دست رفتن حتی یک رکورد)

```bash
cd /opt/nakhl
git pull                      # یا فایل‌های جدید را جایگزین کنید
bash docker/update.sh         # بک‌اپ خودکار → بیلد → جایگزینی کانتینر → healthcheck
```

`update.sh` قبل از هر کاری snapshot از دیتابیس می‌گیرد؛ اگر مهاجرت جدیدی در `migrations/`
باشه فقط در جهت جلو و داخل تراکنش اعمال می‌شود؛ تنظیمات/مدیر/CMS همه دست‌نخورده می‌مانند.

### بک‌اپ

```bash
bash docker/backup.sh         # snapshot سازگار داخل volume + کپی در ./backups/ روی هاست
```

کرون (هر شب ۳:۳۰):
```cron
30 3 * * *  cd /opt/nakhl && bash docker/backup.sh >> backups/backup.log 2>&1
```

- snapshot ها با `VACUUM INTO` ساخته می‌شوند (سازگار، بدون توقف سرویس) و به‌صورت خودکار
  نگهداری می‌شوند (پیش‌فرض ۱۴ عدد — با `NAKHL_BACKUP_KEEP` در .env قابل تغییر).
- برای نگهداری خارج از سرور، پوشهٔ `./backups/` را به فضای ابری/سرور فایل کپی کنید.
- تصاویر آپلودی روی همان volume هستند؛ برای بک‌اپ کامل، همان پوشه را هم کپی کنید.

### بازیابی

```bash
bash docker/restore.sh backups/nakhl-2025-09-10T12-30-00.db
```

اسکریپت: اپ را stop می‌کند → صحت فایل را می‌سنجد → از دیتابیس فعلی نسخهٔ
`.pre-restore` می‌گیرد → بازیابی می‌کند → اپ را دوباره بالا می‌آورد.

### لاگ‌ها و مانیتورینگ

```bash
docker compose logs -f app              # لاگ زندهٔ اپ (order/realtime/emit)
docker compose logs --tail=200 app      # آخرین ۲۰۰ خط
docker inspect --format '{{.State.Health.Status}}' nakhl-app   # healthy?
docker stats nakhl-app                  # مصرف CPU/RAM لحظه‌ای
```

لاگ‌ها با چرخش خودکار (حداکثر ۳ فایل × ۱۰MB) تنظیم شده‌اند.

### توقف/شروع مجدد

```bash
docker compose restart app      # ری‌استارت تمیز (خاموشی graceful + بوت idempotent)
docker compose stop app         # توقف (volume دست‌نخورده)
docker compose start app        # شروع مجدد
docker compose down             # حذف کانتینر — ⚠️ هرگز «down -v» نه!
```

---

## ۸) تنظیمات `.env` — مرجع کامل

| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `NAKHL_PORT` | `8080` | پورت میزبان (فقط 127.0.0.1) — اگر عوض کردید، **همین مقدار** در `nakhl-proxy.conf` بگذارید |
| `TZ` | `Asia/Tehran` | منطقهٔ زمانی کانتینر |
| `ADMIN_USERNAME` | `nakhl-admin` | نام کاربری ادمین (فقط اولین بوت) |
| `ADMIN_PASSWORD` | *(خالی)* | خالی = تولید رمز تصادفی + ذخیره در فایل امن داخل volume |
| `ADMIN_NOTIFY_KEY` | *(خالی)* | خالی = تولید یک‌باره و ذخیره در `data/secrets.env` (در ری‌دیپلوی ثابت می‌ماند) |
| `NAKHL_SEED_PROFILE` | `prod` | `prod`=تنظیمات امن (OTP و پرداخت واقعی) · `dev`=فقط برای استیجینگ (کد OTP در پاسخ API پیداست!) |
| `NAKHL_BACKUP_KEEP` | `14` | تعداد snapshot نگه‌داشته‌شده |
| `ZARINPAL_FORCE_REAL` | *(خالی)* | `1` = قفل همیشگی دروازهٔ شبیه‌سازی پرداخت (کیل‌سوییچ امنیتی اختیاری) |

تنظیمات عملیاتی (مرچنت‌آیدی زرین‌پال، کلید OpenRouter، پنل پیامک و …) **از پنل مدیریت** و
داخل دیتابیس ذخیره می‌شوند — نه در .env — و در ری‌دیپلوی‌ها حفظ می‌شوند.

### تغییر پورت بعداً

```bash
nano .env                      # NAKHL_PORT=9090
docker compose up -d           # بازسازی mapping
# و مقدار 8080 را در nakhl-proxy.conf دایرکت‌ادمین به 9090 تغییر دهید
```

---

## ۹) امنیت — چه چیزهایی رعایت شده است

- **اجرا بدون root:** کانتینر با کاربر `node` اجرا می‌شود؛ `cap_drop: ALL` + `no-new-privileges`.
- **شبکه:** پورت اپ فقط روی `127.0.0.1` publish می‌شود — تنها راه ورود، آپاچیِ DA است.
- **رازها هرگز داخل ایمیج نیستند:** `.dockerignore` همهٔ `.env` ها را از context حذف می‌کند؛
  پیکربندی فقط از محیط کانتینر (env_file) می‌آید. کلید تولیدشده در volume (chmod 600) می‌ماند.
- **دیتابیس جدا از ایمیج:** SQLite در volume؛ حتی `docker rm` + بیلد مجدد داده‌ها را حفظ می‌کند.
- **مهاجرت‌های تراکنشی و forward-only:** فایل مهاجرت شکست‌خورده کل بوت را متوقف می‌کند (نه نیمه‌کاره).
- **رمزها با scrypt** هش می‌شوند و فقط هش ذخیره می‌شود (فرمت یکسان با مسیر Cloudflare).
- **کانال اعلان با کلید مشترک** (`x-notify-key`) محافظت می‌شود و `/emit` فقط از داخل کانتینر
  (127.0.0.1) صدا زده می‌شود — از بیرون حتی با کلید، در دسترس نیست.
- **هدرهای امنیتی** (nosniff / SAMEORIGIN / Referrer-Policy / Permissions-Policy) روی همهٔ پاسخ‌ها.
- **محدودیت آپلود:** ۵MB فقط تصویر با فرمت‌های مجاز؛ نام فایل UUID تصادفی (ضد path-traversal).

---

## ۱۰) رفع اشکال

| نشانه | علت محتمل | راه‌حل |
|---|---|---|
| پنل ادمین «سفارش جدید» را لحظه‌ای نشان نمی‌دهد | ماژول `proxy_wstunnel` آپاچی غیرفعال | `httpd -M` را چک کنید؛ در CustomBuild فعالش کنید و `service httpd restart` |
| 502 پشت آپاچی | کانتینر بالا نیست / پورت اشتباه | `docker compose ps` و مطابقت `NAKHL_PORT` با `nakhl-proxy.conf` |
| «فضای ذخیره‌سازی در دسترس نیست» در آپلود | `NAKHL_UPLOADS_DIR` ست نشده | نباید اتفاق بیفتد (entrypoint ست می‌کند)؛ `docker compose exec app printenv NAKHL_UPLOADS_DIR` |
| کانتینر restarting می‌شود | مهاجرت شکست‌خورده | `docker compose logs --tail=100 app` — جدول `[migrate] ✗` دلیل را می‌گوید؛ فایل SQL را اصلاح و `docker compose up -d` دوباره |
| رمز مدیر را فراموش کردم | — | یک ادمین دوم نسازید؛ دیتابیس را restore کنید یا: `docker compose exec app node -e "…"` با هش scrypt جدید (همان الگوی docker/seed.mjs) |
| آپلود فایل بزرگ رد می‌شود | `LimitRequestBody` آپاچی | در `nakhl-proxy.conf` بزرگ‌تر کنید (پیش‌فرض ۶MB) |
| ساعت‌ها عقب‌اند | TZ | `TZ=Asia/Tehran` در .env + `docker compose up -d` |
| بوت اول خیلی طول کشید | عادی است | مهاجرت + سید اولین بار انجام می‌شود؛ healthcheck تا ۶۰s فرصت دارد |

---

## ۱۱) مرجع فنی (برای توسعه‌دهندگان)

### دو مسیر دیپلوی، یک کد

| | **Docker / VPS (این سند)** | **Cloudflare Workers** (سند `CLOUDFLARE-DEPLOY-FA.md`) |
|---|---|---|
| بیلد | `NAKHL_DOCKER_BUILD=1 next build` → `.next/standalone` | `bun run cf:build` → `.open-next/worker.js` |
| رانتایم | Node 22 (ایمیج) | workerd |
| دیتابیس | SQLite (libsql) در volume — `NAKHL_SQLITE_PATH` | D1 binding |
| آپلود | فایل‌سیستم volume — `NAKHL_UPLOADS_DIR` (`/f/<key>` یکسان) | R2 bucket (`/f/<key>` یکسان) |
| Real-time | socket.io در-پروسس روی `/api/ws` + `POST /emit` | Durable Object NakhlRealtime |
| انتخاب بک‌اند | `src/lib/db.ts` و `src/lib/uploads/index.ts` به‌صورت رانتایم بین دو بک‌اند تصمیم می‌گیرند | (همان فایل‌ها) |

### چرا `process.getBuiltinModule`؟

سه لایهٔ باندلر (Turbopack → esbuild/OpenNext → wrangler) هر مسیر استاتیک ایمپورت Node را
دنبال می‌کنند یا stub می‌کنند. الگوی `process.getBuiltinModule("module")` + `createRequire`
یک فراخوانی متد ساده است که همهٔ باندلرها از آن عبور می‌دهند؛ در نتیجه کد libsql/z-ai
**از باندل Cloudflare حذف شد** (کارگر از ۳.۴۲MB به **۲.۶۴MB gzip** رسید — زیر سقف پلن رایگان)
و در داکر از node_modules ایمیج لود می‌شود.

### فایل‌های کلیدی

```
Dockerfile                     بیلد چندمرحله‌ای (oven/bun → node:22-slim)
docker-compose.yml             سرویس app + volume nakhl-data + هاردنینگ
docker/entrypoint.sh           بوت: secrets → migrate → seed → exec server
docker/app-server.js           سرور Node: Next + socket.io + /emit + graceful shutdown
docker/migrate.mjs             مهاجرت‌های forward-only تراکنشی (جدول _nakhl_migrations)
docker/seed.mjs                سید idempotent + بوت‌استرپ امن ادمین (scrypt)
docker/backup.mjs              snapshot سازگار VACUUM INTO + retention
docker/restore.mjs             بازیابی با پیش‌چک قفل و صحت + نسخهٔ pre-restore
docker/deploy.sh               استقرار اولیه + انتظار healthy + راهنما
docker/update.sh               به‌روزرسانی امن (بک‌اپ → بیلد → جایگزینی)
docker/backup.sh               بک‌اپ + کپی روی هاست
docker/restore.sh              بازیابی end-to-end
docker/directadmin/nakhl-proxy.conf   قالب vhost آپاچی (WS + پراکسی + هدرها)
docker/env.example             مرجع .env
```

### تست‌های انجام‌شده (سندباکس، شبیه‌سازی کامل Docker)

بیلد standalone با Node اجرا و موارد زیر تأیید شده است: بوت تمیز · health/db:up · منوی کامل ·
ورود ادمین (رمز env و رمز تصادفی) · آپلود روی فایل‌سیستم و سرو از `/f/` · بهینه‌سازی تصویر sharp ·
handshake و ارتقای WebSocket · عضویت ادمین با کلید · دریافت broadcast «order:new-paid» ·
جریان کامل مشتری (OTP→ثبت‌نام→آدرس→سفارش→پرداخت شبیه‌سازی→اعلان) · خاموشی graceful ·
**ری‌دیپلوی: مهاجرت no-op + حفظ ادمین/تنظیمات/CMS بدون تک‌تکرار** · فاجعه+restore کامل ·
و بیلد سبز Cloudflare با باندل سبک‌تر از قبل.
