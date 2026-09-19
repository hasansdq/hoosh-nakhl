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
  > نکتهٔ بیلد: مرحلهٔ `docker compose build` (کامپایل Next) به‌طور موقت بیش از اجرای اپ حافظه می‌خواهد؛
  > روی VPS با ۱–۲GB RAM یک‌بار **swap** فعال کنید تا بیلد با OOM قطع نشود (برای اجرا لازم نیست):
  > ```bash
  > fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  > # (بعد از اولین بیلد موفق می‌توانید swapon را در /etc/fstab نگه دارید یا بردارید)
  > ```
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
   httpd -M 2>/dev/null | grep -E 'proxy|wstunnel|headers|rewrite'
   # باید شامل proxy_module, proxy_http_module, proxy_wstunnel_module,
   # headers_module, rewrite_module باشد
   ```

> **نکته‌های مهم قالب پراکسی (v2 — بازبینی‌شده و اصلاح‌شده):**
> • **WebSocket + long-polling**: socket.io دو نوع ترافیک روی `/api/ws` دارد — ارتقای WebSocket
>   و درخواست‌های polling معمولی. قالب با `RewriteCond %{HTTP:Upgrade}` فقط درخواست‌های ارتقا را به
>   `ws://` می‌فرستد و بقیه را از `http://` — سازگار با «همهٔ» نسخه‌های Apache 2.4 (الگوی قدیمی
>   `ProxyPass ws://` درخواست‌های polling را با خطای ۵۰۰ می‌شكست).
> • **تمدید SSL**: مسیر `/.well-known/acme-challenge` صریحاً از پراکسی مستثنی شده تا تمدید ۹۰روزهٔ
>   Let's Encrypt دایرکت‌ادمین بعد از استقرار کار کند.
> • **`retry=0`**: بعد از هر ری‌استارت/به‌روزرسانی کانتینر، آپاچی بک‌اند را ۶۰ ثانیه «سیاه» نمی‌کند
>   (پیش‌فرض آپاچی ۶۰ ثانیه 502 می‌دهد).
> • قوانین `/api/ws` عمداً **قبل از** قانون کلی `/` آمده‌اند.

### گام ۳ — SSL (Https) با Let's Encrypt

1. در DA → User level → **«SSL Certificates»** برای دامنه، گزینهٔ
   **«Free & automatic certificate from Let's Encrypt»** را انتخاب و فعال کنید.
2. تیک **«Force HTTPS»** را در همان صفحه بزنید (به https:443 ریدایرکت می‌شود — 443 را خود DA سرو می‌کند).
3. همان قالب پراکسی برای vhost سایتِ 443 هم اعمال می‌شود (cust_httpd روی هر دو) و هدر
   `X-Forwarded-Proto` به‌درستی تنظیم می‌شود.
4. نگران تمدید ۹۰روزه نباشید — مسیر چالش ACME (`/.well-known/acme-challenge`) در قالب از پراکسی
   مستثنی شده و از DocumentRoot دامنه سرو می‌شود.

### چرا X-Forwarded-Proto حیاتی است؟ (آدرس بازگشت پرداخت)

اپ پشت پراکسی، پروتکل واقعی کاربر را فقط از این هدر می‌فهمد. وقتی ست باشد:

- `callback_url` ارسالی به زرین‌پال = `https://دامنه‌شما/api/payment/callback` (نه http حلقهٔ داخلی)
- ریدایرکت‌های بعد از پرداخت (موفق/ناموفق) به `https://دامنه` برمی‌گردند

مقادیر هدر قبل از استفاده اعتبارسنجی می‌شوند (کاراکترها/طول) — Host آلوده هرگز در URL بازتاب نمی‌شود.

### گام ۴ — تست نهایی

