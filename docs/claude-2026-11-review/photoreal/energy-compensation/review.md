# Review: energy-compensation plan

Reviewer: independent agent, 2026-11-06. Labels as in the plan: [checked-code], [checked-src], [checked-num], [reasoning].

**Verdict: approve with changes.** The model choice is right, and it is the simplest member of the
family: an ωₒ-only gain, so sampling and pdf stay unchanged. The math matches Cycles. The cited code
says what the plan says. Four things must change. Two of them are verification gaps: as written, the
GPU checks would pass even if the GLSL eval forgot the gain. One duplicates an existing decision (the
domain checks). One is a wrong citation.

## What I checked and found correct

- **Reference fidelity.** I re-fetched Cycles `bsdf_microfacet.h` from raw.githubusercontent.com
  (main). `microfacet_ggx_preserve_energy` sets `energy_scale = 1 + (1−E)/E` and then multiplies by
  `(1 + Fms·(1−E)/E)/energy_scale`, where `Fms = Fss·E_avg/(1 − Fss(1−E_avg))`. For glass it uses
  `1/E` from a 3D table, and from the `_inv` table when `ior < 1`. `ior_to_z_index = sqrt(|ior−1|/(ior+1))`.
  The plan's §2 formulas match [checked-src]. Turquin's text has Eq. 8, 10, 12 and 18 as cited
  [checked-src turquin.txt:176-298]. Cycles' `ior` is n_t/n_i, while the house η is n_i/n_t. The
  plan's channel assignment (R: η<1 entering denser, G: η>1 leaving) is consistent with the house
  convention [checked-code rough_dielectric.glsl:53,84].
- **Closed form.** E(μ=1, α=1) = (1/4π)·2π∫₀¹ 2c/(c+1) dc = 1 − ln 2. I re-derived it by hand, and it
  agrees with proto/check6.out [reasoning + checked-num].
- **The §11.3 triple.** The gain g(μₒ) multiplies eval (ggx.glsl:24; rough_dielectric.glsl:63,70) and
  both sample branches (ggx.glsl:44; rough_dielectric.glsl:112,126). The pdf is untouched, so
  weight·pdf = eval·|cos| still holds, and MIS weights (pdf-only) are unchanged
  [checked-code + reasoning]. The index-matched delta branch (:96-102) is correctly excluded.
- **Non-reciprocity is harmless here.** Both scoring sites evaluate f with ωₒ = the camera-side
  direction: BSDF sampling uses `interaction_surface_sample(mat, wo, …)`
  (kernel.glsl:29-30) and NEE uses `interaction_surface_eval(mat, ls.wi, wo, …)` (light.glsl:33)
  [checked-code].
- **Spectral and curved space.** μₒ comes from `microfacet_to_local`, which goes through `ambient_dot`
  (microfacet.glsl:22-24). η is one float after the hero collapse, and F_avg is per lane
  [checked-code]. No new Euclidean assumption.
- **Schlick average 1/21.** This is exact for the house `schlick_fresnel`, which uses the fifth power
  (math.glsl:83-84) [checked-code].
- **Bit-identity of the default.** x·1.0 is exact in IEEE for every finite x, wherever the compiler
  places the multiply, so risk 6 is smaller than stated [reasoning].
- **Citations I opened, all correct.** types.ts:596-598; measurement.ts:14-35; Validator.ts:875-880;
  BuiltinAssets.ts:9-30 (RGBA32F, width·height·16 bytes, sha-checked); components/assets.ts:11;
  core.ts:111; materials.ts:153-167; witness.mjs FRAME_CASES at ~:759; index.ts veach-mis
  :2268-2286, rough-mis :2317-2334, rough-furnace :2535-2557; rough_dielectric.md energy tables;
  spectral.ts textures precedent.

## Must fix

1. **The GPU never checks the eval-side gain.**
   - `ms-furnace` runs pt with no lights, so only the *sample* weight is exercised there.
   - The eval gain (the NEE path) is left to `veach-mis-ms` and `rough-mis-ms`, which reuse
     whole-frame `meanTol: 0.03`. Their materials are at roughness ≤ 0.6 (veach plates 0.1/0.22/0.38/0.6,
     with f0 ≈ 0.9) and 0.25 (rough-mis glass) [checked-code ggxScenes.ts:47-50,
     roughDielectricWitness.ts:75]. At those roughnesses the gain is about 1.00–1.10 on one plate
     out of four, and about 1.01–1.05 on glass.
   - So a GLSL eval that forgot the gain would very likely still pass both equalities [reasoning].
     CLAUDE.md says nothing checks GLSL against its twin, so this is the only GPU check of that line.
   - **Fix:** run `ms-furnace` under pt, pt-nee and pt-mis, with the constant white sky as the light.
     The constant environment is sampleable as a light per CLAUDE.md's status; confirm on an existing
     furnace strategy. Require every sphere = 1.0 under each strategy.
   - At roughness 1 the gain is about 3×, so a missing gain on either side reads about 0.3–0.6
     instead of 1.0. That makes it an *exact* check of both sides.
   - This also lets the plan **drop `veach-mis-ms` and `rough-mis-ms`**: fewer parts and a stronger
     check.

