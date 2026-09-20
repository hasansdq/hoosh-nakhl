#!/bin/sh
# =============================================================================
# Nakhl Restaurant — heartbeat helper for Dockerfile RUN steps (POSIX sh)
# -----------------------------------------------------------------------------
# این فایل در Stage «builder» ایمیج source می‌شود (Dockerfile) و دور هر فرمان
# طولانی یک «ضربان‌سنج» می‌گذارد:
#
#   RUN . /usr/local/bin/nakhl-build-lib && hb "next build" bun run build
#
# چرا لازم است؟ دو مرحلهٔ بیلد به‌طور طبیعی «بی‌خروجی»اند:
#   • «Running TypeScript» در next build — روی سرورهای ۱–۲ vCPU ممکن است چند
#     دقیقه هیچ خروجی چاپ نشود در حالی که tsc با تمام توان CPU کار می‌کند.
#   • دانلود پکیج‌ها روی رجیستری کند — CPU ساکت است اما شبکه فعال است.
# بدون سیگنال، تشخیص «کند» از «گیر کرده» غیرممکن است. hb دقیقاً همین را حل
# می‌کند: هر ۶۰ ثانیه یک خط وضعیت چاپ می‌کند با یک شاخصِ واقعی:
#
#   [nakhl] next build - 240s (cpu busy)
#
# شاخص cpu از جمع jiffies (utime+stime) «تمام» پروسه‌های همین کانتینرِ بیلد
# محاسبه می‌شود (BuildKit هر RUN را در PID namespace خودش اجرا می‌کند، پس
# /proc/[0-9]* فقط پروسه‌های همین مرحله را نشان می‌دهد — نه کل میزبان).
# «cpu busy» = بیش از ~۱ ثانیهٔ CPU در هر دقیقه؛ «cpu idle» یعنی در انتظار
# شبکه/دیسک هستیم (طبیعی حین دانلود).
#
# نکته: خطوط این فایل عمداً ASCII کوتاه‌اند تا در لاگ‌های BuildKit (و البته
# خروجی deploy.sh/update.sh که «آخرین گام» را از همین لاگ برمی‌دارد) بدون
# مشکل bidi/ترانکیت نمایش داده شوند. توضیح فارسی معنای این خطوط در
# DOCKER-DEPLOY-FA.md §۷ («پایش بیلد») آمده است.
# =============================================================================

# مجموع jiffies مصرفی همهٔ پروسه‌های این build-step (utime+stime؛ فیلدهای
# ۱۲و۱۳ بعد از حذف «pid (comm) » از ابتدای هر خط /proc/<pid>/stat).
_jif() {
    sed 's/^.*) //' /proc/[0-9]*/stat 2>/dev/null |
        awk '{ u += $12; s += $13 } END { print u + s + 0 }'
}

# hb LABEL CMD…  — اجرای CMD با ضربان ۶۰ ثانیه‌ای؛ کد خروج = کد خروج CMD
hb() {
    _hb_label=$1
    shift
    "$@" &
    _hb_pid=$!
    _hb_j0=$(_jif)
    _hb_t=0
    while kill -0 "$_hb_pid" 2>/dev/null; do
        sleep 15
        _hb_t=$(( _hb_t + 15 ))
        kill -0 "$_hb_pid" 2>/dev/null || break
        # فقط در مضرب‌های ۶۰ چاپ کن (گرانولاریتی ۱۵ ثانیه، دندانهٔ ۶۰)
        [ $(( _hb_t % 60 )) -eq 0 ] || continue
        _hb_j1=$(_jif)
        _hb_d=$(( _hb_j1 - _hb_j0 ))
        _hb_j0=$_hb_j1
        # >100 jiffies در ۶۰s ≈ بیش از ۱ ثانیهٔ CPU (CLK_TCK=100)
        if [ "$_hb_d" -gt 100 ]; then
            echo "[nakhl] $_hb_label - ${_hb_t}s (cpu busy)"
        else
            echo "[nakhl] $_hb_label - ${_hb_t}s (cpu idle)"
        fi
    done
    wait "$_hb_pid"
}
