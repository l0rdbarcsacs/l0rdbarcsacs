/* crt.mjs — GPU CRT post-process, ported from the portfolio's crt.ts.

   Pass 1: phosphor persistence (ping-pong, scene blended with a decaying prev).
   Pass 2: final composite — bloom, barrel, chroma, grain, scanline, vignette.

   PORT NOTES — the shader bodies are the site's, with exactly two changes, both
   demanded by the fact that this render is captured frame-by-frame rather than
   animated in real time:

   1. `u_time` is fed `params.u * DURATION`, never a wall clock. It only drives
      the horizontal sync wobble here.
   2. The film-grain term was reading `u_time`, which makes the grain field a
      function of continuous time. Grain must be FRAME-indexed to be periodic, so
      it now reads `u_grainSeed` (from timeline's `grainSeed`) and its amplitude
      is a uniform rather than a literal 0.02 — grain is the dominant cost in the
      WebP bitrate, so the encoder budget needs a knob on it.

   The tier machinery (QualityTier, the dt-anchored decay/bloom lerp, the surge
   envelope) is deliberately dropped: there is no runtime here to degrade, and a
   time-anchored lerp is exactly the kind of state that would make frame N depend
   on how frame N-1 was reached. Every value is passed in per frame instead. */

import {
  createProgram, createFullscreenVAO, createFbo, resizeFbo, disposeFbo, cacheUniforms,
} from "./gl.mjs"

const PASS_VS = `#version 300 es
layout(location=0) in vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }`

const PERSIST_FS = `#version 300 es
precision highp float;
uniform sampler2D u_scene;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_decay;
out vec4 frag;
void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  vec3 s = texture(u_scene, uv).rgb;
  vec3 p = texture(u_prev, uv).rgb * u_decay;
  frag = vec4(max(s, p), 1.0);
}`

const FINAL_FS = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_bloom;
uniform float u_barrel;
uniform float u_surge;
uniform float u_time;
uniform float u_fx;                       // tier as a number: 0=low,1=medium,2=high
uniform float u_wobble;                   // horizontal sync wobble
uniform float u_grainSeed;                // PORT: frame-indexed, replaces u_time in the grain
uniform float u_grainAmp;                 // PORT: was a literal 0.02
out vec4 frag;
// Same hash used by the site's BG_FS — shaders don't share code, so it's
// duplicated here for the film-grain term.
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
vec2 barrel(vec2 uv, float amt){
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  return uv + c * r2 * amt;
}
void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 buv = barrel(uv, u_barrel);
  buv.x += sin(uv.y * 42.0 + u_time * 9.0) * u_wobble;
  if (buv.x < 0.0 || buv.x > 1.0 || buv.y < 0.0 || buv.y > 1.0){ frag = vec4(0.0,0.0,0.0,1.0); return; }
  float ca = 0.0016;
  vec3 col;
  col.r = texture(u_tex, buv + vec2(ca, 0.0)).r;
  col.g = texture(u_tex, buv).g;
  col.b = texture(u_tex, buv - vec2(ca, 0.0)).b;
  if (u_bloom > 0.0){
    float ox = 1.6 / u_res.x;
    float oy = 1.6 / u_res.y;
    vec3 b = vec3(0.0);
    b += texture(u_tex, buv + vec2(ox, 0.0)).rgb;
    b += texture(u_tex, buv - vec2(ox, 0.0)).rgb;
    b += texture(u_tex, buv + vec2(0.0, oy)).rgb;
    b += texture(u_tex, buv - vec2(0.0, oy)).rgb;
    b += texture(u_tex, buv + vec2(ox, oy)).rgb;
    b += texture(u_tex, buv - vec2(ox, oy)).rgb;
    col += (b / 6.0) * u_bloom;
  }
  col *= 1.0 + u_surge * 0.55;
  // Aperture grille — high tier only (subtle RGB triad, kills itself at
  // lower res where it would just read as noise).
  if (u_fx > 1.5) {
    float m = mod(gl_FragCoord.x, 3.0);
    col *= (m < 1.0) ? vec3(1.0, 0.94, 0.94) : (m < 2.0) ? vec3(0.94, 1.0, 0.94) : vec3(0.94, 0.94, 1.0);
  }
  // Film grain — medium and up.
  col += (hash(uv * u_res + vec2(u_grainSeed, u_grainSeed * 0.784)) - 0.5) * u_grainAmp * step(0.5, u_fx);
  float scan = 0.94 + 0.06 * sin(gl_FragCoord.y * 1.6);
  col *= scan;
  vec2 vc = uv - 0.5;
  float vig = smoothstep(0.95, 0.35, length(vc));
  col *= mix(0.78, 1.0, vig);
  frag = vec4(col, 1.0);
}`

/* Straight blit — the light variant is a blueprint, not a phosphor terminal, so
   it takes none of the above. Kept as its own trivial program rather than as a
   pile of "if this uniform is zero" branches in FINAL_FS. */
const BLIT_FS = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_res;
out vec4 frag;
void main(){
  frag = vec4(texture(u_tex, gl_FragCoord.xy / u_res).rgb, 1.0);
}`

