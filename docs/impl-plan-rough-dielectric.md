# impl-plan-rough-dielectric.md — the build

Design authority: `docs/fable-rough-dielectric.md` (owner-approved Aug 11 2026, all
four decisions ratified). This file is the task ledger + build record.

## T1 — the facts and the policy (BEFORE the model)

**Why first:** `tests/components/lightTree.test.ts`'s v1.5 pin literally demands it —
the constructor's normal policy must learn the case before a model can register it.
T1 stands alone: it is provable with a synthetic descriptor and changes no pixel.

1. **The capability split** (`components/descriptors.ts`): `capabilities` gains a
   REQUIRED `support: 'hemisphere' | 'sphere'`. `transmission` keeps its meaning
   (crosses the interface: ior row, `eta_scale`, `current_medium`, thin/instance rules).
   All five descriptors state it: lambert/ggx/mirror/checker `hemisphere`,
   dielectric `sphere`.
2. **`modelTwoSidedShading`** (`components/materials/index.ts`): the ONE predicate —
   `support === 'sphere' && nonDeltaLobes`. Fail-safe on unknown models (treat as
   two-sided: costs variance, never bias), mirroring the nondelta guard's polarity.
3. **`MaterialsDesc.twoSidedShading`** (plan/types.ts + Planner): the seam-existence
   DECISION (`lighting !== null ∧ some planned material is two-sided`). Generators read
   it; nothing re-derives it.
4. **`material_two_sided(int mat)`** (generate/features/materials.ts): the generated
   predicate, emitted only under the decision, in `generateNondeltaGuard`'s shape
   (all/none fold to constants).
5. **`LightQuery.two_sided`** (`glsl/core/structs.glsl`) + the generated constructors
   (`transport/integrators/pt/pt.ts`, `techniques/kernel/kernel.ts`): the policy site.
   Surface = `material_two_sided(mat)` under the decision, `false` otherwise; medium and
   the camera-init query = `false` (n = 0 already says "no orientation").
6. **The two-sided importance arm** (`accel/light_tree/light_tree.glsl` + the TS twin):
   `h = max(h₊, h₋)`, `|cos_c|`, cull skipped.
7. **Tests**: the contract-test FLIP (registry-wide: every sphere-support non-delta
   model must produce a two-sided query — asserted on the EMITTED constructor, with a
   synthetic model registered into `MATERIAL_MODELS`); importance invariants (two-sided
   never culls; agrees with one-sided when the cluster is fully above; symmetric under
   n → −n); snapshots re-goldened and audited to the constructor + decision classes.

**Expected churn:** every NEE program's `LightQuery(...)` lines (+1 argument), the
program-description snapshot (+1 field). GPU output unchanged.

## T2a — the microfacet carve

`glsl/core/microfacet.glsl` (`microfacet_D`, `microfacet_G1`, `microfacet_sample_vndf`),
conditionally included when any microfacet model is present; `dielectric_fresnel` moves
to `glsl/core/math.glsl` beside `schlick_fresnel`. `ggx.glsl` and `dielectric.glsl`
shrink to their model functions; `ggx.test.ts`'s twin and
`fable-reference-implementations.md` §7 follow the rename. Own commit; the diff is
audited to be exactly the move.

## T2b — the occupant

`components/materials/rough_dielectric/{rough_dielectric.glsl, rough_dielectric.ts,
rough_dielectric.md, rough_dielectric.test.ts}` + one registry line.
`fable-reference-implementations.md` §7b transcribed FIRST (the house rule), then the
GLSL against it. Rows: `roughness` (shared with ggx), `transmittance` + `ior`
(region-table, shared with dielectric), derived `alpha` (shared with ggx) — no new
`MaterialProperties` field. Capabilities: `nonDeltaLobes: true`, `transmission: true`,
`support: 'sphere'`, `emissive: false`.

## T3 — witnesses

W-SMOOTH-LIMIT, W-ROUGH-MIS, **W-GLASS-INCLUSION** (the §3 policy gate: emissive
inclusion in a rough-glass block under `lightSelection: 'bvh'` — `power ≡ bvh` and
`nee ≡ mis`), W-ENERGY (furnace curve vs roughness), plus `glass.roughness` live on the
glass-lab demo.

## T4 — the owner's sweep

Rough-glass scenes join the marched-glass re-gates. Gates in T3 are pre-calibration
estimates until then.

## Ledger

- T1 — **BUILT** Aug 11 2026 (churn audited: the LightQuery constructor lines in 45
  programs + one `twoSidedShading` field per program description; nothing else).
- T2a — **BUILT**. The move was proved content-preserving mechanically: undoing the
  rename on the carved file reproduces the old `ggx.glsl` line for line, the only
  difference being the VNDF block becoming a function. `veach + mis` joined the
  generated-GLSL byte snapshot, which had ZERO microfacet coverage before.
- T2b — **BUILT**. vitest 2132 green (incl. the new 21-case twin), glslang clean, the
  registry kitchen sink picks the model up automatically.
- T3 — **BUILT** (fixtures + registry entries + the glass-lab frosted twin). Scenes
  render clean headlessly (no shader errors, no validator rejections, no NaN).
- T4 — owner-gated: `npm run witness -- rough-smooth-limit rough-mis glass-inclusion
  rough-furnace`.

### Note for the sweep (where calibration is most likely needed)

Every gate in T3 is a pre-calibration estimate, but two deserve attention first:

1. **`rough-furnace`'s three sphere numbers are guesses.** The background 1.0 is the
   only exact number on that card; the transmittance curve is what the sweep MEASURES,
   and the tolerances are brackets to be replaced with the recorded values.
2. **`glass-inclusion`'s nee arms may need more spp than 256.** NEE through a glossy
   TRANSMISSION lobe samples the light direction and then evaluates a peaked BSDF at
   it, so its variance grows as roughness → 0 — the ordinary reason MIS exists, but
   worth knowing before reading a failure as a bug. A hand probe at ~25 spp read the
   nee arm ~11% dark at roughness 0.2 and in agreement at 0.45–0.7; a longer run at
   0.2 with both arms traced together showed nee ≡ pt to 0.5%, i.e. the early gap was
   a wall-clock-vs-sample-count artifact of the probe, not of the estimator. If the
   sweep shows the nee arms lagging at 256 spp, the fix is the scene's roughness
   (0.2 → ~0.5), not the model: raising it broadens the lobe and the arms agree fast.
   The `power ≡ bvh` check is unaffected either way — both arms share the technique
   and the coverage, which is exactly why it is the one that gates the policy.
