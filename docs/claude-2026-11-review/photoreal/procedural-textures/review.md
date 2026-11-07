# Review: procedural-textures plan

Reviewer: independent agent. Verdict: **approve with changes.** The noise library is sound. The
object-space point `q` (§3.2) is most of the plan's moving parts and has three defects.

Labels: [checked-code file:line], [checked-src URL], [reasoning].

## Summary

The plan has two parts.

**Part A, Perlin noise as a GLSL library usable from expression rows.** This is small, faithful to
pbrt (with one exception, F3 below), cannot change any existing image, and is easy to verify.

**Part B, the object-space point `q`.** This touches:
- the resolver signature in every program;
- the plan data (a new `frame` field);
- a new region-keyed dispatch;
- a new Validator error;
- all four probe scripts.

It also reintroduces a design pattern the project deleted (F5). Its benefit is that textures stay
attached to driven or copied objects. A still photograph does not need that: world-anchored solid
noise on a static object is just as photographic.

**Recommendation:** build Part A alone, with world `p`. Write Part B as its own plan, after the owner
decides whether he wants it.

## (a) Simplicity

- **S1. Split Part B out.** Without it, the following all disappear: §3.2, the `frame` plan field,
  `scene_object_point`, the Validator rule, the signature ripple, digest risk 7, risks 5 and 6,
  probe (b), and four of the five `texture-frame-*` witnesses. Part A is roughly 80 lines of GLSL,
  20 of compiler code (the include gate), 150 of twin and tests, 100 for the GPU probe (a), and the
  demo: about 350 lines instead of 850. The demo uses `p`. [reasoning]
- **S2. `texture-estimators` cannot fail for this change.** Expression emission is never in the
  light roster (spectral/README.md:203-205; `hasConstantNonzeroEmission` gate at
  dataTenants.ts:134) [checked-code]. Every estimator reads the same `MaterialProperties`
  (pt.ts:419) [checked-code]. A pt-nee vs pt-mis equality on a textured albedo therefore tests
  nothing the existing `expr-const` pair does not already test. Drop it. [reasoning]
- **S3. If Part B is kept, record `frame` once.** For a patterned, rotated shape whose chart is
  declared (sphere, quad, disk, torus: `uvChart: true`), `keepsLocalFrame` (dataTenants.ts:59-62)
  already keeps the constant similarity in `placement` [checked-code]. The new `frame` field would
  then hold the same similarity a second time. The authored similarity is one fact. Record it once
  and have `placement` say only whether the geometry arm conjugates. [reasoning]
- **S4. Media inclusion.** Adding the library to medium coefficient expressions is a scope
  addition with no witness. It is harmless because the gate is coarse, but say so, or limit
  Part A to material rows.

## (b) Estimator correctness

- **Part A is clean.** The texture is a function of the scene and never of sampling. The §11.3
  triple is untouched. Expression emitters stay path-found under all three estimators
  [checked-code spectral/README.md:203-205]. I found no undeclared change to existing images:
  scenes without expressions gain nothing. [checked-code core.ts:107-113, as the gating precedent]
