# fable-light-bvh-starter.md — spatially-aware many-lights sampling: the session starter

**STATUS: starter brief (Aug 9 2026) — NOT a design. Read at the top of the design
session; the session's owner-approved design supersedes it. Motivation from the
owner: future scenes with HUNDREDS of small lights.**

## The problem, precisely

NEE light selection today is the **power CDF**: compile-time, area-aware,
POSITION-BLIND. With hundreds of small lights, a shading point samples lights in
proportion to power alone — nearly all samples go to lights that contribute nothing
locally (wrong side of the scene, facing away, 1/d² tiny). Variance grows roughly
linearly with light count even though each point is lit by a handful. The fix is a
**light BVH**: a tree over emitters that a sampler descends STOCHASTICALLY, choosing
children by an importance estimate from the shading point — spatially-aware selection
at O(log n), unbiased because every light keeps positive probability.

This is an ESTIMATOR change (selection pmf), bias-free by contract — the taxonomy
places it as an estimator axis with equality witnesses as the gate.

## Literature anchors (transcribe, don't re-derive — fetch at session start)

- **Conty Estevez & Kulla 2018**, "Importance Sampling of Many Lights with Adaptive
  Tree Splitting" (the origin: SAOH build — surface-area-orientation heuristic —
  cone-of-normals per node, importance = power · geometric term · orientation term;
  the splitting variant is for CPU renderers — the sampling-only walk is what fits).
- **pbrt-v4 §12.6 `BVHLightSampler`** — the practical transcription target: 32-byte
  compressed light-tree nodes, per-node bounds = spatial box + direction cone
  (θ_o, θ_e) + power; `Importance(p, n, node)` with the clamped d² and cosine terms;
  stochastic single-child descent; **PMF evaluation by re-walking to the light's
  leaf via a stored bit trail** (each light stores its root→leaf path as a bit
  string) — this is the piece MIS needs and the piece most implementers get wrong.
- The survey (Meister 2021 §7) for context; ReSTIR is explicitly OUT (WebGPU-future).

## What already exists to build on (verified around the Aug 9 batches)

- **The lights door is FINISHED** (doors-close batch): `LIGHT_KINDS` registry with
  desugar facts, generated per-kind structs, sampler + MIS-pdf as ADJACENT functions
  in one file — **the byte-match discipline: selection pmf and lighting_pdf MUST come
  from the same emission site** or pt-nee and pt-mis diverge. A light-BVH sampler and
  its pmf walk must be born adjacent, exactly like the kind samplers.
- **Power CDF machinery**: area-aware CDF with `cdf_rescale`, `light_of`, generated
  `lighting_pdf`, `u_envSelectProb` two-stage env selection ON TOP of finite-light
  selection — the env stage composes unchanged with a finite-light BVH underneath.
- **Stage B reserved rail space**: the light tree's nodes/records ride the existing
  `nodes`/`records` channels (fable-data-rail — reserved at rail design time).
- **The binary BVH build core** (`accel/bvh`) is NOT directly reusable: the light
  tree needs the SAOH cost (power × area × orientation cone), not SAH — a sibling
  small builder in `accel/` (build shared-in-family, query with lights — the family
  rule), CPU-side like everything.
- **Value<T> light params are still deferred** — light GEOMETRY is compile-time
  literal today, so the tree can be built at PLAN time and baked (no refit story
  needed until driven lights land; note the dependency both ways).
- **Delta lights (point/spot/sun) + area kinds (quad/sphere/disk) + mesh lights**
  all have positions/bounds; mesh lights have world-baked light textures + area CDFs
  (leaf importance can use the mesh's total power + its world box). The env stays
  the separate top stage.
- Equiangular medium NEE composes: it samples the POINT along the segment given a
  chosen light — selection upstream is exactly what the BVH replaces. Check
  `techniques/equiangular.glsl`'s light-selection entry.

## Design questions the session must settle

1. **Axis shape**: `estimator.lightSelection: 'power' | 'bvh'` (registry +
   Validator enum, defaults 'power'), or fold into the existing lighting desc?
   Modular-first says: carve the axis, power-CDF becomes the first occupant.
2. **PMF for MIS**: the bit-trail scheme (per-light packed path) vs re-derivation.
   pt-mis needs `lighting_pdf(light, p, n)` = descent probability product — this
   MUST be exact, not approximate (the byte-match discipline). Bit trails ride the
   records channel (one texel per light).
3. **Importance function**: transcribe pbrt-v4's (power · cos-cone bound · 1/d̂²
   with the clamp-to-node-radius) exactly; the shading-normal term is optional in
   pbrt — decide with a noise witness, not taste.
4. **Media**: importance from a medium vertex has no normal — pbrt handles the
   no-normal case; the equiangular arm needs the same selection entry.
5. **Tree quality**: SAOH greedy top-down (pbrt's) is fine at hundreds of lights;
   build cost trivial. Node format: plain floats in `records` (the CWBVH lesson:
   no byte-packing on this platform — decode ALU loses).
6. **Interaction with the deferred mis/tally batch** (medium MIS arms) — the light
   tree's pmf enters those weights too; sequence the batches explicitly.

## Proof regime sketch

- **Equality**: pt-nee power ≡ pt-nee bvh (same converged image — selection is
  importance sampling; χ² arms are NOT identical-stream here since different lights
  get sampled — use the standard equality gates, mean + χ² with variance occupant).
- **The win metric (the point of the batch)**: a `hundred-lights` fixture (e.g. a
  grid/gallery of 200 small emitters, one lit corner) — `noise` check asserting
  σ/µ(bvh) < σ/µ(power) at equal spp, plus the perf row (selection cost per sample).
- pt-mis equality (the pmf walk correctness — the sharpest gate).
- All existing light witnesses stay green under the 'power' default.

## Suggested staging (for the session to confirm)

1. Carve the axis + move power-CDF behind it (byte-identical gate).
2. CPU SAOH build + records/nodes packing + the bit trails.
3. The sampler walk + pmf walk (adjacent, one file) under pt-nee; equality witness.
4. pt-mis wiring; the hundred-lights noise + perf witnesses. Medium arms last.
