# Independent review: `small-materials` plan (thin_dielectric + sheen)

**Verdict: approve with changes.** Both models are small, the sources are right, and the code
facts the plan cites hold. Two of the three new witnesses, though, either fail on correct code
or pass on wrong code as written. One authoring choice also triggers an existing Validator
warning. All of these are fixture or spec fixes; none changes the design.

Labels: [checked-code file:line], [checked-src URL], [checked-num script], [reasoning].
Script: `…/small-materials/review/e.ts`.

## What holds up

- **Cited code is accurate.**
  - The front hit sets `region_to = owner` [checked-code src/compiler/generate/features/intersection.ts:1696].
  - The open-defect note is in the rough-sheet fixture [checked-code tests/witnesses/index.ts:1515].
  - Emission keys on `region_to` [checked-code src/components/transport/techniques/kernel/kernel.glsl:16-19].
  - The quad is one-sided [checked-code src/components/geometry/quad/quad.glsl:2-4].
  - The walk sets `current_medium = region_to` on transmission, and eta_scale reads `ior_of` [checked-code src/components/transport/integrators/pt/pt.ts:446-453].
  - Non-transmissive models are pinned to 1.0 in `ior_of` [checked-code intersection.ts:1629].
  - The descriptor comment foresees a "sphere support, transmission false" model [checked-code src/components/descriptors.ts:136-141].
  - The microfacet core already names sheen as a future occupant of `usesMicrofacet` [checked-code src/glsl/core/microfacet.glsl:1-5].
