# Quad area light — what it computes and why

A parallelogram emitter sampled uniformly by area, with the pdf converted to solid
angle at the shading point — the measure the estimator integrates in.

`quad_light_sample(QuadLight l, Point p, vec2 xi)` (struct generated from the descriptor
rows: `corner`, `edge1`, `edge2`, `radiance`, and the derived `normal` and `area`):

- `q = corner + xi.x·edge1 + xi.y·edge2` — uniform on the surface (pdf_area = 1/A).
- `radiance = Le` with **NO 1/d²** (pitfall 1): for area lights the falloff lives in
  the measure conversion, `pdf = d² / (area · cos_l)` — dividing by that pdf applies
  d²/cosθ_l exactly once. Folding 1/d² into radiance too is the double-falloff bug.
- **ONE-SIDED** (pinned): emits from the `cross(edge1, edge2)` side; `n_l` and `area`
  are derived on the CPU (via the shared `quadNormal` — the same formula
  the analytic hit arm uses, so hit side and sample side cannot disagree).
- Back-face samples return `pdf = 0` (pitfall 2 — the old `pdf = 1, radiance = 0`
  poisons MIS: a zero-radiance sample with positive pdf still shifts the weights).
- `flags = 0u` — non-delta: hittable (the Planner desugars every explicit quad light
  into a real `__light_n` emissive region), MIS-eligible against kernel sampling.

Descriptor facts (`quad.ts`): `power = π·A·mean(Le)` (area-aware — pitfall 6: a big
dim panel must outrank a tiny bright one in the selection CDF when it emits more
total power); `quad_light_pdf`, adjacent to the sampler in `quad.glsl`, repeats its
`d²/(A·cosθ)` formula — the §6.1 byte-match invariant MIS depends on. Witnesses:
cornell-area / X-GLASS / X-FOG three-way convergence. Deferred: solid-angle
(spherical-rectangle, Ureña et al. 2013) sampling — see docs/claude-improvements-2026-09.md
§2.2 — and two-sided quads.
