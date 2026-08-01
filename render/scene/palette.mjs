/* Dark and light palettes, sourced from tools/tokens/tokens.json so the hero
   cannot drift from the rest of the identity. Values are 0..1 float triples
   ready for gl.uniform3f.

   The path is relative and stays inside profile/: this is a public repository
   and it has to build from a fresh clone with no sibling checkouts on disk.

   WHY tokens.json AND NOT tools/tokens/index.mjs — index.mjs reads the file with
   `node:fs` at module scope, so importing it from a page is a hard failure
   ("Access to script at 'node:fs' ... blocked by CORS"). tokens.json is the same
   canonical artefact index.mjs parses, and a JSON import attribute resolves it
   identically in Chromium and in Node, so the hero and the SVG panels still read
   one source of truth. hexToRgb is four lines and is restated here rather than
   dragging a Node-only module into the browser graph. */

import tokens from "../../tools/tokens/tokens.json" with {type: "json"}

function hexToRgb(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) throw new Error(`invalid hex color: ${hex}`)
  return {r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16)}
}

const f = hex => {
  const {r, g, b} = hexToRgb(hex)
  return [r / 255, g / 255, b / 255]
}

export const DARK = {
  name: "dark",
  bg: f(tokens.color.canvas.bg),
  bgGlow: f(tokens.color.phosphor.dark),
  grid: f(tokens.color.canvas.grid),
  particle: f(tokens.color.phosphor.primary),
  particleHot: f(tokens.color.phosphor.bright),
  particleCold: f(tokens.color.phosphor.dark),
  ring: f(tokens.color.ibm.blue),
  ringHot: f(tokens.color.ibm.tint),
  // Additive: light accumulating on an unlit tube. Also selects the backdrop's
  // polarity — grid and halo ADD here, and subtract in the light variant.
  additive: true,
  gridGain: 1.0,
  crt: true,
  // The site runs bloom at 0.95 over a mostly-dark field at 60fps. Here the
  // scene is additive particles on black and the frame is a still: at 0.95 the
  // 6-tap bloom lifts the whole field and the lobes clip to white. 0.5 keeps the
  // phosphor halo and keeps #00ff66 reading as green rather than as blown-out.
  bloom: 0.50,
  // 0.05 is the site's value; on a 3:1 banner it bends the corners far enough to
  // punch black wedges through the frame, so the hero runs a fifth of it — enough
  // curvature to read as glass, not enough to eat the edges.
  barrel: 0.010,
  // Short trails, and this number matters more than it looks. The structure
  // turns a full 360° over the 8 s loop, i.e. 2.25° per frame. At decay 0.74 the
  // phosphor still carries ~10 frames of history, so every still frame is a 22°
  // rotational smear — the arms come out as blurred brush strokes instead of
  // filaments. At 0.45 the trail is ~3 frames (7°): visible as persistence in
  // motion, sharp as a still.
  decay: 0.45,
  grain: 0.016,
  // Point alpha: additive on black, so the nebula can stay faint and still read.
  alpha: 1.0,
}

/* The light variant is not the dark one with the colours swapped — it is a
   different object. Ink deposits on paper instead of light accumulating on a
   tube, so the blending is SRC_ALPHA/ONE_MINUS_SRC_ALPHA, the backdrop terms run
   subtractively, and the CRT is off entirely: barrel distortion and scanlines on
   a white sheet read as a printing fault, not as a monitor. */
export const LIGHT = {
  name: "light",
  bg: f("#f6f8fa"),
  bgGlow: f("#dbe6f7"),
  grid: f("#c4d0e0"),
  particle: f(tokens.color.ibm.blueDark),
  particleHot: f(tokens.color.ibm.blueDeep),
  particleCold: f("#9fb3cc"),
  ring: f(tokens.color.ibm.blueDeep),
  ringHot: f(tokens.color.ibm.blueDark),
  additive: false,
  gridGain: 0.85,
  crt: false,
  bloom: 0.0,
  barrel: 0.0,
  decay: 0.0,
  grain: 0.0,
  alpha: 0.85,
}

export function paletteFor(name) {
  return name === "light" ? LIGHT : DARK
}
