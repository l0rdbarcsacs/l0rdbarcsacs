/* Base64-embedded webfonts for standalone SVGs.

   WHY THIS EXISTS — verified empirically on 2026-07-31:
   GitHub serves README images through camo as <img src>. Inside that context an
   SVG has NO network access, so `font-family: "VT323"` silently degrades to the
   viewer's generic monospace and the CRT identity is lost. A woff2 embedded as a
   base64 data: URI inside the SVG's own <style> renders correctly, because it
   needs no fetch.

   Test fixture and screenshots: /tmp/claude-1000/camo-test/
     a-nofont.svg  → generic monospace (fails)
     b-embedded.svg → VT323 renders (passes)

   The faces here are subset with pyftsubset to the glyph set the renderers
   actually emit, which is what keeps the overhead at ~27 KB instead of ~180 KB
   for the full families. If a renderer starts emitting glyphs outside CHARSET
   below, re-run scripts/subset-fonts.sh or the missing glyphs render as .notdef. */

import {readFileSync} from "node:fs"
import {fileURLToPath} from "node:url"

/** The exact glyph set the subset files were built from. Keep in sync with
 *  scripts/subset-fonts.sh — a renderer emitting anything outside this set will
 *  show .notdef boxes rather than falling back to a system font. */
export const CHARSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ,.:;·/\\-_()[]{}&#%+*=<>|\"'!?@áéíóúñÁÉÍÓÚÑ→▸◂●○■□▪"

const FACES = {
  display: {file: "vt323-400.woff2", family: "CerberusDisplay", weight: 400},
  mono: {file: "plex-mono-400.woff2", family: "CerberusMono", weight: 400},
  monoBold: {file: "plex-mono-700.woff2", family: "CerberusMono", weight: 700},
}

/** Font-family stacks to use in generated SVG. The embedded family comes first;
 *  the generic fallback only ever applies if the data URI itself fails to parse. */
export const STACK = {
  display: "CerberusDisplay, monospace",
  mono: "CerberusMono, monospace",
}

function dataUri(file) {
  const bytes = readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)))
  return `data:font/woff2;base64,${bytes.toString("base64")}`
}

/** Emit the @font-face rules for the requested faces.
 *  @param {Array<"display"|"mono"|"monoBold">} faces
 *  @returns {string} CSS to inline inside an SVG <style> element */
export function fontFaceCss(faces = ["display", "mono"]) {
  return faces.map(key => {
    const face = FACES[key]
    if (!face)
      throw new Error(`fonts: unknown face "${key}" (have: ${Object.keys(FACES).join(", ")})`)
    return `@font-face{font-family:"${face.family}";font-style:normal;font-weight:${face.weight};src:url(${dataUri(face.file)}) format("woff2")}`
  }).join("")
}

/** Byte cost of embedding a given set of faces — used by size-budget tests. */
export function embeddedSize(faces = ["display", "mono"]) {
  return fontFaceCss(faces).length
}
