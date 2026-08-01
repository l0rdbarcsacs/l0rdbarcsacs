#!/usr/bin/env node
/* Usage: node cli.mjs <output.svg> [--login l0rdbarcsacs] [--title "..."] */

import {writeFileSync, mkdirSync} from "node:fs"
import {dirname} from "node:path"
import {fetchCalendar} from "./fetch.mjs"
import {renderIsoSvg} from "./render.mjs"

const [out = "contrib-3d.svg"] = process.argv.slice(2).filter(a => !a.startsWith("--"))
const arg = name => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : null
}

const token = process.env.METRICS_TOKEN ?? process.env.GITHUB_TOKEN
if (!token)
  throw new Error("contrib3d: GITHUB_TOKEN is required")

const calendar = await fetchCalendar({token, login: arg("login") ?? "l0rdbarcsacs"})
const svg = renderIsoSvg(calendar, {
  title: arg("title") ?? "CONTRIBUTION MATRIX",
  subtitle: arg("subtitle") ?? "including private repositories · rendered by contrib3d",
})

mkdirSync(dirname(out), {recursive: true})
writeFileSync(out, svg)
console.log(`contrib3d: wrote ${out} (${(svg.length / 1024).toFixed(1)} KB, ${calendar.total} contributions)`)
