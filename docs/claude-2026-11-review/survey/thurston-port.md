# thurston-rebuild — what a curved-space port to PathTracerGLSL would take

Reader: survey agent, 2026-11-06. Read-only. Source: /Users/stevetrettel/Code/thurston-rebuild
(single commit dae073a5 "source + examples (from french server, Sept 2025)"; three.js + JS +
GLSL 1.0-style `gl_FragColor`/`varying`; webpack). Compared against PathTracerGLSL
src/components/ambient and src/glsl/core.

Confidence tags: **[checked]** = I read the code (or ran a numeric check) that proves it;
**[inferred]** = reasoning, not verified; **[math]** = standard math fact I verified by
derivation, not by running code.

---------------------------------------------------------------------------------------------

## 1. The two-minute picture

thurston-rebuild ("3DS", the 3-dimensional.space ray-marcher) renders the eight Thurston
geometries by **ray-marching SDFs along exact geodesics**. A geometry is a *pair of GLSL
files* (`part1.glsl`, `part2.glsl`, ~250–330 lines together for E³/H³/S³/H²×R/S²×R) that
define four structs and ~20 functions:

| concept | GLSL | JS twin |
|---|---|---|
| `Point` | `struct Point { vec4 coords; }` | `Point.prototype.build/reduceError/applyIsometry/interpolate` |
| tangent vector | `struct Vector { Point pos; vec4 dir; }` — a vector *carries its base point* | three `Vector3` at the origin only (`core/geometry/Vector.js`) |
| `Isometry` | `struct Isometry { mat4 matrix; }` (+ `float shift` in H²×R, S²×R) | `Isometry.prototype.*` monkey-patched per geometry |
| `Position` (frame) | `struct Position { Isometry boost; mat4 facing; }` = isometry ∘ O(3) frame at origin | `core/geometry/Position.js` (boost + quaternion) |
| exp map / geodesic flow | `Vector flow(Vector v, float t)` → point **and** transported velocity | `Isometry.makeTranslationFromDir(vec)` |
| metric | `float geomDot(Vector, Vector)` | — |
| distance | `float dist(Point, Point)` (imports/distance.glsl) | — |
| two-point geodesic | `Vector direction(Point p, Point q)` (imports/direction.glsl) | — |
| frame section | `frame(p)` (NOT orthonormal) and `orthoFrame(p)` (orthonormal, = transport from origin) | — |
| move-to-origin | `makeTranslation(p)`, `makeInvTranslation(p)` | same names |
| numeric hygiene | `reduceError(Point/Vector/Isometry)` (renormalize onto the model) | same |

Everything else (shapes, lights, materials, cameras, renderers, quotient groups) is written
against that surface, so shapes and lights are per-geometry, but the march loop, cameras and
renderers are geometry-agnostic. Geometry is chosen at *bundle* time (`src/3dsHyp.js`, …): each
bundle monkey-patches the shared core classes' prototypes and sets
`Renderer.prototype.constructor.shader1/shader2`.

Quotient manifolds (lattices, closed hyperbolic manifolds) are handled by **teleportation**:
the ray carries a `RelVector {Vector local; GroupElement cellBoost, invCellBoost}`; when the
local point leaves the fundamental domain (a list of half-space tests), it is moved back by a
group element and the cell boost is updated. "Local" shapes live in the quotient (evaluated in
the fundamental domain + optional nearest-neighbour cells); "global" shapes live in the
universal cover (evaluated by pulling the shape back by `invCellBoost`).

There is a path tracer (`core/renderers/PathTracerRenderer.js` + `shaders/pathTracer/`), but it
is a demofox/"Casual Shadertoy Path Tracing"-style toy: chance-based lobe selection, no NEE, no
MIS, no light sampling at all, an ad-hoc `hackCoeff = 0.2` on first-bounce emission. **The
geometry layer is worth porting; the path tracer is not** — PathTracerGLSL is far ahead.

---------------------------------------------------------------------------------------------

## 2. File map (with line counts)