```bash
curl -I https://order.example.ir/                       # 200 + هدرهای امنیتی
curl https://order.example.ir/api/health                # {"ok":true,"db":"up"}
# WebSocket پشت پراکسی (باید 101 بماند — نه 500/502):
curl -si -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  "https://order.example.ir/api/ws/?EIO=4&transport=websocket" | head -1
# long-polling (fallback) هم باید 200 بدهد:
curl -si "https://order.example.ir/api/ws/?EIO=4&transport=polling" | head -1
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
- 🔒 هر snapshot یک کپی کامل دیتابیس است (اطلاعات کاربران، هش رمزها، کلیدهای API) —
  پوشهٔ `./backups/` روی هاست با دسترسی `700` و فایل‌ها با `600` ساخته می‌شوند؛
  فقط root (اجراکنندهٔ کرون) باید به آن‌ها دسترسی داشته باشد.
- برای نگهداری خارج از سرور، پوشهٔ `./backups/` را به فضای ابری/سرور فایل کپی کنید
  (فضای مقصد هم باید خصوصی/رمزنگاری‌شده باشد).
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
| `ZARINPAL_FORCE_REAL` | `1` | **پیش‌فرض فعال** — کیل‌سوییچ سه‌لایهٔ دروازهٔ آزمایشی پرداخت (بخش ۹) |

تنظیمات عملیاتی (مرچنت‌آیدی زرین‌پال، کلید OpenRouter، پنل پیامک و …) **از پنل مدیریت** و
داخل دیتابیس ذخیره می‌شوند — نه در .env — و در ری‌دیپلوی‌ها حفظ می‌شوند.

### تنظیم پنل پیامک ملی‌پیامک — ارسال کد یکبارمصرف با «پترن خدماتی»

روش رسمی و توصیه‌شدهٔ ملی‌پیامک برای پیامک‌های یکبارمصرف (OTP)، ارسال از **خط خدماتی
اشتراکی با پترن** است — مزیتش این است که حتی به شماره‌های «لیست سیاه مخابرات» هم تحویل
می‌شود و معمولاً از ارسال ساده ارزان‌تر است. مراحل:

1. **ساخت پترن در پنل ملی‌پیامک:** وارد پنل شوید → بخش «پترن / متون پیش‌فرض» →
   پترن جدید با **دقیقاً یک متغیر** بسازید (مثال متن: `کد تأیید شما: %0`) → بعد از
   تأیید مدیر سامانه، «کد پترن» (عددی مثل `254`) به شما داده می‌شود.
2. **ساخت کلید API:** <span dir="ltr">console.melipayamak.com</span> → بخش «کلیدها» →
   افزودن کلید.
3. **در پنل مدیریت سایت** (`/nk-admin` → تنظیمات → تب «پیامک»):
   - پنل پیامکی = **ملی‌پیامک**، نوع احراز هویت = **کلید API**
   - کلید API و شماره فرستنده (From = خط اختصاصی پنل) را وارد کنید
   - **«کد پترن خدماتی»** را پر کنید (مثلاً `254`)
   - دکمهٔ **«تست اتصال»** را بزنید — بدون ارسال پیامک، کلید و اعتبار پنل را از
     `console.melipayamak.com/api/receive/credit` استعلام می‌کند و نتیجه را نشان می‌دهد
   - «حالت توسعه (Dev Mode)» را **خاموش** کنید و ذخیره بزنید

> اگر «کد پترن» را خالی بگذارید، ارسال به‌صورت پیامک ساده از خط اختصاصی انجام می‌شود
> (نیازمند اعتبار کافی و عدم لیست‌سیاه بودن گیرنده). اگر پر شود، ارسال OTP از
> `console.melipayamak.com/api/send/shared/{کلید}` با همان `bodyId` شما انجام می‌شود.
> کلید/رمز پنل هرگز داخل ریپو یا .env نیست — فقط داخل دیتابیس (جدول Setting) ذخیره می‌شود.

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
- **هیچ credential در ریپو نیست:** seed ها بدون ادمین/رمز (ساخت ادمین فقط از env در اولین بوت)؛
  تاریخچهٔ git هم از credential ها پاک‌سازی شده است.

### پرداخت آزمایشی — کیل‌سوییچ سه‌لایه (ZARINPAL_FORCE_REAL=1، پیش‌فرض)

۱. **مسیر `/api/payment/simulate` کاملاً مرده است** — برای «همه» ۴۰۳ برمی‌گرداند (حتی با سشن معتبر).
۲. **زرین‌پال هیچ‌وقت authority آزمایشی (SIM-…) نمی‌سازد** — بدون مرچنت‌آیدیِ تنظیم‌شده در پنل،
   سفارش با خطای واضح متوقف می‌شود؛ هرگز «پرداخت موفق» جعلی رخ نمی‌دهد.
۳. **دفاع در عمق:** حتی اگر کیل‌سوییچ خاموش باشد، مسیر آزمایشی فقط تراکنش‌های صادرشده توسط خودِ
   شبیه‌ساز (پیشوند SIM-) را تکمیل می‌کند — سفارشِ درگاه واقعی هرگز از آن مسیر PAID نمی‌شود
   (قبلاً این سوراخ امنیتی وجود داشت و بسته شد؛ تلاش‌ها در AuditLog ثبت می‌شوند).

هشدارهای بلند بوت: اگر ZARINPAL_FORCE_REAL ≠ 1 یا NAKHL_SEED_PROFILE=dev باشد، در لاگ
کانتینر هشدار واضح چاپ می‌شود (برای استیجینگ خصوصی مجاز، برای پروداکشن ممنوع).

### کانال اعلان — کلید غیرقابل‌حدس

- **بدون کلید پیش‌فرض حدس‌زدنی:** اگر `ADMIN_NOTIFY_KEY` تنظیم نشده/کوتاه باشد، سرور یک کلید
  تصادفیِ «گذرا» می‌سازد — یعنی `/emit` و admin-join به‌جای پذیرش کلید عمومی، کلاً رد می‌شوند
  (fail-closed). در داکر، entrypoint همیشه یک کلید قوی ۵۴ کاراکتری تولید و در `data/secrets.env`
  ذخیره می‌کند (رفع باگ `od` که کلید ۶ کاراکتری «nakhl-» تولید می‌کرد).
- **کانال اعلان با کلید مشترک** (`x-notify-key`) محافظت می‌شود؛ مقادیر هدر اعتبارسنجی می‌شوند.
- **هدرهای امنیتی** (nosniff / SAMEORIGIN / Referrer-Policy / Permissions-Policy) روی همهٔ پاسخ‌ها.
- **محدودیت آپلود:** ۵MB فقط تصویر با فرمت‌های مجاز؛ نام فایل UUID تصادفی (ضد path-traversal).
- **آدرس‌های بازگشت پرداخت** از هدرهای اعتبارسنجی‌شدهٔ `X-Forwarded-Proto/Host` ساخته می‌شوند —
  همیشه https دامنهٔ عمومی، هرگز http حلقهٔ داخلی؛ Host آلوده بازتاب نمی‌شود.

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

**دور اول (docker-1):** بوت تمیز · health/db:up · منوی کامل · ورود ادمین (رمز env و رمز تصادفی) ·
آپلود روی فایل‌سیستم و سرو از `/f/` · بهینه‌سازی تصویر sharp · handshake و ارتقای WebSocket ·
عضویت ادمین با کلید · دریافت broadcast «order:new-paid» · جریان کامل مشتری
(OTP→ثبت‌نام→آدرس→سفارش→پرداخت شبیه‌سازی→اعلان) · خاموشی graceful ·
**ری‌دیپلوی: مهاجرت no-op + حفظ ادمین/تنظیمات/CMS بدون تک‌تکرار** · فاجعه+restore کامل ·
و بیلد سبز Cloudflare با باندل سبک‌تر از قبل.

**دور دوم (docker-2 — سخت‌سازی امنیتی، ۸۱ آزمون سبز):**

- **Phase A (پوسچر پروداکشن، کیل‌سوییچ روشن) — ۲۷/۲۷:** صفحهٔ اصلی/منو/فاوآیکون · هدرهای امنیتی ·
  health db:up · ورود ادمین + رد رمز غلط · OTP (هش در DB، بدون لو رفتن devCode در پروداکشن) ·
  **لایهٔ ۱ کیل‌سوییچ: simulate → 403** · **آدرس بازگشت پرداخت: ریدایرکت‌های https/http عمومی از
  X-Forwarded-Proto/Host، رد Host آلوده، fallback مستقیم** · WebSocket end-to-end + رد کلید غلط ·
  آپلود ادمین (مسیر بازیابی‌شده) + سرو `/f/` + رکورد Upload
- **Phase B (پوسچر استیجینگ) — ۱۶/۱۶:** devCode قابل مشاهده با EXPOSE_DEV_CODE · ورود کاربر موجود ·
  ثبت‌نام · سبد → checkout شبیه‌سازی (SIM-) · **گارد ۲: authority درگاه واقعی → 403 + ثبت AuditLog
  (سوراخ «پرداخت رایگان سفارش واقعی» بسته شد)** · broadcast order:new-paid به ادمین
- **Phase C — ۱۴/۱۴:** snapshot آنلاین VACUUM INTO · **فاجعه: حذف کامل DB → restore کامل
  (منو/CMS/ادمین/آپلودها)** · بوت مجدد healthy · ورود ادمین بعد از restore
- **Phase D — ۲۴/۲۴:** آمار/سفارش‌ها/تنظیمات (گروه‌به‌گروه)/CMS/آپلودها/AuditLog ادمین ·
  401 بدون سشن برای همهٔ مسیرهای ادمین · جریان کاربر کامل (آواتار با رفع باگ avatarUrl ·
  پروفایل · پیگیری سفارش PAID)
- **هاردنینگ کلید notify:** بدون کلید → کلید تصادفی گذرا (fail-closed) · کلید قدیمی قابل حدس → 401 ·
  **رفع باگ od که کلید ۶ کاراکتری می‌ساخت** · کلید persisted ۵۴ کاراکتری کار می‌کند
- رگرسیون: typecheck صفر · lint صفر · cf:build سبز (کارگر سبک) · سه ری‌دیپلوی متوالی sim بدون از دست رفتن داده
- مرورگر (dev سندباکس): صفحهٔ اصلی RTL کامل · افزودن به سبد (۱۸۵,۰۰۰ تومان) · پنل ادمین همهٔ تب‌ها ·
  **«اتصال زنده فعال است» از طریق گیت‌وی (رفع ناسازگاری کلید dev که realtime را خاموش‌قطع کرده بود)** ·
  صفر خطای کنسول