- **The no-prefiltering argument is right.** I checked pbrt's FBm in the zero-footprint limit:
  len2 → 0 gives n = maxOctaves and nPartial = 0, so `SmoothStep(0, .3, .7) = 0` and FBm equals
  the plain sum. The plan's `perlin_fbm` is exactly pbrt's limit.
  [checked-src https://raw.githubusercontent.com/mmp/pbrt-v4/master/src/pbrt/util/noise.cpp]
- **F3 below covers Turbulence**, which is not pbrt's limit.
- **The bound |noise| ≤ 2 is correct.** Each `Grad` returns ±u ± v, where u and v are components
  of offsets in (−1, 1], and the trilerp weights are convex. So the witness albedo lies in
  [0.1, 0.9]: 0.5 ± 0.4, and 0.5 ± 0.1·2·Σ₀⁵ 0.5ⁱ = 0.5 ± 0.394. [reasoning, rechecked]
- **The heterogeneous-media majorant is an author contract.** Noise in σ under a declared majorant
  is unbiased only if the expression stays at or below the majorant. The header bound helps here,
  but the plan should name this as the media-side contract, next to the reflectance one, if S4 is
  kept.

## (c) Fit with the codebase

All cited lines exist and say what the plan claims, with the exceptions F1, F2, F4 and F5.

**Checked:**
- materials.ts:252 and :378 (the resolver signature);
- pt.ts:419 and kernel.glsl:23 (the call sites);
- structs.glsl:40-43 and :60-62;
- intersection.ts:639 (`emitPlacementQuery`), :677-681 (`uvFill`), :1002-1006 (frame-tier fetch);
- placement.glsl:24 and :39;
- Planner.ts:621;
- dataTenants.ts:51-56 and :123-130;
- plan/types.ts:357-362 and :401-402;
- the witness names in §4.4 (all present in tests/witnesses).

**Findings:**
- **F1 (must fix): a call site is missing.** scripts/witness-spectral-bindings.ts:61, :169 and :179
  also call `scene_material_properties` with the old signature [checked-code grep]. The plan lists
  only blackbody, dispersion and wavelengths, yet §4.4 runs `witness:spectral-bindings`, which
  would then fail to compile.
- **F2 (must fix if Part B is kept): tabled objects.** §3.2 gives "folded, retained or tabled"
  constant objects a literal `emitPlacementQuery` arm, one per region. Table dispatch exists so
  that many objects do not each get an unrolled arm. Analytic table records are folded, with no
  frame stored (dataTenants.ts:59-62; plan/types.ts:357-362) [checked-code]. A scene with
  thousands of tabled objects sharing one expression material would therefore get thousands of
  literal arms in `scene_object_point`, the compile-size blow-up the table avoids. q for tabled
  objects must come from data (a record field, ledger change) or be declared out of scope with
  a Validator error. [reasoning]
- **F4 (must fix if Part B is kept): the Validator rule rejects valid scenes.** "An instanced
  batch whose material has an expression emission row is rejected" turns scenes that compile and
  render today (world `p`) into errors. The ambiguous case is narrower:
  - The region ahead (region_to) is a batch only for batches with `hasInterior`
    (intersection.ts:360-364) [checked-code].
  - When the batch owns the surface (`region_to == owner`), `mat_emit == mat` and
    kernel.glsl:23 reuses `props` with the correct `element`.

  Narrow the rule to batches with an interior, or accept the regression explicitly. Also record
  that kernel.glsl:23 already passes the owner's `hit.element` to region_to's material. That is a
  defect today for per-instance attribute emission rows on interior batches; it predates this
  plan and is worth a line in the open-defects list. [checked-code kernel.glsl:23; reasoning]
- **F5 (must fix if Part B is kept): the plan does not mention the deleted pattern.**
  `scene_object_point(region, …)` is a region-keyed O(N) dispatch. The project had exactly such a
  sibling, `scene_object_uv(p, region)`, and deleted it (docs/impl-plan-sdf-as-shape.md:132-136;
  lesson at docs/impl-plan-sdf-accel.md:101-105: region-keyed O(N) dispatches are safe only at
  top-level call sites) [checked-code]. The plan calls fable-imagery.md P1a stale but does not
  say that its own design brings that pattern back. The plan's two call sites are top-level, so
  it is legal under that lesson. Still, the plan must say so, and compare it with the design
  that replaced `scene_object_uv`: compute the local point in the hit-fill arm, which already
  conjugates the ray. That alternative needs a Hit field, which is a contract edit; the owner
  should choose between the two.
- **Curved spaces:** no new `ambient_dot` bypass. The noise is a function on ℝ³, and the only
  Euclidean step is g⁻¹ inside Part B. This is correctly flagged. [reasoning]

## (d) Reference fidelity

I re-fetched pbrt-v4 `src/pbrt/util/noise.cpp`. The following match the plan's prototype
(proto/noise.ts):
- `Noise`: fmod 2³⁰, floor, `&= 255`, the eight `Grad` corners, quintic `NoiseWeight`, the trilerp
  order x, y, z;
- `Grad`: the hash `perm[perm[perm[x]+y]+z] & 15` and the u/v selection;
- `FBm`: λ ×= 1.99, o ×= ω;
- the first 30 table entries.

The 256-entry table indexed `& 255` is equivalent to pbrt's doubled 512-entry table.
[checked-src https://raw.githubusercontent.com/mmp/pbrt-v4/master/src/pbrt/util/noise.cpp]

- **F3 (must fix): Turbulence is not pbrt's zero-footprint limit.** pbrt's Turbulence adds
  `o * Lerp(SmoothStep(nPartial, .3, .7), 0.2, |Noise|)`. With nPartial = 0 this is **0.2·ωⁿ**,
  a constant the plan's `perlin_turbulence` (proto/noise.ts:30-34) omits. The plan says
  "noise.cpp:133-156, no differentials", which reads as a transcription. Either include the
  +0.2ωⁿ term (pbrt's limit) or state the deviation in the header and the plan.
  [checked-src noise.cpp Turbulence; checked-code proto/noise.ts]

## (e) Can the verification fail?

- **Twin vs pbrt.** No test ties the twin to pbrt's numbers. The GPU probe compares GLSL to the
  twin, and the twin was checked only by reading.
  - **Fix (cheap):** compile the downloaded `ref/noise.cpp` functions (`Noise`, `Grad`,
    `NoiseWeight`, `FBm`/`Turbulence` with zero differentials) standalone with clang. Record a
    few hundred golden values, including negative coordinates, in the test.
  - Today's tests ("|noise| ≤ 2 on 10⁶ samples", "0 at lattice points", "derivative jump
    < 1e-6") pass for many wrong implementations. The derivative test cannot tell the quintic
    fade from the cubic 3t² − 2t³: both have zero slope at 0 and 1, so the gradient is
    continuous either way. A second-derivative jump test, or golden values, would catch it.
    [reasoning]
- **fp32 in the twin.** The twin computes λ = 1.99ⁱ in fp64, while GLSL uses fp32 1.99f. Use
  `Math.fround` for λ and o in the twin (proto imports `fround` but never uses it). Otherwise the
  2e-5 probe tolerance has unnecessary slack or spurious failures at high octaves.
  [checked-code proto/noise.ts:5, 25-34]
- **The fold path is never exercised (if Part B is kept).** `texture-frame-folded` uses a unit
  sphere with an oblique rotation and an expression material. `keepsLocalFrame` therefore keeps
  that similarity, so the witness exercises the retained arm, not the fold
  (dataTenants.ts:59-62; sphere.ts:20 `uvChart: true`) [checked-code].
  - To exercise the fold, use a shape without a chart (a box, or the motivating case: a marched
    SDF such as a menger with `backend: 'sdf'`), or a translate-and-scale placement.
  - No witness uses an SDF or a fractal, though they are the plan's motivation.
- **Strong points:**
  - The frame-invariance witness is a good derived-exact test. A world-`p` texture fails it, and
    a convex Lambert body in a white sky gives L = albedo(q) with no path variance.
  - The digest gate is good.
  - The negative control on probe (b) is good.

## Must fix (for Part A alone, only F1, F3 and the twin–pbrt golden values apply)

1. F1: add scripts/witness-spectral-bindings.ts (lines 61, 169, 179) to the call-site list (Part B
   only; Part A changes no signature).
2. F3: include pbrt's +0.2·ωⁿ turbulence residual, or declare the deviation.
3. Tie the twin to pbrt numerically: golden values from compiling ref/noise.cpp. Use fp32 λ and o
   in the twin.
4. If Part B stays:
   - F2: tabled objects get literal arms; take q from data, or declare and reject;
   - F4: narrow the Validator rule (it now rejects scenes that render today);
   - F5: acknowledge the reintroduced region-keyed dispatch and give the owner the hit-fill
     alternative;
   - give the fold path and an SDF a witness.

## Simplifications

- Split: Part A now (about 350 lines), Part B as its own plan after the owner decides. (S1)
- Drop `texture-estimators`. (S2)
- One field for the authored similarity, not `frame` plus `placement`. (S3)
- Leave media out of the include gate, or declare it with the majorant contract. (S4)
