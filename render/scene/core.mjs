/* THE CORE — the particle layer.

   48k points, each carrying TWO positions: a home in the nebula and a slot on
   the 3-lobed target. The vertex shader mixes between them by u_morph, so the
   whole morph costs one uniform and zero CPU work per frame.

   The target is 3-fold symmetric by construction: three dense lobes at 120°,
   filament-linked to a bright centre and tied together by a crest that bows
   INWARD between the lobes. The inward bow is the load-bearing decision — an
   outward bow reads as a circle with three dents, an inward bow reads as a
   trefoil, and the trefoil is the shape that says "three heads" and "multi-agent"
   at the same time. There is no illustration asset: it is all procedural.

   Everything here is deterministic. mulberry32 with a fixed seed, no Math.random,
   no clock. */

import {createProgram, cacheUniforms, staticAttrib, mulberry32, gaussian} from "./gl.mjs"

export const COUNT = 48_000
const TAU = Math.PI * 2
const SEED = 0xce28e205          // "cerberus" is not valid hex; this is a fixed constant.

/* Radius of the three lobe centres, in world units. Everything else is sized
   relative to this, so the whole structure scales from one number. */
const R_LOBE = 0.92

/* Fractions must sum to 1. Tuned by looking at frame 80, not by theory:
   too much filament and the centre smears, too much crest and it reads as a logo. */
const MIX = {core: 0.12, filament: 0.33, lobe: 0.29, crest: 0.16, halo: 0.10}

/* Filaments per arm. One smooth stream per arm renders as a solid wedge and the
   whole thing reads as a propeller badge; four separated strands render as a
   bundle of fibres, which reads as structure. */
const STRANDS = 4

