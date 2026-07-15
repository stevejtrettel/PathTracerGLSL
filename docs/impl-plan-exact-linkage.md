# Impl plan — exact linkage (the shader-cleanliness batch)

**Status: BUILT (July 15 2026).** Owner-approved design; the policy half is pinned as
contracts §2.12. This doc is the batch record: what the audit found, what was decided,
what changed, and the deferred ledger.

## 1. Motivation — the July 15 audit

A transitive-reachability audit over all 72 registry pairs (witnesses + demos) found the
decision-hoist gating **sound on every feature axis** (zero cross-feature leaks: no
GGX/dielectric/media/MIS/equiangular code in pairs that don't use them) but incomplete at
the **seam** level: estimator-support functions emitted by scene-side features
unconditionally. Typical program: 3–7% dead lines; worst class (`pt` + samplable env):
**24–27%** — the whole env-sampling stack (sampler + CDF walkers + chart, ~100 lines)
emitted where `directLighting: 'none'` meant nothing could call it. Other classes:
`scene_intersect_any` chains in no-NEE programs (~50L × 27), `interaction_surface_eval`
+ NEE guard in `pt` (21), `interaction_surface_pdf` in non-MIS (53), medium dispatch
eval/pdf twins, `is_null_interface` in `pt` media programs, dead `u_resolution`/`u_time`
in every main, dead `u_envSelectProb` in NEE env-only programs, `phase_g` struct field
in absorbing-only programs, `env_rotate_y` beside charts that don't call it.

## 2. Decisions (owner-ratified)

1. **Wholesale component inclusion is a declared cost** — pinned as contracts §2.12.
   Self-authored occupant files are trusted as written; the compiler never carves inside
   them. Unused ops inside an included occupant (`lambert_pdf` under `pt`, the
   `sampler_cdf.glsl` pdf half under nee, `sdf_intersect_any` in `raymarch.glsl`, the
   fisheye θ quartet, the `glsl/core/` spine) are NOT findings.
2. **Generated code must be exactly linked.** Every generated seam/uniform exists iff
   linked — recorded as ProgramDescription decisions (the `emitters.lightingPdf`
   precedent), enforced by the merge-stage `seam-unused` warning.
3. `environmentSamplable` was a T2 violation — the analyzer's kind-fact copied into the
   link map. It is now the decision (kind-samplable ∧ NEE machinery exists).

## 3. What changed

**T1 — Planner truth fix.** `environmentSamplable = envKindSamplable && lighting !== null`.
All prior readers already composed the flag with nee/mis themselves, so only the env
feature's emission changed. Kills the 24–27% class.

**T2 — seam decisions + gated emission.**
New ProgramDescription fields, derived once in `planProgram`:
`materials.surfaceEval` (= nee; gates the eval dispatch + `material_has_nondelta_lobes`),
`materials.surfacePdf` (= mis; gates the pdf dispatch),
`media.mediumEval`/`media.mediumPdf` (scattering twins),
`intersection.anyQuery` (= nee ∧ no media — the opaque shadow fast path is the only
caller; `shadow_media` re-spawns `scene_intersect`; gates generated
`scene_intersect_any` + `analytic_intersect_any`),
`environmentPdf` (= samplable ∧ mis; gates the constant env's generated pdf; the
tabulated pdf rides `sampler_cdf.glsl` as a `componentScoped` provide),
`environmentSelectionLive` (= samplable ∧ finite lights; gates `u_envSelectProb` and
folds BOTH selection sides to the constant 1 in env-only programs — sampler and
combiner now agree structurally, not by the app binding 1.0).
Every gated block's `provides` entry mirrors its emission condition.

**T3 — `seam-unused` merge diagnostic** (registered in codes.ts): a provided seam no
contribution requires is dead generated code → warning. `componentScoped` provides
exempt. Honest self-requires added where a feature's generated bodies call its own or
another feature's seams (intersection → `scene_region_at`; materials →
`scene_medium_properties`). `power_heuristic` left `provides` entirely: `math_mis.glsl`
now precedes its combiner callers (internal helper, not a cross-feature seam).
Zero warnings across all 72 pairs at build time — the ledger closed.

**T4 — feature-local trims.**
- `ROTATE_BLOCK` (`env_rotate_y`): emitted only for procedural radiance or the
  octahedral chart (equirect + the fixed map lookup apply `u_envRotation` inline).
- `is_null_interface`: gated on `nullInterfaces || shadowWalker` (the static
  `shadow_media.glsl` probes it unconditionally — constant-false fold in null-free
  media scenes).
- `MediumProperties` phase fields are now strictly schema-driven (§3.4 literal): the
  union of the PRESENT scattering models' properties, shared by core's struct, the
  lookup codegen, and the `{param}` uniform scan. Absorbing-only programs carry
  extinction fields only. (draine declares only `draine_d`; hg's `phase_g` no longer
  force-included.)
- `u_resolution`/`u_time` dropped from core (nothing in the main program reads them);
  the display pass's `u_resolution` binding is appended by the Generator, where the
  display shader is built. `u_time` returns when an animated feature declares it.
- **Latent bug fixed:** `combiner_w_light_medium` under mis called `hg_pdf` directly
  instead of the `interaction_medium_pdf` dispatch its own requires list names — any
  non-hg medium under `pt-mis` failed to link. One-word fix; the requires list was
  already correct.

## 4. Proof

- `npx tsc --noEmit` clean; **623/623 vitest green** including glslang static compile of
  every pair (before re-goldening: the only failures were the two snapshot files +
  the codes-registry test for the new diagnostic).
- Snapshot churn reviewed line-by-line by tally: deletions = exactly the dead
  dispatches/prototypes/uniforms; additions = moved blocks + source-map lines. Net
  −763 snapshot lines.
- Diagnostic scan across all 72 pairs: zero seam-unused, zero seam-missing.
- `npm run witness` sweep green (35/35) — every derived number holds (furnace 0.4000,
  F-ETA 0.5541, slab, F-BOX-M, sky/furnace-sky/proc-sky arms, equality + noise gates).
- Reachability audit re-run: the estimator-policy dead classes are gone; the remaining
  per-program residue is the declared §2.12 component/spine cost.

## 5. Deferred ledger

- **Per-shape geometry primitive occupants** — `sdf_primitives.glsl` /
  `analytic_primitives.glsl` are single occupant files, so unused shapes ride along
  (furnace carries `sdf_sphere`/`sdf_box`; ~10–25L). The lights family shows the target
  anatomy (per-kind folders) if the primitive library ever grows enough to warrant the
  reorg. Not done here: file reorg ≠ this batch.
- **`u_previous` in oneshot programs** — declared but never read (the occupant reuses
  the ping-pong pipeline; the binding is pass plumbing). Accepted as-is.
- **Identity-weight elision** (combiner bodies that fold to `return 1.0`) — the
  already-ratified Generate-stage fold; unchanged by this batch.
- **Interface-header prototypes for wholesale-included seams** — `componentScoped`
  provides still get header prototypes; harmless and truthful.
