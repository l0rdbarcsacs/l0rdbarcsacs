/* Renders an aggregated language distribution as a standalone SVG in the CERBERUS
   palette. Pure: no network, no clock, no randomness — byte-identical for identical
   input, which is what makes it snapshot-testable.

   Fonts are embedded as base64 woff2 because in GitHub's camo <img> context an SVG
   has no network and a font-family name silently degrades to generic monospace.
   Verified on 2026-07-31.

   Language swatch colours stay canonical (GitHub's own per-language hues) rather
   than being folded into the phosphor ramp: they are the one place in this design
   where colour carries identity rather than intensity, and readers already know
   them. Everything else — canvas, type, rules, labels — is CERBERUS. */

import {tokens} from "../tokens/index.mjs"
import {fontFaceCss, STACK} from "../fonts/index.mjs"

const W = 1000
const PAD = 34
const ROW_H = 34
const BAR_H = 12
const LABEL_W = 150
const NUM_W = 250

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function mb(bytes) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} kB`
}

const pct = share => `${(share * 100).toFixed(share >= 0.1 ? 1 : 2)}%`

/** The folded "Other" bucket has no meaningful repository count — max across the
 *  folded languages would read as a real figure for a row that is an aggregate. */
function repoLabel(lang) {
  if (lang.name.startsWith("Other ("))
    return ""
  return lang.repos === 1 ? "1 repo" : `${lang.repos} repos`
}

export function renderLanguagePanel(data, {title = "LANGUAGE DISTRIBUTION", note = ""} = {}) {
  const {canvas, phosphor, ibm} = tokens.color
  const langs = data.languages
  const top = PAD + 58
  const H = top + langs.length * ROW_H + (note ? 34 : 14)

  const fallback = [phosphor.primary, phosphor.dim, ibm.blue, phosphor.bright, ibm.blueDeep, phosphor.dark]
  const colourOf = (lang, i) => lang.color ?? fallback[i % fallback.length]

  // One bar per language on a LOGARITHMIC scale, not a single stacked bar.
  //
  // The distribution is extreme: the top language holds ~92% of the bytes, so a
  // linear stacked bar renders as one solid block and every other language
  // collapses to a hairline. That is truthful and useless — it hides exactly the
  // breadth a reader is looking for. Log scaling is the standard treatment for
  // count data spanning orders of magnitude; the exact MB and percentage sit in
  // the same row, so nothing is obscured, and the axis is labelled as log.
  const barMax = W - PAD * 2 - LABEL_W - NUM_W
  const maxBytes = Math.max(...langs.map(l => l.bytes), 1)
  const logScale = bytes => {
    if (bytes <= 0)
      return 0
    // Normalise against a floor three decades below the largest language so the
    // smallest entries still get a visible, comparable bar.
    const floor = Math.max(1024, maxBytes / 10_000)
    const t = Math.log(Math.max(bytes, floor) / floor) / Math.log(maxBytes / floor)
    return Math.max(6, t * barMax)
  }

  const rows = langs.map((lang, i) => {
    const y = top + i * ROW_H
    const colour = colourOf(lang, i)
    const bw = logScale(lang.bytes)
    const bx = PAD + LABEL_W
    return [
      `<circle cx="${PAD + 7}" cy="${y - 5}" r="6" fill="${colour}"/>`,
      `<text class="lg" x="${PAD + 22}" y="${y}">${esc(lang.name)}</text>`,
      `<rect class="tr" x="${bx}" y="${y - 14}" width="${barMax}" height="${BAR_H}" fill="${phosphor.ghost}"/>`,
      `<rect class="bar" style="animation-delay:${(i * 0.05).toFixed(2)}s" x="${bx}" y="${y - 14}" width="${bw.toFixed(1)}" height="${BAR_H}" fill="${colour}"/>`,
      `<text class="rp" x="${W - PAD - 172}" y="${y}" text-anchor="end">${repoLabel(lang)}</text>`,
      `<text class="nu" x="${W - PAD - 86}" y="${y}" text-anchor="end">${mb(lang.bytes)}</text>`,
      `<text class="pc" x="${W - PAD}" y="${y}" text-anchor="end">${pct(lang.share)}</text>`,
    ].join("")
  }).join("\n")

  const totalLabel = `${mb(data.total)} ACROSS ${data.repoCount} REPOSITORIES`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)} — ${esc(totalLabel)}">
<title>${esc(title)} — ${esc(totalLabel)}</title>
<style>
${fontFaceCss(["display", "mono"])}
  .hd { font-family: ${STACK.display}; fill: ${phosphor.primary}; font-size: 30px; }
  .ac { font-family: ${STACK.mono}; fill: ${ibm.blue}; font-size: 13px; letter-spacing: ${tokens.tracking.caps}; }
  .lg { font-family: ${STACK.mono}; fill: ${phosphor.bright}; font-size: 15px; }
  .nu { font-family: ${STACK.mono}; fill: ${phosphor.dim}; font-size: 14px; }
  .rp { font-family: ${STACK.mono}; fill: ${phosphor.dark}; font-size: 13px; }
  .pc { font-family: ${STACK.mono}; fill: ${phosphor.primary}; font-size: 14px; }
  .ft { font-family: ${STACK.mono}; fill: ${phosphor.dim}; font-size: 12px; }
  .bar { animation: grow .8s cubic-bezier(.2,.8,.3,1) both; transform-origin: left center; }
  @keyframes grow { from { transform: scaleX(.06); opacity: .5 } to { transform: scaleX(1); opacity: 1 } }
  @media (prefers-reduced-motion: reduce) { .bar { animation: none } }
</style>
<rect width="${W}" height="${H}" fill="${canvas.bg}"/>
<rect x="0" y="0" width="${W}" height="1" fill="${phosphor.dark}"/>
<text class="hd" x="${PAD}" y="${PAD + 14}">${esc(title)}</text>
<text class="ac" x="${W - PAD}" y="${PAD + 12}" text-anchor="end">${esc(totalLabel)}</text>
<text class="ft" x="${PAD + LABEL_W}" y="${PAD + 40}">bar is log-scaled — exact volume and share on the right</text>
${rows}
${note ? `<text class="ft" x="${PAD}" y="${H - 12}">${esc(note)}</text>` : ""}
</svg>
`
}
