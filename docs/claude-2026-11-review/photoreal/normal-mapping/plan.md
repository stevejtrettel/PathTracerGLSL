# Plan: bump maps and normal maps (shading-normal perturbation)

Status: draft for owner review. Nothing is built. Scratch twin:
`/private/tmp/claude-501/-Users-stevetrettel-Code-PathTracerGLSL/04194012-7031-43cb-a852-aed5c827ffd4/scratchpad/photoreal/normal-mapping/twin.ts`
(output beside it in `twin-output.txt`).

Labels: [checked-code file:line] read in this repo; [checked-src URL] read in the
reference source; [checked-num twin.ts §n] measured by the scratch twin; [reasoning]
not checked.

The plan has two stages that can be approved separately:

- **Stage A, procedural bump (buildable now).** A height field h(p) written as a GLSL
  expression in the world point p tilts the shading normal. It works on every surface
  (meshes, analytic shapes, marched SDFs, fractals) and needs no uv coordinates and no
  tangent direction. It also builds the shared machinery: the frame swap in the walk,
  the flip and the mask.
- **Stage B, tangent-space normal-map images.** This needs a parameterization tangent
  (`dpdu`) on `Hit` and image textures, so it waits for the image-texture plan. It
  reuses all of Stage A's machinery.

---

## 1. The problem, with evidence

- Every shading frame is built from the normal alone, so its tangent is arbitrary:
  `hit.frame = ambient_frame(hit.p, n)` [checked-code
  src/compiler/generate/features/intersection.ts:709, :906, :1025, :1707]. The tangent
  comes from `abs(nn.x) < 0.9 ? x̂ : ŷ` [checked-code
  src/components/ambient/euclidean/euclidean.glsl:13-19]. A tangent-space normal map
  needs the uv chart's ∂p/∂u (survey finding sota-3, [checked-code
  docs/claude-2026-11-review/survey/sota-architecture.md:160-164]).
- `Hit.ng` exists and is already documented as the field for "later normal/bump maps"
  [checked-code src/glsl/core/structs.glsl:29-36]. `ray_spawn` offsets along ng
  [checked-code src/glsl/core/ray.glsl:29-31]. Region classification uses ng
  [checked-code intersection.ts:1690-1708]. `mesh_light_pdf` uses ng [checked-code
  src/compiler/generate/features/lighting.ts:665, :922]. So these consumers are already
  safe from a perturbed `frame.n`.
- Readers of `hit.frame` after the hit are the materials, the NEE cosine
  [checked-code src/components/transport/techniques/light/light.glsl:26], the
  light-query constructor [checked-code src/components/transport/integrators/pt/pt.ts:134]
  and the normal guide [checked-code src/components/aov/normal/normal.glsl:9]. All of
  them must see the same perturbed frame. If the NEE cosine used a different normal than
  the material's sample weight, pt and pt-nee would converge to different images
  [reasoning].
- The dielectric clamps `cos_i = clamp(wo·n, 1e-6, 1)`, which assumes wo lies above the
  shading normal [checked-code src/components/materials/dielectric/dielectric.glsl:24].
  The survey lists "the shading-normal-below-surface rule is undecided" as the open gap
  [checked-code docs/claude-2026-11-review/survey/materials-lights-color.md:299].
- The mesh leaf's comment asks for this design: "With normal maps this rule becomes a
  general one (one place, any surface)" [checked-code
  src/components/intersection/mesh/mesh.glsl:100-108].
- No surface detail is possible today: there is no bump, normal-map or displacement
  code anywhere in `src/` [checked-code: grep for bump/normal map finds only the
  structs.glsl comment and the review docs].

## 2. The model

**Bump (Stage A).** Let n_out be the owner surface's outward unit normal at p. Let h be
a scalar field on ambient space (world units). The bumped surface is p + h(p) n_out. To
first order in h, its normal is

    n'_out ∝ n_out − ∇_S h,   with ∇_S h = (∂h/∂t) t + (∂h/∂b) b,

where (t, b) is any orthonormal tangent basis at p. This is pbrt-v4's `BumpMap` with
the `h·dndu` terms dropped: dp/du' = dp/du + (∂h/∂u) n gives n' = n − h_u t − h_v b
for orthonormal t, b [checked-src
https://raw.githubusercontent.com/mmp/pbrt-v4/master/src/pbrt/materials.h lines
109-139; the algebra is reasoning]. Dropping the curvature term is the model's
definition, not an approximation that the system hides. The derivatives are central
differences along geodesics, with a declared step ε:

    ∂h/∂t ≈ [h(exp_p(ε t)) − h(exp_p(−ε t))] / 2ε.

