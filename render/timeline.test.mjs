import test from "node:test"
import assert from "node:assert/strict"
import {FRAMES, DURATION, paramsAt} from "./timeline.mjs"

/* frame, t, u and rotation legitimately differ between frame 0 and frame FRAMES —
   frame FRAMES is the frame *after* the last one, so its clock has advanced a full
   period. What must be identical is everything that reaches the screen. */
const visual = p => ({morph: p.morph, glow: p.glow, grainSeed: p.grainSeed,
                      ringPhases: p.ringPhases.map(r => r % (Math.PI * 2))})

test("locked output parameters", () => {
  assert.equal(FRAMES, 160)
  assert.equal(DURATION, 8.0)
})

test("frame 0 and frame FRAMES are visually identical — the loop closes", () => {
  // paramsAt(FRAMES) is the frame that would come after the last one; every
  // quantity that is drawn must equal frame 0 exactly, or the WebP will visibly
  // jump on repeat.
  assert.deepEqual(visual(paramsAt(FRAMES)), visual(paramsAt(0)))
})

test("rotation completes exactly one full turn over the loop", () => {
  assert.ok(Math.abs(paramsAt(0).rotation - 0) < 1e-9)
  assert.ok(Math.abs(paramsAt(FRAMES).rotation - Math.PI * 2) < 1e-9)
})

test("morph factor starts and ends dispersed, peaks mid-loop", () => {
  assert.ok(paramsAt(0).morph < 0.02, "starts as a nebula")
  assert.ok(paramsAt(FRAMES / 2).morph > 0.98, "fully formed at the midpoint")
  assert.ok(paramsAt(FRAMES - 1).morph < 0.1, "dispersed again by the end")
})

test("morph factor is symmetric about the midpoint", () => {
  for (const i of [10, 33, 57]) {
    const a = paramsAt(i).morph
    const b = paramsAt(FRAMES - i).morph
    assert.ok(Math.abs(a - b) < 1e-9, `frame ${i} (${a}) vs ${FRAMES - i} (${b})`)
  }
})

test("grain seed is periodic and never derived from wall-clock time", () => {
  assert.equal(paramsAt(0).grainSeed, paramsAt(FRAMES).grainSeed)
  assert.notEqual(paramsAt(0).grainSeed, paramsAt(1).grainSeed)
})

test("ring phases all close over the loop", () => {
  const start = paramsAt(0).ringPhases
  const end = paramsAt(FRAMES).ringPhases
  assert.equal(start.length, 3)
  for (const [i, phase] of start.entries())
    assert.ok(Math.abs(((end[i] - phase) % (Math.PI * 2))) < 1e-9, `ring ${i} does not close`)
})

test("boot log reveals monotonically and is fully typed before the midpoint", () => {
  assert.equal(paramsAt(0).bootChars, 0)
  const mid = paramsAt(FRAMES / 2).bootChars
  assert.ok(mid > 0)
  for (let i = 1; i <= FRAMES / 2; i++)
    assert.ok(paramsAt(i).bootChars >= paramsAt(i - 1).bootChars, `boot log went backwards at frame ${i}`)
})

test("paramsAt is pure — repeated calls return equal values", () => {
  assert.deepEqual(paramsAt(42), paramsAt(42))
})