### 2.1 core (geometry-agnostic) — src/core, ~4,000 lines JS+GLSL
- `core/geometry/` — abstract JS classes whose methods all `throw "need be overloaded"`:
  `Isometry.js` 169, `Point.js` 107, `Vector.js` 49 (a three `Vector3` = tangent vector at
  origin in the reference frame), `Position.js` 270 (boost + quaternion; `flow(v)` =
  right-multiply by `flowFromOrigin(facing·v)`; `fakeDiffExpMap` for VR controllers),
  `Group.js` 35, `GroupElement.js` 109.
  GLSL: `shaders/model1.glsl.txt` 136 + `model2.glsl.txt` 33 = **the interface template a
  geometry must implement** (good documentation of the contract); `commons1.glsl` 97
  (geomMix, negate, geomLength, geomNormalize, cosAngle, geomReflect, geomRefract — all
  written only against `geomDot/add/multiplyScalar`, so they are geometry-generic);
  `commons2.glsl` 64 (createVector from frame coords, `struct Position`, `applyPosition`);
  `groups.glsl` 25 (applyGroupElement + deprecated `applyIsometry(GroupElement, …)`).
- `core/teleportations/` — `relative.glsl` 231 (RelPosition, RelVector, ExtVector, `rewrite`,
  RelVector versions of every vector op), `teleport.glsl.mustache` 52 (`teleport()` +
  `creepingDist()`), `creeping.glsl.mustache` 25 (binary-search creep to the domain wall),
  `Teleportation.js` 164, `TeleportationSet.js` 133, `RelPosition.js` 254 (JS-side camera
  teleport using hand-written JS twins of the GLSL tests).
- `core/renderers/` — `Renderer.js` 155, `BasicRenderer.js` 156 (Phong + lights, no shadows),
  `PathTracerRenderer.js` 219 (accumulate in HalfFloat targets, `Math.random()` frame seed),
  `VRRenderer.js` 132; shaders: `basic/raymarch.glsl` 124, `basic/scenes.glsl.mustache` 102,
  `pathTracer/raymarch.glsl` 267 (`raymarch`, `scatterRaymarch`, `getColor`),
  `pathTracer/vectorDataUpdate.glsl.mustache` 164 (the "BSDF"), `pathTracer/nextObject…` 25,
  `pathTracer/random1.glsl` 89 (Wang hash), `random2.glsl` 14.
- `core/shapes/` Shape.js 208 (isom, absoluteIsom chain via parent), BasicShape/AdvancedShape
  31 each, mustache wrappers `sdf/gradient/uv/numericalGradient`.
- `core/solids/Solid.js` 150 — shape + `material` (Phong pipeline) + `ptMaterial` (PT pipeline).
- `core/lights/Light.js` 71 — `maxDirs` + `{{name}}_directions(RelVector v, int i, out dir,
  out intensity)`: **a light may reach a point along several geodesics**.
- `core/cameras/` — Camera.js 168 (minDist/maxDist 50/maxSteps/threshold/fov/position),
  SphereCamera, FlatCamera, PathTracerCamera (focalLength/aperture fields, unused by mapping),
  VRCamera, asym cameras.
- `core/Generic.js` 139 — uuid-named base; the **JS object itself is passed as the GLSL
  struct uniform** (three.js matches JS property names to struct field names).
- `utils/ShaderBuilder.js` 163 — append-only string builder with dedupe by name/string.

### 2.2 per geometry (euc, hyp, sph, h2e, s2e)

| geometry | geometry GLSL | imports | shapes (struct.glsl + JS) | lights | groups (quotients) |
|---|---|---|---|---|---|
| euc | part1 187 + part2 57 | distance 6, lightIntensity 10 | ball, box, cylinder, cappedCylinder, torus, cappedTorus, halfSpace, menger, displacement, local* | point, localPoint, constDir | freeAbelian (3-torus), hantzsche-wendt, kleinS1 |
| hyp | part1 252 + part2 85 | distance 5, direction 8, lightIntensity 13, trueLightIntensity 9 | ball, halfSpace, horoball, cylinder (tube about a geodesic), slab, local{Ball,Cylinder,CappedCylinder,CappedCone,RoundCone,Horoball,DirectedHoroball}, semiLocalSlab | point, truePoint, localPoint, localTruePoint, sun (ideal point), constDir | cube (ideal cube, QuadRing exact), augmentedCube, m125, seifert-weber, whitehead, h435 honeycomb |
| sph | part1 186 + part2 73 | distance 5, direction 7, lightIntensity 8 | ball, halfSpace, cylinder (tube about a great circle), circle, cliffordTorus, local* | point (2 directions), localPoint, constDir | quaternion (lens/prism spaces), poincare |
| h2e | part1 279 + part2 76 | distance 7, direction 10, lightIntensity 9, noise 34 | ball, horoball (tilted by an elevation angle), verticalCylinder, horizontalCylinder, wHalfSpace, verticalHalfSpace, wCappedCylinder, local* (slabs, stacks, noisy) | point, localPoint, constDir, esun (vertical sun) | horizontalLoop, zLoop, genus-2 quotients, cuspedTorus, orbiTorus, plane |
| s2e | part1 199 + part2 71 | distance 8, direction 9, lightIntensity 9 | ball, wCylinder, verticalCylinder, horizontalCylinder, wHalfSpace, wCappedCylinder, local* | point, localPoint, constDir, esun | torus, zLoop, cube |

