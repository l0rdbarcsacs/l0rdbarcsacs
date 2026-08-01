/* Design tokens for CERBERUS // PUBLIC TERMINAL.
   Canonical source: the @theme block of the portfolio site behind jose.cerberus.cl.
   Kept in sync by hand — tokens.test.mjs pins the phosphor + IBM families so
   drift fails loudly rather than silently splitting the visual identity. */

import {readFileSync} from "node:fs"
import {fileURLToPath} from "node:url"

export const tokens = JSON.parse(readFileSync(fileURLToPath(new URL("./tokens.json", import.meta.url)), "utf8"))

export function hexToRgb(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m)
    throw new Error(`invalid hex color: ${hex}`)
  return {r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16)}
}

export function rgbToHex({r, g, b}) {
  const c = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")
  return `#${c(r)}${c(g)}${c(b)}`
}

/** Relative luminance (sRGB, Rec. 709 coefficients). */
export function luminance(hex) {
  const {r, g, b} = hexToRgb(hex)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/** N-step phosphor intensity ramp: ghost → dark → dim → primary → bright.
 *  Interpolates linearly in sRGB across the five anchor tokens so any N ≥ 2
 *  lands exactly on ghost at index 0 and bright at index N-1. */
export function phosphorRamp(steps) {
  if (steps < 2)
    throw new Error("phosphorRamp requires at least 2 steps")
  const {ghost, dark, dim, primary, bright} = tokens.color.phosphor
  const anchors = [ghost, dark, dim, primary, bright].map(hexToRgb)
  return Array.from({length: steps}, (_, i) => {
    const t = (i / (steps - 1)) * (anchors.length - 1)
    const lo = Math.floor(t), hi = Math.min(lo + 1, anchors.length - 1), f = t - lo
    return rgbToHex({
      r: anchors[lo].r + (anchors[hi].r - anchors[lo].r) * f,
      g: anchors[lo].g + (anchors[hi].g - anchors[lo].g) * f,
      b: anchors[lo].b + (anchors[hi].b - anchors[lo].b) * f,
    })
  })
}
