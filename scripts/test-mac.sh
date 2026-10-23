#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then
  echo 'Mac package verification must run on macOS.' >&2
  exit 1
fi

test_dir=$(mktemp -d "${TMPDIR:-/tmp}/tracker-mac.XXXXXX")
mount_dir="$test_dir/mount"
mounted=false
cleanup() {
  if [[ "$mounted" == true ]]; then
    hdiutil detach "$mount_dir" -quiet || true
  fi
  rm -rf -- "$test_dir"
}
trap cleanup EXIT
mkdir -p "$mount_dir" "$test_dir/dmg" "$test_dir/zip"

shopt -s nullglob
images=(release/*.dmg)
archives=(release/*-mac.zip)
if [[ ${#images[@]} != 1 || ${#archives[@]} != 1 ]]; then
  echo 'Expected exactly one freshly built Mac DMG and app ZIP.' >&2
  exit 1
fi

hdiutil verify "${images[0]}"
hdiutil attach "${images[0]}" -readonly -nobrowse -mountpoint "$mount_dir" -quiet
mounted=true
ditto "$mount_dir/Time Tracker.app" "$test_dir/dmg/Time Tracker.app"
hdiutil detach "$mount_dir" -quiet
mounted=false
ditto -x -k "${archives[0]}" "$test_dir/zip"

for source in dmg zip; do
  app_path="$test_dir/$source/Time Tracker.app"
  codesign --verify --deep --strict --verbose=2 "$app_path"
  codesign --display --verbose=4 "$app_path"
  lipo -verify_arch x86_64 arm64 "$app_path/Contents/MacOS/Time Tracker"
  lipo -verify_arch x86_64 arm64 "$app_path/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework"
  node scripts/check-mac-icon.cjs "$app_path/Contents/Resources/icon.icns"
  iconutil --convert iconset --output "$test_dir/$source/decoded.iconset" "$app_path/Contents/Resources/icon.icns"
  test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app_path/Contents/Info.plist")" = app.timetracker.desktop
done

# Exercise the actual app copied from the installer, with isolated test data.
TIME_TRACKER_EXECUTABLE="$test_dir/dmg/Time Tracker.app/Contents/MacOS/Time Tracker" npm run test:desktop
echo 'Mac DMG and ZIP signatures verified; installed-copy desktop tests passed.'
echo 'Development signature only: this does not imply Apple notarization or Gatekeeper approval.'