Shape boilerplate per primitive per geometry: `XShape.js` (~70–130 lines), `shaders/struct.glsl`
(~30–80), `solids/X.js` (~22), plus a line in `shapes/all.js` and `solids/all.js`.

### 2.3 nil / sol / sl2 (why they are harder) [checked]
- Nil: `flow` is closed-form but needs an asymptotic branch near `c·t → 0`
  (nil/geometry/shaders/part2.glsl:61–110); **no closed-form `direction(p,q)` or distance**:
  `imports/exactDistance.glsl` solves for a parameter numerically (`zero_height`), and
  `fakeDistance.glsl` gives a lower bound used by "fake balls". Shapes use the numerical
  gradient.
- Sol: flow needs Jacobi elliptic functions (`ellipj`, `ellipz`, AGM;
  sol/geometry/shaders/part1.glsl 589 lines, with a note that one variant breaks on Windows
  Chrome).
- SL2: `fakeDirection.glsl`, `fakeDistance.glsl`.
So in these geometries the two-point geodesic problem and the SDFs are not analytic — exactly the
owner's exclusion criterion.

### 2.4 docs
- doc/tutorials/start/index.md 286 (scene building), extending/shape.md 174, material.md 140,
  solid.md 53. Good for the JS API; they describe the extension recipe (class + struct.glsl +
  mustache wrappers). Minor mismatch: shape.md says an unimplemented `isGlobal` "always return
  true" but `Shape.isGlobal` throws (core/shapes/Shape.js).

### 2.5 path-tracer examples
examples/index.html lists PT demos: euc/pathTracer, euc/ptTranslucent, euc/ptLens,
hyp/pathTracer, hyp/ptGlowing, hyp/ptCloudyMaterial, hyp/ptScatter, hyp/ptLensLattice,
hyp/ptSw, hyp/ptSwTubes (Seifert–Weber), nil/pathTracer, pathTracer/{basic,lens,glow,switch,
debug}. hyp/pathTracer/index.html: a lattice in the ideal-cube quotient = complement(union(local
ball, 8 local horoballs)); light = emissive `LocalBall` with `BasicPTMaterial({emission})`;
point lights there are "for the Phong material (not used by the path tracer)".

---------------------------------------------------------------------------------------------

## 3. Exactly what each geometry provides (the port inventory)

Representation: all five use `vec4` points and `vec4` tangent directions, isometries as `mat4`.

### E³ (euc) — trivial; PathTracerGLSL already has it.
Points homogeneous `(x,y,z,1)`, isometries affine `mat4`. flow `p + t d`. dist = Euclidean
length. No `direction` import (lights compute `normalize(q-p)` inline).
lightIntensity = **1/len** (not 1/len²) — artistic, euc/imports/lightIntensity.glsl:7–10.

