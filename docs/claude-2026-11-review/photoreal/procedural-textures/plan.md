# Plan: procedural textures (solid noise in object space)

**Status:** draft for owner review. Nothing built. Scratch prototype only
(`proto/noise.ts`, `proto/measure.ts` next to this file; pbrt sources downloaded to `ref/`).

Labels: [checked-code file:line] read in this repo; [checked-src URL/file:line] read in the
reference source; [checked-num script] measured; [reasoning] thought through, not checked.

---

## 1. The problem, with evidence

Math scenes (SDFs, fractals, algebraic surfaces) have no surface parameterization. Photographic
materials (stone, marble, wood, worn metal, ceramic glaze variation) come from spatial variation
of albedo and roughness. What exists today:

1. **Expression rows exist and work.** Any material field row (albedo, f0, roughness, emission)
   may be `{ kind: 'glsl', source, params? }`, emitted verbatim into the generated resolver
   `scene_material_properties(int id, vec3 p, vec2 uv, int element, Wavelengths wl)`
   [checked-code src/compiler/generate/features/materials.ts:372-417, :253;
   src/compiler/generate/values.ts:63]. Spectral programs lift the RGB result by the row's role
   after all RGB arithmetic [checked-code src/components/color/spectral/README.md:188-202].
2. **There is no noise to write expressions with.** The only noise in the GLSL tree is the
   blue-noise display dither [checked-code src/glsl/shared/noise.glsl:1-10]. An author must
   hand-write sinusoids (demos/exprMaterialsScene.ts:21-24, 47).
3. **`p` is the world point, so textures do not move with objects.** Both call sites pass
   `hit.p` [checked-code src/components/transport/integrators/pt/pt.ts:419;
   src/components/transport/techniques/kernel/kernel.glsl:23]. A `{param}`-driven object slides
   through a fixed world pattern; a rotated copy of a textured object shows a different pattern.
4. **`uv` on an SDF is a world-anchored placeholder.** Shapes without a chart get
   `(p.x, p.z)·UV_PLANAR_SCALE` in world coordinates [checked-code src/glsl/core/structs.glsl:40-43,
   :60-62; src/compiler/generate/features/intersection.ts:677-681]. Fractals and marched
   shapes have no chart, so uv-based patterns on them are stretched on vertical faces and
   anchored to the world.

So two things are missing: a noise library, and an object-space point.

## 2. The model

**Solid texturing (Perlin 1985; pbrt-v4 "3D textures").** A texture is a function
f : ℝ³ → ℝ evaluated at the shading point written in the object's own coordinates,
q = g⁻¹(p), where g is the object's authored placement (a similarity: rotation R,
translation t, scale s; q = Rᵀ(p − t)/s). This needs no parameterization, so it works on
every surface, including fractals. It is what pbrt does: `PointTransformMapping` maps the
render-space point by a fixed `textureFromRender` transform
[checked-src ref/textures.h:229-245; ref/textures.cpp:75-79 — `Inverse(renderFromTexture)`].