export function buildGeometry(seed = SEED) {
  const rnd = mulberry32(seed)
  const nebula = new Float32Array(COUNT * 3)
  const target = new Float32Array(COUNT * 3)
  const attrs = new Float32Array(COUNT * 4)   // [sizeJitter, heat, twinklePhase, morphOffset]

  const cum = []
  let acc = 0
  for (const k of ["core", "filament", "lobe", "crest", "halo"]) {
    acc += MIX[k]
    cum.push([k, acc])
  }
  const groupOf = x => cum.find(([, c]) => x < c)?.[0] ?? "halo"

  // Lobe base angles: one lobe straight up. u_rotZ carries a +PI offset so the
  // loop midpoint — the frame used as the static fallback — lands exactly here.
  const lobeAngle = k => Math.PI / 2 + (k * TAU) / 3

  for (let i = 0; i < COUNT; i++) {
    const lobe = Math.floor(rnd() * 3)
    const a = lobeAngle(lobe)
    const dir = [Math.cos(a), Math.sin(a)]
    const perp = [-dir[1], dir[0]]
    const group = groupOf(rnd())
    let heat

    /* ── Target ──────────────────────────────────────────────────────────── */
    if (group === "core") {
      // A cusp, not a ball. A uniform-density sphere renders with a visible
      // circular edge and reads as a marble pasted over the scene; a power-law
      // radius puts most of the mass within a few pixels and lets the rest fall
      // off smoothly, which is what a point source actually looks like.
      const r = 0.32 * Math.pow(rnd(), 2.4)
      const th = rnd() * TAU
      const ph = Math.acos(2 * rnd() - 1)
      target[i * 3 + 0] = r * Math.sin(ph) * Math.cos(th)
      target[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th)
      target[i * 3 + 2] = r * Math.cos(ph) * 0.7
      heat = 1.0 - 0.55 * (r / 0.32)
    } else if (group === "filament") {
      // Centre → lobe as a bundle of STRANDS fibres. The bundle is pinched at
      // both ends and splayed in the middle; the shared twist gives all three
      // arms the same chirality so the structure reads as one mechanism.
      const strand = Math.floor(rnd() * STRANDS)
      const t = Math.pow(rnd(), 0.80)
      const bulge = Math.sin(t * Math.PI)
      const ca = a + 0.30 * bulge
      const rr = 0.05 + t * (R_LOBE - 0.05)
      const off = (strand - (STRANDS - 1) / 2) * 0.058 * bulge
      const sd = 0.008 + 0.013 * bulge
      target[i * 3 + 0] = Math.cos(ca) * rr + perp[0] * off + gaussian(rnd) * sd
      target[i * 3 + 1] = Math.sin(ca) * rr + perp[1] * off + gaussian(rnd) * sd
      target[i * 3 + 2] = (strand - (STRANDS - 1) / 2) * 0.032 * bulge + gaussian(rnd) * 0.014
      heat = (0.90 - 0.52 * t) * (0.80 + 0.20 * ((strand % 2) === 0 ? 1 : 0))
    } else if (group === "lobe") {
      // A tapered blade, not a ball. A round cluster at the end of each arm
      // reads as an eye — three of them plus a bright centre reads as a face.
      // Elongating along the radius and pinching the outer half turns each lobe
      // into a node that points away from the core and lands on the crest.
      const mag = Math.pow(rnd(), 0.5)
      const th = rnd() * TAU
      const dr = Math.cos(th) * mag
      const dt = Math.sin(th) * mag
      const taper = 1 - 0.66 * Math.max(0, dr)
      const rr = R_LOBE + dr * 0.28
      target[i * 3 + 0] = dir[0] * rr + perp[0] * dt * 0.092 * taper
      target[i * 3 + 1] = dir[1] * rr + perp[1] * dt * 0.092 * taper
      target[i * 3 + 2] = gaussian(rnd) * 0.045 * taper
      heat = (0.28 + 0.46 * (1 - mag)) * (1 - 0.34 * Math.max(0, dr))
    } else if (group === "crest") {
      // Containment arc: blade tip to blade tip, sagging inward between them.
      // Placed OUTSIDE the arms rather than between them — an inner crest is
      // simply buried under the filament bundles and does no work. The result is
      // a triskelion inscribed in a rounded triangle, which is three-fold twice
      // over and is legible even at README thumbnail size.
      const s = rnd()
      const ang = a + s * (TAU / 3)
      const rr = (1.20 - 0.185 * Math.sin(s * Math.PI)) * (1 + 0.010 * Math.sin(s * 23.0 + lobe * 2.1))
      const sd = 0.009 + 0.010 * Math.sin(s * Math.PI)
      target[i * 3 + 0] = Math.cos(ang) * rr + gaussian(rnd) * sd
      target[i * 3 + 1] = Math.sin(ang) * rr + gaussian(rnd) * sd
      target[i * 3 + 2] = gaussian(rnd) * 0.028
      heat = 0.36 - 0.10 * Math.sin(s * Math.PI)
    } else {
      // Sparse halo — keeps the formed state from looking like hard vector art.
      const th = rnd() * TAU
      const rr = 1.02 + 0.46 * Math.sqrt(rnd())
      target[i * 3 + 0] = Math.cos(th) * rr
      target[i * 3 + 1] = Math.sin(th) * rr * 0.66
      target[i * 3 + 2] = gaussian(rnd) * 0.30
      heat = 0.04 + 0.05 * rnd()
    }

    /* ── Nebula ──────────────────────────────────────────────────────────── */
    // A wide, flattened disc. 58% of it sits on three loose spiral arms — the
    // three-fold idea is already present before the morph resolves it — and the
    // rest is diffuse haze so the arms do not read as a diagram.
    const nr = 0.70 + 1.34 * Math.sqrt(rnd())
    const arm = rnd() < 0.58
    const nth = arm
      ? a + gaussian(rnd) * 0.42 + nr * 0.92
      : rnd() * TAU
    nebula[i * 3 + 0] = Math.cos(nth) * nr + gaussian(rnd) * 0.075
    nebula[i * 3 + 1] = Math.sin(nth) * nr * 0.46 + gaussian(rnd) * 0.055
    nebula[i * 3 + 2] = gaussian(rnd) * 0.42

    attrs[i * 4 + 0] = 0.62 + rnd() * 0.82   // size jitter
    attrs[i * 4 + 1] = heat
    attrs[i * 4 + 2] = rnd()                 // twinkle phase
    attrs[i * 4 + 3] = rnd()                 // morph offset — staggers the arrival
  }

  return {COUNT, nebula, target, attrs}
}