This uses only `ambient_geodesic`, so it works unchanged in curved spaces, and it needs
no uv chart, so it works on SDFs. pbrt likewise uses finite differences, with
du = 0.0005 when there are no differentials (materials.h:118-120).

**Normal map (Stage B).** A texel c ∈ [0,1]³ decodes to m = 2c − 1, with x and y
scaled by `strength`. This follows the glTF `normalTexture` convention: linear transfer
function, z > 0, OpenGL +Y [checked-src
https://raw.githubusercontent.com/KhronosGroup/glTF/main/specification/2.0/Specification.adoc
lines 2823-2845]. Then n'_out = m.x T + m.y s B + m.z n_out, where T = Gram-Schmidt(dpdu
against n_out), B = n_out × T, and s = ±1 is the bitangent sign (glTF TANGENT.w; lines
1815-1825). The pbrt-v4 `NormalMap` has the same frame but no sign [checked-src
materials.h:86-106; bsdf.h:25 `Frame::FromXZ(Normalize(dpdus), ns)`].

**Orientation.** The walk's `frame.n` faces `region_from`. Write σ = +1 if
`frame.n = n_out` and −1 otherwise. Then the shading normal is n' = σ n'_out =
frame.n − σ ∇_S h. σ is +1 exactly when the ray entered the owner:
`region_to == region_owner`. The dispatcher sets `region_to = region_owner` only on
entry [checked-code intersection.ts:1694-1708]. On exit `region_to` is the probe's
outside region, and that cannot be the owner, because thin owners never claim
containment [checked-code intersection.ts:351-353] [reasoning for the solid case].
Without σ, the relief would invert when seen from inside. For glass, the entry and exit
surfaces would then not be the same surface.

