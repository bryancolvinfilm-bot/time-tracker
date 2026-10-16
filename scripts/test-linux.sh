#!/usr/bin/env bash
set -euo pipefail

# Xvfb supplies a display, but maximize/restore requests need a window manager.
# Run this script inside xvfb-run so Openbox and Electron share that display.
wm_log=$(mktemp)
openbox --sm-disable >"$wm_log" 2>&1 &
wm_pid=$!
cleanup() {
  kill "$wm_pid" 2>/dev/null || true
  wait "$wm_pid" 2>/dev/null || true
  rm -f -- "$wm_log"
}
trap cleanup EXIT

wm_ready=false
for attempt in {1..50}; do
  if ! kill -0 "$wm_pid" 2>/dev/null; then
    cat "$wm_log"
    echo 'Openbox exited before the desktop tests could start.' >&2
    exit 1
  fi
  if xprop -root _NET_SUPPORTING_WM_CHECK | grep -q 'window id # 0x'; then
    wm_ready=true
    break
  fi
  sleep 0.1
done
if [[ "$wm_ready" != true ]]; then
  cat "$wm_log"
  echo 'Timed out waiting for the Linux window manager.' >&2
  exit 1
fi

npm test
