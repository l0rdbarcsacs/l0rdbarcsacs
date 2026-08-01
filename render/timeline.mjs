/* Pure frame-index → scene-parameters mapping.

   Every quantity here is periodic with period FRAMES. That is not a stylistic
   preference: the hero is delivered as a looping WebP, and any non-periodic term
   produces a visible jump when the loop repeats. The periodicity is enforced by
   timeline.test.mjs rather than by eyeballing the output.

   Nothing in this file may read the clock or use Math.random(). */

export const FRAMES = 160
export const FPS = 20
export const DURATION = FRAMES / FPS   // 8.0 s

const TAU = Math.PI * 2

/** Raised cosine: 0 at the loop edges, 1 at the midpoint, symmetric, C¹-continuous. */
function raisedCosine(u) {
  return 0.5 - 0.5 * Math.cos(u * TAU)
}

/** Sharpen the plateau so THE CORE holds formed for ~2s instead of only touching 1.0. */
function ease(x) {
  return x * x * (3 - 2 * x)
}

export const BOOT_LOG = [
  "> cerberus-os v2026.7 // public terminal",
  "> mounting /dev/inference ... ok",
  "> loading ensemble: lstm · kalman · ou · tft",
  "> gpu: rtx 3070 · cuda 13 · 8gb vram",
  "> latency budget 15ms ... within tolerance",
  "> core online.",
].join("\n")

export function paramsAt(frame) {
  const u = frame / FRAMES                       // 0 → 1 over exactly one loop
  const morph = ease(ease(raisedCosine(u)))

  // The grain is a per-frame lookup rather than a continuous function of u, so it
  // only closes if the index itself wraps. Without this wrap frame FRAMES would
  // draw a different grain field than frame 0 and the loop point would sparkle.
  const grainFrame = ((frame % FRAMES) + FRAMES) % FRAMES

  return {
    frame,
    t: frame / FPS,
    u,
    rotation: u * TAU,
    morph,
    // Core brightness tracks formation but keeps a floor so the nebula stays visible
    glow: 0.25 + 0.75 * morph,
    // Integer multiples of the loop frequency ⇒ every ring closes
    ringPhases: [1, 2, 3].map(k => u * TAU * k),
    // Frame-indexed, never clock-indexed; wrapped so it is periodic in FRAMES
    grainSeed: (grainFrame * 9301 + 49297) % 233280,
    // Types out over the first half, then holds
    bootChars: Math.min(BOOT_LOG.length, Math.round(BOOT_LOG.length * Math.min(1, u * 2.2))),
  }
}
