/* Layer 0 — background: engineering grid, core halo, vignette.

   One fullscreen triangle, no texture reads. The grid is drawn in device pixels
   and faded radially around the core so it never competes with the wordmark on
   the left: on a 1280x420 banner a uniform grid at readable contrast turns the
   whole frame into graph paper. */

import {createProgram, createFullscreenVAO, cacheUniforms} from "./gl.mjs"

const BG_VS = `#version 300 es
layout(location=0) in vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }`

const BG_FS = `#version 300 es
precision highp float;
uniform vec2  u_res;
uniform vec2  u_corePx;      // core centre, device pixels, origin bottom-left
uniform float u_dpr;
uniform float u_glow;
uniform float u_morph;
uniform vec3  u_bg;
uniform vec3  u_grid;
uniform vec3  u_halo;
uniform float u_gridGain;
uniform float u_polarity;    // 1 = phosphor on black (add), 0 = ink on paper (subtract)
out vec4 frag;

// Anti-aliased single-pixel line lattice, one line every "period" device px.
float lattice(vec2 px, float period, float width){
  vec2 g = abs(fract(px / period - 0.5) - 0.5) * period;
  vec2 l = 1.0 - smoothstep(width - 1.0, width + 0.5, g);
  return max(l.x, l.y);
}

void main(){
  vec2 px = gl_FragCoord.xy;
  vec2 d  = (px - u_corePx) / (140.0 * u_dpr);
  float rad = length(d);

  vec3 col = u_bg;

  float fine  = lattice(px, 13.0 * u_dpr, 1.0 * u_dpr);
  float major = lattice(px, 65.0 * u_dpr, 1.0 * u_dpr);
  float gfall = exp(-rad * rad * 0.10);
  float halo  = exp(-rad * rad * 1.05) * (0.22 + 0.78 * u_glow);
  vec2  v     = (px / u_res - 0.5) * vec2(1.32, 1.0);
  float vig   = smoothstep(0.82, 0.16, length(v));

  if (u_polarity > 0.5) {
    // Phosphor on black: everything ADDS. The gains are low on purpose — the CRT
    // pass applies a 6-tap bloom over everything downstream, so a grid that looks
    // correct here comes out roughly twice as bright on screen. Anything above
    // ~0.3 turns the banner into graph paper.
    col += u_grid * (fine * 0.16 + major * 0.40) * (0.45 + 0.55 * gfall) * u_gridGain;
    // Ambient halo — this is what stops the particles reading as confetti on a
    // flat field; it gives them something to sit inside. Tight, and dim enough
    // that the black stays black two core-radii out.
    col += u_halo * halo * 0.62;
    // Vignette, biased so the left third (which carries the type) stays darkest.
    col *= mix(0.30, 1.0, vig);
  } else {
    // Ink on paper: the SAME terms have to run the other way. Adding a grid
    // colour to a #f6f8fa background paints white lines and multiplying by a
    // vignette turns the paper grey — the light variant is a blueprint, so the
    // grid darkens the sheet, the halo is a faint blue wash, and the vignette is
    // a whisper rather than a tunnel.
    col = mix(col, u_grid, clamp((fine * 0.40 + major * 0.85) * (0.55 + 0.45 * gfall) * u_gridGain, 0.0, 1.0));
    col = mix(col, u_halo, clamp(halo * 0.75, 0.0, 1.0));
    col *= mix(0.965, 1.0, vig);
  }

  frag = vec4(col, 1.0);
}`

export function createBackdrop(gl, palette) {
  const prog = createProgram(gl, BG_VS, BG_FS)
  const vao = createFullscreenVAO(gl)
  const U = cacheUniforms(gl, prog, [
    "u_res", "u_corePx", "u_dpr", "u_glow", "u_morph",
    "u_bg", "u_grid", "u_halo", "u_gridGain", "u_polarity",
  ])

  return {
    draw(view, p) {
      gl.useProgram(prog)
      gl.bindVertexArray(vao)
      gl.disable(gl.BLEND)
      gl.uniform2f(U.u_res, view.w, view.h)
      gl.uniform2f(U.u_corePx, view.corePx[0], view.corePx[1])
      gl.uniform1f(U.u_dpr, view.dpr)
      gl.uniform1f(U.u_glow, p.glow)
      gl.uniform1f(U.u_morph, p.morph)
      gl.uniform3fv(U.u_bg, palette.bg)
      gl.uniform3fv(U.u_grid, palette.grid)
      gl.uniform3fv(U.u_halo, palette.bgGlow)
      gl.uniform1f(U.u_gridGain, palette.gridGain)
      gl.uniform1f(U.u_polarity, palette.additive ? 1 : 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.bindVertexArray(null)
    },
    dispose() {
      gl.deleteProgram(prog)
      gl.deleteVertexArray(vao)
    },
  }
}
