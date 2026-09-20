#!/usr/bin/env bash
# =============================================================================
# Nakhl Restaurant — کتابخانهٔ مشترک اسکریپت‌های استقرار (deploy / update)
# -----------------------------------------------------------------------------
# این فایل مستقیماً اجرا نمی‌شود؛ در ابتدای deploy.sh و update.sh با
# «source docker/lib.sh» بارگذاری می‌شود. امکانات:
#
#  ۱) تایمر فازها      — هر گام زمان شروع/پایان دارد؛ در پایان «جدول زمان‌ها»
#  ۲) ضربان‌سنج بیلد   — حین docker compose build هر NAKHL_BUILD_TICK ثانیه
#                        (پیش‌فرض ۳۰) یک خط وضعیت: زمان سپری‌شده + گام جاری
#                        BuildKit. اگر خروجی بیلد بیش از NAKHL_STALL_WARN ثانیه
#                        (پیش‌فرض ۲۴۰) قطع بماند → هشدار؛ بیش از
#                        NAKHL_STALL_ALERT ثانیه (پیش‌فرض ۹۰۰) → هشدار جدی +
#                        علت‌یابی. (همراهِ خطوط [nakhl] … (cpu busy) که از داخل
#                        ایمیج هر ۶۰ ثانیه می‌آیند، تشخیصِ «کند» از «گیر» ممکن
#                        می‌شود.)
#  ۳) تشخیص خطای بیلد  — شبکه (proxyconnect/…) · کمبود حافظه (OOM/exit 137) ·
#                        خطای TypeScript (error TS…) — هرکدام با راهنمای فارسی
#  ۴) پیش‌پروازش        — حافظه/سواپ/دیسک + وضعیت پروکسی و ایمیج‌های پایهٔ داکر
#
# تمام توابع با «set -euo pipefail» سازگارند (هیچ عبارتی بدون محافظ مقدار
# غیرصفر برنمی‌گرداند).
# =============================================================================

# ═══════════════════════ زمان و رنگ‌ها ═══════════════════════

NAKHL_T0="$(date +%s)"

now_s() { date +%s; }

# clock 125 → "02:05" · 3725 → "1:02:05"
clock() {
  local s=$1 h m
  h=$(( s / 3600 )); s=$(( s % 3600 )); m=$(( s / 60 )); s=$(( s % 60 ))
  if [ "$h" -gt 0 ]; then printf '%d:%02d:%02d' "$h" "$m" "$s"; else printf '%02d:%02d' "$m" "$s"; fi
}

