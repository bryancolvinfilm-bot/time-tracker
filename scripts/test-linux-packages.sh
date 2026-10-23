#!/usr/bin/env bash
set -euo pipefail

# Exercise copies extracted from both distributable packages, never user data.
test_dir=$(mktemp -d)
trap 'rm -rf -- "$test_dir"' EXIT
shopt -s nullglob
images=(release/*.AppImage)
packages=(release/*.deb)
if [[ ${#images[@]} != 1 || ${#packages[@]} != 1 ]]; then
  echo 'Expected exactly one fresh AppImage and Debian package.' >&2
  exit 1
fi
test "$(dpkg-deb --field "${packages[0]}" Architecture)" = amd64
dpkg-deb --extract "${packages[0]}" "$test_dir/deb"
image_path=$(realpath "${images[0]}")
(cd "$test_dir" && chmod +x "$image_path" && "$image_path" --appimage-extract >/dev/null)
for executable in "$test_dir/deb/opt/Time Tracker/time-tracker" "$test_dir/squashfs-root/time-tracker"; do
  test -x "$executable"
  TIME_TRACKER_EXECUTABLE="$executable" xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" bash scripts/test-linux.sh npm run test:desktop
done
echo 'AppImage and Debian extracted-app desktop tests passed.'
