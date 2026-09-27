# env/ — environment sampling charts

**Taxonomy:** estimator (the radiance is scene data; WHICH chart the importance table
lives in and whether it is MIS-compensated changes noise, never the answer — X-CHART's
4-digit agreement is the witness). **Kind:** pick-one axis pair:
`estimator.envSampler.chart: 'equirect' | 'octahedral'` × `compensation: boolean`.

## Occupants

- `equirect/` — pbrt-v3's chart: sinθ-weighted 2D CDF over the lat-long map.
- `octahedral/` — pbrt-v4's equal-area square↔sphere mapping (Clarberg 2008): constant
  chart Jacobian, no pole singularity. **The TS twin is the tested ground truth**
  (`octahedral.ts` + its test — the GLSL is a line-for-line transcription; change one,
  change both: the sampler's pdf depends on the pair agreeing). This twin pattern is
  the family's methodology: chart math is testable on the CPU.
- `sampler_cdf.glsl` (family root, shared): the CDF walk both charts use.

## What an occupant supplies

The chart GLSL (`direction ↔ uv`, exact cell solid angle, and uniform-solid-angle
`env_chart_sample(cell, xi, size)` within a cell), a CPU
loader/builder counterpart in the engine path where needed (the baked-table pipeline),
and — because compensation and two-stage selection are cross-chart — nothing else:
`environment.ts` owns the radiance bodies, the baked-CDF plumbing (`extern:` textures),
the two-stage `u_envSelectProb` wrapper, and the miss-branch bookkeeping seams.

## Invariants & witnesses

sky (X-ENV + X-CHART: charts agree to 4 digits), sky-lamp (two-stage selection),
proc-sky (bake + W9 compensation: same image, −27% noise), furnace-sky (convex ρ·L).
Compensation requires `directLighting 'mis'` (Validator: pdf-0 regions are only
covered unbiasedly by MIS). Tabulated environments (image HDRI + procedural) are BUILT
(the env-as-light batch — real `.hdr` loading, CDF importance sampling as a NEE/MIS
light). Deferred: hierarchical sample warping (an alternative sampler on the chart axis).

## Proposal support and density

Uncompensated tables use a mixture: 15/16 table sampling plus 1/16 uniform sphere.
If the stored table is empty, the proposal is entirely uniform. A bake can miss a
procedural feature, and float32 CDFs can erase dim HDR texels; the independent sphere
component preserves support in both cases. The selected branch remaps its random
dimension, and both sampling and PDF evaluation return the full mixture density.
The mixture weight is an implementation choice, not a scene control.

Compensated tables keep their intentionally incomplete support and are MIS-only.
An empty compensated table has zero PDF; the BSDF miss gets full MIS weight. Empty
CDFs are stored as zeros. Positive CDFs normalize in float64 before float32 storage,
including very dim tables. Nonfinite or negative input samples fail table building.

Equirectangular sampling uses uniform azimuth and uniform cos(theta) between row
edges, with the exact cell area. Octahedral sampling keeps uniform UV because its
mapping is equal-area. The CPU luminance weights remain a proposal heuristic.

Spectral image radiance filters authored RGB before lifting it at the ray wavelengths.
Procedural radiance evaluates the formula directly after rotation, scales intensity,
then lifts; its bake supplies sampling weights only. Formulas must return finite,
nonnegative RGB at every direction. Bake validation checks its samples, not every
possible direction; there is no runtime clamp. Live intensity has the same domain.

`npm run witness:environment` executes both chart samplers and checks independent
sphere quadrature, directional histograms, HDR support, empty/compensated tables and
RNG endpoints. Mutations remove sphere support, omit a PDF component, restore the
midpoint-area approximation and restore uniform-UV equirect placement; all must fail.
