#!/usr/bin/env bash
# Encodes captured frames into the delivered hero and FAILS if over budget.
#
# APNG is deliberately not produced: the same frames encode to 72 MB as APNG,
# measured 2026-07-31. The fallback is a single static frame.
set -euo pipefail
THEME="${1:-dark}"
DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMES="$DIR/frames/$THEME"
OUT="$DIR/../assets/hero"
BUDGET=$((2 * 1024 * 1024))

[ -d "$FRAMES" ] || { echo "encode: no frames at $FRAMES — run capture.mjs first" >&2; exit 1; }
mkdir -p "$OUT"

# Downsample 2560x840 -> 1280x420 with lanczos: the supersample is where particle
# antialiasing comes from, and it costs render time rather than file size.
ffmpeg -hide_banner -loglevel error -framerate 20 -i "$FRAMES/f_%04d.png" \
  -vf "scale=1280:420:flags=lanczos" \
  -c:v libwebp_anim -lossless 0 -q:v "${QUALITY:-68}" -compression_level 6 -loop 0 -an \
  -y "$OUT/hero-$THEME.webp"

# Static fallback: the midpoint frame, where THE CORE is fully formed.
if [ "$THEME" = "dark" ]; then
  ffmpeg -hide_banner -loglevel error -i "$FRAMES/f_0080.png" \
    -vf "scale=1280:420:flags=lanczos" -y "$OUT/hero-static.png"
fi

SIZE=$(stat -c%s "$OUT/hero-$THEME.webp")
printf 'encode[%s]: %s KB (budget %s KB)\n' "$THEME" $((SIZE / 1024)) $((BUDGET / 1024))
[ "$SIZE" -le "$BUDGET" ] || { echo "encode: OVER BUDGET — lower grain in scene/palette.mjs" >&2; exit 1; }
