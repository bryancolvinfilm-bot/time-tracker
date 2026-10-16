#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then
  echo 'Mac icon generation requires Apple iconutil and sips on macOS.' >&2
  exit 1
fi

icon_dir=$(mktemp -d "${TMPDIR:-/tmp}/tracker-icon.XXXXXX")
trap 'rm -rf -- "$icon_dir"' EXIT
iconset="$icon_dir/TimeTracker.iconset"
mkdir -p "$iconset" build
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" src/assets/icon.png --out "$iconset/icon_${size}x${size}.png" >/dev/null
  retina=$((size * 2))
  sips -z "$retina" "$retina" src/assets/icon.png --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil --convert icns --output build/icon.icns "$iconset"
node scripts/check-mac-icon.cjs build/icon.icns
