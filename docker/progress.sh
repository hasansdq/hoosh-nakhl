#!/usr/bin/env bash
# Sourced by deployment scripts. Keep the command in the foreground so signals,
# stdin and exit codes work normally; only the display runs in the background.
NAKHL_TIMER_PID=""
nakhl_stop_timer() {
  if [ -n "${NAKHL_TIMER_PID:-}" ]; then
    kill "${NAKHL_TIMER_PID}" 2>/dev/null || true
    wait "${NAKHL_TIMER_PID}" 2>/dev/null || true
    NAKHL_TIMER_PID=""
  fi
}

nakhl_timed() {
  local label="$1" start=$SECONDS result=0
  shift
  (
    trap 'exit 0' TERM INT
    local tick=0
    while :; do
      if [ -t 2 ]; then
        printf '\r\033[K⏱ %s: %s ثانیه | کل: %s ثانیه' "$label" "$((SECONDS - start))" "$SECONDS" >&2
      elif [ "$((tick % 10))" -eq 0 ]; then
        printf '⏱ %s: %s ثانیه | کل: %s ثانیه\n' "$label" "$((SECONDS - start))" "$SECONDS" >&2
      fi
      sleep 1
      tick=$((tick + 1))
    done
  ) &
  NAKHL_TIMER_PID=$!
  "$@" || result=$?
  nakhl_stop_timer
  printf '\n⏱ %s تمام شد: %s ثانیه | کل: %s ثانیه\n' "$label" "$((SECONDS - start))" "$SECONDS" >&2
  return "$result"
}