export class CrtPost {
  constructor(gl) {
    this.gl = gl
    this.persistProg = createProgram(gl, PASS_VS, PERSIST_FS)
    this.finalProg = createProgram(gl, PASS_VS, FINAL_FS)
    this.blitProg = createProgram(gl, PASS_VS, BLIT_FS)
    this.vao = createFullscreenVAO(gl)
    this.prev = createFbo(gl, 2, 2)
    this.cur = createFbo(gl, 2, 2)
    this.w = 2
    this.h = 2
    this.persistU = cacheUniforms(gl, this.persistProg, ["u_scene", "u_prev", "u_res", "u_decay"])
    this.finalU = cacheUniforms(gl, this.finalProg, [
      "u_tex", "u_res", "u_bloom", "u_barrel", "u_surge", "u_time", "u_fx",
      "u_wobble", "u_grainSeed", "u_grainAmp",
    ])
    this.blitU = cacheUniforms(gl, this.blitProg, ["u_tex", "u_res"])
  }

  resize(w, h) {
    this.w = w
    this.h = h
    resizeFbo(this.gl, this.prev, w, h)
    resizeFbo(this.gl, this.cur, w, h)
  }

  /** Clear both ping-pong buffers. Called before every pre-roll so a frame never
   *  inherits phosphor from whatever frame happened to be rendered before it. */
  clear() {
    const gl = this.gl
    for (const fbo of [this.prev, this.cur]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb)
      gl.viewport(0, 0, this.w, this.h)
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  /** Run pass 1 only: fold `sceneTex` into the persistence chain without
   *  compositing. Used to warm the phosphor during the pre-roll. */
  accumulate(sceneTex, decay) {
    const gl = this.gl
    gl.disable(gl.BLEND)
    gl.bindVertexArray(this.vao)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.cur.fb)
    gl.viewport(0, 0, this.w, this.h)
    gl.useProgram(this.persistProg)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, sceneTex)
    gl.uniform1i(this.persistU.u_scene, 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.prev.tex)
    gl.uniform1i(this.persistU.u_prev, 1)
    gl.uniform2f(this.persistU.u_res, this.w, this.h)
    gl.uniform1f(this.persistU.u_decay, decay)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
    const t = this.prev
    this.prev = this.cur
    this.cur = t
    // accumulate() leaves the freshly written buffer in `prev`, which is what the
    // next accumulate() reads — the swap is the ping-pong.
    return this.prev.tex
  }

  /** Composite the (already persisted) texture to the default framebuffer. */
  composite(tex, o) {
    const gl = this.gl
    gl.disable(gl.BLEND)
    gl.bindVertexArray(this.vao)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.w, this.h)

    if (!o.crt) {
      gl.useProgram(this.blitProg)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.uniform1i(this.blitU.u_tex, 0)
      gl.uniform2f(this.blitU.u_res, this.w, this.h)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.bindVertexArray(null)
      return
    }

    gl.useProgram(this.finalProg)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(this.finalU.u_tex, 0)
    gl.uniform2f(this.finalU.u_res, this.w, this.h)
    gl.uniform1f(this.finalU.u_bloom, o.bloom)
    gl.uniform1f(this.finalU.u_barrel, o.barrel)
    gl.uniform1f(this.finalU.u_surge, o.surge)
    gl.uniform1f(this.finalU.u_time, o.time)
    gl.uniform1f(this.finalU.u_fx, o.fx)
    gl.uniform1f(this.finalU.u_wobble, o.wobble)
    gl.uniform1f(this.finalU.u_grainSeed, o.grainSeed)
    gl.uniform1f(this.finalU.u_grainAmp, o.grainAmp)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
  }

  dispose() {
    const gl = this.gl
    gl.deleteProgram(this.persistProg)
    gl.deleteProgram(this.finalProg)
    gl.deleteProgram(this.blitProg)
    gl.deleteVertexArray(this.vao)
    disposeFbo(gl, this.prev)
    disposeFbo(gl, this.cur)
  }
}