- **The references were re-fetched and match.**
  - pbrt `ThinDielectricBxDF`: `R = FrDielectric(|cos|, eta); T = 1-R; if (R<1) { R += T²R/(1-R²); T = 1-R; }`, with reflect/transmit chosen by R:T and f = pdf = 0 [checked-src https://raw.githubusercontent.com/mmp/pbrt-v4/master/src/pbrt/bxdfs.h].
  - MaterialX Zeltner sheen: the E, aInv and bInv constants equal the twin's digit for digit. The LTC eval is `cosPDF(w'.z)·(aInv/|w'|²)²`. The sampler pdf is `cosPDF(w.z)·(aInv·|Mw₀|²)²`. Roughness is clamped to [0.01, 1]. The frame falls back when V ∥ N [checked-src https://raw.githubusercontent.com/AcademySoftwareFoundation/MaterialX/main/libraries/pbrlib/genglsl/lib/mx_microfacet_sheen.glsl].
  - `mx_sheen_bsdf` returns `dirAlbedo·color·D` (μ_i already inside D) with throughput `1 − E·weight`. So the plan's μ_i f_fuzz = c·E·D is right.
  - The OpenPBR equation f = F f_fuzz + lerp(1, 1−E, F) f_base matches the plan's (1 − W·E) [checked-src scratch copy of OpenPBR, openpbr.txt:1149].
- **Estimator algebra.**
  - The mixture pdf p·D + (1−p)μ_i/π is right.
  - When c = ρ the weight is exactly ρ [reasoning, re-derived].
  - Non-reciprocity is harmless for unidirectional estimators that all evaluate f(·|ω_o) [reasoning].
  - p = W·E has no spectral reduction, so sheen is identical in RGB and spectral programs [reasoning].
- **Simplicity.** Sheen is fixed over lambert. Thin glass has no tint, and media are excluded. This is the small version. W is not redundant with c: W = 0 must give back lambert exactly, and c = 0 alone still darkens the base [reasoning].
- **The media exclusion is necessary and honest.** On a front hit of a zero-thickness pane, `current_medium = hit.region_to = owner` drops the fog behind the pane for one segment. The dispatcher cannot be changed without breaking one-sided emission [checked-code above].

## Must fix

1. **The thin-pane emitter must have albedo 0.**
   - Lambert's albedo defaults to 0.8 [checked-code src/components/materials/lambert/lambert.ts:12].
   - The pane reflects R_tot ≈ 0.077 of the emitter's light back onto the emitter. The emitter then re-reflects about 0.8× that, raising both the pane region and the direct region by several percent. That is well beyond the 0.005 tolerance [reasoning].
   - Every spectral emitter fixture already writes `albedo: 0` [checked-code tests/witnesses/scenes/spectralDispersion.ts:10].
2. **In the tilted thin-pane arm, the reflected rays land on the emitter.**
   - At θ_i = 60°, the reflected ray makes d·r = 1 − 2cos²θ_i = 0.5 with the view direction. It goes forward at 60° off-axis, away from the camera, so it meets the front (emitting) face of a large emitter behind the pane [reasoning, re-derived].
   - The pane would then read up to T_tot + R_tot instead of T_tot = 0.836232.
   - Fix: specify geometry whose reflection cone misses the emitter (for example, a narrow emitter strip close behind the pane, with its extent stated), or put the hit fraction into the expected value.
   - The normal-incidence arms are safe, because the reflection returns toward the ortho camera.
3. **Authoring the pane's index as `ior` raises a spurious warning.**
   - The Validator collects every region-table source (`ior`) and warns "ior is ignored for model …" on any material whose model has no region-table row [checked-code src/compiler/analyze/Validator.ts:981-995]. `thin_dielectric` has none.
   - The plan's Q4 fallback is also the simplest fix: author key **`eta`**, with row `name` = `source` = `eta`. No existing row has name ≠ source [checked-code materials/*/*.ts rows]. pbrt's own name for a relative index is eta, which matches §2.1's meaning.
   - Add "no diagnostics" to T-T5's compile case. Today T-T5 would pass while the warning fires.
4. **As written, the sheen furnace cannot catch a wrong fuzz lobe.**
   - With c = ρ, the pt key is zero-variance for **any** D, E or sampler, as long as eval and pdf share code. So it never tests the sampler [reasoning].
   - The nee and mis keys see D only through W·E·ρ·(∫D − 1), and the furnace-sky region is the sphere's center, where μ_o ≈ 1. E values [checked-num review/e.ts]:

     | r | E(μ_o = 1) | E(μ_o = 0.1) |
     |---|---|---|
     | 0.5 | 0.0249 | 0.558 |
     | 0.05 | ≈ 0 | ≈ 0 |

     At r = 0.05, E ≈ 0 everywhere except μ_o < 0.1.
   - A 10% normalization error in D moves the center reading by 1.0e-3 at r = 0.5, under the furnace-sky tolerance of 0.008. The (W 1, r 0.05) arm tests only lambert.
   - Fix: make the fuzz-alone arm mandatory and grazing. Use c = 1, ρ = 0, a large quad under the constant sky, and an **orthographic** camera, so μ_o is one known value over the whole region.
   - Expected value: W·E(μ_o, r) [exact under the model]. For example, E(0.2, 0.5) = 0.4295 and E(0.3, 1) = 0.5914 [checked-num].
   - Run all three keys. pt tests the LTC sampler against D; nee tests eval and ∫D = 1.
   - Keep one c = ρ arm as the energy identity, and drop the r = 0.05 arm.
5. **One answer for "the scene has media".**
   - The new Validator error must read the Analyzer's census `media.hasMedia` [checked-code src/compiler/analyze/Analyzer.ts:16-26, consumed at Planner.ts:652]. It must not re-derive the predicate from the materials and `ambientMedium`.

## Smaller points (not blocking)

- **Sheen below the frame.** Say how a ω_o below `frame.n` is canonicalized: flip the local z, as `lambert_sample` flips n [checked-code lambert.glsl:16]. The LTC math assumes ω_o.z > 0. Also clamp μ_o to [ε, 1] as MaterialX does.
- **Q5.** (a) `usesMicrofacet: true` is fine. The flag's doc already covers the frame maps, and hand-written core files are included whole [checked-code descriptors.ts:111-114, microfacet.glsl:1-5].
- **eta_scale.** At a pane inside a transmissive region (say a pane submerged in a water solid), the eta_scale step multiplies by (1/n_water)². That ratio is not undone on exit, because `region_to` is the owner, which is pinned to 1.0 [checked-code pt.ts:450-453]. It feeds only the roulette metric, so the result stays unbiased but noisier. Say so in thin_dielectric.md.
- **Label mismatch.** The plan says the pinned values came from the house `dielectric_fresnel`, but twin.ts uses pbrt's `FrDielectric` (η = n_t/n_i). The numbers agree. Still, the real twin should transcribe math.glsl:95-102 with η = 1/ior, and the labels should say which function produced each value.
- **"Check this first" is already answered.** `MaterialModel` is an open string [checked-code src/compiler/types.ts:427]; no union edit is needed.
- **T-T5's cauchy case.** Say which code produces the error: the existing role-less row validation, or new code. The test is written first, so this is fine either way. The plan should not imply that nothing is added.
- **Tilt arm catches a flipped η.** At normal incidence R is symmetric under η ↔ 1/η, so only the cos 0.5 arm catches η inverted (inverted, it goes TIR and reads 0). That is another reason to fix item 2 rather than drop the arm.
- **§0 rows 3–5.** These are useful notes, but they belong in the survey, not a build plan. Trim them to one line each.

## Can the verification fail?

- **Thin-pane, after items 1 and 2: yes.** It separates a single interface (0.96) from the thin-slab series (0.923), and the tilted arm catches the η convention.
- **Digest no-change gate: yes.** It is the right gate for "no existing image changes".
- **Twin χ² and the §11.3 triple: yes**, against the twin. Per CLAUDE.md, nothing compares the GLSL to the twin. That is why item 4 is the plan's only GPU check of the sheen GLSL.
