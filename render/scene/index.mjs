/* createScene(canvas, palette) — the single entry point index.html uses.

   `scene.render(params)` is a PURE function of `params`. That is the whole
   contract: capture.mjs calls window.__frame(i) in whatever order it likes and
   gets the same pixels every time.

   Purity is not free here, because the CRT's phosphor persistence is by
   definition a function of the frames that came before. The fix is a pre-roll:
   before compositing frame N the persistence chain is cleared and frames
   N-PREROLL .. N-1 are folded into it. With decay d the forgotten tail is
   d^PREROLL — at d=0.45 and PREROLL=8 that is 0.0017, far under one 8-bit level,
   so the pre-rolled buffer is indistinguishable from an infinitely long
   run. And because timeline.paramsAt is periodic, paramsAt(-1) is visually
   paramsAt(FRAMES-1): frame 0's phosphor trail is the trail it would have had
   coming round the loop, so the loop closes through the persistence too. */

import {getGL, createFbo} from "./gl.mjs"
import {createBackdrop} from "./backdrop.mjs"
import {buildGeometry, createCore} from "./core.mjs"
import {createRings} from "./rings.mjs"
import {CrtPost} from "./crt.mjs"
import {paramsAt, DURATION} from "../timeline.mjs"

export const LOGICAL = {w: 1280, h: 420}

/* Composition. The core sits right of centre because the left third carries the
   wordmark and the boot log; a centred core would sit underneath the type. */
const CORE_CX = 0.672
const CORE_CY = 0.468
const WORLD_PX = 130          // CSS pixels per world unit
const CAM_Z = 3.4
const PREROLL = 8

export async function createScene(canvas, palette) {
  const dpr = Math.max(1, Math.round(canvas.width / LOGICAL.w)) || 1
  const w = canvas.width
  const h = canvas.height

  const gl = getGL(canvas)
  if (!gl) throw new Error("scene: WebGL2 is unavailable")

  const view = {
    w, h, dpr,
    scale: [(WORLD_PX * dpr) / (w / 2), (WORLD_PX * dpr) / (h / 2)],
    center: [2 * CORE_CX - 1, 1 - 2 * CORE_CY],
    corePx: [CORE_CX * w, (1 - CORE_CY) * h],
    camZ: CAM_Z,
    pointBase: 1.95 * dpr,
  }

  const geo = buildGeometry()
  const backdrop = createBackdrop(gl, palette)
  const core = createCore(gl, palette, geo)
  const rings = createRings(gl, palette)
  const crt = new CrtPost(gl)
  crt.resize(w, h)

  const sceneFbo = createFbo(gl, w, h)

  function drawScene(p) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo.fb)
    gl.viewport(0, 0, w, h)
    backdrop.draw(view, p)
    gl.enable(gl.BLEND)
    gl.blendEquation(gl.FUNC_ADD)
    if (palette.additive) gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
    else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    rings.draw(view, p)
    core.draw(view, p)
    gl.disable(gl.BLEND)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return sceneFbo.tex
  }

  return {
    gl,
    view,
    render(p) {
      const decay = palette.decay
      crt.clear()
      if (decay > 0) {
        for (let k = PREROLL; k >= 1; k--)
          crt.accumulate(drawScene(paramsAt(p.frame - k)), decay)
      }
      const tex = crt.accumulate(drawScene(p), decay)
      crt.composite(tex, {
        crt: palette.crt,
        bloom: palette.bloom,
        barrel: palette.barrel,
        surge: 0,
        // Frame-derived, never a wall clock.
        time: p.u * DURATION,
        // 1 = "medium": grain on, aperture grille off. The grille is a 3-device-
        // pixel triad; at 2x it survives the downsample as chroma noise rather
        // than as a grille, which is worse than not having it.
        fx: palette.crt ? 1 : 0,
        wobble: 0.0006 * (0.5 + 0.5 * Math.cos(p.u * Math.PI * 2 * 4)),
        grainSeed: p.grainSeed,
        grainAmp: palette.grain,
      })
      gl.finish()
    },
    dispose() {
      backdrop.dispose()
      core.dispose()
      rings.dispose()
      crt.dispose()
    },
  }
}