**Perlin gradient noise (improved, 2002), as pbrt-v4 implements it**
[checked-src https://raw.githubusercontent.com/mmp/pbrt-v4/master/src/pbrt/util/noise.cpp, lines 19-104]:
for the lattice cell containing x with offsets d = x − ⌊x⌋ ∈ [0,1)³,

  noise(x) = trilerp over the 8 corners c ∈ {0,1}³ of  g_{h(c)} · (d − c),

with corner gradients chosen by a hash h of the corner (a 256-entry permutation, used three
times), gradient vectors the 12 cube-edge directions (`Grad`, noise.cpp:94-100), and
interpolation weights from the quintic fade w(t) = 6t⁵ − 15t⁴ + 10t³ (noise.cpp:102-104).

**fBm and turbulence** (noise.cpp:114-156): Σ_{i<n} ωⁱ noise(λᵢ x) and Σ ωⁱ |noise(λᵢ x)|,
λᵢ = 1.99ⁱ (1.99, not 2, so octave lattices do not align). pbrt picks n from ray differentials
(noise.cpp:116-117). **We do not:** n is authored. Rationale below.

**Color.** Textures return RGB; spectral programs lift the finished RGB by the row's role. pbrt's
`MarbleTexture` does exactly this — RGB arithmetic, then `RGBAlbedoSpectrum(...).Sample(lambda)`
[checked-src ref/textures.cpp:480-503]. Our expression rule already matches.

**Facts about the noise** [checked-num proto/measure.ts, TS twin of noise.cpp]:
- pbrt's 512-entry table is two copies of one permutation of 0..255, so a 256-entry table indexed
  `& 255` is exactly equivalent [checked-num: Python extraction from ref/noise.cpp].
- noise = 0 at every lattice point (max |noise| over a 10³ block of lattice points = 0).
- Value range: 2·10⁶ random samples gave [−0.782, 0.694], rms 0.265, mean −0.0006; a hill climb in
  32³ cells found |noise| = 1.011. Provable bound |noise| ≤ 2: each corner term is ±u ± v with
  |u|, |v| ≤ 1, and the trilerp weights are convex [reasoning]. fBm bound: 2·Σωⁱ.
- The derivative is continuous across cell faces (largest one-sided-difference jump 3·10⁻⁹).

**Estimator facts.**
- A texture changes only the integrand (the scene), never sampling: eval/sample/pdf of every
  model read the same `MaterialProperties`, computed once per hit [checked-code pt.ts:419]. The
  §11.3 triple is unaffected, and pt / pt-nee / pt-mis converge to the same image [reasoning].
- **No prefiltering.** Pixel supersampling converges to the box-filtered pixel integral of the
  authored texture. pbrt's differential-based octave clamp (noise.cpp:116-128) replaces the
  texture by a band-limited one, which changes the converged image; here that would be a
  measurement change. Detail finer than a pixel is not wrong, only noisy at low spp. The authored
  octave count is part of the scene, not a truncation [reasoning; agrees with
  docs/claude-2026-11-review/survey/sota-architecture.md:165-167].

**Curved spaces.** The noise functions are pure functions on ℝ³ and know nothing about the
ambient space. The one Euclidean step is g⁻¹ in `scene_object_point` (below). In H³/S³, where each
object is intersected in its own local frame (decisions.md item 9), q becomes "the local-frame
point read in a chart" (gnomonic/Klein or the exponential map at the object's origin). Picking
that chart is a question for the curved-space plan. No BSDF math is touched [reasoning].

## 3. The change and its boundaries

### 3.1 A Perlin library: `src/glsl/core/perlin.glsl` (new, about 70 lines)
A hand-written core library, like `microfacet.glsl`, transcribed from noise.cpp:
```glsl
float perlin_noise(vec3 x);                                  // noise.cpp:56-104
float perlin_fbm(vec3 x, float omega, int octaves);          // noise.cpp:114-131, no differentials
float perlin_turbulence(vec3 x, float omega, int octaves);   // noise.cpp:133-156, no differentials
```
- The permutation is `const int PERLIN_PERM[256] = int[256](...)`, indexed `& 255`.
- Lattice index: `int(mod(floor(x), 256.0))`. This is exact for |x| < 2²⁴ and avoids bitwise
  operations on negative ints. pbrt's `fmod(x, 2³⁰)` guards int overflow, which this form
  cannot hit [reasoning].
- The header states the bounds (|noise| ≤ 2 provable, ≈ 1.01 observed) so that authors can meet
  the reflectance ∈ [0,1] contract, which is not clamped at run time (spectral/README.md:197-201).
- **Inclusion:** linked whole when the program has any GLSL expression in a material row or a
  medium coefficient. The new Planner flag is `program.materials.procedural` (or one
  `procedural: boolean`; the planner decides it once). This follows the `usesMicrofacet` gate
  [checked-code src/compiler/generate/features/core.ts:107-113]. Media expressions get the
  library, which allows procedural smoke and clouds under the existing declared majorant, but
  they keep the world point (see §5).

### 3.2 The object-space point `q` in material expressions
- **The resolver gains the region** whose material it evaluates:
  `scene_material_properties(int id, int region, vec3 p, vec2 uv, int element, Wavelengths wl)`.
  - pt.ts:419 passes `hit.region_owner`.
  - kernel.glsl:23 passes `hit.region_to`, because emission is scored on the region ahead, which
    can differ from the owner.
  - q = g_R⁻¹(p) is a function of position, so it is well defined for any region at any point.
- **In each material arm that has an expression row** (the existing coarse notion,
  `materialReadsUv`, dataTenants.ts:51-56), the generator emits
  `vec3 q = scene_object_point(region, element, p);` before the row assignments. Other arms pay
  nothing.
- **A generated `vec3 scene_object_point(int region, int element, vec3 p)`.** It has one arm per
  region with a non-identity placement whose material reads expressions, and `return p;`
  otherwise (exact for identity placements; for every other region q is not read).
  (fable-imagery.md P1a describes a generated `scene_object_uv`, but no such symbol exists in
  src/ today [checked-code grep]; that doc is stale.) The inverse map has one spelling, reused
  from the geometry:
  - **constant** (folded, retained or tabled): the literal lines from `emitPlacementQuery(g)`
    [checked-code intersection.ts:631-655, function at :639] (Rᵀ/s folded into one mat3);
  - **driven:** `placement_rigid(u_q, u_ts, p) / placement_scale(u_ts)`
    [checked-code src/glsl/core/placement.glsl:24, :39]. placement.glsl is already linked
    whenever a driven placement exists [checked-code Planner.ts:621; intersection.ts:100];
  - **instanced batch:** fetch `q_i, ts_i` at `placementsBase + 2·element` (the frame-tier ABI)
    and apply the same two calls [checked-code intersection.ts:1002-1006]. Expression materials
    already force the frame tier [checked-code dataTenants.ts:123-130], and the CWBVH twin exists
    only for params-tier batches [checked-code instancing.ts:192-196], so `element` indexes these
    records in binary-TLAS leaf order [reasoning — confirm in the probe, §4.2].
  - **mesh:** the planned constant or driven placement [checked-code plan/types.ts:401-402].
    The vertices are object-local, so q is the OBJ file's own coordinates.
- **Plan data.** Folding discards a constant object's placement
  [checked-code plan/types.ts:357-362]. Add `PlannedPrimitiveObject.frame?: PlannedPlacement`:
  the authored placement, undefined when it is the identity, computed in the same place, from the
  same `similarityFromTransform`, as the fold. `placement` stays the geometry-arm decision; these
  are two different facts.
- **Scope variable documentation.** `q` joins `p`, `uv` and the params in the resolver header
  comment (materials.ts:374-377), materials/README.md, spectral/README.md "Surface RGB
  expressions", and fable-imagery.md P2.
- **Validator, one new error.** An instanced batch whose material has an *expression emission*
  row is rejected. Emission is scored at region_to, and when region_to is a batch that is not the
  owner, which instance contains p is unknown. That is a missing fact, so it must be an error, not
  a guess [reasoning]. Non-emission rows of `eprops` are computed but discarded at that site.
- **Other call sites** of the resolver signature: scripts/witness-blackbody.ts:60, 81, 122, 132;
  scripts/witness-dispersion.ts:44, 49, 53, 95; scripts/witness-wavelengths.ts:115, 117
  [checked-code grep]. Each gets the extra `int region` argument.

### 3.3 A demo card: `demos/proceduralTexturesScene.ts` (new)
Marble (the pbrt marble formula, textures.cpp:484-486, with an authored palette), a wood-ring
formula, and a GGX metal whose roughness row is `0.15 + 0.1·perlin_turbulence(8q, 0.5, 5)`. The
pieces are an SDF and a fractal, one of them driven, to show the texture following the object.
This is a feature card, not a composed "beautiful" scene; it is judged on renders.

### Files
New:
- `src/glsl/core/perlin.glsl`
- `tests/glsl/perlinTwin.ts` (reads the table out of `perlin.glsl?raw`, so the table has one source)
- `tests/glsl/perlin.test.ts`
- `scripts/witness-textures.ts` (+ a `witness:textures` script in package.json)
- `tests/witnesses/scenes/textureWitness.ts`
- the demo

Edited:
- `features/core.ts` (include)
- `features/materials.ts` (signature, q line, `scene_object_point`)
- `features/intersection.ts` (export `emitPlacementQuery`)
- `plan/types.ts` and `Planner.ts` (`frame`, `procedural`)
- `pt.ts`, `kernel.glsl`
- `Validator.ts` (one rule)
- the three witness scripts
- `tests/witnesses/index.ts`
- the docs listed above, and CHANGELOG.md

## 4. Verification (written first)

### 4.1 vitest (CPU)
- `perlin.test.ts`:
  - The table parsed from perlin.glsl is a permutation of 0..255, and its first 22 entries match
    pbrt's listing (noise.cpp:22-23).
  - The twin is 0 at lattice points.
  - The derivative jump across cell faces is < 1e-6.
  - |noise| ≤ 2 holds on 10⁶ samples, and the fBm bound 2Σωⁱ holds.
  - pbrt's `Grad` identities hold on all 16 hash cases.

  (No χ² or pdf test: textures do not sample.)
- Compiler tests:
  - A scene with an expression on a rotated, scaled, translated sphere emits
    `scene_object_point` with that object's arm.
  - A scene without expressions emits no q, no `scene_object_point` and no perlin block (exact
    linkage).
  - The Validator rejects expression emission on an instanced batch.
  - Snapshot and glslang compile of every registry scene, which covers the 256-entry const array
    under glslang.
- **Digest gate:** `npm run digest` before and after, then `--compare`. Every scene differs only
  in the resolver signature and its two call sites. Expression scenes additionally gain the q
  line and `scene_object_point`. Any other difference is a defect.

### 4.2 GPU probe (seconds, not the sweep): `npm run witness:textures`
Built on `tools/render-glsl-probes.mjs` like witness-spectral-bindings.
- (a) `perlin_noise`, `perlin_fbm(·, 0.5, 8)` and `perlin_turbulence` at 4096 fp32-exact points
  (including negative coordinates and points on cell faces) against the twin, to an absolute
  tolerance of 2e-5.
- (b) `scene_object_point` at known world points, against the TS similarity inverse, for:
  - a folded constant sphere;
  - a tabled constant object;
  - a driven object after moving its parameter;
  - a frame-tier instance batch (element 0 and element N−1);
  - a placed mesh.
- **Negative control** (run once, recorded): replacing the generated body with `return p;` must
  fail (b).

### 4.3 New witnesses (`tests/witnesses/scenes/textureWitness.ts`), small and SwiftShader-cheap
The scene is a unit sphere in a constant white environment (a convex lambert body, so every path
escapes after one bounce). Albedo:
`vec3(0.5) + 0.2·vec3(perlin_noise(4q), perlin_noise(4q + 17.3), 0.5·perlin_fbm(2q, 0.5, 6))`,
which is provably in [0.1, 0.9] by the bounds in §2 [reasoning].
- **`texture-frame-ref`**: the sphere at the identity placement.
- **`texture-frame-folded`**, **`-driven`**, **`-instanced`**: the whole scene (sphere *and*
  camera) moved by one similarity g (an oblique rotation, a translation, s = 2.5), applied as a
  constant transform, a `{param}` transform whose default is g, and a one-instance batch.
  - **Derived exact value:** a pinhole image is invariant when one similarity moves the scene,
    the camera and a constant sky together, and q is invariant by construction. So each image
    equals the ref. The check is `twin` vs `texture-frame-ref` with `rmse` (identical streams;
    only fp differences at the silhouette).
  - A texture over world `p` would fail this; that is the gate's purpose.
- **`texture-mesh-ref` / `texture-mesh`**: the same pair with the teapot OBJ (a mesh–mesh twin,
  so tessellation cancels).
- **`texture-estimators`**: the textured sphere on a ground plane under a quad light, with
  pt-nee vs pt-mis `equality` (χ²) and pt in the mean only.

### 4.4 Existing witnesses to run (targeted; never the full sweep)
- `expr-const-ref` and `expr-const` (the resolver path);
- `attr-twin-ref` and `attr-twin` (`element` plumbing);
- `instance-twin-ref` and `instance-twin`;
- `transform-bake-ref` and `transform-bake` (placement emission);
- `spectral-expressions-ref`, `spectral-expressions-constant` and `spectral-expressions`;
- the scripts `witness:spectral-bindings`, `witness:blackbody`, `witness:dispersion` and
  `witness:wavelengths`, whose signatures change.

## 5. What this does NOT do
- **No image textures, triplanar or hex tiling.** These need the image-texture feature, which is
  its own plan.
  - Recorded for it: triplanar is a 3-sample blend with weights wᵢ = |n_q,i|ᵏ / Σⱼ|n_q,j|ᵏ in
    object space, and it would add an object-space normal to the scope.
  - Repetition hiding: Heitz & Neyret 2018 (histogram-preserving blending, HPG / PACMCGIT 1(2)),
    or the simpler Mikkelsen 2022 hex-tiling (JCGT 11(2), no precomputation)
    [checked-src via web search; papers not read].
  - For procedural textures, solid noise in q makes triplanar unnecessary.
- **No bump mapping.** That belongs to the normal-mapping plan. Recorded for it: pbrt's `BumpMap`
  differentiates the displacement texture by finite differences along dpdu/dpdv
  (materials.h:109-140). On surfaces without UVs, a 3D height h(q) plus the surface gradient
  (Mikkelsen 2010, "Bump mapping unparametrized surfaces") needs no tangent [reasoning, not read].
- **No analytic noise gradient.** It has no reader yet.
- **No Worley/cellular noise** (open question 1).
- **No ray differentials or octave clamping** (see §2).
- **Media expressions keep world `p`.** An object-space point for media is a follow-up.
- **Procedural skies** do not get the library: they are baked by a separate program.
- **No group frame.** `flattenGroups` gives each leaf its own composed frame, so a group of
  objects is not textured as one block.
- **Spectral.** No change and no new gate. Expressions return RGB and are lifted by role in both
  color models, as pbrt does.

## 6. Risks and open questions
1. **Worley F1/F2 (cellular).** It is not in pbrt or Mitsuba 3. Mitsuba 3 has no noise textures
   at all: its texture plugins are bitmap, checkerboard, lut, math, mesh_attribute and volume
   [checked-src GitHub API listing of mitsuba3/src/textures]. Worley is valuable for stone and
   crackle. Add it now with its own twin, or later?
2. **The 256-entry const int array with dynamic indexing.** It is legal in GLSL ES 3.00, and
   glslang will confirm. Some ANGLE back ends compile large const arrays slowly
   [reasoning, unmeasured]. The fallback is an integer hash in place of the permutation. That
   deviates from pbrt, but the twin stays exact.
3. **Cost.** One `perlin_noise` call is 8 gradients, about 24 table reads; 8-octave fBm is about 200
   reads per row per hit. This is unmeasured on SwiftShader. Keep witness octaves ≤ 6.
4. **fp32.** Object-space coordinates above about 10⁴ lose lattice precision in `x − floor(x)`.
   This is a declared limit in the header.
5. **The coarse "reads expressions" notion** puts q into every expression arm, even when the
   expression ignores q. The cost is one mat3 or one texel fetch; precise detection waits for the
   deferred expression parser (docs/impl-plan-expression-machinery.md, Stage 0).
6. **Plan data.** Where exactly the Planner records `frame` (planScene vs placeScene; the instance
   base needs placeScene) is checked at implementation time. Any deviation means stop and ask.
7. **The resolver's new `region` argument changes every program's text.** The digest gate (§4.1)
   is what proves nothing else moved.

## 7. Estimate
About 850 lines in total:
- GLSL library: ~80
- compiler (planner, generator, validator): ~150
- call sites and probe scripts: ~15
- twin and tests: ~200
- GPU probe: ~150
- witness fixtures and registry: ~160
- demo: ~90
- docs: ~60
