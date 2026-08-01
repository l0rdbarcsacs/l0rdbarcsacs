#!/usr/bin/env node
/* Captures every frame of the hero deterministically.

   index.html exposes window.__frame(i) and never calls requestAnimationFrame, so
   frame timing is driven entirely from here. That is what makes a re-render
   reproducible: no wall-clock, no dropped frames, no dependence on GPU speed.

   Usage: node capture.mjs [--theme dark|light] */

import {mkdirSync, rmSync} from "node:fs"
import {chromium} from "playwright"
import {LAUNCH, VIEWPORT, DEVICE_SCALE_FACTOR} from "./launch.mjs"

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const theme = arg("theme", "dark")
const out = arg("out", `${import.meta.dirname}/frames/${theme}`)

rmSync(out, {recursive: true, force: true})
mkdirSync(out, {recursive: true})

const browser = await chromium.launch(LAUNCH)
const page = await browser.newPage({viewport: VIEWPORT, deviceScaleFactor: DEVICE_SCALE_FACTOR})

const errors = []
page.on("pageerror", e => errors.push(String(e)))
page.on("console", m => m.type() === "error" && errors.push(m.text()))

await page.goto(`file://${import.meta.dirname}/index.html?theme=${theme}`)
await page.waitForFunction("window.__ready === true", {timeout: 60_000})

const renderer = await page.evaluate(`(() => {
  const gl = document.createElement("canvas").getContext("webgl2")
  const dbg = gl && gl.getExtension("WEBGL_debug_renderer_info")
  return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "NO WEBGL2 CONTEXT"
})()`)
console.log(`capture[${theme}]: renderer = ${renderer}`)
if (/NO WEBGL2/.test(renderer))
  throw new Error("capture: no WebGL2 context — check launch.mjs flags")

const frames = await page.evaluate("window.__FRAMES")
for (let i = 0; i < frames; i++) {
  await page.evaluate(`window.__frame(${i})`)
  await page.screenshot({path: `${out}/f_${String(i).padStart(4, "0")}.png`, animations: "disabled"})
  if (i % 40 === 0)
    console.log(`capture[${theme}]: ${i}/${frames}`)
}

await browser.close()
if (errors.length) {
  console.error(`capture: ${errors.length} page error(s):\n${errors.join("\n")}`)
  process.exit(1)
}
console.log(`capture[${theme}]: wrote ${frames} frames to ${out}`)