### H³ (hyp) — hyperboloid model, signature (+,+,+,−), origin (0,0,0,1)
| function | file:line | formula | analytic? |
|---|---|---|---|
| `hypDot` | hyp part1.glsl:11 | x·x'+y·y'+z·z'−w·w' | yes |
| `reduceError(Point)` | part1:109 | `p/√|⟨p,p⟩|` | yes |
| `reduceError(Vector)` | part1:185 | `d + ⟨p,d⟩p` (project to T_p) | yes |
| `reduceError(Isometry)` | part1:48 | **no-op** (Gram–Schmidt commented out: "makes everything worse" for big boosts) | — |
| `makeTranslation(p)` | part1:128 | `I + sinh·M + (cosh−1)·M²`, M the boost generator toward p | yes |
| `geomInverse` | part1:85 | `inverse(mat4)` (general inverse; J·Mᵀ·J would be exact & cheaper) | — |
| `flow(v,t)` | part2:78 | p' = cosh t p + sinh t d, d' = sinh t p + cosh t d, then reduceError + normalize | yes, exact |
| `dist(p,q)` | imports/distance.glsl:4 | `acosh(−⟨p,q⟩)` | yes |
| `direction(p,q)` | imports/direction.glsl:1 | `(q + ⟨p,q⟩p)/√(⟨p,q⟩²−1)` (unit; singular at q=p) | yes |
| `orthoFrame(p)` | part2:35 | transport of origin frame along the geodesic from origin | yes, orthonormal [checked numerically] |
| `frame(p)` | part2:9 | (w,0,0,x)/… — unit but **not orthogonal** (off-diagonals up to ~0.8) [checked numerically] | — |
| `lightIntensity` | imports/lightIntensity.glsl:7 | **1/len²** (Euclidean law) | — |
| `trueLightIntensity` | imports/trueLightIntensity.glsl:7 | **1/sinh²(len)** — the physical H³ falloff | yes |
SDFs (all exact distance functions): ball `dist − r`; half-space `asinh(⟨p,n⟩)`
(hyp/shapes/halfSpace/shaders/struct.glsl:15–19); horoball `log(−⟨p,c⟩) + offset` with c light-like
(horoball struct.glsl:15–20); tube about a geodesic `acosh(√(⟨p,a⟩²−⟨p,u⟩²)) − r`
(cylinder struct.glsl:16–22); analytic gradients for all.
Sun light at an ideal point l (light-like): direction `⟨p,p⟩/⟨l,p⟩·l − p`, normalized
(hyp/lights/sunLight/shaders/struct.glsl).
Camera: `createVector(ORIGIN, dir)` then `applyPosition(camera.position, v)`; NativeCamera adds a
projective "eye" model (hyp/cameras/native/shaders/mapping.glsl).
Quotients: the ideal-cube group uses `QuadRingMatrix` (entries a + b√3 with integer a,b, rounded
after each multiply — utils/quadRing/shader/quadRing.glsl) so cell boosts never drift; exact
creep to a face: `t = atanh(−⟨p,n⟩/⟨d,n⟩)` with Euclidean ⟨,⟩ against a linear hyperplane
(hyp/groups/cube/set.js:27–33).

### S³ (sph) — unit sphere in R⁴, origin (0,0,0,1)
flow `cos t p + sin t d`, `−sin t p + cos t d` (sph part2:67); dist `abs(acos(⟨p,q⟩))` (no clamp →
NaN risk when |⟨p,q⟩| creeps above 1); direction `normalize(q − ⟨p,q⟩p)` (singular at q = ±p);
orthoFrame orthonormal [checked] but divides by `1 + w` — **singular at the antipode of the
origin** (sph part2:32); reduceError(Vector) does not re-project the direction (sph part1:131).
SDFs: ball; half-space `asin(⟨p,n⟩)`; tube about a great circle `acos(√(⟨p,a⟩²+⟨p,u⟩²)) − r`;
Clifford torus `±acos((|p.xy|+|p.zw|)/√2)` (sph/shapes/cliffordTorus).
Point light: **2 directions** — the short arc and the long arc (sph/lights/pointLight/shaders/
struct.glsl:28–45), long-arc intensity `lightIntensity(2π − d)` with lightIntensity = 1/len
(artistic; physical is 1/sin²d on both arcs [math]). Uses a global variable
`pointLightComputations` to pass state from i = 0 to i = 1.
Quotients: quaternion groups (lens/prism), Poincaré dodecahedral space.

### H²×R (h2e) — Point = (x,y,z ∈ hyperboloid in R^{2,1}, w = height); origin (0,0,1,0)
- Metric `diag(1,1,−1,1)` (h2e part1:243–252). `hypDot(vec4)` deliberately ignores w (part1:29).
- Isometry = `mat4` (acting on xyz; `matrix[3][3] = ±1` encodes flipping R) + `float shift`
  (part1:52–110). multiply: `shift = s1 + m1[3][3]·s2`.
- flow (part2:64–76): split d into H² part u (length λ) and vertical part; H² part flows with
  cosh/sinh(λt), height moves `w + t·d.w`. **Divides by λ — NaN for exactly vertical rays**
  (`hypNormalize(u)` with λ = 0, part2:66–67).
