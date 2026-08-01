/* Three orbit rings around THE CORE.

   Drawn as dense POINTS rather than LINE_STRIP on purpose: WebGL line width is
   clamped to 1 on every desktop driver, and a 1-device-pixel line survives the
   2x -> 1x downsample as a 0.5px ghost. Points let the thickness be a uniform,
   and a per-point size lets the sweep head fatten into a comet.

   Each ring's phase is one of timeline's ringPhases — integer multiples of the
   loop frequency — so every sweep returns to its start exactly at frame 0. */

import {createProgram, cacheUniforms, staticAttrib} from "./gl.mjs"

const SEGMENTS = 720
const TAU = Math.PI * 2

/* radius, tilt about X (bringing the ring toward edge-on), roll about Z.
   The X tilts are heavy because the frame is 3:1 — an untilted ring of radius
   1.6 would run straight off the top and bottom of a 420px banner. */
const RINGS = [
  {radius: 1.38, tiltX: 1.12, roll: 0.00, weight: 1.00, ticks: 12},
  {radius: 1.58, tiltX: 1.28, roll: 0.50, weight: 0.72, ticks: 8},
  {radius: 1.74, tiltX: 1.46, roll: -0.30, weight: 0.55, ticks: 6},
]

const RING_VS = `#version 300 es
layout(location=0) in float a_s;        // 0..1 around the ring

uniform float u_radius;
uniform float u_tiltX;
uniform float u_roll;
uniform float u_phase;
uniform float u_rotZ;
uniform float u_wobY;
uniform float u_globalTiltX;
uniform vec2  u_scale;
uniform vec2  u_center;
uniform float u_camZ;
uniform float u_dpr;
uniform float u_ticks;
uniform float u_alpha;
uniform float u_weight;

out float v_a;

const float TAU = 6.28318530718;

mat3 rotZ(float a){ float c=cos(a), s=sin(a); return mat3( c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
mat3 rotY(float a){ float c=cos(a), s=sin(a); return mat3( c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotX(float a){ float c=cos(a), s=sin(a); return mat3( 1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }

void main(){
  float th = a_s * TAU;
  // Truly circular. A radial wobble here reads as a wavy scribble once chroma
  // aberration and phosphor persistence are applied on top of a 1px track.
  float r = u_radius;
  vec3 p = vec3(cos(th) * r, sin(th) * r, 0.0);
  p = rotZ(u_roll) * rotX(u_tiltX) * p;
  p = rotX(u_globalTiltX) * rotY(u_wobY) * rotZ(u_rotZ) * p;

  // Depth is deliberately compressed before the perspective divide. A ring tilted
  // to 1.4 rad reaches z = ±1.7, and a true divide against camZ = 3.4 scales its
  // near side by 2x — the ring balloons to twice its radius and runs off the
  // banner. Compressing z keeps the tilt (which comes from the y extent anyway)
  // and keeps the ring inside the frame.
  float persp = u_camZ / (u_camZ - p.z * 0.30);
  gl_Position = vec4(u_center + p.xy * u_scale * persp, 0.0, 1.0);

  // A bright head chasing around the ring, over a faint constant track. The
  // exponent is deliberately low: a sharper head plus phosphor persistence draws
  // a long, chroma-fringed streak that reads as a scratch on the tube.
  float sweep = pow(0.5 + 0.5 * cos(th - u_phase), 3.0);
  // Instrument ticks: a short run of points every 1/u_ticks of the way round.
  // Kept few and faint — at 36 per ring they turn the track into a dashed line,
  // and a dashed line under chroma aberration reads as coloured noise.
  float tick = 1.0 - step(0.10, fract(a_s * u_ticks));

  v_a = (0.36 + 0.42 * sweep + 0.14 * tick) * u_alpha * u_weight;
  gl_PointSize = (1.25 + 1.0 * sweep + 1.1 * tick) * persp * u_dpr;
}`

const RING_FS = `#version 300 es
precision highp float;
in float v_a;
uniform vec3 u_col;
uniform vec3 u_colHot;
uniform float u_opacity;
out vec4 frag;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = pow(1.0 - d, 1.7);
  vec3 c = mix(u_col, u_colHot, clamp((v_a - 0.62) * 2.0, 0.0, 1.0));
  frag = vec4(c, a * v_a * 0.42 * u_opacity);
}`

export function createRings(gl, palette) {
  const prog = createProgram(gl, RING_VS, RING_FS)
  const s = new Float32Array(SEGMENTS)
  for (let i = 0; i < SEGMENTS; i++) s[i] = i / SEGMENTS

  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)
  staticAttrib(gl, 0, s, 1)
  gl.bindVertexArray(null)

  const U = cacheUniforms(gl, prog, [
    "u_radius", "u_tiltX", "u_roll", "u_phase", "u_rotZ", "u_wobY", "u_globalTiltX",
    "u_scale", "u_center", "u_camZ", "u_dpr", "u_ticks", "u_alpha", "u_weight",
    "u_col", "u_colHot", "u_opacity",
  ])

  return {
    draw(view, p) {
      gl.useProgram(prog)
      gl.bindVertexArray(vao)
      gl.uniform2f(U.u_scale, view.scale[0], view.scale[1])
      gl.uniform2f(U.u_center, view.center[0], view.center[1])
      gl.uniform1f(U.u_camZ, view.camZ)
      gl.uniform1f(U.u_dpr, view.dpr)
      gl.uniform1f(U.u_rotZ, p.rotation + Math.PI)
      gl.uniform1f(U.u_wobY, 0.38 * Math.sin(p.rotation))
      gl.uniform1f(U.u_globalTiltX, 0.13 * Math.cos(p.rotation))
      // Rings are instruments around a formed core; during the nebula phase they
      // are only just alight.
      gl.uniform1f(U.u_alpha, 0.16 + 0.84 * p.morph)
      gl.uniform3fv(U.u_col, palette.ring)
      gl.uniform3fv(U.u_colHot, palette.ringHot)
      gl.uniform1f(U.u_opacity, palette.alpha)

      for (const [i, r] of RINGS.entries()) {
        gl.uniform1f(U.u_radius, r.radius)
        gl.uniform1f(U.u_tiltX, r.tiltX)
        gl.uniform1f(U.u_roll, r.roll)
        gl.uniform1f(U.u_ticks, r.ticks)
        gl.uniform1f(U.u_weight, r.weight)
        gl.uniform1f(U.u_phase, p.ringPhases[i])
        gl.drawArrays(gl.POINTS, 0, SEGMENTS)
      }
      gl.bindVertexArray(null)
    },
    dispose() {
      gl.deleteProgram(prog)
      gl.deleteVertexArray(vao)
    },
  }
}
