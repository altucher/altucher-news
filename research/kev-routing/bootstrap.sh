#!/usr/bin/env bash
# Clone kev at the pinned upstream commit and copy the overlay in. Idempotent.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PIN="cc954f2"
if [ ! -d "$HERE/kev/.git" ]; then
  git clone https://github.com/jaredpalmer/kev "$HERE/kev"
fi
git -C "$HERE/kev" fetch --quiet origin
git -C "$HERE/kev" checkout --quiet "$PIN"
if [ -d "$HERE/overlay" ]; then
  cp -R "$HERE/overlay/." "$HERE/kev/"
fi
echo "kev @ $(git -C "$HERE/kev" rev-parse --short HEAD) with overlay applied at $HERE/kev"