# dur 42 → "42s" · 485 → "8m 05s" · 3725 → "1h 02m"
dur() {
  local s=$1 h m
  if [ "$s" -lt 60 ]; then printf '%ds' "$s"; return; fi
  h=$(( s / 3600 )); m=$(( (s % 3600) / 60 )); s=$(( s % 60 ))
  if [ "$h" -gt 0 ]; then printf '%dh %02dm' "$h" "$m"; else printf '%dm %02ds' "$m" "$s"; fi
}

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m⚠\033[0m %s\n' "$1"; }
err()  { printf '  \033[31m✗\033[0m %s\n' "$1" >&2; }

# ═══════════════════════ فازها (گام‌های زمان‌دار) ═══════════════════════

PH_NAME=""; PH_T0=0
PH_NAMES=(); PH_SECS=()

# ph "عنوان گام" "شمارهٔ فارسی" "تعداد کل"
ph() {
  PH_NAME="$1"; PH_T0="$(now_s)"
  printf '\n\033[1m═══ گام %s از %s ─ %s ═══\033[0m \033[2m[%s از شروع]\033[0m\n' \
    "$2" "$3" "$1" "$(clock $(( PH_T0 - NAKHL_T0 )))"
}

ph_done() {
  local d=$(( $(now_s) - PH_T0 ))
  PH_NAMES+=("${PH_NAME}"); PH_SECS+=("$d")
  printf '  \033[32m✔ %s پایان یافت\033[0m \033[2m(%s)\033[0m\n' "${PH_NAME}" "$(dur "$d")"
}

summary() {
  local i total=0
  printf '\n\033[1m═══ خلاصهٔ زمان‌ها ═══\033[0m\n'
  for i in "${!PH_SECS[@]}"; do
    printf '  %9s · %s\n' "$(dur "${PH_SECS[$i]}")" "${PH_NAMES[$i]}"
    total=$(( total + PH_SECS[$i] ))
  done
  printf '  \033[2m───────────\033[0m\n'
  printf '  %9s · \033[1mمجموع\033[0m\n' "$(dur "$total")"
}

# ═══════════════════════ پیش‌پروازش ═══════════════════════

# حافظه و دیسک — دو علت اصلی «گیر کردن»/کشته‌شدن بیلد روی VPS های کوچک.
# بیلد Next.js (کامپایل + TypeScript) به‌طور موقت به ~۲.۵GB RAM+Swap نیاز دارد.
sys_preflight() {
  local ram_kb=0 swap_kb=0 total_mb avail_mb
  ram_kb="$(awk '/^MemTotal:/{print $2}' /proc/meminfo 2>/dev/null || echo 0)"
  swap_kb="$(awk '/^SwapTotal:/{print $2}' /proc/meminfo 2>/dev/null || echo 0)"
  total_mb=$(( (ram_kb + swap_kb) / 1024 ))
  ok "حافظه: $(( ram_kb / 1024 ))MB RAM + $(( swap_kb / 1024 ))MB Swap"
  if [ "$total_mb" -lt 2500 ]; then
    warn "RAM+Swap کمتر از حد توصیه‌شده برای بیلد است (~۲.۵GB لازم)"
    echo  "    افزودن سریع ۴GB سواپ (قبل از هر فکر دیگری):"
    echo  "        fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile"
  fi
  avail_mb="$(df -Pm /var/lib/docker 2>/dev/null | awk 'NR==2{print $4}' || true)"
  if [ -z "${avail_mb:-}" ]; then
    avail_mb="$(df -Pm . 2>/dev/null | awk 'NR==2{print $4}' || echo 0)"
  fi
  if [ "${avail_mb:-0}" -lt 6000 ]; then
    warn "فضای آزاد دیسک داکر کم است (~${avail_mb}MB — بیلد ایمیج به چند GB نیاز دارد)"
  else
    ok "فضای دیسک: ~$(( avail_mb / 1024 ))GB آزاد"
  fi
}

# وضعیت شبکهٔ داکر (سرورهای ایران) — فقط «آگاهی‌رسانی»؛ اگر رجیستری سالم باشد
# بیلد حتی با این هشدارها ادامه پیدا می‌کند. Dockerfile عمداً بدون directive
# «# syntax=…» نوشته شده و به docker.io وصل نمی‌شود؛ استقرار اول فقط برای
# pull دو ایمیج پایه به رجیستری نیاز دارد (میرور ابرآروان اگر مستقیم باز نیست).
net_preflight() {
  local daemon_proxy missing_base img p_addr
  daemon_proxy="$(docker info 2>/dev/null | awk -F': ' '/^ *(HTTP|HTTPS) Proxy:/{print $2; exit}' | tr -d ' ' || true)"
  if [ -n "${daemon_proxy}" ]; then
    p_addr="${daemon_proxy#*://}"; p_addr="${p_addr%%/*}"
    if timeout 4 bash -c "</dev/tcp/${p_addr%:*}/${p_addr##*:}" 2>/dev/null; then
      ok "پروکسی دیمن داکر (${daemon_proxy}) پاسخ می‌دهد"
    else
      warn "پروکسی پیکربندی‌شده روی داکر (${daemon_proxy}) پاسخ نمی‌دهد — هر pull از رجیستری شکست می‌خورد"
      warn "راه‌حل: DOCKER-DEPLOY-FA.md §۱۰ → «خطای شبکه هنگام بیلد» (گام ۱)"
    fi
  fi
  missing_base=""
  for img in "oven/bun:1" "node:22-slim"; do
    docker image inspect "${img}" >/dev/null 2>&1 || missing_base="${missing_base} ${img}"
  done
  if [ -n "${missing_base}" ]; then
    warn "ایمیج‌های پایه به‌صورت محلی موجود نیستند:${missing_base}"
    warn "اگر docker.io روی این سرور در دسترس نیست، از میرور بکشید و همان نام را بزنید:"
    echo  "        docker pull docker.arvancloud.ir/oven/bun:1 && docker tag docker.arvancloud.ir/oven/bun:1 oven/bun:1"
    echo  "        docker pull docker.arvancloud.ir/library/node:22-slim && docker tag docker.arvancloud.ir/library/node:22-slim node:22-slim"
  else
    ok "ایمیج‌های پایه در کش محلی موجودند (بیلد بدون رجیستری ممکن است)"
  fi
}

# ═══════════════════════ بیلد با ضربان‌سنج ═══════════════════════

BUILD_PID=""; BUILD_LOG=""; BUILD_RC=0

# هشدار سطح ۱: خروجی مدتی قطع بوده (معمولاً بی‌خطر — مرحلهٔ TypeScript)
_stall_warn() { # $1 = ثانیهٔ بی‌خروجی
  warn "بیش از $(( $1 / 60 )) دقیقه است خروجی جدیدی از بیلد نمی‌آید — لزوماً خطا نیست:"
  echo  "    مرحلهٔ «Running TypeScript» در next build روی سرورهای کم‌سرعت چند دقیقه"
  echo  "    کاملاً بی‌خروجی طول می‌کشد. اگر بیلد زنده باشد، هر ~۶۰ ثانیه یک خط"
  echo  "    «[nakhl] … (cpu busy)» از داخل ایمیج به همین خروجی اضافه می‌شود."
  echo  "    برای اطمینان، در ترمینال دیگری روی همان سرور:"
  echo  "        ps aux --sort=-%cpu | head -8     ← پروسهٔ کامپایل باید بالای لیست باشد"
  echo  "        free -m                            ← اگر RAM پر و Swap تقریباً خالی است، ریسک OOM"
}

# هشدار سطح ۲: خیلی طولانی — احتمال واقعی گیر/OOM + علت‌یابی
_stall_alert() { # $1 = ثانیهٔ بی‌خروجی
  err "بیلد بیش از $(( $1 / 60 )) دقیقه است نه خروجی دارد و نه نشانه‌ای از فعالیت"
  echo  "    آخرین خطوط خروجی بیلد:" >&2
  tail -n 5 -- "$BUILD_LOG" 2>/dev/null | sed 's/^/      /' >&2 || true
  echo  "    علت‌های محتمل و بررسی فوری:" >&2
  echo  "      • کمبود حافظه (OOM):  free -m   و   dmesg | grep -iE 'oom|killed' | tail -5" >&2
  echo  "      • پر بودن دیسک:       df -h /" >&2
  echo  "      • گیر دانلود پکیج:    ps aux | grep -E 'bun|docker' | grep -v grep" >&2
  echo  "    اگر مطمئن شدید گیر کرده، Ctrl+C بی‌خطر است — هیچ داده‌ای خراب نمی‌شود؛" >&2
  echo  "    در update.sh کانتینر نسخهٔ قبلی همچنان سرویس می‌دهد و بک‌اپ گرفته شده." >&2
}

# اجرای docker compose build با پایش زنده. خروجی کامل زندهً stream می‌شود
# (مثل قبل) + هر تیک یک خط تایمر. کد خروج بیلد در BUILD_RC برمی‌گردد.

# _hb_wait TICK SLICE — به‌جای sleep یکجا، در برش‌های کوچک می‌خوابد و اگر
# پروسهٔ بیلد مرد، سریع (کد ۱) برمی‌گردد تا تشخیص شکست حداکثر SLICE ثانیه
# طول بکشد، نه یک تیک کامل.
_hb_wait() { # $1=کل مدت انتظار $2=اندازهٔ برش
  local w=0
  while [ "$w" -lt "$1" ]; do
    sleep "$2"
    w=$(( w + $2 ))
    kill -0 "$BUILD_PID" 2>/dev/null || return 1
  done
  return 0
}

build_image() {
  local tick="${NAKHL_BUILD_TICK:-30}"
  local warn_after="${NAKHL_STALL_WARN:-240}"
  local alert_after="${NAKHL_STALL_ALERT:-900}"
  local t0 last_size=-1 last_change warned=0 alerted=0 sz idle el step

  BUILD_LOG="$(mktemp /tmp/nakhl-build-XXXXXX.log)"
  t0="$(now_s)"; last_change="$t0"

  # خروجی زنده برای کاربر + کپی کامل در فایل (مبنای تشخیص گیر)
  ( docker compose build --progress=plain 2>&1 | tee -- "$BUILD_LOG" ) &
  BUILD_PID=$!

  # داخل هر تیک، هر ۲ ثانیه زنده بودن بیلد چک می‌شود تا شکستِ بیلد حداکثر ۲
  # ثانیه بعد از وقوعتش تشخیص داده شود (نه یک تیک کامل بعد‌تر).
  local slice=2
  if [ "$tick" -lt "$slice" ]; then slice="$tick"; fi

  while :; do
    _hb_wait "$tick" "$slice" || break
    sz="$(stat -c %s -- "$BUILD_LOG" 2>/dev/null || echo 0)"
    el=$(( $(now_s) - t0 ))
    if [ "$sz" -ne "$last_size" ]; then
      # خروجی در جریان است — خط تایمر معمولی با گام جاری BuildKit
      last_size="$sz"; last_change="$(now_s)"; warned=0; alerted=0
      step="$(grep -E '^#[0-9]+ \[' -- "$BUILD_LOG" 2>/dev/null | tail -n 1 | cut -c1-56 || true)"
      printf '  ⏱ %s · در حال اجرا · %s\n' "$(clock "$el")" "${step:-…}"
    else
      idle=$(( $(now_s) - last_change ))
      if [ "$idle" -ge "$alert_after" ]; then
        if [ "$alerted" -eq 0 ]; then alerted=1; _stall_alert "$idle"; fi
        printf '  \033[31m⏱ %s · بی‌خروجی از %ss ⚠\033[0m\n' "$(clock "$el")" "$idle"
      elif [ "$idle" -ge "$warn_after" ]; then
        if [ "$warned" -eq 0 ]; then warned=1; _stall_warn "$idle"; fi
        printf '  \033[33m⏱ %s · بی‌خروجی از %ss\033[0m\n' "$(clock "$el")" "$idle"
      else
        printf '  ⏱ %s · در حال اجرا (بدون خروجی جدید: %ss)\n' "$(clock "$el")" "$idle"
      fi
    fi
  done

  BUILD_RC=0
  wait "$BUILD_PID" || BUILD_RC=$?

  if [ "$BUILD_RC" -eq 0 ]; then
    local built cached
    built="$(grep -cE '^#[0-9]+ DONE' -- "$BUILD_LOG" 2>/dev/null || true)"
    cached="$(grep -cE '^#[0-9]+ CACHED' -- "$BUILD_LOG" 2>/dev/null || true)"
    ok "ساخت ایمیج کامل شد ($(clock $(( $(now_s) - t0 ))) · ${built:-0} لایهٔ جدید · ${cached:-0} لایهٔ کش)"
  fi
}

# ═══════════════════════ تشخیص خطای بیلد ═══════════════════════

_network_help() {
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
}

_oom_help() {
  bold "  تشخیص: کمبود حافظه (OOM) — پروسهٔ بیلد حین کامپایل/تایپ‌چک کشته شده"
  echo  "  نشانه‌ها در لاگ:"
  grep -iE 'exit code: ?137|killed|out of memory|cannot allocate' -- "$BUILD_LOG" 2>/dev/null | head -n 3 | sed 's/^/    /' || true
  echo  "  بیلد Next.js (کامپایل + TypeScript) به ~۲.۵GB RAM+Swap نیاز دارد (اجرا خیلی"
  echo  "  سبک‌تر است). افزودن ۴GB سواپ تقریباً همیشه کافی است:"
  echo  "      fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile"
  echo  "      echo '/swapfile none swap sw 0 0' >> /etc/fstab    ← ماندگار پس از ری‌بوت"
  echo  "  سپس همین اسکریپت را دوباره اجرا کنید — لایه‌های موفق قبلی از کش استفاده می‌شوند."
}

_ts_help() {
  bold "  تشخیص: خطای TypeScript در کد — خطای زیرساخت نیست"
  grep -E 'error TS[0-9]+' -- "$BUILD_LOG" 2>/dev/null | head -n 5 | sed 's/^/    /' || true
  echo  "  این خطاها باید در کد رفع شوند (مسیر:خط). برای بازتولید روی ماشین توسعه:"
  echo  "      bun run typecheck"
}

_generic_help() {
  bold "  الگوی شناخته‌شده‌ای در لاگ پیدا نشد — ۳۰ خط آخر بیلد:"
  tail -n 30 -- "$BUILD_LOG" 2>/dev/null | sed 's/^/    /' || true
  echo  "  جدول رفع اشکال: DOCKER-DEPLOY-FA.md §۱۰"
}

# بعد از شکست build_image: علت‌یابی + نگه‌داشتن کپی کامل لاگ + پیام زمینه‌ای
diagnose_build_failure() { # $1 = پیام زمینه‌ای این استقرار
  local keep="/tmp/nakhl-build-failed-$(date +%Y%m%d-%H%M%S).log"
  if [ -f "$BUILD_LOG" ]; then
    cp -- "$BUILD_LOG" "$keep" 2>/dev/null || true
  fi
  bold "✗ ساخت ایمیج شکست خورد — $1"
  echo
  bold "  تشخیص خودکار:"
  if grep -qiE 'proxyconnect|deadline ?exceeded|i/o timeout|failed to resolve|dial tcp.*timeout|no route to host' -- "$BUILD_LOG" 2>/dev/null; then
    _network_help
  elif grep -qiE 'exit code: ?137|signal 9|sigkill|out of memory|cannot allocate|oom-?kill' -- "$BUILD_LOG" 2>/dev/null; then
    _oom_help
  elif grep -qE 'error TS[0-9]+' -- "$BUILD_LOG" 2>/dev/null; then
    _ts_help
  else
    _generic_help
  fi
  echo
  echo  "  لاگ کامل بیلد برای بررسی بعدی ذخیره شد:"
  echo  "      ${keep}"
}

# ═══════════════════════ سلامت کانتینر ═══════════════════════

# منتظر healthy شدن nakhl-app می‌ماند؛ شمارندهٔ زنده دارد و در صورت تمام شدن
# مهلت، ۲۵ خط آخر لاگ کانتینر را چاپ می‌کند (علامت‌گذاری سریع علت).
wait_healthy() { # $1 = حداکثر ثانیه
  local t0 deadline state now
  t0="$(now_s)"; deadline=$(( t0 + $1 ))
  while :; do
    state="$(docker inspect --format '{{.State.Health.Status}}' nakhl-app 2>/dev/null || echo starting)"
    if [ "$state" = "healthy" ]; then
      printf '\r\033[K'
      ok "کانتینر healthy شد (پس از $(( $(now_s) - t0 ))s)"
      return 0
    fi
    now="$(now_s)"
    if [ "$now" -ge "$deadline" ]; then
      printf '\r\033[K'
      err "کانتینر در $1 ثانیه healthy نشد — آخرین لاگ‌های کانتینر:"
      docker compose logs --tail 25 app 2>&1 | sed 's/^/    /' || true
      return 1
    fi
    printf '\r\033[K  … در انتظار سلامت کانتینر: %ss (وضعیت: %s)   ' "$(( now - t0 ))" "$state"
    sleep 2
  done
}

# بررسی HTTP سلامت روی پورت میزبان
http_health() { # $1 = پورت
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$1/api/health" || true)"
  if [ "$code" = "200" ]; then
    ok "GET /api/health → 200"
  else
    err "GET /api/health → ${code:-fail} (لاگ: docker compose logs --tail=50 app)"
  fi
}

# ═══════════════════════ پاک‌سازی و خروج ═══════════════════════

# باید بعد از source به این شکل نصب شود:
#   trap cleanup EXIT
#   trap 'exit 130' INT TERM
cleanup() {
  local rc=$?
  # اگر هنوز بیلدی در پس‌زمینه است، آن و فرزندانش (docker compose/tee) را ببند
  if [ -n "${BUILD_PID}" ] && kill -0 "$BUILD_PID" 2>/dev/null; then
    pkill -P "$BUILD_PID" 2>/dev/null || true
    kill "$BUILD_PID" 2>/dev/null || true
  fi
  if [ -n "${BUILD_LOG}" ] && [ -f "$BUILD_LOG" ]; then
    rm -f -- "$BUILD_LOG"
  fi
  # اگر فرایند به هر دلیلی (خطا/Ctrl+C) قطع شد، «چقدر طول کشید» مشخص بماند
  if [ "$rc" -ne 0 ]; then
    printf '\n  \033[31m✗ اسکریپت پس از %s متوقف شد (کد خروج %s)\033[0m\n' \
      "$(clock $(( $(now_s) - NAKHL_T0 )))" "$rc" >&2
  fi
}
