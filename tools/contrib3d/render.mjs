/* Renders a contribution calendar as an animated isometric SVG in the CERBERUS
   phosphor palette. Pure: no network, no clock, no randomness — same input is
   byte-identical output, which is what makes it snapshot-testable.

   Animation is CSS (not SMIL) inside a <style> element. GitHub serves README
   images through camo as <img>, where declarative CSS animation runs but
   scripts do not — the same mechanism Platane/snk and readme-typing-svg use.
   That sandbox also has no network, so the webfonts are inlined as base64
   woff2: naming a family that would have to be fetched degrades silently to the
   viewer's generic monospace and the CRT identity is gone.

   ENCODING — height and colour are two views of ONE number. `norm` is the log of
   the day's count over the log of the 98th percentile of the ACTIVE days, so a
   day that is twice as tall is also exactly one ramp region brighter. GitHub's
   own `level` quartile is deliberately not rendered: on this calendar it drops
   152 of 179 active days into a single near-black step (#003b16 on #000000)
   while their real counts span 1..238. Logarithmic because contribution counts
   are heavily right-skewed — it spreads the crowded low end across the ramp and
   still lets the top day reach the brightest step.

   LAYOUT — a 53x7 grid in 2:1 isometric is a thin diagonal band and its bounding
   box is mostly void. Instead of padding around the band, the title, the total
   and the legend are placed *inside* the triangles the band leaves behind, and
   the canvas is tightened onto the towers. Each block asks the geometry where
   its ink actually ends (`inkSpan`) rather than reserving a fixed margin, so the
   padding is exactly the shortfall and never more. */

import {tokens, phosphorRamp} from "../tokens/index.mjs"
import {fontFaceCss, STACK} from "../fonts/index.mjs"
import {boxFaces, gridBounds} from "./project.mjs"

/* Intrinsic size drives legibility: the README embeds this at width="100%"
   (~1012 CSS px). tileW 30 puts the natural width at 980, an upscale of 1.03,
   so a 30px title renders at ~31px next to a real 24px <h2> instead of being
   blown up to 47px by a 2.13x stretch. */
const GEO = {tileW: 30, tileH: 15, unitH: 6}
const PAD = {x: 40, edge: 16}   // side gutter, and the floor for top/bottom
const CLEAR = 16                // minimum gap between text ink and tower ink
const RAMP = phosphorRamp(9)
const TOP_STEP = RAMP.length - 1
const MAX_H = GEO.unitH * 8     // height of a norm === 1 tower
const TYPE = {title: 30, total: 26, label: 11, micro: 10}
const STAGGER = 0.6             // seconds from the first tower to the last
const LEGEND = {sw: 18, sh: 10, lo: "LOW", hi: "HIGH", caption: "COMMITS PER DAY · LOG SCALE"}

/* Advance width per em of the two embedded faces (both monospaced). Used only to
   reserve space for a text block, never to position individual glyphs. */
const ADV = {display: 0.5, mono: 0.6}
const textW = (s, size, face) => s.length * size * ADV[face]

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

const pts = quad => quad.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")
const n1 = v => Number(v.toFixed(1))

/** Face shading: the top face reads at full intensity, the side faces are
 *  darkened so the volume is legible without any lighting model. */