- dist (imports/distance.glsl): `√(acosh(−⟨p,q⟩_{H²})² + (Δw)²)` — exact product distance.
- direction (imports/direction.glsl): H² log map scaled by H² length, plus Δw, normalized —
  exact, unique geodesic.
- Tangent coordinates at the origin: camera e₁,e₂ = H² directions, **e₃ = vertical**, stored in
  `.w` (applyFacing remaps `(dir.xy, dir.w)` ↔ facing's xyz, part1:272–277).
- SDFs: ball (product distance), vertical cylinder `acosh(−⟨p,c⟩) − r`, horizontal cylinder,
  w-half-space (height), vertical half-space, horoball with an elevation tilt
  (`cE·log(−⟨p,c⟩) − sE·w·c.w + offset`, h2e/shapes/horoball), capped cylinders, slabs.
- Lights: point (1 direction), esun (vertical direction light).
- lightIntensity = 1/len (artistic).

### S²×R (s2e) — Point = (x,y,z ∈ S² ⊂ R³, w = height); origin (0,0,1,0)
Mirror of h2e with sin/cos. flow divides by `length(u)` — **NaN for vertical rays**
(s2e part2:59–62). dist `√(acos(⟨p,q⟩_{R³})² + Δw²)`, direction analogous, **only the shortest
geodesic** — the point light uses 1 direction (s2e/lights/pointLight) although light reaches a
point along infinitely many geodesics winding around the S² factor. `wCylinder` comment admits a
NaN-like failure "for some strange reason" without `abs` (s2e/shapes/wCylinder) — almost certainly
`acos` of a dot product slightly > 1 [inferred].

---------------------------------------------------------------------------------------------

## 4. Data flow of a frame (path-tracer renderer)

1. JS: `Thurston` (thurston/thurston/Thurston.js 262) builds a `Scene`, a `PathTracerCamera`,
   a `PathTracerRenderer`, and a `TeleportationSet` (`set`).
2. `PathTracerRenderer.buildFragmentShader` concatenates, in order: constants, uniforms, the
   geometry's part1 + commons1 + part2 + commons2, random1, VectorData struct, the group +
   relative.glsl + teleport tests, random2, camera, every Generic's struct/instance (Mustache
   templated per instance with uuid names), scenes.glsl (local/global SDF dispatch), nextObject,
   updateVectorData, raymarch, main.
3. GLSL `main`: seed (Wang hash of pixel + frameSeed), `mappingFromFlatScreen` → RelVector at the
   camera, `getColor`: up to `maxBounces` of `scatterRaymarch` + `updateVectorData`.
4. `scatterRaymarch` (pathTracer/raymarch.glsl:145–255): **local loop** (teleport if outside the
   fundamental domain; else SDF of local solids incl. neighbour cells; step = creepingDist so it
   never jumps past a domain wall; `localV = flow(localV0, marchingStep)` — always re-flowed from
   the seed, never incrementally), then a **global loop** in the universal cover up to the local
   hit distance. Hit = the first solid (declaration order) with `|sdf| < threshold`.
5. `updateVectorDataFromSolid`: Beer–Lambert absorption over `lastBounceDist`, linear volume
   emission, analytic normal via `{{shape}}_gradient`, inside/outside via `isInside` and a
   probe (`nextObjectProperties`), choose diffuse/reflect/refract by chance, cosine sampling as
   `normalize(n + uniform sphere)` in the orthonormal frame, offset `20·threshold/|⟨v,n⟩|`.
6. Russian roulette on max(throughput); accumulation `acc·i/(i+1) + new/(i+1)` in HalfFloat RTs.

---------------------------------------------------------------------------------------------

## 5. How it maps to PathTracerGLSL's ambient seam

PathTracerGLSL seam (src/components/ambient/euclidean/euclidean.glsl, 33 lines):
`ambient_geodesic(o,d,t) → Point`, `ambient_frame(p,n) → Frame`, `ambient_dot(a,b,p)`,
`ambient_parallel_transport(v,from,to)`, `ambient_direction_to(from,to)`.
`Point`/`Direction` are `#define vec3` (src/glsl/core/structs.glsl:4–5).