2. **The new domain checker duplicates an existing one.**
   - The plan adds `energyCompensation.unitIntervalRows` and a new Validator rule ("constants, and
     slider min/max"). The descriptor vocabulary already has this fact: `PropertySchema.constraint`
     with `{ kind: 'closed-interval', min, max }` [checked-code descriptors.ts:29-34,70-73].
   - Its one interpreter is already applied to constants, slider default and both ends
     (propertyValidation.ts:1-12,25-31,50-56) and to per-instance attributes (Validator.ts:1233-1240)
     [checked-code].
   - The plan's rule would miss per-instance `f0` attribute arrays, which the existing path covers.
   - **Fix:** express the domain as a row `constraint`. Simplest: put `closed-interval [0, 1]` on the
     `roughness` rows of ggx and rough_dielectric unconditionally. No suite scene authors
     roughness > 1 (grep of src/ and tests/). This is a validation change for every program, so it is
     a one-line owner decision in §6, but the owner decides a rule, not a mechanism.
   - For `f0`: the F_ms denominator 1 − F_avg(1−E_avg) stays positive for F_avg < 1/(1−E_avg) ≥ 1.6
     (E_avg ≥ 0.377 at roughness 1, check5.out). f0 ∈ (1, 1.6) is therefore finite. It is already
     non-physical, and single-scattering allows it today.
   - Either constrain `f0` by row constraint as well (owner decision) or state why no check is needed.
     Do not add a second checker.

3. **The control value 0.3069 ignores the neighbor spheres.**
   - In the single-scattering control strategy, every sphere is lossy. Rays reflected from the
     roughness-1 conductor at roughness 1 reach the hemisphere almost to the horizon, where the
     neighbor spheres sit.
   - Any ray that hits a neighbor returns L < 1, so the region reads 0.3069 minus an occlusion term.
     Near the horizon G1(ωᵢ)·cos is small, but against `tol 0.005` that term is not shown to be
     negligible [reasoning].
   - **Fix:** either derive and state the occlusion bound for the fixture's actual spacing, or give
     the control sphere its own scene or arrangement with no neighbor in its hemisphere.

4. **Wrong citation for MaterialX.**
   - MaterialX's `mx_ggx_energy_compensation` is `1 + Fss·(1−Ess)/Ess` with Fss = F_avg, i.e.
     Turquin Eq. 14. It is not the plan's F_ms (Eq. 12) form
     [checked-src scratch src/mx_microfacet_specular.glsl:514-522].
   - Say "Cycles uses Eq. 12, MaterialX uses Eq. 14", or drop the MaterialX claim. Turquin reports
     the variants as visually close (turquin.txt:265-275).

## Simplifications (recommended, not required)

- **One fact instead of two.**
  - Replace `usesMicrofacet: true` plus `energyCompensation: { kind }` with a single
    `microfacet?: { energy: 'conductor' | 'dielectric' }`. Its presence is the include gate at
    core.ts:111, and its value selects the gain.
  - The type then enforces that every microfacet model declares its gain, and the proposed Validator
    error ("usesMicrofacet but no energyCompensation") disappears.
  - With must-fix 2 also applied, the plan adds no Validator rule beyond the enum.
- **Add one more index to `ms-furnace`.**
  - Every glass sphere is at ior 1.5, so only one z position of the table is exercised on the GPU. An
    error in the GLSL z mapping (for example, a missing sqrt: z = 0.2 instead of 0.447) is checked by
    nothing that runs GLSL.
  - One sphere at ior 1.33 or 2.4, at roughness 1, costs one row of checks.
- **Optional: Turquin Eq. 16 (F_ms = F0).**
  - This would drop the E_avg channel and the F_avg formula. Turquin reports it as visually close
    and used it for the paper's Fig. 1.
  - Cons: it differs from Cycles, and it adds saturation. The plan's Eq. 12 costs one extra channel
    read. Owner's choice; I would keep Eq. 12, since it is what Cycles ships.

## Smaller notes

- **Texture units.** A compensated program binds one more sampler. Generator.ts:44-49 already errors
  above the 16-unit floor, so nothing fails silently. But no suite scene uses compensation, so CI's
  glslang pass never sees the worst case.
  - State the current sampler count of the largest spectral + image-env + data-texture program
    plus 1.
  - Note that the image-texture plan in the same batch will compete for the same units.
- **§4 test 7 (χ² with the gain) cannot fail from the gain.** The sampling distribution is
  unchanged, so χ² stays the same. The triple and pdf-agreement cases are the meaningful ones; say so,
  rather than counting χ² as coverage.
- **§4 tests 3–4 test the TS lookup, not the GLSL lookup.** Axis swaps, half-texel offsets and the
  slice index in GLSL are covered only by `ms-furnace`. That is another reason it needs whole-sphere
  regions at several roughnesses, which it has, plus must-fix 1.
- **`maxBounces 64` with no roulette in the glass furnace.** Probably enough: with rough TIR at
  n = 1.5, escape per interior hit is large. Still, state the residual or measure it once in the twin.
- **Size.** ~1,000 lines and a 512 KiB asset. Must-fix 1 removes two witness entries, and must-fix 2
  plus the merged fact remove the new Validator rule and the `unitIntervalRows` plumbing. Expect
  roughly 100–150 fewer lines.
