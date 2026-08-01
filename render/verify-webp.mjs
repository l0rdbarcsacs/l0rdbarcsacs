#!/usr/bin/env node
/* Structural verification of a delivered animated WebP.

   WHY THIS EXISTS: encode.sh used to gate on file size alone, and a size check
   passes trivially when the encode produces nothing — `0 -le 2097152` is true.
   That is not hypothetical: on 2026-08-01 an `encode.sh light` run emitted a
   0-byte hero-light.webp and reported "0 KB (budget 2048 KB)" as a success.
   libwebp_anim buffers the whole animation and muxes it at close, so a run that
   dies late leaves a plausible-looking empty file behind.

   WHY NOT ffprobe: ffmpeg cannot decode animated WebP. `ffprobe hero-dark.webp`
   answers "image data not found", width=0, height=0 on a perfectly valid file,
   so it cannot distinguish a good asset from a broken one.

   So the container is parsed directly. The RIFF layout is simple and stable:
     "RIFF" u32le(size) "WEBP" then a sequence of {FourCC, u32le size, payload},
     each payload padded to an even length.
   Animation lives in three chunks:
     VP8X  flags byte (bit 1 = ANIM), then canvas width-1 and height-1 as u24le
     ANIM  background colour (4B) + loop count (u16le); 0 means "loop forever"
     ANMF  one per frame — counting these IS the frame count

   Usage: node verify-webp.mjs FILE --frames 160 --width 1280 --height 420 [--max-bytes N]
   Exits non-zero with a specific reason on any mismatch. */

import {readFileSync} from "node:fs"

const argv = process.argv.slice(2)
const file = argv.find(a => !a.startsWith("--"))
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? Number(argv[i + 1]) : fallback
}

if (!file) {
  console.error("verify-webp: usage: verify-webp.mjs FILE --frames N --width W --height H")
  process.exit(2)
}

const want = {
  frames: opt("frames", 160),
  width: opt("width", 1280),
  height: opt("height", 420),
  maxBytes: opt("max-bytes", 2 * 1024 * 1024),
}

const fail = msg => {
  console.error(`verify-webp: FAIL ${file}: ${msg}`)
  process.exit(1)
}

let buf
try {
  buf = readFileSync(file)
} catch (e) {
  fail(`unreadable (${e.code})`)
}

if (buf.length === 0) fail("file is 0 bytes — the encoder produced nothing")
if (buf.length < 20) fail(`only ${buf.length} bytes — truncated`)
if (buf.toString("latin1", 0, 4) !== "RIFF") fail("not a RIFF container")
if (buf.toString("latin1", 8, 12) !== "WEBP") fail("RIFF container is not WEBP")

// The RIFF header declares the payload length; a mismatch means a truncated
// write, which is exactly the failure mode a size-only gate lets through.
const declared = buf.readUInt32LE(4) + 8
if (declared !== buf.length)
  fail(`RIFF declares ${declared} bytes but the file is ${buf.length} — truncated write`)

const u24 = off => buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16)

let pos = 12
let anmf = 0
let canvas = null
let loops = null
let animFlag = false

while (pos + 8 <= buf.length) {
  const tag = buf.toString("latin1", pos, pos + 4)
  const size = buf.readUInt32LE(pos + 4)
  const body = pos + 8
  if (body + size > buf.length) fail(`chunk ${tag} at ${pos} overruns the file — truncated`)

  if (tag === "VP8X" && size >= 10) {
    animFlag = (buf[body] & 0x02) !== 0
    canvas = {width: u24(body + 4) + 1, height: u24(body + 7) + 1}
  } else if (tag === "ANIM" && size >= 6) {
    loops = buf.readUInt16LE(body + 4)
  } else if (tag === "ANMF") {
    anmf++
  }

  pos = body + size + (size & 1)   // payloads are padded to an even length
}

if (!animFlag) fail("VP8X animation flag is not set — this encoded as a STILL image, not an animation")
if (loops === null) fail("no ANIM chunk — not an animation")
if (loops !== 0) fail(`loop count is ${loops}, expected 0 (loop forever) — check ffmpeg -loop 0`)
if (anmf !== want.frames) fail(`${anmf} ANMF frames, expected ${want.frames}`)
if (!canvas) fail("no VP8X chunk — cannot confirm canvas size")
if (canvas.width !== want.width || canvas.height !== want.height)
  fail(`canvas is ${canvas.width}x${canvas.height}, expected ${want.width}x${want.height}`)
if (buf.length > want.maxBytes)
  fail(`${buf.length} bytes exceeds the ${want.maxBytes}-byte budget`)

const kb = n => `${Math.round(n / 1024)} KB`
console.log(
  `verify-webp: OK ${file} — ${anmf} frames, ${canvas.width}x${canvas.height}, ` +
  `loop forever, ${kb(buf.length)} / ${kb(want.maxBytes)} budget ` +
  `(${(100 * buf.length / want.maxBytes).toFixed(1)}% used)`,
)