**Making it sound** (Mitsuba 3's `PerturbedBSDF`, transcribed, with one change):

1. *Flip* (Schüssler et al. 2017, as Mitsuba implements it). If wo·n' ≤ 0, mirror n'
   across the base normal n = frame.n: n'' = 2(n'·n) n − n'. If wo·n > 0 and n'·n > 0,
   then wo·n'' > 0 [checked-src
   https://raw.githubusercontent.com/mitsuba-renderer/mitsuba3/master/src/bsdfs/perturbed_bsdf.h
   lines 159-164] [checked-num twin.ts §1: 2·10⁶ random wo and slopes up to ~600 gave
   zero failures; the minimum of wo·n''/wo·n is 4.9e-6]. The premise holds for every
   base frame today. For analytic and marched surfaces the base is ng. For meshes,
   mesh.glsl:108 puts the interpolated normal on ng's side of the ray. Bump has
   n'·n = 1/|n − ∇h| > 0, and glTF maps have z > 0. This rule removes the black
   fringes and keeps the dielectric clamp's assumption true.
2. *Mask.* Accept a direction wi only if it lies on the same side of the true surface as
   of the shading normal: (wi·ng)(wi·n'') > 0. The same mask goes in eval, pdf and
   sample. A masked sample has weight 0 and pdf 0. Mitsuba masks against the
   unperturbed shading frame [checked-src perturbed_bsdf.h:57, :211-218]. **This plan
   masks against `Hit.ng` instead.** On analytic and SDF surfaces the two are the same.
   On smooth meshes ng is the surface that `ray_spawn` actually crosses
   [checked-code ray.glsl:29-31], so ng is what stops light from leaking through
   [reasoning].
3. *Cosine.* Transport's cosine is |wi·n''|. This holds because the walk replaces
   `hit.frame` with the perturbed frame before NEE, sampling, the light query and the
   guides. pbrt-v4 does the same thing (`AbsDot(wi, isect.shading.n)`) [checked-src
   https://raw.githubusercontent.com/mmp/pbrt-v4/master/src/pbrt/cpu/integrators.cpp
   lines 439, 453, 473].

**Consequences** (all estimators share them, so pt, pt-nee and pt-mis converge to the
same image):

- No energy is gained. The mask only removes directions, and the nested model is
  already energy-conserving in its own frame [checked-num twin.ts §3: the maximum
  directional albedo over 300 random configurations is 1.0000 for Lambert ρ=1 and
  1.0000 for GGX f0=1].
- Energy is lost in the wedge between n'' and the true horizon. Example: Lambert ρ on a
  plane with a constant slope tan θ under a uniform sky L reads exactly ρL(1+cos θ)/2,
  for every view direction, flipped or not. For slope 1 and ρ = 0.4 that is 0.341421
  [checked-num twin.ts §2: the BSDF, NEE and MIS estimators give 0.3413-0.3426]. This is
  the accepted darkening.
- Light does not leak through the true surface on perturbed materials.
- The BSDF is not reciprocal. The frame depends on wo, and the mask uses ng. That is
  harmless for camera-only (unidirectional) transport, which is all this project does
  (decisions.md item 6). Veach's adjoint correction only matters for light tracing
  [reasoning; pbrt-v4's path integrators show no correction, only BDPT/light paths do].
- The sampling triple stays consistent. A χ² test of the masked sampler against the
  masked pdf, with a rejected cell, passed for Lambert and GGX, and the
  eval/pdf/weight triple agrees to 1e-12 [checked-num twin.ts §4].

**Spectral and RGB.** The perturbation reads no `Spectrum`. h is a float expression and
a normal map is raw direction data. So the code is identical in RGB and spectral
programs, and dispersion collapse is unaffected [reasoning]. Stage B requires that the
texture plan offers a *data* (linear, never lifted) texture kind. Reading a normal map
through the RGB→spectrum lift is a compile error.

**Curved spaces.** Stage A uses `ambient_geodesic`, `ambient_dot` and `ambient_frame`
(which normalizes in the metric seam), plus linear combinations of tangent vectors at
p. It adds no new Euclidean assumption. Stage B adds one seam function,
`ambient_frame_xz(p, n, t)` (pbrt's `Frame::FromXZ`), which every space must provide.

## 3. The change and its boundaries

### Stage A: procedural bump

| File | Change |
|---|---|
| `src/compiler/types.ts` | `MaterialDescription` gains the meta-key `bump?: { height: GlslExpression; step?: number }` (height in world units, step in world units). |
| `tests/components/materialsContract.test.ts:13` | `RESERVED_KEYS` gains `'bump'`. |
| `src/compiler/analyze/Validator.ts` | Errors: `bump` on model `'none'`; `height` not a `GlslExpression`; `step ≤ 0`. The expression sees only `p`. A `uv` reference fails to compile, because the generated function has no `uv` in scope. |
| `src/compiler/plan/types.ts`, `Planner.ts` | `PlannedMaterial.bump?: { height, step }` and the decision `MaterialsDesc.perturbed: number[]` (bumped material ids). Generators read this decision and never re-derive it. |
| `src/glsl/core/shading_normal.glsl` (new, ~45 lines, conditional include in the microfacet pattern) | `hit_outward_sign(hit)`, `shading_frame_perturbed(hit, wo, n_prime)` (flip, then `ambient_frame`), `shading_side_consistent(hit, wi)` (the mask), `shading_masked(InteractionSample, hit)`. |
| `src/compiler/generate/features/materials.ts` | When `perturbed` is non-empty, emit `float bump_height_<id>(Point p)` (the expression), `Direction bump_gradient_<id>(Hit hit)` (four height calls along ±t and ±b) and `Frame material_shading_frame(int mat, Hit hit, Direction wo)`. In `generateInteractionDispatch`, add dedicated arms for perturbed ids ahead of the model arms, the way emission cones already get them (materials.ts:937-943): eval and pdf are `shading_side_consistent(hit, wi) ? M_op(..) : 0`, and sample is `shading_masked(M_sample(..), hit)`. Seam: provides `material_shading_frame`. |
| `src/components/transport/integrators/pt/pt.ts` | Flag `f.perturbed`. After `Direction wo = -s.ray.direction;` (pt.ts:419-420), emit `hit.frame = material_shading_frame(mat, hit, wo);`. It runs before the guides, NEE, sampling and the light query. When the flag is set, `material_shading_frame` is added to the required seams. |
| `src/components/materials/README.md` | New section, "Shading-normal perturbation": the model, σ, the flip, the ng mask, and the accepted darkening. |
| `docs/claude-normal-mapping.md` | This plan, as the design record. CHANGELOG entry. |

Scenes without `bump` produce **byte-identical** output, because every piece is gated
on the decision. The digest will prove this.

### Stage B: normal-map images (after the image-texture plan)

| File | Change |
|---|---|
| `src/glsl/core/structs.glsl` | **A contract edit to `Hit` (needs owner approval):** `Direction tangent;` (unit ∂p/∂u, world) and `float bitangent_sign;` (±1, or 0 where the chart has no tangent). These are filled by every hit-fill site, behind a `materialsReadTangent` gate in the `materialsReadUv` pattern (Planner.ts:649). Otherwise they are 0. |
| `src/components/intersection/mesh/mesh.glsl` | `mesh_test_range` and both traversal entry points gain an `inout vec3 dpduLocal` and a sign. These are computed per triangle from the three uvs, as in pbrt-v4 `Triangle` [checked-src https://raw.githubusercontent.com/mmp/pbrt-v4/master/src/pbrt/shapes.h lines 899-910], under a compile-time flag. |
| sphere, quad, disk `.glsl` and `.ts` | `<type>_tangent(p, shape)`: quad gives edge1, sphere gives ∂/∂φ of its atan chart, disk gives the radial direction. The descriptor declares `tangentChart: true`, and geometryContract.test pins that the symbol exists if and only if the flag is set. |
| `intersection.ts` | `primitiveHitFill`, the three mesh arms and the instance/table leaves rotate the tangent like a direction. The SDF marcher writes 0. |
| `src/components/ambient/euclidean/euclidean.glsl` | `ambient_frame_xz(p, n, t)`. |
| `materials.ts` / `types.ts` / Validator | Meta-key `normalMap: { texture, strength? }`. Errors: both `bump` and `normalMap` on one material; `normalMap` on a shape without a tangent chart (SDF, box, cylinder, torus, …); on a mesh without uvs; on a texture that is not a data texture. `material_shading_frame` gains a decode arm. The flip, mask and σ are reused unchanged. |
| assets | Poly Haven `nor_gl` maps (OpenGL green channel, matching glTF). Poly Haven publishes both `nor_gl` and `nor_dx` [checked-src https://api.polyhaven.com/files/rocky_terrain_02 keys]. |

## 4. Verification (written first)

**TS twin** (`src/components/materials/shading_normal.test.ts`, a line-for-line
transcription of `shading_normal.glsl` over the existing Lambert and GGX twins; scratch
version already passing [checked-num twin.ts]):

1. Flip guarantee: for random wo above n and random slopes, wo·n'' > 0, including both
   signs of σ.
2. χ² of the masked sampler against the masked pdf, with a rejected cell, for Lambert and
   GGX at two configurations. Also the triple identity weight·pdf = f·|cos| and
   sample.pdf = pdf.
3. Albedo ≤ 1 for Lambert and GGX (f0 = 1) under perturbation.
4. Estimator equality: BSDF, uniform-sphere NEE and power-MIS estimates of the
   tilted-plane integral agree with ρ(1+cos θ)/2 for flipped and unflipped wo.
5. The σ rule: n'(σ = −1, frame −n) = −n'(σ = +1, frame n), so it is one surface seen
   from both sides.
6. The finite-difference step in float32 [checked-num twin.ts §5]: for features of size
   ~0.08 with |p| ≤ 10, ε = 1e-3 gives a worst relative gradient error of 1.2e-3. ε = 1e-2
   gives 5e-2 (truncation) and ε = 1e-5 gives 9e-2 (rounding). The test pins the error law
   that the README states.
7. Stage B: decoding a constant map (0.5 + 0.5·sin θ, 0.5, 0.5 + 0.5·cos θ) with T = x̂
   gives the same n' as the Stage A bump h = −tan θ·x. A G > 0.5 texel tilts toward +B.

**Compiler tests:** Validator errors (one test per rule above). The emitted
`material_shading_frame` and the masked arms exist only for bumped ids. Seam linkage is
clean (no missing or unused seams). The glslang compile covers the new witness scenes in
**both** `color: 'rgb'` and `'spectral'`.

**Refactor gate:** run `npm run digest` before and after Stage A, then `--compare`. The
expected result is **no difference in any suite scene**. Stage B changes `Hit`, so the
digest will change. For Stage B, run `npm run frames -- record` before and after, then
`compare`. Pictures must be **bit-identical** for every fixed case.

**New witness** `tests/witnesses/scenes/bumpWitness.ts`, with two registry entries:

- `bump-tilt`: an infinite plane y = 0, Lambert ρ = 0.4, `bump: { height: 'p.x' }`
  (slope 1, θ = 45°), constant samplable sky L = 1, RR off. Keys: pt, pt-nee, pt-mis,
  and pt-nee with `color: 'spectral'`. Checks: a near region where the view is steeper
  than 45° (unflipped) and a far region where it is shallower (flipped) both read
  **ρ(1+1/√2)/2 = 0.341421**, and the sky reads 1.0. Wrong results distinguish the
  failures: 0.4 means the mask is missing, and 0 means the flip is missing
  [checked-num twin.ts §2].
- `bump-sides`: two thin quads with normal +y and the same bump `p.x`. The camera sees
  quad A's front and quad B's back. Directional light 1 propagates along (1,−1,0)/√2 and
  light 2 along (1,1,0)/√2, each with E = π, and they are placed so that neither quad
  shadows the other. Exact values: **A front = ρ** (n'·l = 1) and **B back = 0**
  (n'·l = 0). Without the bump both read ρ/√2. With the wrong σ, the back reads ρ. Keys:
  pt-nee and pt-mis.
- Stage B adds `normal-map-tilt` (a quad with a constant tilted `nor_gl` image) and a
  `twin` check against `bump-tilt`, plus an orientation case under light 1.

**Existing witnesses:** if the Stage A digest is identical, no existing witness can
change, so run only the new ones. For Stage B (the Hit edit), run `mesh-light-smooth`,
`mesh-furnace`, `mesh-quad-twin`, `accel-triple`, `mesh-instance-twin`, `table`,
`transform-bake`, `furnace-sky` and `guides` (targeted runs only, never the sweep).

## 5. What it does not do

- It does not displace geometry. Silhouettes stay smooth, and shadows come from the
  undisplaced surface.
- Stage A has no image bump maps (heights in uv). Normal-map images are Stage B.
  Triplanar normal maps on SDFs are not planned (they are a blending heuristic).
- It does not include the shadow-terminator term (Estevez 2019, Mitsuba's
  `use_shadowing_function`, [checked-src perturbed_bsdf.h:23-30]). That term changes the
  image, so it would enter later as a declared option.
- It does not use Schüssler et al.'s full microfacet normal mapping, which needs a
  stochastic random-walk sampler. The simpler Mitsuba default is chosen.
- It does not change smooth meshes without maps. Their missing ng mask is today's
  behavior, and changing it is a separate measurement decision (Q2).
- It does not port MikkTSpace. Stage B uses per-triangle tangents (Q4).
- It does not do anisotropic models. `dpdu` from Stage B would enable them later.

## 6. Risks and open questions

- **Q1. Finite-difference step.** Should `step` have a declared default of 1e-3 world
  units, with the error law (truncation (ε/ℓ)²/6 plus float rounding) stated in the
  README, or should it be required? Recommendation: a default, since pbrt has one
  (0.0005).
- **Q2.** Should the ng mask also apply to smooth meshes without maps? That fixes leaks
  but changes the `cacti` and teapot images. Recommendation: not in this plan.
- **Q3.** Should the bump field be in world p (like every expression row today, so it
  slides over driven or moving objects) or in object-local p? Recommendation: world p
  now, local p as part of the expression machinery generally.
- **Q4 (Stage B).** Per-triangle tangents differ from MikkTSpace bakes (Blender bakes in
  MikkTSpace [reasoning, unverified]). On low-poly smooth meshes this shows faint seams
  along edges. Textures on analytic charts are exact. The MikkTSpace port (~600 lines of
  TS plus a data tenant) would be a separate plan.
- **Q5 (Stage B).** Triangles with degenerate uvs have no tangent space. Proposed rule:
  `bitangent_sign = 0`, the map is not applied there, and the packer reports the count.
  pbrt falls back to an arbitrary frame instead (shapes.h:912-918).
- **Q6 (Stage B).** The `Hit` contract edit (two fields, every fill site) needs owner
  approval.
- **Risk: cost.** Each bumped hit costs four height evaluations, and procedural noise is
  expensive. Register pressure from the extra arms may slow SwiftShader witness runs.
- **Risk: σ.** The rule is checked in the dispatcher's code but not against GRIN or
  instance containment arms. The `bump-sides` witness covers thin quads only. A closed
  mesh or instanced glass case should be added if review finds a path that sets
  `region_to = owner` on exit.

## 7. Estimate

- Stage A: about 250 lines of source (types 15, Validator 30, Planner 25,
  shading_normal.glsl 45, materials.ts 80, pt.ts 10, README 40) and about 450 lines of
  tests and fixtures (twin 250, compiler tests 80, witness 120).
- Stage B: about 250 lines of source (Hit and fill sites 40, mesh leaf 40, three tangent
  charts 30, seam 10, normal-map arm and validation 70, descriptor and contract 30,
  planner gate 20) and about 200 lines of tests and witnesses.
