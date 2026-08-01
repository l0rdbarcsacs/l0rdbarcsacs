/* Task 2 Step 5 harness. Temporary — capture.mjs (Task 3) supersedes it.
   Usage: node _verify.mjs [frameList] [theme] */
import {chromium} from "playwright"
import {LAUNCH, VIEWPORT, DEVICE_SCALE_FACTOR} from "./launch.mjs"

const HERE = import.meta.dirname
const OUT = "/tmp/claude-1000/preview"
const frames = (process.argv[2] ?? "80").split(",").map(Number)
const theme = process.argv[3] ?? "dark"

const b = await chromium.launch(LAUNCH)
const p = await b.newPage({viewport: VIEWPORT, deviceScaleFactor: DEVICE_SCALE_FACTOR})
const errs = []
p.on("console", m => m.type() === "error" && errs.push(m.text()))
p.on("pageerror", e => errs.push(String(e)))

await p.goto(`file://${HERE}/index.html?theme=${theme}`)
try {
  await p.waitForFunction("window.__ready === true", {timeout: 20000})
} catch (e) {
  console.error("NOT READY:", String(e).split("\n")[0])
  console.error(errs.length ? errs.join("\n") : "(no console/page errors captured)")
  await b.close()
  process.exit(1)
}

const gpu = await p.evaluate(`(() => {
  const c = document.createElement("canvas").getContext("webgl2")
  const d = c.getExtension("WEBGL_debug_renderer_info")
  return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : "unknown"
})()`)

const t0 = Date.now()
for (const f of frames) {
  await p.evaluate(`window.__frame(${f})`)
  const tag = theme === "light" ? `-light` : ``
  await p.screenshot({path: `${OUT}/hero-f${f}${tag}.png`, animations: "disabled"})
}
const ms = (Date.now() - t0) / frames.length

await b.close()
console.log(`renderer: ${gpu}`)
console.log(`per-frame: ${ms.toFixed(0)} ms (incl. screenshot)`)
console.log(errs.length ? "CONSOLE ERRORS:\n" + errs.join("\n") : "clean render")
