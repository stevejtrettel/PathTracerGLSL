# fable-rough-dielectric.md — the rough dielectric

**STATUS: owner-approved DESIGN (Aug 11 2026 — commissioned after the glass-lab arc,
amended the same session after the code audit + the reference research; the owner
ratified all four decisions: the capability SPLIT, the two-sided query, the fixed-core
microfacet carve, the `rough_` name prefix). Build record:
`docs/impl-plan-rough-dielectric.md`. This is the feature the v1.5 lightQuery policy
pin left a note for (`tests/components/lightTree.test.ts`: "the day a ROUGH-transmissive
model registers, this fails: extend the constructor's policy FIRST") — §3 is that
extension, and it lands BEFORE the model, exactly as the test insists.**

## 1. The shape of the feature

Rough glass: a microfacet dielectric (Walter et al. 2007 — the standard, restated in
pbrt-v4 §9.7) with BOTH a reflection and a transmission lobe, each non-delta. It is
what makes glass behave like glass — microroughness blurs successive internal bounces,
one of the three ways real glass suppresses the idealized-specular artifacts the
glass-lab night catalogued (absorption and dispersion being the others; absorption is
built, dispersion is spectral-era).

**The materials DOOR is not what this feature tests.** Adding a model has been one
folder + one registry line since July. What GGX-T tests is the VOCABULARY behind the
door: it is the first occupant whose *capability combination* is new, and every
non-trivial line of this batch follows from that one sentence. The work splits:

- **The BSDF** (§2) — transcription against machinery already in the house.
- **One new capability word** (§3) — the material fact sheet gains its second axis,
  and one downstream policy learns to read it. Small, but it is the part that must be
  DECIDED rather than slipped in, because getting it wrong makes it a patch instead of
  a law.
- **A library carve** (§4) — the first occupant that COMPOSES two other occupants'
  math, which forces the question of where shared BSDF math lives.

## 2. The BSDF (transcribe, don't re-derive)

Sources: Walter 2007 (the eval/pdf formulas incl. the transmission Jacobian), pbrt-v4
§9.5/§9.7 for the modern restatement and the conventions.
`fable-reference-implementations.md` gains a §7b with the transcribed GLSL before the
build (the house rule).

**The house conventions SIMPLIFY the transcription.** `hit.frame.n` is oriented toward
`region_from` (§4.1), so `wo` is ALWAYS in the upper hemisphere and
`eta = ior_of(region_from, p) / ior_of(region_to, p)` always: pbrt's
`if (cosTheta_o < 0) eta = 1/eta` side flip has no analogue here and must not be
transcribed. IORs come from the HIT's regions, never from the material — the smooth
dielectric's rule, unchanged.

- **Sampling**: draw the microfacet normal `m` by VNDF over α = roughness² (the shared
  sampler, α floor 1e-3). Exact Fresnel `F(wo·m, eta)` via `dielectric_fresnel` (NOT
  Schlick — the smooth dielectric's function, reused verbatim). `uc < F` → reflect
  about m; else refract through m (TIR at the m level falls out of F = 1). The (uc, u)
  split exists for exactly this: `uc` picks the lobe, `u` picks the microfacet.
- **Weight/pdf** (pbrt-v4 §9.7's form, which is Walter Eq. 17/21):
  `wm = normalize(wi·etap + wo)` with `etap = eta` for transmission and 1 for
  reflection; `denom = (wi·wm + (wo·wm)/etap)²`;
  `ft = D·(1−F)·G·|wi·wm · wo·wm| / denom`, divided by `etap²` for radiance transport;
  `dwm_dwi = |wi·wm| / denom`. Both lobes' pdfs carry the discrete lobe probability
  (`pr = F`, `pt = 1−F`), so `interaction_surface_pdf` returns the F-weighted sum and
  MIS sees the whole material. The backfacing-microfacet discards
  (`wm·wi · cosθi < 0`, `|wm|² = 0`, same-hemisphere on the transmission branch) are
  part of the transcription, not optional hygiene.
- **Radiance scaling**: our `radiance_scale = n_i²/n_t²` IS pbrt's `/etap²`. The η²
  factor on transmission and the `etaScale` RR bookkeeping copy the smooth dielectric's
  convention EXACTLY (§7.2 / F-ETA — any divergence makes the smooth-limit witness
  fail, which is that witness's job).
- **No `EffectivelySmooth` switch.** pbrt flips to a delta BSDF at low roughness; we
  cannot, and should not: `nonDeltaLobes` is a COMPILE-TIME capability and `roughness`
  may be a live slider, so a runtime delta flip would break the NEE guard and the MIS
  bookkeeping. The α floor of 1e-3 stands and true smooth glass is authored as
  `dielectric` — the same convention ggx already pins for mirrors ("author true mirrors
  as a delta model"). The library then carries both delta/rough PAIRS —
  `mirror : ggx` and `dielectric : rough_dielectric` — which is the intended shape, not
  duplication.
- **Flags**: `LOBE_TRANSMISSION` WITHOUT `LOBE_DELTA` — the first such sample in the
  codebase. Verified: everything downstream that keys on flags reads TRANSMISSION alone
  (the walk's `current_medium` update and the `eta_scale` accumulation both ignore
  delta-ness), and `ray_spawn` already escapes to `wi`'s side. **Transport churn: zero.**
- **Rows** (§3.4 schema): `roughness` (SHARED row with ggx — `schema.ts`'s union
  comment has been predicting this occupant by name), `transmittance` tint and `ior`
  (region-table) SHARED with dielectric, derived `alpha` shared with ggx.
  **`MaterialProperties` gains no new field** — which is the schema union earning its
  keep, and decent evidence the rest of the vocabulary is healthy.
- **TS twin duty**: the §11.3 pdf-histogram harness (ggx.test.ts's pattern) grows the
  transmission lobe: χ² over the sample histogram vs pdf, the weight·pdf ≈ eval·|cos|
  triple on BOTH sides, and η²-aware reciprocity (a BTDF is reciprocal only up to the
  η² factor — assert the corrected form, not the naive one).

## 3. The capability split + two-sided NEE (THE decision)

### 3.1 The fact conflation, dissolved

`capabilities.transmission` currently bundles two independent claims:

1. **"crosses the interface"** — an index change ⇒ the ior region-table row exists,
   `eta_scale` accumulates, `current_medium` switches, the thin-surface warning and
   the instance-batch exclusion apply.
2. **"the BSDF's support is the whole sphere"** — light arriving from BELOW the shading
   normal can scatter toward `wo` ⇒ NEE may connect there, and any consumer that
   assumes a hemisphere is wrong.

Every occupant so far answers both or neither, so the conflation has been invisible.
`rough_dielectric` still answers both — but it brings a FIFTH reader that asks only
question 2, and a future translucent model (diffuse transmission: sphere support, no
index change, no region table) would answer them differently. This is the placement-fold
batch's lesson verbatim: **dissolve a conflated fact when the second reader arrives**,
not before and not after.

**The split (owner-approved):** `capabilities.transmission` keeps meaning 1 unchanged.
A new required fact declares meaning 2:

```
support: 'hemisphere' | 'sphere'
```

Every registered model states it explicitly (required, no default — the geometry rows'
discipline). lambert/ggx/mirror/checker = `hemisphere`; dielectric = `sphere`;
rough_dielectric = `sphere`.

The rule downstream is then a LAW, phrased with no model name in it:

> A receiver whose BSDF support is the SPHERE and which runs NEE gets a two-sided
> selection query.

Any future model — GGX-T, a thin-sheet BTDF, translucency, layered, hair — inherits
correct behavior by declaring one word.

### 3.2 What actually breaks, precisely

The below-horizon cull lives ONLY inside the `bvh` light-selection occupant
(`light_tree.glsl`); `power` and `uniform` selection are orientation-free already. The
cull is licensed by a claim the query makes — today, implicitly, "my support is the
upper hemisphere". Under a sphere-support receiver that claim is false and the cull
zeroes a reachable light.

Where is it reachable? The `opaque-dielectrics` shadow truncation kills most far-side
connections: a shadow ray leaving through the surface crosses another dielectric
interface and dies. The exception is **an emitter inside the transmitted region** — a
glowing inclusion in a glass block, a lamp inside a glass shell. There the shadow ray
never crosses an interface, the contribution is real, and the cull would zero it.
Under `pt-nee` (no MIS weight to carry the term at 1) that is **bias**, not variance.
That configuration is the witness (§5's W-GLASS-INCLUSION), and it is the reason this
section exists at all.

### 3.3 The policy: a two-sided query, NOT `n = 0`

`LightQuery.n = 0` (the "no orientation" arm) would disarm the cull, but it throws away
orientation for the REFLECTION lobe too — which is the dominant NEE term at a rough-glass
surface, since the transmission lobe's NEE is occluded nearly everywhere. v1.5 measured
what normal-free costs: limb-noise proxy 1.45–1.96 vs 0.36–0.87. Paying that on every
rough-glass receiver to enable a usually-occluded term is the wrong trade.

**`LightQuery` gains `two_sided`** — the query's declared SUPPORT claim, the same
sentence the descriptor fact says — and the importance takes the sign-agnostic form:

- `h` becomes `max(h₊, h₋)`, the exact max over the box of `|n·(x−p)|`, computed from
  the SAME sign-selected corner machinery (the near corner is `bmin + bmax − far_c`);
- the center cosine becomes `|cos_c|`;
- **the cull is skipped** — `h_two ≥ 0` always, so a two-sided query can never zero a
  cluster. Bias-free by construction, and `h_two/dmax` is still a valid lower bound on
  the best-case `|cos|`, so the distance-and-shaping structure survives intact.

This is the SECOND growth event for the v1.5 selection context, and therefore the test
of its central claim ("context grows, nothing churns" via stored-query replay). The
stored query carries `two_sided`, so the pmf replays byte-identically as designed. It
does not foreclose the eventual per-lobe query — a sphere-support bit is that design's
degenerate case, not a competitor.

Cost, honestly: one struct field, ~4 ALU + one branch in the descent, and the three
generated `LightQuery(...)` constructor sites gain an argument — so **T1 is NOT
byte-identical**; every NEE program's light-query lines churn mechanically (GPU output
unchanged, since `two_sided` is false until a sphere-support non-delta model exists).

### 3.4 Riders

- `interaction_surface_eval` must be TOTAL for far-side `wi`. Already true of the
  transport side: NEE applies `abs(ambient_dot(...))` for the cosine, and `ray_spawn`
  escapes to `wi`'s side.
- `material_has_nondelta_lobes` returns true for a transmissive model for the first
  time — pure capability plumbing, no new seams. A consequence worth expecting: a
  glass-ONLY scene emits the `surfaceEval`/`surfacePdf` seams for the first time
  (today's pure-delta glass links neither). That already falls out of the existing
  exact-linkage decision; no new machinery, but the snapshots move.
- UNCHANGED, deliberately: `measurement.shadows: 'opaque-dielectrics'`. Shadow rays
  THROUGH glass stay a declared truncation. What §3 adds is NEE *from* rough glass, not
  visibility *through* it. **But this batch is evidence FOR lifting it** — rough glass
  is the material that most wants transmissive shadows, and that evidence belongs on
  the manifold-NEE ledger rather than being silently absorbed.
- Deferred: a per-LOBE query (ask selection about the lobe about to be evaluated) and
  AbsDot-shaped importance measured against the real trees. The v1.5 probe methodology
  (CPU descent over real trees) is the instrument; run it before adding machinery.

## 4. Where shared BSDF math lives

`rough_dielectric` needs `ggx_D`/`ggx_G1`/the VNDF sampler AND `dielectric_fresnel`.
Both live inside other occupants' `.glsl` files, and model files are included only for
models PRESENT — so a rough-glass-only scene links neither. Duplicating them is two
truths, which the house forbids.

Until now occupants shared CONTRACTS (core stdlib) but never MATH; `schlick_fresnel` in
`glsl/core/math.glsl` is the sole precedent. The durable answer (owner-approved): the
MODEL is swappable, the DISTRIBUTION MACHINERY is not. Microfacet D / Smith G₁ / VNDF
sampling are stdlib, so they belong in the FIXED layer, conditionally included the way
`math_media.glsl` is:

- **`glsl/core/microfacet.glsl`** — `microfacet_D`, `microfacet_G1`,
  `microfacet_sample_vndf`, included when any microfacet model is present.
- **`dielectric_fresnel` → `glsl/core/math.glsl`**, beside `schlick_fresnel`: the two
  Fresnel forms named side by side is an honesty win as well as a linkage fix.

Dividends: every future microfacet occupant (anisotropic α, sheen, layered,
multiple-scattering compensation, a Beckmann D) draws from one file, and the existing
histogram twin becomes the twin for the SHARED math rather than for one occupant. If a
distribution AXIS is ever carved (a second D occupant), the file moves into
`components/` with a registry — a rename, not a redesign.

## 5. Witnesses

- **W-SMOOTH-LIMIT**: roughness 0.02 vs the smooth dielectric on the eta-witness
  geometry — display-RMSE band + Δmean, a TREND gate not an exact twin (the α floor
  makes true 0 unreachable; document, don't pretend).
- **W-ROUGH-MIS**: a rough-glass solid under a samplable panel — nee ≡ mis Δmean/χ²,
  exercising the two-lobe pdf and the stored-query replay in one number, plus the pt
  tripwire.
- **W-GLASS-INCLUSION** (THE policy gate): an emissive inclusion inside a rough-glass
  block, rendered under `lightSelection: 'bvh'`. `power ≡ bvh` AND `nee ≡ mis`. This is
  the first witness that gates a SELECTION-policy bias rather than a BSDF number —
  without §3 it fails on the bvh/nee arm and passes everywhere else.
- **W-ENERGY**: white furnace, roughness ∈ {0.05, 0.2, 0.5} — the recorded
  transmittance curve (§6's declaration made checkable).
- **glass-lab**: gains `glass.roughness` as a LIVE slider (the driven-ior precedent) —
  the user-facing payoff and the visual check that rings/idealized sharpness soften
  physically.

## 6. Energy, honestly

Single-scattering microfacet transmission LOSES energy as roughness grows (the missing
multiple-scattering terms — a property of the model, not a bug). v1 DECLARES it in the
bias ledger, where the strategy taxonomy says truncations live: W-ENERGY measures
transmittance vs roughness and the descriptor's `.md` carries the numbers.

The fix is cheap to defer because its landing zone already exists: Turquin 2019's
compensation for DIELECTRICS needs a fitted directional-albedo table over (μ, α, η)
plus a side-dependent term — a genuine precompute, which is exactly the
"precompute the HOW, ship numbers as uniforms/rail data" discipline the house already
runs. No new machinery when it lands.

## 7. Staging

- **T1 — the facts and the policy, first** (the pin's own demand): the `support` split
  across all five descriptors, `LightQuery.two_sided` + the two-sided importance arm
  (GLSL + TS twin), the generated `material_two_sided` predicate + the constructor arm,
  the contract-test FLIP (from "no transmissive model may have non-delta lobes" to
  "every sphere-support non-delta model produces a two-sided query"), and a synthetic
  registry model proving the arm emits. No BSDF yet; no visual change.
- **T2a — the microfacet carve** (§4), its own commit, diff audited to the move.
- **T2b — the occupant**: `components/materials/rough_dielectric/`,
  reference-implementations §7b transcribed FIRST, then the GLSL and the TS twin.
- **T3 — witnesses (§5) + the glass-lab slider.**
- **T4 — the owner's sweep** (rough-glass scenes join the marched-glass re-gates).

## 8. Deferred

Multiple-scattering energy compensation (Turquin) — triggered by W-ENERGY's curve being
unacceptable in real scenes; anisotropic α; thin-film interference; dispersion (spectral
era); per-lobe two-sided light queries (§3.4's measured follow-up); transmissive shadow
rays (the manifold-NEE ledger, to which this batch adds evidence).
