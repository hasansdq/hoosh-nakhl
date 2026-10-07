# 🌴 رستوران نخل — راهنمای کامل بیلد و دیپلوی پروداکشن

> ⚠️ **این سند قدیمی و منسوخ است** (معماری web+notify+caddy که دیگر وجود ندارد).
> راهنمای معتبر استقرار داکر روی VPS با دایرکت‌ادمین: **`DOCKER-DEPLOY-FA.md`**

این سند، استقرار کامل سایت «رستوران نخل» را روی **سرور شخصی/VPS خارج از z.ai** توضیح می‌دهد.
همه‌چیز تست شده و روی همین نسخهٔ کد تأیید شده است (بیلد standalone + seed + smoke test کامل).

---

## 📐 معماری پروداکشن

```
                        اینترنت
                           │
                    ┌──────▼──────┐
                    │    Caddy     │  ← TLS خودکار (Let's Encrypt) روی پورت ۸۰/۴۴۳
                    │  :80 / :443  │
                    └──────┬──────┘
              ┌────────────┴────────────┐
              │                         │
        بقیهٔ مسیرها                /rt/*
              │                         │
     ┌────────▼────────┐      ┌─────────▼─────────┐
     │  nakhl-web      │      │  nakhl-notify      │
     │  Next.js 16     │      │  socket.io         │
     │  standalone     │      │  (پوش نوتیفیکیشن   │
     │  node :3000     │      │   زندهٔ ادمین/مشتری) │
     └────────┬────────┘      │  bun :3003         │
              │               └───────────────────┘
     ┌────────▼────────┐
     │   SQLite +      │  volume های دائمی:
     │  uploads volume │  • db_data → /app/db
     └─────────────────┘  • uploads_data → /app/public/uploads
```

- **web** — سرور Next.js خروجی `standalone` (فقط Node.js؛ Bun فقط برای نصب و باندل استفاده می‌شود)
- **notify** — سرویس socket.io برای نوتیفیکیشن زندهٔ سفارش‌ها (همان که در حال توسعه زیر bun اجرا می‌شود)
- **Caddy** — پروکسی معکوس + SSL رایگان خودکار + مسیریابی `/rt` برای WebSocket

---

## ✅ پیش‌نیازها

