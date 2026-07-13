# Equal-area octahedral chart — what it computes and why

Clarberg's (2008) square↔sphere mapping as adopted by pbrt-v4's ImageInfiniteLight:
fold the sphere onto an octahedron, unfold to the unit square, with the radial warp
that makes every texel of an N×N table subtend exactly 4π/N² steradians. **Constant
chart Jacobian** — no sinθ weighting in the CDF build, no pole singularity, no wasted
polar texels; the pdf conversion is a single constant.

NOTE this is NOT the common octahedral *normal encoding* (Cigolle et al.) — that one
is not equal-area; the radial warp is what buys the property.

Three files, one truth:

- `octahedral.ts` — the TS twin (`equalAreaSquareToSphere` / `equalAreaSphereToSquare`
  + `resampleEquirectToOctahedral` for the load-time table build). **The twin is the
  tested ground truth**; the GLSL chart is a line-for-line transcription. Change one,
  change both — the sampler's pdf depends on the pair agreeing.
- `octahedral.test.ts` — round-trip and equal-area checks (deterministic LCG).
- `octahedral.glsl` — the same two functions behind the chart seam names
  (`env_chart_uv`/`env_chart_dir`), drop-in behind the same names as equirect.

Convention: Y-up (pbrt's z-up swizzled — our (x, z) span the square, y is the pole
axis). Witness: X-CHART — equirect and octahedral converge to 4-digit agreement on
the sky scene (a chart cannot change the answer, only the noise); W9 compensation
runs on this chart's table.
