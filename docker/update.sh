#!/usr/bin/env bash
# =============================================================================
# Nakhl Restaurant — به‌روزرسانی با بک‌آپ و تست حفظ سفارش‌ها (Docker / VPS)
# -----------------------------------------------------------------------------
# اجرا از ریشهٔ پروژه:   bash docker/update.sh
#
# ترتیب کارها (هر سه قانون طلایی رعایت می‌شود):
#  ۱. بک‌اپ لحظه‌ای از دیتابیس قبل از هر کاری (VACUUM INTO — سازگار آنلاین)
#  ۲. ساخت ایمیج جدید (volume باقی می‌ماند — down -v هرگز)
#  ۳. تست ارتقا با ایمیج جدید روی دیتابیس آزمایشیِ دارای سفارش (گیت سخت:
#     اگر حتی یک ردیف سفارش/قلم/لاگ در شبیه‌سازی از دست برود، جایگزینی لغو
#     می‌شود) + خروجی JSON داده‌هایی که این ارتقا حذف می‌کند + تأیید مدیر
#  ۴. جایگزینی کانتینر؛ مهاجرت‌ها فقط در جهت جلو اعمال می‌شوند؛ داده/
#     تنظیمات/مدیر موجود حفظ می‌شوند؛ رزروها و زمان تحویل طبق migration 0006 حذف می‌شوند.
#
# نکتهٔ شبکه: Dockerfile عمداً بدون directive «# syntax=…» نوشته شده و بیلد
# برای خودش به docker.io وصل نمی‌شود (ایمیج‌های پایه از کش محلی مصرف می‌شوند).
# اگر شبکه/رجیستری داکر مشکل داشته باشد، همین اسکریپت علت را تشخیص داده و
# راه‌حل فارسی چاپ می‌کند — کانتینر فعلی و داده‌ها دست‌نخورده می‌مانند.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
source docker/progress.sh
BUILD_LOG=""
cleanup() {
  nakhl_stop_timer
  [ -z "${BUILD_LOG}" ] || rm -f "${BUILD_LOG}"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m⚠\033[0m %s\n' "$1"; }

# --- پیش‌پروازش شبکهٔ داکر (سرورهای ایران) ------------------------------------
# فقط «آگاهی‌رسانی» است — چیزی را نشکانیم. اگر رجیستری سالم باشد بیلد حتی با
# این هشدارها ادامه پیدا می‌کند و موفق می‌شود.
net_preflight() {
  # ۱) پروکسی دیمن داکر: اگر پیکربندی شده باشد، یک اتصال آزمایشی ۴ ثانیه‌ای
  #    می‌زنیم. پروکسیِ مرده یعنی هر pull شکست می‌خورد (خطای proxyconnect).
  DAEMON_PROXY="$(docker info 2>/dev/null | awk -F': ' '/^ *(HTTP|HTTPS) Proxy:/{print $2; exit}' | tr -d ' ' || true)"
  if [ -n "${DAEMON_PROXY}" ]; then
    P_ADDR="${DAEMON_PROXY#*://}"; P_ADDR="${P_ADDR%%/*}"
    if timeout 4 bash -c "</dev/tcp/${P_ADDR%:*}/${P_ADDR##*:}" 2>/dev/null; then
      ok "پروکسی دیمن داکر (${DAEMON_PROXY}) پاسخ می‌دهد"
    else
      warn "پروکسی پیکربندی‌شده روی داکر (${DAEMON_PROXY}) پاسخ نمی‌دهد — هر pull از رجیستری شکست می‌خورد"
      warn "راه‌حل: DOCKER-DEPLOY-FA.md §۱۰ → «خطای شبکه هنگام بیلد» (گام ۱)"
    fi
  fi
  # ۲) ایمیج‌های پایه: اگر محلی نباشند و docker.io هم در دسترس نباشد، بیلد
  #    در همان ابتدا می‌شکند — راه‌حل، میرور ابرآروان است.
  MISSING_BASE=""
  for IMG in "oven/bun:1" "node:22-slim"; do
    docker image inspect "${IMG}" >/dev/null 2>&1 || MISSING_BASE="${MISSING_BASE} ${IMG}"
  done
  if [ -n "${MISSING_BASE}" ]; then
    warn "ایمیج‌های پایه به‌صورت محلی موجود نیستند:${MISSING_BASE}"
    warn "اگر docker.io روی این سرور در دسترس نیست، از میرور بکشید و همان نام را بزنید:"
    echo  "        docker pull docker.arvancloud.ir/oven/bun:1 && docker tag docker.arvancloud.ir/oven/bun:1 oven/bun:1"
    echo  "        docker pull docker.arvancloud.ir/library/node:22-slim && docker tag docker.arvancloud.ir/library/node:22-slim node:22-slim"
  fi
}

bold "═══ رستوران نخل — به‌روزرسانی ═══"


# ۱) بک‌اپ پیش از به‌روزرسانی
bold "گام ۱/۴ — بک‌اپ دیتابیس…"
nakhl_timed "بک‌آپ دیتابیس" bash docker/backup.sh

# ۲) ساخت ایمیج جدید
bold "گام ۲/۴ — ساخت ایمیج جدید…"
net_preflight
BUILD_LOG="$(mktemp /tmp/nakhl-build-XXXXXX.log)"


build_image() {
  # Explicitly propagate pipeline failures even when called in an if condition.
  DOCKER_BUILDKIT=1 docker compose --progress plain build 2>&1 | tee "${BUILD_LOG}"
}
if ! nakhl_timed "ساخت ایمیج و بررسی TypeScript" build_image; then
  bold "✗ ساخت ایمیج شکست خورد — هیچ چیزی تغییر نکرده است:"
  echo  "    • کانتینر فعلی همچنان در حال سرویس‌دهی است (نسخهٔ قبلی)"
  echo  "    • بک‌اپ گام ۱ گرفته شده است (docker/restore.sh در صورت نیاز)"
  echo
  if grep -qiE 'proxyconnect|deadline ?exceeded|i/o timeout|failed to resolve' "${BUILD_LOG}"; then
    bold "  تشخیص: خطای شبکه/رجیستری داکر (در سرورهای ایران رایج). سه مسیر رفع:"
    echo
    echo  "  ۱) پروکسی مردهٔ دیمن داکر را پیدا و حذف/اصلاح کنید:"
    echo  "       docker info | grep -i proxy"
    echo  "       systemctl show docker --property=Environment"
    echo  "       cat /etc/docker/daemon.json"
    echo  "       ls /etc/systemd/system/docker.service.d/ 2>/dev/null"
    echo  "     سپس:  systemctl daemon-reload && systemctl restart docker"
    echo
    echo  "  ۲) اگر docker.io بدون پروکسی هم باز نیست — میرور ابرآروان در daemon.json:"
    echo  "       { \"registry-mirrors\": [\"https://docker.arvancloud.ir\"] }"
    echo  "     سپس:  systemctl restart docker   (کانتینرها خودشان برمی‌گردند؛ داده‌ها روی volume امن‌اند)"
    echo
    echo  "  ۳) راه سریع بدون دست زدن به دیمن — فقط ایمیج‌های پایه را از میرور بکشید:"
    echo  "       docker pull docker.arvancloud.ir/oven/bun:1 && docker tag docker.arvancloud.ir/oven/bun:1 oven/bun:1"
    echo  "       docker pull docker.arvancloud.ir/library/node:22-slim && docker tag docker.arvancloud.ir/library/node:22-slim node:22-slim"
    echo
    echo  "  راهنمای کامل: DOCKER-DEPLOY-FA.md §۱۰ (خطای شبکه هنگام بیلد)"
  else
    echo  "  لاگ کامل بیلد در همین خروجی بالاست؛ جدول رفع اشکال: DOCKER-DEPLOY-FA.md §۱۰"
  fi
  exit 1
fi


# ۳) پیش از جایگزینی: تست ارتقا با ایمیج جدید + خروجی داده‌های حذف‌شونده + تأیید مدیر
bold "گام ۳/۴ — تست ارتقا و محافظت از داده‌های حذف‌شونده…"

# ۳-الف) شبیه‌سازی کامل ارتقا روی دیتابیس آزمایشیِ دارای سفارش (ایمیج جدید؛ دیتای واقعی دست‌نخورده)
if ! nakhl_timed "تست حفظ سفارش‌ها" docker compose run --rm -T --no-deps --entrypoint node app scripts/upgrade-test.mjs; then
  bold "✗ تست ارتقا شکست خورد (DATA LOSS یا خطای اجرا) — جایگزینی کانتینر لغو شد:"
  echo  "    • کانتینر فعلی همچنان در حال سرویس‌دهی است (نسخهٔ قبلی)"
  echo  "    • بک‌آپ گام ۱ موجود است؛ لاگ بالا را بررسی و مشکل را رفع کنید"
  exit 1
fi
ok "تست ارتقا پاس شد: سفارش‌ها/اقلام/لاگ‌ها در شبیه‌سازی سالم ماندند"

if ! nakhl_timed "تست اتمی‌بودن مهاجرت" docker compose run --rm -T --no-deps --entrypoint node app scripts/migration-test.mjs; then
  bold "✗ تست مهاجرت شکست خورد — کانتینر فعلی جایگزین نشد"
  exit 1
fi

# ۳-ب) خروجی JSON خوانا از داده‌هایی که این ارتقا برای همیشه حذف می‌کند (روی volume واقعی)
if EXPORT_LOG="$(docker compose run --rm -T --no-deps --entrypoint node app scripts/export-dropped.mjs 2>/dev/null)"; then
  echo "${EXPORT_LOG}"
  ok "خروجی JSON داده‌های حذف‌شونده ذخیره شد (data/pre-upgrade-dropped-*.json روی volume)"
else
  warn "خروجی JSON گرفته نشد (دیتابیس تازه است یا ساختار حذف‌شونده ندارد) — بک‌آپ کامل گام ۱ پوشش می‌دهد"
fi

# ۳-ج) اعلام واضح حذف داده + تأیید صریح مدیر
bold "⚠️  هشدار حذف داده — این ارتقا چه چیزی را برای همیشه پاک می‌کند"
echo  "این نسخه ماژول «رزرو میز» و «تحویل زمان‌بندی‌شده» را کامل حذف می‌کند (دستور مالک)."
echo  "با اعمال مایگریشن 0006 این داده‌ها برای همیشه از دیتابیس حذف می‌شوند:"
echo  "  • تمام رکوردهای رزرو میز (جدول Reservation)"
echo  "  • زمان تحویل زمان‌بندی‌شدهٔ سفارش‌ها (ستون Order.scheduledFor)"
echo  "سفارش‌ها، اقلام سفارش، لاگ‌های وضعیت، نظرات و بقیهٔ داده‌ها دست‌نخورده می‌مانند"
echo  "(خروجی JSON مرحلهٔ ۳-ب + بک‌آپ کامل گام ۱ برای بازیابی در دسترس‌اند)."
echo
if [ "${NAKHL_ALLOW_DESTRUCTIVE_UPGRADE:-}" = "yes" ]; then
  ok "حذف داده با NAKHL_ALLOW_DESTRUCTIVE_UPGRADE=yes صریحاً تأیید شده است"
elif [ -t 0 ]; then
  printf 'برای ادامه و حذف قطعی داده‌های بالا «yes» بنویسید: '
  read -r ANSWER
  if [ "${ANSWER}" != "yes" ]; then
    echo "✗ لغو شد — کانتینر فعلی به سرویس‌دهی ادامه می‌دهد و هیچ چیزی تغییر نکرد."
    exit 0
  fi
else
  warn "اجرای غیرتعاملی بدون تأیید صریح حذف داده متوقف شد؛ کانتینر فعلی جایگزین نشد"
  echo "برای تأیید آگاهانه: NAKHL_ALLOW_DESTRUCTIVE_UPGRADE=yes bash docker/update.sh"
  exit 1
fi
echo
# ۳) جایگزینی کانتینر (volume دست‌نخورده)
bold "گام ۴/۴ — جایگزینی کانتینر…"
nakhl_timed "راه‌اندازی کانتینر" docker compose up -d

# منتظر healthy شدن بمانیم
for i in $(seq 1 90); do
  STATE="$(docker inspect --format '{{.State.Health.Status}}' nakhl-app 2>/dev/null || echo starting)"
  [ "$STATE" = "healthy" ] && { ok "کانتینر جدید healthy شد"; break; }
  [ "$i" = "90" ] && { echo "  ⚠ هنوز healthy نیست — لاگ: docker compose logs --tail=100 app"; exit 1; }
  printf '⏱ انتظار برای سلامت: %s ثانیه | وضعیت: %s\n' "$SECONDS" "$STATE"
  sleep 1
done

# پاک‌سازی ایمیج‌های قدیمی بی‌استفاده (volume ها را هرگز لمس نمی‌کند)
docker image prune -f >/dev/null 2>&1 && ok "ایمیج‌های بلااستفاده پاک شدند" || true

bold "═══ به‌روزرسانی کامل شد — سفارش‌ها حفظ شدند؛ حذف‌های اعلام‌شده اعمال شدند ═══"
docker compose ps
