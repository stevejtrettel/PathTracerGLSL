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

The chart GLSL (`direction ↔ uv`, plus the pdf conversion for its measure), a CPU
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
