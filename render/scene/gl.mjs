/* ═══════════════════════════════════════════════════════════════════════════
   gl.mjs — tiny WebGL2 helpers (shaders, programs, framebuffers, quad).

   Ported from the portfolio's WebGL layer with the TypeScript types stripped;
   the bodies are unchanged so the hero and the site share one implementation.
   Two deliberate differences, both forced by the capture pipeline:

   1. `preserveDrawingBuffer: true` — the site explicitly disables it because
      nothing screenshots a 60 fps fullscreen canvas. Here the entire point is
      that Playwright screenshots the canvas after `window.__frame(i)` returns,
      outside any compositor-driven paint, so the buffer MUST survive.
   2. `antialias: false` is kept: the hero is rendered at 2× and downsampled by
      ffmpeg, which is a better antialiaser than MSAA for additive points.
   ═══════════════════════════════════════════════════════════════════════════ */

export function getGL(canvas) {
  return canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    premultipliedAlpha: false,
    powerPreference: "high-performance",
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true,
  })
}

export function compile(gl, type, src) {
  const sh = gl.createShader(type)
  if (!sh) throw new Error("createShader failed")
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error(`shader compile error: ${log}`)
  }
  return sh
}

export function createProgram(gl, vsSrc, fsSrc) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc)
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc)
  const p = gl.createProgram()
  if (!p) throw new Error("createProgram failed")
  gl.attachShader(p, vs)
  gl.attachShader(p, fs)
  gl.linkProgram(p)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p)
    gl.deleteProgram(p)
    throw new Error(`program link error: ${log}`)
  }
  return p
}

export function createFbo(gl, w, h) {
  const tex = gl.createTexture()
  const fb = gl.createFramebuffer()
  if (!tex || !fb) throw new Error("createFbo failed")
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return {fb, tex, w, h}
}

export function resizeFbo(gl, fbo, w, h) {
  if (fbo.w === w && fbo.h === h) return
  fbo.w = w
  fbo.h = h
  gl.bindTexture(gl.TEXTURE_2D, fbo.tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
}

export function disposeFbo(gl, fbo) {
  gl.deleteTexture(fbo.tex)
  gl.deleteFramebuffer(fbo.fb)
}

/** Fullscreen-triangle VAO (covers clip space with one triangle). */
export function createFullscreenVAO(gl) {
  const vao = gl.createVertexArray()
  if (!vao) throw new Error("createVertexArray failed")
  const buf = gl.createBuffer()
  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  // Big triangle covering the viewport.
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.bindVertexArray(null)
  return vao
}

/**
 * Resolve uniform locations once at program creation — never per frame.
 * `names` must exactly match the uniform identifiers in the paired shader
 * source — a typo silently resolves to a null location with no error.
 */
export function cacheUniforms(gl, prog, names) {
  const map = {}
  for (const n of names) map[n] = gl.getUniformLocation(prog, n)
  return map
}

/** Upload a Float32Array as a STATIC_DRAW attribute on the currently bound VAO. */
export function staticAttrib(gl, location, data, components) {
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
  gl.enableVertexAttribArray(location)
  gl.vertexAttribPointer(location, components, gl.FLOAT, false, 0, 0)
  return buf
}

/** Deterministic PRNG. Every generator in the scene draws from one of these so
 *  a re-render on another machine produces the same bytes. */
export function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Box–Muller on a mulberry32 stream — used for the gaussian particle clusters. */
export function gaussian(rnd) {
  let u = 0
  while (u === 0) u = rnd()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd())
}
