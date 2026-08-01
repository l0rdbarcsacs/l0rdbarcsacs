/* Chromium launch configuration for the hero render.

   Every flag here was established by probing, not by copying a recipe. Measured
   on 2026-07-31, Arch Linux, RTX 3070:

   | configuration                                        | WebGL2 renderer            |
   |------------------------------------------------------|----------------------------|
   | chrome-headless-shell, --use-gl=angle --use-angle=gl | context creation FAILS     |
   | chrome-headless-shell, --use-angle=swiftshader       | SwiftShader (CPU)          |
   | channel:"chromium", --use-angle=gl                   | context creation FAILS     |
   | channel:"chromium", default                          | SwiftShader (CPU)          |
   | channel:"chromium", --use-angle=vulkan --enable-gpu  | NVIDIA RTX 3070            |

   So: the full Chromium build is required (the headless shell has no GPU path
   that works here), and ANGLE must be pointed at Vulkan. The plan's original
   `--use-gl=angle --use-angle=gl` silently produces a page with no WebGL2
   context at all, which is exactly the "empty, black" failure it warns about.

   --allow-file-access-from-files is also load-bearing: index.html is an ES
   module graph and Chromium blocks file:// -> file:// module fetches as
   cross-origin without it. */

export const VIEWPORT = {width: 1280, height: 420}
export const DEVICE_SCALE_FACTOR = 2

/** Real GPU. Fast (single-digit ms per scene draw) and what the scene was tuned on. */
export const LAUNCH_GPU = {
  channel: "chromium",
  args: [
    "--use-angle=vulkan",
    "--enable-gpu",
    "--allow-file-access-from-files",
    "--disable-frame-rate-limit",
    "--force-color-profile=srgb",
    "--disable-lcd-text",
  ],
}

/** CPU rasteriser. Slower by roughly two orders of magnitude, but identical on
 *  every machine — the configuration to use if the render ever has to be
 *  reproduced bit-for-bit in CI. */
export const LAUNCH_SWIFTSHADER = {
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--allow-file-access-from-files",
    "--force-color-profile=srgb",
    "--disable-lcd-text",
  ],
}

export const LAUNCH = process.env.HERO_SWIFTSHADER ? LAUNCH_SWIFTSHADER : LAUNCH_GPU