function shade(hex, factor) {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.round(((n >> 16) & 255) * factor)
  const g = Math.round(((n >> 8) & 255) * factor)
  const b = Math.round((n & 255) * factor)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`
}

/** Reference intensity: the 98th percentile (nearest rank) of the ACTIVE days.
 *  A percentile rather than the max so one 238-commit outlier cannot flatten a
 *  whole year; the max is the honest fallback below 20 active days, where a
 *  percentile means nothing. */
export function intensityRef(counts) {
  const active = counts.filter(c => c > 0).sort((a, z) => a - z)
  if (active.length === 0)
    return 1
  const i = active.length < 20 ? active.length - 1 : Math.ceil(0.98 * active.length) - 1
  return Math.max(1, active[i])
}

/** count → 0..1. The single channel that drives BOTH height and colour. */
export function normalise(count, ref) {
  if (count <= 0)
    return 0
  return Math.min(1, Math.log1p(count) / Math.log1p(Math.max(1, ref)))
}

/** norm → index into the 9-step phosphor ramp. */
export const rampIndex = norm => Math.round(norm * TOP_STEP)

/** norm → box height. Zero days stay flat tiles: a floor plate for the dead half
 *  of the year would read as data it does not have. */
export const heightOf = norm => (norm <= 0 ? 0 : GEO.unitH * (1 + 7 * norm))

/** Where the drawn geometry's ink actually starts and ends vertically over a
 *  horizontal slice of the grid, in grid space. A box at (col,row) spans
 *  x ∈ [(col-row-1)·tileW/2, (col-row+1)·tileW/2]; its highest pixel is the lifted
 *  top apex and its lowest is the south base corner. */
export function inkSpan(cells, x0, x1, geo = GEO) {
  const hw = geo.tileW / 2, hh = geo.tileH / 2
  let top = Infinity, bottom = -Infinity
  for (const {col, row, h} of cells) {
    if ((col - row + 1) * hw < x0 || (col - row - 1) * hw > x1)
      continue
    top = Math.min(top, (col + row) * hh - h)
    bottom = Math.max(bottom, (col + row + 2) * hh)
  }
  return {top, bottom}
}

export function renderIsoSvg(calendar, {title = "CONTRIBUTION MATRIX", subtitle = ""} = {}) {
  const weeks = calendar.weeks
  const cols = weeks.length
  const rows = 7
  const counts = weeks.flatMap(w => w.days.map(d => d.count))
  const ref = intensityRef(counts)

  // Painter's algorithm: back-to-front is increasing (col + row).
  const cells = []
  for (const [col, week] of weeks.entries()) {
    for (const [row, day] of week.days.entries()) {
      const norm = normalise(day.count, ref)
      cells.push({col, row, count: day.count, norm, h: heightOf(norm), depth: col + row})
    }
  }
  cells.sort((a, z) => a.depth - z.depth || a.col - z.col)

  const b = gridBounds({cols, rows, maxHeight: MAX_H}, GEO)
  const maxY = b.minY + b.height

  /* ---- text blocks ------------------------------------------------------- */
  const totalNum = calendar.total.toLocaleString("en-US")
  const totalLabel = `${totalNum} CONTRIBUTIONS`
  const titleW = Math.max(textW(title, TYPE.title, "display"), textW(subtitle, TYPE.label, "mono"))
  const totalW = Math.max(textW(totalNum, TYPE.total, "display"), textW("CONTRIBUTIONS", TYPE.micro, "mono"))
  const barW = RAMP.length * LEGEND.sw
  const loW = textW(LEGEND.lo, TYPE.micro, "mono")
  const legendW = loW + 8 + barW + 8 + textW(LEGEND.hi, TYPE.micro, "mono")
  const footW = Math.max(legendW, textW(LEGEND.caption, TYPE.micro, "mono"))

  // Ink depth of each block measured from the canvas edge it is anchored to.
  const TITLE_H = subtitle ? 62 : 42
  const TOTAL_H = 58
  const FOOT_H = 32

  /* ---- canvas ------------------------------------------------------------ */
  // Width is the band plus one gutter each side, widened only if the header text
  // would otherwise not fit. The grid is then centred in whatever width results.
  const width = Math.ceil(Math.max(b.width + PAD.x * 2, titleW + totalW + PAD.x * 3))
  const ox = (width - b.width) / 2 - b.minX
  const gx = xc => xc - ox                                  // canvas x → grid x

  // Top padding is the shortfall between where the title block's ink ends and
  // where the towers under it begin — zero when the band has already fallen away.
  const titleInk = inkSpan(cells, gx(PAD.x), gx(PAD.x + titleW))
  const totalInk = inkSpan(cells, gx(width - PAD.x - totalW), gx(width - PAD.x))
  const padTop = Math.max(
    PAD.edge,
    Math.ceil(TITLE_H + CLEAR + b.minY - titleInk.top),
    Math.ceil(TOTAL_H + CLEAR + b.minY - totalInk.top),
  )
  const footInk = inkSpan(cells, gx(PAD.x), gx(PAD.x + footW))
  const padBottom = Math.max(PAD.edge, Math.ceil(footInk.bottom + CLEAR + PAD.edge + FOOT_H - maxY))

  const height = Math.ceil(-b.minY + padTop + maxY + padBottom)
  const oy = -b.minY + padTop

  const maxDepth = Math.max(1, cols - 1 + rows - 1)
  const boxes = cells.map(({col, row, count, norm, h, depth}) => {
    const faces = boxFaces(col, row, h, GEO)
    const i = rampIndex(norm)
    const color = RAMP[i]
    const delay = (depth * (STAGGER / maxDepth)).toFixed(3)
    return [
      `<g class="c" style="animation-delay:${delay}s">`,
      `<polygon points="${pts(faces.left)}" fill="${shade(color, 0.45)}"/>`,
      `<polygon points="${pts(faces.right)}" fill="${shade(color, 0.68)}"/>`,
      `<polygon points="${pts(faces.top)}" fill="${color}"${count > 0 && i >= 6 ? ' class="lit"' : ""}/>`,
      `</g>`,
    ].join("")
  }).join("\n")

  /* ---- footer legend ----------------------------------------------------- */
  const footY = height - PAD.edge          // baseline of the lowest footer ink
  const barX = PAD.x + loW + 8
  const swatches = RAMP.map((c, i) =>
    `<rect x="${n1(barX + i * LEGEND.sw)}" y="${n1(footY - 12)}" width="${LEGEND.sw}" height="${LEGEND.sh}" fill="${c}"/>`,
  ).join("")

  const {canvas, phosphor, ibm} = tokens.color

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)} · ${esc(totalLabel)}">
<title>${esc(title)} · ${esc(totalLabel)}</title>
<style>
  ${fontFaceCss(["display", "mono"])}
  .c { animation: rise 0.5s ease-out backwards; }
  @keyframes rise { from { opacity: 0.35; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
  .lit { filter: drop-shadow(0 0 2px ${phosphor.primary}); }
  .hd { font-family: ${STACK.display}; fill: ${phosphor.primary}; }
  .ac { font-family: ${STACK.display}; fill: ${ibm.blue}; }
  .lb { font-family: ${STACK.mono}; fill: ${phosphor.dim}; letter-spacing: ${tokens.tracking.caps}; }
  .mc { font-family: ${STACK.mono}; fill: ${phosphor.dim}; letter-spacing: ${tokens.tracking.kicker}; }
  @media (prefers-reduced-motion: reduce) { .c { animation: none; } }
</style>
<rect width="${width}" height="${height}" fill="${canvas.bg}"/>
<rect x="0" y="0" width="${width}" height="1" fill="${phosphor.dark}"/>
<g transform="translate(${n1(ox)},${n1(oy)})">
${boxes}
</g>
<text class="hd" x="${PAD.x}" y="36" font-size="${TYPE.title}">${esc(title)}</text>
${subtitle ? `<text class="lb" x="${PAD.x}" y="58" font-size="${TYPE.label}">${esc(subtitle)}</text>` : ""}
<text class="ac" x="${width - PAD.x}" y="36" font-size="${TYPE.total}" text-anchor="end">${esc(totalNum)}</text>
<text class="mc" x="${width - PAD.x}" y="55" font-size="${TYPE.micro}" text-anchor="end">CONTRIBUTIONS</text>
<text class="mc" x="${PAD.x}" y="${n1(footY - 22)}" font-size="${TYPE.micro}">${esc(LEGEND.caption)}</text>
<text class="mc" x="${PAD.x}" y="${n1(footY - 3.5)}" font-size="${TYPE.micro}">${LEGEND.lo}</text>
${swatches}
<text class="mc" x="${n1(barX + barW + 8)}" y="${n1(footY - 3.5)}" font-size="${TYPE.micro}">${LEGEND.hi}</text>
</svg>
`
}