| PathTracerGLSL | thurston-rebuild | gap |
|---|---|---|
| `ambient_geodesic(o,d,t) → Point` | `flow(Vector,t) → Vector` (point **+ transported velocity**) | the seam returns no arrival direction; pt.ts:420 uses `wo = -s.ray.direction` (the *origin* direction). Already declared open in docs/fable-reference-implementations.md §10 ("Open (§5.3): the ray's direction at a far hit"). Thurston's answer: flow the unit tangent vector. |
| `ambient_dot(a,b,p)` | `geomDot(Vector,Vector)` (vector carries its point) | same idea |
| `ambient_direction_to(from,to)` | `direction(p,q)` | Thurston also needs `dist(p,q)`; PathTracerGLSL has no `ambient_distance` (the Sep-28 review proposed adding it: docs/claude-design-review-2026-09-28.md §4.7). Multi-geodesic spaces need *several* directions (Light.maxDirs). |
| `ambient_frame(p,n)` | `orthoFrame(p)` (canonical orthonormal section) then orthonormalize vs n | Euclidean version uses `cross` (no 4-D analogue in a tangent space without care). |
| `ambient_parallel_transport` | none (flow transports the velocity; orthoFrame = transport from origin) | closed forms exist in constant curvature [math]; not in thurston. |
| — | `Isometry`, `makeTranslation(p)`, `Position{boost,facing}` | PathTracerGLSL placements are Euclidean similarities (src/glsl/core/placement.glsl: quaternion + translation + uniform scale). Scale is not an isometry in H³/S³; placement.glsl already moves scale into primitive parameters, which ports. |
| `MAX_DIST 1000` (math.glsl:11), environment "found there" | camera.maxDist default 50; hyp march restarts from seed | cosh(t) overflows float32 above t ≈ 89; precision of the hyperboloid model is poor far before that. |
| — | `reduceError` | needed after every isometry/flow in curved models. |
| — | RelVector / teleportation / GroupElement | no quotient concept in PathTracerGLSL (decisions.md item 5: wanted eventually). |

Light falloff for point-light NEE (delta lights "fold 1/d² in", structs.glsl LightSample) becomes
1/A(d,v) where A is the area density of the exponential map: d² (E³), sinh²d (H³), sin²d (S³)
[math]; in product spaces A = d²·sinh(a)/a (H²×R) or d²·sin(a)/a (S²×R) with a the length of the
H²/S² component [math, thought-through-not-checked]. thurston has only the H³ one right
(`trueLightIntensity`).

---------------------------------------------------------------------------------------------

## 6. What is worth porting (the good ideas)

1. **The geometry contract** (model1/model2 template): Point, Vector-with-base-point, Isometry,
   flow-returns-a-vector, dist, direction, orthoFrame, makeTranslation, reduceError. ~250 lines
   of GLSL per space, all closed form for E³/H³/S³/H²×R/S²×R. [checked]
2. **Re-flow from the seed** each march step (`flow(localV0, marchingStep)`) — accumulation-free;
   matches PathTracerGLSL's "Ray = pure geodesic seed" (trace-loop-contract). [checked]
3. **Position = isometry ∘ orthonormal frame at the origin** — works even where the isotropy
   group is smaller than O(3) (product geometries: facing is an O(3) frame of T_o, not an
   isometry). Cameras = `applyPosition(camera.position, createVector(ORIGIN, pixelDir))`.
   [checked]
4. **Exact SDF primitives** per space (balls, half-spaces, horoballs, tubes about geodesics,
   Clifford torus, product-space cylinders/slabs) with analytic gradients. [checked]
5. **Lights with several geodesic directions** (`maxDirs`, `_directions(v, i, …)`) — the right
   shape for S³ and S²×R NEE and for quotient manifolds (light images). [checked]
6. **Projective linearity**: hyperbolic/spherical totally-geodesic planes are linear
   hyperplanes in R⁴, so "which side" tests are one dot product and the ray–plane hit is
   `tanh t = −⟨p,n⟩/⟨d,n⟩` (H³) / `tan t = …` (S³) — used for the teleport walls
   (hyp/groups/cube/set.js:27–33). This is also the basis for **exact ray–triangle tests and a
   BVH in the Klein/gnomonic model** (geodesics are straight lines there) [math;
   design thought-through-not-checked].
7. **Exact integer arithmetic for group elements** (QuadRing) to keep cell boosts drift-free.
   [checked]

## 7. What NOT to copy

