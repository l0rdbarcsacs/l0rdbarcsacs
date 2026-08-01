# `THE CORE` — hero render pipeline

Renders `assets/hero/hero-dark.webp`, `hero-light.webp` and `hero-static.png`: a
seamless 8-second looping banner, 1280×420, from a deterministic WebGL2 scene.

## Re-render

```bash
npm install                       # from profile/, installs the pinned Playwright
node render/capture.mjs --theme dark
node render/capture.mjs --theme light
render/encode.sh dark && render/encode.sh light
```

## How it stays reproducible

`timeline.mjs` maps a frame index to every animated quantity and nothing else —
no clock, no `Math.random`. `index.html` exposes `window.__frame(i)` and never
calls `requestAnimationFrame`, so the driver, not the compositor, decides when a
frame exists. Geometry comes from a seeded `mulberry32`.

The CRT's phosphor persistence is the one stateful thing in the scene, and it is
neutralised by a pre-roll: before compositing frame *N* the ping-pong buffers are
cleared and frames *N−8 … N−1* are folded back in. Since `paramsAt` is periodic,
`paramsAt(-1)` is visually `paramsAt(159)`, so frame 0 gets the phosphor trail it
would have had coming round the loop — the loop closes through the persistence
too. This was checked by rendering frame 80 three ways — cold, after walking
0…79, and after jumping back from frame 159 — and hashing the screenshots: all
three were identical.

## Chromium flags — measured, not copied

| configuration | WebGL2 renderer |
|---|---|
| `chrome-headless-shell` + `--use-gl=angle --use-angle=gl` | **context creation fails** |
| `chrome-headless-shell` + `--use-angle=swiftshader` | SwiftShader (CPU) |
| `channel:"chromium"` + `--use-angle=gl` | **context creation fails** |
| `channel:"chromium"`, defaults | SwiftShader (CPU) |
| `channel:"chromium"` + `--use-angle=vulkan --enable-gpu` | NVIDIA RTX 3070 |

So the full Chromium build is required and ANGLE must be pointed at Vulkan;
`launch.mjs` holds both configurations. `--allow-file-access-from-files` is also
mandatory — `index.html` is an ES module graph and Chromium blocks
`file://` → `file://` module fetches as cross-origin without it.

Set `HERO_SWIFTSHADER=1` to render on the CPU instead. It is about two orders of
magnitude slower but identical on every machine, which is the configuration to
use if the render ever has to be reproduced bit-for-bit off this workstation.

## Layers

| # | Layer | Where |
|---|---|---|
| 0 | Background grid, core halo, vignette | `scene/backdrop.mjs` |
| 1 | Particle core — 48k points, additive | `scene/core.mjs` |
| 2 | Three orbit rings | `scene/rings.mjs` |
| 3 | CRT post-process (ported from the portfolio's `crt.ts`) | `scene/crt.mjs` |
| 4 | Wordmark, boot log, HUD | DOM, in `index.html` |

Typography is DOM rather than WebGL so the wordmark survives the 2× downsample
and the WebP quantiser as real rasterised type. The scanline overlay is applied
over the DOM as well as the canvas — without that the CRT treatment stops at the
edge of the wordmark and the composite reads as two unrelated layers.

`fonts/` holds local copies of the three subset faces from `packages/fonts/`,
referenced relatively; the page awaits `document.fonts.load(...)` and
`document.fonts.ready` before setting `window.__ready`, or the first frames
capture in a fallback face.

## Palettes

`scene/palette.mjs` reads `tools/tokens/tokens.json` directly rather than
`tools/tokens/index.mjs`, because that module reads the file with `node:fs` at
module scope and cannot be imported by a page. It is the same canonical artefact.

The light variant is not the dark one inverted. Ink deposits on paper instead of
light accumulating on a tube, so the particle blend is `SRC_ALPHA /
ONE_MINUS_SRC_ALPHA`, the backdrop's grid and halo terms run subtractively
(`u_polarity`), and the CRT is off entirely — barrel distortion and scanlines on
a white sheet read as a printing fault, not as a monitor.