| مورد | توضیح |
|---|---|
| سرور | VPS لینوکس با حداقل **۱ گیگ رم** (۲ گیگ توصیه) — Ubuntu 22.04/24.04 یا Debian 12 |
| دامنه | یک دامنه/ساب‌دامنه (مثل `nakhl.example.com`) با **رکورد A** به IP سرور |
| پورت‌ها | ۸۰ و ۴۴۳ باز در فایروال (`ufw allow 80,443/tcp`) |
| زرین‌پال | [مرچنت‌آی‌دی واقعی](https://www.zarinpal.com) (برای پرداخت آنلاین) |
| پیامک | اکانت [ملی‌پیامک](https://melipayamak.com) یا [SMS.IR](https://sms.ir) با اعتبار (برای OTP) |
| هوش مصنوعی | کلید [OpenRouter](https://openrouter.ai) یا OpenAI (برای «هوش نخل») |

> ⚠️ سرویس «zai» هوش مصنوعی فقط داخل سندباکس z.ai کار می‌کند؛ در پروداکشن از **OpenRouter** استفاده کنید (م.supports both — تنظیم از پنل مدیریت).

---

## 🚀 مسیر A — استقرار با Docker Compose (توصیه‌شده)

### گام ۱: نصب Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker
# (اختیاری برای اجرای بدون sudo):
sudo usermod -aG docker $USER && newgrp docker
```

### گام ۲: دریافت سورس و تنظیم متغیرها

```bash
git clone <آدرس-ریپوی-شما> nakhl && cd nakhl
cp .env.example .env
nano .env        # یا vim
```

فایل `.env` را این‌طور پر کنید:

```bash
DOMAIN=nakhl.example.com                      # ← دامنهٔ شما (بدون https://)
DATABASE_URL=file:/app/db/custom.db           # (در Docker همین بماند)
AUTH_SECRET=<خروجی دستور زیر>                 # ← openssl rand -hex 32
ADMIN_NOTIFY_KEY=<خروجی دستور زیر>            # ← openssl rand -hex 24
ADMIN_USERNAME=rayantech                      # نام کاربری ادمین اولیه
ADMIN_PASSWORD=<یک-رمز-قوی>                   # رمز ادمین اولیه (فقط هنگام seed اول)
ZARINPAL_FORCE_REAL=1                         # پرداخت فقط از درگاه واقعی
NAKHL_NOTIFY_URL=http://notify:3003/emit      # (ثابت — داخل Docker)
NEXT_PUBLIC_SOCKET_PATH=/rt                   # (ثابت — باید با Caddyfile یکی باشد)
```

> 💡 تولید رمز تصادفی: `openssl rand -hex 32`

### گام ۳: اجرا 🎉

```bash
docker compose up -d --build
```

اولین بیلد چند دقیقه طول می‌کشد. سپس وضعیت را چک کنید:

```bash
docker compose ps                 # هر سه سرویس باید Up/healthy باشند
curl https://nakhl.example.com/api/health
# {"ok":true,"service":"nakhl-web","db":"up",...}
```

**همین!** سایت روی `https://nakhl.example.com` بالا است — SSL به‌صورت خودکار صادر شده.
اولین boot به‌طور خودکار: ساخت دیتابیس + seed منو (۷ دسته/۳۰ آیتم) + ساخت ادمین.

### 🧪 تست اولین ورود

1. `https://nakhl.example.com/nk-admin` → ورود با `ADMIN_USERNAME`/`ADMIN_PASSWORD`
2. **فوراً رمز ادمین را از پنل عوض کنید** (تنظیمات → تغییر رمز)
3. تنظیمات را کامل کنید (بخش پایین: «تنظیمات داخل پنل مدیریت»)

### تست محلی بدون دامنه (روی سیستم خودتان)

```bash
DOMAIN=http://localhost:8080 docker compose up -d --build
# → http://localhost:8080 (HTTP ساده، بدون SSL)
```

---

## 🖥 مسیر B — VPS بدون Docker (systemd)

مناسب اگر Docker نمی‌خواهید. پیش‌نیاز: نصب `node 22+`، `bun`، `caddy`.

```bash
# 1) نصب Bun
curl -fsSL https://bun.sh/install | bash

# 2) سورس و وابستگی‌ها
sudo mkdir -p /opt/nakhl && sudo chown $USER /opt/nakhl
git clone <آدرس-ریپو> /opt/nakhl && cd /opt/nakhl
bun install

# 3) دیتابیس + seed (اولین بار)
cp .env.example .env && nano .env       # مقادیر پروداکشن (مسیرها absolute!)
bun run db:push
NODE_ENV=production bun run db:seed     # منو + ادمین + تنظیمات امن

# 4) بیلد پروداکشن
bun run build                            # خروجی: .next/standalone

# 5) سرویس‌های systemd
sudo cp deploy/systemd/nakhl-web.service    /etc/systemd/system/
sudo cp deploy/systemd/nakhl-notify.service /etc/systemd/system/
# ⚠️ داخل هر دو فایل: WorkingDirectory، AUTH_SECRET و ADMIN_NOTIFY_KEY را تنظیم کنید
sudo systemctl daemon-reload
sudo systemctl enable --now nakhl-notify nakhl-web

# 6) Caddy به‌عنوان پروکسی معکوس
sudo cp deploy/caddy/Caddyfile.vps /etc/caddy/Caddyfile   # دامنه را عوض کنید
sudo systemctl reload caddy
```

جایگزین PM2: فایل `deploy/pm2/ecosystem.config.cjs` آماده است (`pm2 start deploy/pm2/ecosystem.config.cjs`).

---

## ⚙️ تنظیمات داخل پنل مدیریت (بعد از استقرار)

وارد `/nk-admin` شوید و در بخش «تنظیمات»:

| بخش | تنظیم | مقدار پروداکشن |
|---|---|---|
| **پیامک** | سرویس‌دهنده | ملی‌پیامک یا SMS.IR + کلید API |
| | **حالت توسعه (نمایش OTP)** | ❌ خاموش (seed پروداکشن خودش خاموش می‌کند) |
| **پرداخت** | مرچنت‌آی‌دی زرین‌پال | کد ۳۶ کاراکتری واقعی |
| | حالت شبیه‌سازی / سندباکس | ❌ هر دو خاموش |
| **هوش مصنوعی** | Provider | `OpenRouter` + کلید API |
| | مدل | مثل `openai/gpt-4o-mini` |
| **عمومی** | تلفن/آدرس/ساعات کاری | اطلاعات واقعی رستوران |

> 🔒 **حفاظت دوجدasti:** حتی اگر تنظیمات را جا خالی بگذارید:
> - `ZARINPAL_FORCE_REAL=1` (در compose) شبیه‌سازی پرداخت را کلاً غیرفعال می‌کند
> - `NODE_ENV=production` نمایش کد OTP در پاسخ API را غیرفعال می‌کند

---

## 🔐 چک‌لیست امنیتی (قبل از شروع کار واقعی)

- [ ] رمز ادمین از پنل عوض شده (پیش‌فرض seed قوی ولی باید یکتا باشد)
- [ ] `AUTH_SECRET` تصادفی و طولانی است
- [ ] `ADMIN_NOTIFY_KEY` تصادفی است و بین web/notify یکی است
- [ ] `ZARINPAL_FORCE_REAL=1` در `.env`
- [ ] «حالت توسعهٔ پیامک» و «شبیه‌سازی پرداخت» در پنل خاموش‌اند
- [ ] کاربر تستی/سفارش‌های تستی ندارید (seed تمیز است؛ اگر دیتابیس سندباکس را کپی کردید پاکشان کنید)
- [ ] فایروال: فقط 80/443 باز است (۳۰۰۰ و ۳۰۰۳ هرگز مستقیم expose نشوند)
- [ ] SSH با کلید و بدون root-login

---

## 💾 بکاپ و بازیابی

### بکاپ روزانه (cron روی هاست)

```bash
# crontab -e  (هر روز ساعت ۴ بامداد):
0 4 * * * docker exec nakhl-web-1 sh -c 'sqlite3 /app/db/custom.db ".backup /app/db/backup.db"' \
  && docker run --rm -v nakhl_db_data:/data -v /home/backups:/bk alpine \
     tar czf /bk/nakhl-db-$(date +\%F).tar.gz -C /data . \
  && docker run --rm -v nakhl_uploads_data:/data -v /home/backups:/bk alpine \
     tar czf /bk/nakhl-uploads-$(date +\%F).tar.gz -C /data .
```

> اگر `sqlite3` داخل کانتینر نبود، از `cp` با توقف کوتاه استفاده کنید
> (`docker compose stop web` → `cp` → `docker compose start web`) — SQLite تک‌فایلی است.

### بازیابی

```bash
docker compose stop web
docker run --rm -v nakhl_db_data:/data -v /home/backups:/bk alpine \
  sh -c "rm -f /data/custom.db* && tar xzf /bk/nakhl-db-2025-01-01.tar.gz -C /data"
docker compose start web
```

---

## 🔄 به‌روزرسانی نسخه

```bash
cd nakhl
git pull
docker compose up -d --build        # دیتابیس و تصاویر در volume ها سالم می‌مانند
```

> ⚠️ بعد از هر دیپلوی، نسخهٔ Service Worker را در `public/sw.js` بالاتر ببرید
> (`const VERSION = "nakhl-v2"` → `nakhl-v3`) تا کلاینت‌های قدیمی کش تازه بگیرند.

لاگ‌ها: `docker compose logs -f web` / `logs -f notify` / `logs -f caddy`

---

## 🩺 عیب‌یابی رایج

| نشانه | علت احتمالی | راه‌حل |
|---|---|---|
| Caddy گواهی نمی‌گیرد | DNS هنوز تنظیم نشده / پورت ۸۰ بسته | `dig nakhl.example.com` + `ufw allow 80,443` |
| `db is down` در health | volume خراب/مسیر غلط | `docker compose logs web`؛ DATABASE_URL=file:/app/db/custom.db |
| نوتیف زنده کار نمی‌کند | مسیر `/rt` ناهماهنگ | NEXT_PUBLIC_SOCKET_PATH=/rt (build arg) باید با Caddyfile یکی باشد؛ تست: `curl -s https://domain/rt/?EIO=4\&transport=polling` باید JSON با `sid` بدهد |
| پرداخت به شبیه‌سازی می‌رود | تنظیم پنل/مرچنت خالی | مرچنت‌آی‌دی را در پنل وارد کنید؛ ZARINPAL_FORCE_REAL=1 (خطا دادن بهتر از پرداخت جعلی است) |
| OTP نمی‌رسد | اعتبار پیامک/کلید | پنل → تنظیمات → پیامک → «تست اتصال» |
| خطای CORS/socket در کنسول | اتصال مستقیم به :3003 | هرگز پورت 3003 را expose نکنید؛ کلاینت باید از /rt (هم‌origin) وصل شود |
| OOM هنگام بیلد روی VPS ضعیف | رم کم | swap اضافه کنید: `fallocate -l 2G /swapfile && mkswap /swapfile && swapon /swapfile` |

---

## 📚 ساختار فایل‌های استقرار

```
├── Dockerfile                      # ایمیج چندمرحله‌ای web (node:22-slim + bun فقط برای build)
├── docker-compose.yml              # web + notify + caddy
├── Caddyfile.prod                  # پروکسی معکوس + SSL خودکار + مسیر /rt
├── .dockerignore                   # کانتکست بیلد تمیز
├── docker/entrypoint.sh            # اولین boot: ساخت دیتابیس + seed خودکار
├── .env.example                    # نمونهٔ متغیرهای محیطی (فارسی + توضیحی)
├── prisma/seed.ts + seed-data.json # seeder تمیز (۷ دسته، ۳۰ آیتم، ۳ کوپن)
├── deploy/pm2/ecosystem.config.cjs # گزینهٔ PM2 (VPS بدون Docker)
├── deploy/systemd/*.service        # یونیت‌های systemd (web + notify)
└── deploy/caddy/Caddyfile.vps      # Caddy برای VPS بدون Docker
```

---

## 🧾 جدول کامل متغیرهای محیطی

| متغیر | کجا خوانده می‌شود | پیش‌فرض | توضیح |
|---|---|---|---|
| `DOMAIN` | caddy | — | دامنهٔ سایت؛ برای تست محلی `http://localhost:8080` |
| `DATABASE_URL` | runtime | `file:/app/db/custom.db` | مسیر SQLite — **مطلق** باشد |
| `AUTH_SECRET` | runtime | ⚠️ ضعیف | امضای session ها — حتماً قوی و تصادفی |
| `ADMIN_NOTIFY_KEY` | web+notify | ⚠️ ضعیف | کلید مشترک احراز نوتیفیکیشن |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | فقط seed اول | rayantech | ادمین اولیه — بعد از ورود رمز را عوض کنید |
| `ZARINPAL_FORCE_REAL` | runtime | — | `1` = غیرفعال‌سازی قطعی درگاه شبیه‌سازی |
| `NAKHL_NOTIFY_URL` | runtime (web) | `http://localhost:3003/emit` | در Docker: `http://notify:3003/emit` |
| `NEXT_PUBLIC_SOCKET_PATH` | **build** | سندباکس: gateway | در Docker: `/rt` — باید با Caddyfile یکی باشد |
| `NAKHL_SUPERVISE_DEV` | notify | خودکار | `0` در پروداکشن (supervisor مخصوص سندباکس) |
| `NAKHL_EXPOSE_DEV_CODE` | runtime | خاموش | `1` = نمایش OTP در API برای تست موقت — خطرناک |
| `PORT` / `HOSTNAME` | runtime | 3000 / 0.0.0.0 | پورت و آدرس سرور standalone |

---

## ✨ چه چیزی تست و تأیید شده است؟

روی همین کد، در محیط ایزوله و با دیتابیس تازه:

- ✔ بیلد کامل `next build` (خروجی standalone) بدون خطا
- ✔ باندل seed به CJS با تنظیمات امن پروداکشن (devMode/شبیه‌سازی خاموش)
- ✔ اولین boot: `prisma db push` + seed → ۷ دسته / ۳۰ آیتم / ۳ کوپن / ادمین / تنظیمات امن
- ✔ سرور standalone با Node: `/api/health` 200، صفحهٔ اصلی 200 (رندر فارسی)، `/api/menu` 200
- ✔ استاتیک‌ها: تصاویر غذا، `/uploads`، `/_next/static`، `manifest.json`، `sw.js` — همگی 200
- ✔ هدرهای امنیتی (X-Frame-Options، nosniff، Referrer-Policy، Permissions-Policy)
- ✔ مسیر `/rt` داخل باندل کلاینت درج شده (`NEXT_PUBLIC_SOCKET_PATH`)
- ✔ 404 صحیح؛ سرویس notify زیر bun (همان الگوی سندباکس)

---

*آخرین به‌روزرسانی: مطابق کد موجود در ریپو — برای سؤالات فنی، بخش عیب‌یابی و worklog.md را ببینید.*