1. Prototype monkey-patching per geometry (`Isometry.prototype.build = …` in every
   geometries/*/geometry/*.js; `Vector4.prototype.hypDot` in hyp/geometry/Utils.js) — one
   geometry per bundle, global mutation, invisible API. [checked]
2. JS objects as struct uniforms by property-name coincidence (core/Generic.js `shader()` passes
   `this`). [checked]
3. Hand-written JS twins of every GLSL teleport test (hyp/groups/cube/set.js: `testXp` and
   `glslTestXp`). [checked]
4. The path tracer: hackCoeff (vectorDataUpdate.glsl.mustache:97–100), chance-based lobes,
   `geomMix` roughness, no NEE/MIS, scatter that is overwritten (below), HalfFloat accumulation,
   `Math.random()` seeds, first-hit-in-declaration-order instead of nearest. [checked]
5. Two material systems per solid (`material` for Phong, `ptMaterial` for PT; core/solids/Solid.js).
6. `frame()` (non-orthogonal) + `numericalGradient` (Σ ∂f(fᵢ)·fᵢ without the inverse metric).
   Harmless in these five spaces because every basic shape has an analytic gradient, but wrong
   in general. [checked numerically: off-diagonals 0.16–0.99]
7. Non-physical light falloffs (1/len) and commented-out alternatives.
8. Local/global duplicate shape classes (Ball vs LocalBall …) — 3 files each, per geometry.
9. Global mutable GLSL state (`pointLightComputations`, sph point light).
10. Unclamped `acos`, divisions by λ / (1+w) at measure-zero but reachable configurations.

## 8. Defects found (in thurston-rebuild; relevant as cautions, not to fix there)

- `scatterRaymarch` scattering has no lasting effect: after `scatterRay(localV)` the next
  iteration does `localV = flow(localV0, marchingStep)`, re-flowing the *unscattered* seed
  (pathTracer/raymarch.glsl:197–207 and 242–248). [checked by reading]
- `Teleportation.shader` declares the inverse's uniform under the element's name:
  `shaderBuilder.addUniform(this.elt.name, 'GroupElement', this.inv)` (Teleportation.js:162);
  the dedupe drops it; it only works because every set passes `inv` = another teleportation's
  `elt` or a `neighbors` entry. [checked]
- Vertical rays in H²×R / S²×R divide by zero in `flow` (h2e part2:65–67, s2e part2:60–62);
  a mirror reflection of a vertical ray off a w-half-space stays vertical. [checked reading;
  GPU NaN behavior inferred]
- S³ / S²×R `orthoFrame` singular at w = −1 / z = −1 (1/(1+w)). [checked]
- hyp `reduceError(Isometry)` is a no-op in GLSL but Gram–Schmidt in JS. [checked]

## 9. Research notes for the curved-space plan (all thought-through-not-checked unless marked)

- **Arrival direction**: the seam needs `flow(point, dir, t) → (point, dir)`; constant curvature
  gives it in closed form (H³: d' = sinh t p + cosh t d) [math].
- **Shading in T_o**: move the hit to the origin with `makeInvTranslation(p)` (or use
  orthoFrame(p)); BSDF code then sees vec3 frame coordinates and needs no curved-space edits.
  PathTracerGLSL's lambert already builds wi as a linear combination of frame vectors, which is
  frame-generic as long as Frame holds tangent vectors.
- **Far clip / environment**: H³ needs an environment at the ideal boundary (ray endpoint =
  light-like vector p + d [math]), not at a distance; S³ and S²×R are compact in the spherical
  factor — rays wrap; "environment at MAX_DIST" has no meaning in S³.
- **Precision**: float32 hyperboloid coordinates degrade as cosh(d); thurston keeps everything
  near the origin (teleports, re-flow). A port should keep scenes within a few units of the
  origin or re-center per bounce (move the whole path frame so the current point is the origin).
- **Multi-geodesic NEE** in S³/S²×R: each geodesic is a separate light image; MIS weights need
  per-image pdfs; and conjugate points (S³ antipode) make A(d) → 0 (focusing) — irradiance
  singular at the antipode of a point light.
- **Meshes**: H³ and S³ — geodesic triangles lie in linear hyperplanes through 0 in R⁴;
  intersection is one dot-product ratio + three linear sign tests; BVH could live in the
  Klein/gnomonic chart. H²×R — geodesics are not straight in (Klein_xy, z), so general
  triangles need a root solve; vertical/horizontal facets are easy.