const CORE_VS = `#version 300 es
layout(location=0) in vec3 a_nebula;
layout(location=1) in vec3 a_target;
layout(location=2) in vec4 a_attr;      // sizeJitter, heat, twinklePhase, morphOffset

uniform float u_morph;
uniform float u_glow;
uniform float u_rotZ;
uniform float u_wobY;
uniform float u_tiltX;
uniform vec2  u_scale;                  // world unit -> NDC, per axis
uniform vec2  u_center;                 // NDC position of the core
uniform float u_pointBase;
uniform float u_camZ;
uniform float u_u;                      // loop phase 0..1

out float v_heat;
out float v_alpha;

const float TAU = 6.28318530718;
const float PI  = 3.14159265359;

// Particles do not all arrive at once: each one's local morph is offset by
// a_attr.w. The clamp keeps the endpoints exact — every particle is still
// exactly on its nebula seat at morph=0 and its target seat at morph=1, which
// is what keeps the loop closed at the pixel level.
const float MSPREAD = 0.34;

mat3 rotZ(float a){ float c=cos(a), s=sin(a); return mat3( c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
mat3 rotY(float a){ float c=cos(a), s=sin(a); return mat3( c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotX(float a){ float c=cos(a), s=sin(a); return mat3( 1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }

void main(){
  float m = clamp((u_morph - a_attr.w * MSPREAD) / (1.0 - MSPREAD), 0.0, 1.0);
  m = m * m * (3.0 - 2.0 * m);

  vec3 p = mix(a_nebula, a_target, m);

  // Differential swirl, active only in transit (sin(m*PI) is 0 at both ends), so
  // the inflow spirals instead of sliding radially.
  float sw = sin(m * PI) * (1.15 - 0.34 * length(p.xy));
  p = rotZ(sw) * p;

  p = rotX(u_tiltX) * rotY(u_wobY) * rotZ(u_rotZ) * p;

  float persp = u_camZ / (u_camZ - p.z);
  gl_Position = vec4(u_center + p.xy * u_scale * persp, 0.0, 1.0);

  float tw = 0.84 + 0.16 * sin(u_u * TAU * 3.0 + a_attr.z * TAU);
  v_heat  = a_attr.y * (0.28 + 0.72 * u_glow) * mix(0.50, 1.0, m);
  // Additive blending over a dense cluster saturates fast. These are low enough
  // that the lobes keep visible particle texture instead of clipping to a bulb.
  // The steep heat weighting is what gives the frame tonal range: the nucleus
  // burns, the crest is nearly a wireframe, and the halo is barely there.
  v_alpha = (0.055 + 0.135 * m) * tw * (0.42 + 1.30 * a_attr.y);
  gl_PointSize = u_pointBase * a_attr.x * persp * mix(1.55, 1.0, m) * (0.60 + 1.05 * a_attr.y);
}`

const CORE_FS = `#version 300 es
precision highp float;
in float v_heat;
in float v_alpha;
uniform vec3 u_cold;
uniform vec3 u_warm;
uniform vec3 u_hot;
uniform float u_opacity;
out vec4 frag;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  // Soft halo plus a tight bright centre — a plain gaussian sprite reads as fog,
  // the second term is what makes each particle a point of light.
  float a = pow(1.0 - d, 1.9) * 0.80 + pow(max(0.0, 1.0 - d * 2.6), 6.0) * 0.60;
  float h = clamp(v_heat, 0.0, 1.4);
  vec3 c = mix(u_cold, u_warm, clamp(h * 1.75, 0.0, 1.0));
  // The hot tint carries red and blue (#7dffa8); reached too early it stacks
  // additively into white. Only the nucleus should ever get there.
  c = mix(c, u_hot, clamp((h - 0.74) * 2.6, 0.0, 1.0));
  frag = vec4(c, a * v_alpha * u_opacity);
}`

export function createCore(gl, palette, geo) {
  const prog = createProgram(gl, CORE_VS, CORE_FS)
  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)
  staticAttrib(gl, 0, geo.nebula, 3)
  staticAttrib(gl, 1, geo.target, 3)
  staticAttrib(gl, 2, geo.attrs, 4)
  gl.bindVertexArray(null)

  const U = cacheUniforms(gl, prog, [
    "u_morph", "u_glow", "u_rotZ", "u_wobY", "u_tiltX", "u_scale", "u_center",
    "u_pointBase", "u_camZ", "u_u", "u_cold", "u_warm", "u_hot", "u_opacity",
  ])

  return {
    draw(view, p) {
      gl.useProgram(prog)
      gl.bindVertexArray(vao)
      gl.uniform1f(U.u_morph, p.morph)
      gl.uniform1f(U.u_glow, p.glow)
      // +PI so the loop midpoint (the static fallback frame) lands with one lobe
      // pointing straight up. rotZ(0) === rotZ(2PI), so the loop still closes.
      gl.uniform1f(U.u_rotZ, p.rotation + Math.PI)
      gl.uniform1f(U.u_wobY, 0.38 * Math.sin(p.rotation))
      gl.uniform1f(U.u_tiltX, 0.13 * Math.cos(p.rotation))
      gl.uniform2f(U.u_scale, view.scale[0], view.scale[1])
      gl.uniform2f(U.u_center, view.center[0], view.center[1])
      gl.uniform1f(U.u_pointBase, view.pointBase)
      gl.uniform1f(U.u_camZ, view.camZ)
      gl.uniform1f(U.u_u, p.u)
      gl.uniform3fv(U.u_cold, palette.particleCold)
      gl.uniform3fv(U.u_warm, palette.particle)
      gl.uniform3fv(U.u_hot, palette.particleHot)
      gl.uniform1f(U.u_opacity, palette.alpha)
      gl.drawArrays(gl.POINTS, 0, geo.COUNT)
      gl.bindVertexArray(null)
    },
    dispose() {
      gl.deleteProgram(prog)
      gl.deleteVertexArray(vao)
    },
  }
}
