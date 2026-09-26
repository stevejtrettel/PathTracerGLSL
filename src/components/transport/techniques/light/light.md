# T2 — light sampling (NEE): what it computes and why

The second estimator of the direct-lighting term: draw a point ON an emitter from the
registry's density (`lighting_sample`), cast a shadow ray, evaluate the kernel toward
it. Unlike T1, both endpoints of the edge are known immediately — so T2 samples AND
scores at the same vertex, locally. No carried state.

**Surface site** (`light_sample_direct`):
- skipped entirely for pure-delta materials (`material_has_nondelta_lobes` — their
  eval is zero, the shadow march would be wasted);
- `ray_spawn(hit, ls.wi)` escapes the surface (the origin moves `hit.eps` along the
  geometric normal), then the ray is re-aimed from there at the light point
  (`ambient_direction_to(origin, light_p)`). Kept parallel to `ls.wi`, it would pass beside
  the light point, `hit.eps` away, and at a slant it would meet the light's own surface
  first. The search stops `SHADOW_BACKOFF` (math.glsl) short of the light point, which
  covers the rounding error of the light's surface there. Only visibility uses the aimed
  direction; `f`, the cosine and the pdfs keep `ls.wi`;
- score: `throughput · ls.radiance · f · cos_i · vis · combiner_w_light(...) / ls.pdf`
  — bare `f` from `interaction_surface_eval`, the cosine applied HERE by transport
  (`abs(ambient_dot(ls.wi, n, p))` — the §2.2 Jacobian), per-channel `vis` from the
  shadow seam, and the weight from the combiner (1 under plain NEE; the power
  heuristic against `interaction_surface_pdf` under MIS).

**Medium site** (`light_sample_direct_medium`): the same flow from a scattering
vertex with the pinned surface/medium asymmetry — phase EVAL (`hg_eval`) and **NO
cosine** (§2.2: the cosine is a surface Jacobian), weight from
`combiner_w_light_medium` (balances against `hg_pdf` under MIS). Replaced wholesale
by `../equiangular/` under `mediumLightSampling: 'equiangular'` — one placement per
program.

Partition bookkeeping: whatever T2 covers, T1's emitter-hit weight zeroes (nee) or
power-weights (mis) — the combiner keeps the two techniques summing to one on every
shared path (§11.2 three-way convergence is the standing witness).
