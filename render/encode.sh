#!/usr/bin/env bash
# Encodes captured frames into the delivered hero and FAILS unless the result is
# a valid, animating, correctly sized, in-budget asset.
#
# APNG is deliberately not produced: the same frames encode to 72 MB as APNG,
# measured 2026-07-31. The fallback is a single static frame.
#
# OUTPUT PATH: assets/hero/v2 — this tracks what README.tpl.md actually
# references (`assets/hero/v2/hero-dark.webp` and siblings). The plan text says
# assets/hero; the delivered tree moved to v2 and the template followed it, so
# the template wins — an encoder that writes somewhere the README does not read
# produces a broken image, which is the one failure worse than an ugly one.
# Override with HERO_OUT= if the convention moves again.
#
# WHY THE VERIFY STEP: gating on `size <= budget` alone is unsound, because an
# empty file passes it — `0 -le 2097152` is true. That is not theoretical: on
# 2026-08-01 this script printed "encode[light]: 0 KB (budget 2048 KB)" and
# exited 0 on a 0-byte hero-light.webp. libwebp_anim buffers the whole animation
# and muxes it at close, so the output sits at 0 bytes for the entire encode and
# any run that dies late, or races another writer, leaves a plausible-looking
# empty file behind.
#
# WHY NOT ffprobe: ffmpeg has no animated-WebP decoder. `ffprobe hero-dark.webp`
# answers "image data not found", width=0, height=0 on a perfectly valid asset,
# so it cannot tell a good file from a broken one. verify-webp.mjs parses the
# RIFF container instead and asserts frame count, canvas size, the ANIM loop
# flag, container integrity and the budget.
set -euo pipefail

THEME="${1:-dark}"
DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMES="$DIR/frames/$THEME"
OUT="${HERO_OUT:-$DIR/../assets/hero/v2}"
WIDTH=1280
HEIGHT=420
FPS=20
EXPECT_FRAMES=160
BUDGET=$((2 * 1024 * 1024))

case "$THEME" in
  dark|light) ;;
  *) echo "encode: unknown theme '$THEME' (expected dark or light)" >&2; exit 1 ;;
esac

[ -d "$FRAMES" ] || { echo "encode: no frames at $FRAMES — run capture.mjs first" >&2; exit 1; }

# Precondition: a short or half-written capture must not silently become a short
# animation that still fits the budget and still looks fine as a single still.
COUNT=$(find "$FRAMES" -maxdepth 1 -type f -name 'f_*.png' | wc -l)
[ "$COUNT" -eq "$EXPECT_FRAMES" ] || {
  echo "encode: $COUNT frames in $FRAMES, expected $EXPECT_FRAMES — re-run capture.mjs" >&2
  exit 1
}

mkdir -p "$OUT"

# Downsample 2560x840 -> 1280x420 with lanczos: the supersample is where particle
# antialiasing comes from, and it costs render time rather than file size.
ffmpeg -hide_banner -loglevel error -framerate "$FPS" -i "$FRAMES/f_%04d.png" \
  -vf "scale=$WIDTH:$HEIGHT:flags=lanczos" \
  -c:v libwebp_anim -lossless 0 -q:v "${QUALITY:-68}" -compression_level 6 -loop 0 -an \
  -y "$OUT/hero-$THEME.webp"

# Static fallback: the midpoint frame, where THE CORE is fully formed. Only the
# dark variant produces it — README.tpl.md serves a single static <img> fallback.
if [ "$THEME" = "dark" ]; then
  ffmpeg -hide_banner -loglevel error -i "$FRAMES/f_0080.png" \
    -vf "scale=$WIDTH:$HEIGHT:flags=lanczos" -y "$OUT/hero-static.png"
fi

# The real gate: exits non-zero, with a specific reason, on empty, truncated,
# still-image, short, wrong-size or over-budget output.
node "$DIR/verify-webp.mjs" "$OUT/hero-$THEME.webp" \
  --frames "$EXPECT_FRAMES" --width "$WIDTH" --height "$HEIGHT" --max-bytes "$BUDGET"
