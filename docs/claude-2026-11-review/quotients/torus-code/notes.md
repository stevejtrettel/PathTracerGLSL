# E³ 3-torus milestone, designed against this codebase (key: torus-code)

Read first: `docs/claude-2026-11-review/survey/quotients.md` and the skeptic's section
`quotient-light` in `survey/blackhole-quotient-challenges.md`. This note takes the skeptic's
corrections as given and designs the E³/Z³ step concretely against the code. Nothing in the
repo was edited.

Labels: **[checked-code file:line]** read in this repo; **[checked-num script]** measured by a
script in this folder; **[math]** a short argument given here (thought through, not checked by
anyone else); **[mem]** from memory.

Scripts in this folder:
- `partition_mis_twin.py` (float64, numpy): direct irradiance in a 3-torus with real
  occlusion by other images; pt vs partition-MIS NEE variants. Output: `partition_mis_twin.out`.
- `dda_bound_twin.py` (float32 vs float64): the proposed cell walk, its loop bound and its
  entry-point precision. Output: `dda_bound_twin.out`.

---

## 0. Answers in brief

1. **The teleport loop lives inside the generated `scene_intersect` and `scene_intersect_any`**
   as a 3D cell walk (a DDA over the cells D + L∘k). The walk, the techniques and the shadow
   files do not change. `Hit` gains one field, `ivec3 cell`, with the contract
   "hit.p + L∘hit.cell is the hit point in the chart of the ray's origin". `hit.p` is in the
   chart of the cell where the hit was found; `hit.t` is the total length from the ray origin.
2. **Objects do not cross faces in milestone 1**, with one exception that costs nothing: an
   unrotated box that spans the whole period along an axis (a wall or a beam). Ghost copies are
   step 2, because they need light-image identity per ghost (the skeptic's point) and region
   identity shared between copies.
3. **NEE picks one image uniformly from the 27 cells around x** (S = {−1,0,1}³, probability
   1/27, independent of x), by shifting the light query point by −L∘c and calling the existing
   light sampler unchanged. `lighting_pdf` at a BSDF hit does the same shift with `hit.cell`,
   and returns 0 when `hit.cell` is outside S. In pt-mis the power heuristic then gives the
   BSDF sample weight 1 with no other change; in pt-nee one generated line in the combiner
   makes the weight 1 outside S. Checked in a float64 twin (§3.5).
4. **Far clip:** one declared measurement field `farClip` (default: today's `MAX_DIST` = 1000,
   so E³ programs are unchanged), validated in a quotient to be ≥ 2·diam(D) so that every NEE
   image is within reach of a BSDF ray. The walk's loop bound is then a proven number, not a
   safety cap. **Environment: none**; any other environment is a compile error.
5. **Authoring:** `ambientSpace: { type: 'euclidean', quotient: { kind: 'torus', size: [Lx, Ly, Lz] } }`,
   D = [−L/2, L/2]³ centred at the origin. A quotient is a property of the space, so it goes
   on `ambientSpace`, not as a new top-level scene field. General lattices are a later
   occupant of the same family.
6. **Compile errors at first:** delta lights (by the descriptor fact `delta: true`), any
   environment, every kind of medium including null interfaces and GRIN, unbounded
   primitives (plane), objects that violate the inside-or-spanning rule, driven placements,
   curved ambient spaces with a quotient. **Allowed:** all non-delta lights including
   emissive objects, meshes, instancing, table dispatch, the light tree, all cameras, every
   surface material, RR, spectral, AOVs.
7. **Size:** about 450–600 lines of source in ~12 files plus ~600 lines of tests and fixtures
   (§8).

---

## 1. Where the teleport loop lives, and what Hit carries

### 1.1 What the code does today

- The walk calls `scene_intersect(s.ray, hit)` once per segment
  [checked-code src/components/transport/integrators/pt/pt.ts:315, 400].
- The dispatcher seeds `hit.t = MAX_DIST` and every backend arm is bounded by the running
  `hit.t` ("updates hit only if it finds something closer")
  [checked-code src/compiler/generate/features/intersection.ts:1680-1688, 1654-1658].
  So a per-cell query is exactly "seed hit.t with the cell's far limit, run the same arms".
- After the nearest hit, the dispatcher classifies once with `scene_region_at` probes at
  `hit.p ± EPS_INTERFACE·ng` [checked-code intersection.ts:1689-1710].
- Opaque shadow rays call `scene_intersect_any(ray, maxDist)` with
  `maxDist = length(light_p − origin) − SHADOW_BACKOFF`
  [checked-code src/components/transport/shadow/opaque/opaque.glsl:16-19].
- NEE builds `light_p = ambient_geodesic(hit.p, ls.wi, ls.distance)`, spawns, re-aims and
  calls `shadow_transmittance` [checked-code src/components/transport/techniques/light/light.glsl:20-23].
- After a hit, the walk reads the arrival direction from `s.ray.direction` (`wo`,
  `kernel_score_miss`, `combiner_w_emitter`'s `lighting_pdf(s.prev_query, s.ray.direction, …)`,
  and the dispatcher's side test) [checked-code pt.ts:420; kernel/kernel.glsl:13;
  combiner.ts:39; intersection.ts:1694]. Torus pairings are translations, so the direction
  is the same in every chart [math]. This is why the walk survives unchanged in E³/Z³ and
  will not in H³ (there the arrival direction must come from the Hit; the curved design's
  `ambient_flow` is that seam).

### 1.2 The proposal: a cell walk inside the dispatcher

The generator splits today's dispatcher into `scene_intersect_cell(Ray r, float t_far, out Hit hit)`
(today's body with `hit.t = t_far` instead of `MAX_DIST`, classification included) and emits,
only in quotient programs, the walk around it:

```glsl
// D = [-L/2, L/2]^3; cell k is D + L*k. The ray's chart is the chart of its origin.
bool scene_intersect(Ray ray, out Hit hit) {
    vec3 L = TORUS_PERIOD;
    vec3 k = floor(ray.origin / L + 0.5);                 // cell of the origin (any origin)
    vec3 s = sign-with-0-as-+1(ray.direction);
    float t_enter = 0.0;
    for (int n = 0; n < TORUS_MAX_CELLS; n++) {
        vec3 t_next = (direction != 0) ? ((k + 0.5*s) * L - ray.origin) / ray.direction : BIG;
        float t_exit = min3(t_next);
        // Local ray starts at the cell entry point: hit.p is then accurate to ~|L|·eps,
        // not ~t·eps, so ray_spawn's hit.eps stays honest after long segments.
        Ray local = make_ray(ray.origin + ray.direction * t_enter - L * k, ray.direction, ray.wl);
        if (scene_intersect_cell(local, min(t_exit, MAX_DIST) - t_enter, hit)) {
            hit.t += t_enter;
            hit.cell = ivec3(k);
            return true;
        }
        if (t_exit >= MAX_DIST) return false;            // the declared far clip
        k[argmin(t_next)] += s[argmin(t_next)];           // cross one face
        t_enter = t_exit;
    }
    return false;   // unreachable: TORUS_MAX_CELLS is a proven bound (below)
}
```

`scene_intersect_any(ray, maxDist)` is the same walk with the any-hit arms and `maxDist` in
place of `MAX_DIST`. The cell index is recomputed from the original origin each step, so
nothing accumulates. (Today's `MAX_DIST` define becomes the emitted `farClip`; §4.)

**Why a per-cell query with only a far limit finds the true nearest hit [math].** Call an
object set "complete for D" if (i) every point of every object in the local scene is a point of
the lifted scene π⁻¹(M-scene), and (ii) every point of π⁻¹(M-scene) in D belongs to some local
object. Under (i) any hit found in chart k is real; under (ii) every real surface point in cell k
is found in chart k. Cells are visited in order of t, so the first cell that reports a hit
holds the nearest one, provided rounding cannot move a hit across a face (that is what the
margin in §2 is for). Both objects strictly inside D and the spanning boxes of §2 satisfy (i)
and (ii); ghost copies (step 2) are how general objects will satisfy them, with the same walk.

**The loop bound is a theorem, not a cap [math, checked-num dda_bound_twin.py].** A straight
segment of length R crosses at most ⌊R|d_i|/L_i⌋ + 1 planes of axis i, so it visits at most
4 + R·Σ|d_i|/L_i ≤ 4 + R·√(Σ 1/L_i²) cells (Cauchy–Schwarz). The emitted bound is
`TORUS_MAX_CELLS = 5 + ceil(farClip · sqrt(Σ 1/L_i²))` (one cell of margin for rounding).
Float32 walk over 4000 random rays (periods 0.3–3, far clips 1–200, origins up to 1000 cells
away, origins exactly on faces, near-axis directions): the largest cells/bound ratio was 0.992,
never above 1 [checked-num dda_bound_twin.out]. 7 of 4000 float32 walks visited a different
cell sequence than float64 — edge or vertex passages where two exits tie and the zero-length
cell in between differs [checked-num]. That is harmless when objects keep the margin of §2
(no object lies in a zero-length piece of a cell) [math]. The largest distance of a local entry
point outside D was 2.4e-4, and it came from origins ~1000 cells from D (|o|·ε) [checked-num];
for rays spawned inside D it is ~farClip·ε.

### 1.3 What Hit carries

Add `ivec3 cell;` to `Hit` in `src/glsl/core/structs.glsl`, with the comment-contract:
"lattice cell of the hit in the chart of the ray's origin: hit.p + PERIOD∘cell is the hit point
in that chart; ivec3(0) in non-quotient programs". Non-quotient dispatchers fill it with
`ivec3(0)` (the fill-the-whole-Hit protocol, [checked-code structs.glsl:44-50]). This changes
every program's text but no picture; the verification is the digest diff (two kinds of line)
plus `npm run frames -- compare` bit-exact.

Why the cell is enough to identify the light image, in milestone 1 [math]: there are no ghost
copies, so the image of a light hit in cell k is the light translated by L∘k relative to the
ray's chart. Every BSDF ray starts at `ray_spawn(hit, wi)` from the previous vertex's local
`hit.p`, so "the ray's chart" is the chart in which the previous vertex x = `prev_query.p` is
expressed. Hence the image of the light relative to x is exactly `hit.cell`. The camera ray's
chart may be far from D (cell k₀ ≠ 0), but nothing reads `hit.cell` after a camera ray
(`prev_was_delta` is true there [checked-code combiner.ts:34]).

What breaks this, and why media are deferred (the skeptic's point 3, made concrete): a null
crossing re-spawns from the local `hit.p` without a new vertex [checked-code pt.ts:408-415], and
so does a GRIN hand-off [checked-code pt.ts:364]. The next hit's `cell` is then relative to the
crossing's chart, not to x. Supporting these needs a PathState field accumulating cells since
the last vertex, and the media shadow walker must shift its fixed `light_p` by −L∘h.cell on each
re-spawn [checked-code shadow/media/media.glsl:45, 58-59]. Medium events produce
`p_evt = ms.exit_p` in the segment's chart, which can be many cells away and must be reduced
before NEE and `scene_region_at`. All doable in E³ (reduction by floor), none needed for
milestone 1.

### 1.4 Alternatives considered

- **The walk advances cell by cell** (a "face crossing" event in pt.ts): touches the generated
  walk, every technique that ends a segment, the null budget and the media walker. More parts,
  no gain in E³. Rejected for milestone 1 [thought through, not checked].
- **No near clip, origin kept at the ray origin in every chart**: correct by the lemma, but the
  hit point then has error ~t·ε, while `hit.eps` from `spawn_eps_fp(p)` scales with |hit.p| ≤ |L|
  [checked-code structs.glsl:51-55]. Starting each cell at its entry point fixes this for free.

---

## 2. Objects that cross fundamental-domain faces

**Milestone 1 rule (one Validator check on world AABBs).** For each object, on each axis i, its
world AABB must either
- (a) lie inside [−L_i/2 + m, L_i/2 − m], or
- (b) contain [−L_i/2 − m, L_i/2 + m], which is allowed only for an unrotated `box`;

with m = `EPS_INTERFACE` (0.001, [checked-code src/glsl/core/math.glsl:12]). An object of type
(a) on all axes is "strictly inside D". A box with (b) on one or two axes is a beam or a wall: it
is invariant under the lattice translations along the axes it spans, so it satisfies (i) and
(ii) of §1.2 [math]. A box with (b) on all three axes fills space; it is legal and useless.

Why m = EPS_INTERFACE [math]: the classification probe goes EPS_INTERFACE along the normal from
any hit (intersection.ts:1693); with the margin it lands in the same chart and can only be
inside objects of that chart, so `scene_region_at` needs no reduction. The same margin dwarfs the
rounding of t_exit (farClip·ε ≈ 6e-6 at farClip 100; entry points at most 2.4e-4 outside D even
for origins 1000 cells away [checked-num dda_bound_twin.out]), so no hit is moved across a face.
For a spanning box the overhang ≥ m is what keeps the probe inside the box's continuation.

What this allows: furniture inside D, walls (finite-horizon scenes), and the "jungle gym" — three
beams through the centre of D along x, y and z, which is the classic 3-torus picture with the
lattice nodes at cell centres. What it does not allow: objects straddling a face (e.g. beams on
the cube's edges — shift D so they sit on the centre lines instead).

The bounds already exist: `primitiveBounds` + `transformAABB` [checked-code
src/compiler/sceneData.ts:145; src/compiler/analyze/Validator.ts:1545]; mesh and instance-batch
bounds come from their BVH/TLAS roots. Driven (`{param}`) placements have no compile-time bound:
compile error in milestone 1. Planes are unbounded (plane.ts:30) and are half-spaces, which are
not lattice-invariant (the region "x < c" in D does not continue across the x-faces): compile error.

**Step 2, ghost copies** (not in milestone 1): the compiler emits, for every object whose AABB
straddles a face, the translates γO (γ ∈ {−1,0,1}³ ∖ 0) that meet D, as additional local objects
with the same region id. The cell walk is unchanged. What it needs: (1) region identity shared
by several emitted objects (material_of, light_of, symbol names `sdf_<name>` all key on one
object today); (2) per-light-image identity: a hit on ghost g of a light inside cell k is image
k + g (the skeptic's point), so the Hit needs the ghost offset too, e.g. `hit.cell = k + g`
filled by the ghost's arm; (3) `scene_region_at` must test the ghosts.

---

## 3. NEE image choice and MIS

### 3.1 The rule (partition MIS)

- S = {−1,0,1}³ (27 images), p_sel(c | x) = 1/27, independent of x.
- NEE: pick c ∈ S with one extra random number, run the existing `lighting_sample` at the
  shifted query q' = (x − L∘c, n, two_sided), multiply `ls.pdf` by 1/27. `ls.wi` and
  `ls.distance` are translation-invariant, so `light_p = hit.p + wi·distance` computed by
  light.glsl is the image point in x's chart, and the opaque shadow test is unchanged.
- BSDF side: at an emitter hit, NEE's density for that sample is
  `cell ∈ S ? lighting_pdf(shift(prev_query, hit.cell), dir, lid, hit) / 27 : 0`.

Both are generated wrappers (in quotient programs only) around today's `lighting_sample` and
`lighting_pdf`, which are renamed `…_cover` there. The static technique files and the combiner's
pt-mis body do not change: `power_heuristic(a, 0) = 1`
[checked-code src/components/transport/math_mis.glsl]. pt-nee needs one generated line, because
its emitter weight is a flat 0 for samplable lights [checked-code combiner.ts:33-41]:
`if (lid < 0 || s.prev_was_delta || !torus_image_in_nee_set(hit.cell)) return 1.0;`.

### 3.2 Why a query shift is exact for every light in this repo [checked-code]

Every light pdf reads the light point and the query point only through their difference
(or the query point against the light's centre): quad `d = light_p − p`
(src/components/lights/quad/quad.glsl:36-40), sphere `to_c = l.center − p` (sphere.glsl:66-70),
mesh lights `mesh_light_pdf(…, q.p, light_hit.p, light_hit.ng, wi)`
(src/compiler/generate/features/lighting.ts:665), and the generic arm
`<kind>_light_pdf(…, q.p, light_hit.p, wi)` (lighting.ts:668). Translating q.p by −L∘c is
therefore the same as translating the light by +L∘c [math]. The light tree takes the same
`LightQuery` (`light_tree_pick(LightQuery q, …)`, `light_tree_pmf(LightQuery q, …)`, lighting.ts:786,
804), so with the shifted query it importance-samples lights as seen from x for that image; the
normal is unchanged under translation, so its below-horizon cull stays licensed. The light tree
needs no change and is allowed.

### 3.3 Conditions that make it unbiased [math]

1. NEE and BSDF use the same S and the same pdf, keyed on the same group element (here a lattice
   vector compared exactly). The BSDF ray's `hit.cell` is the light image relative to x (§1.3).
2. Every image in S is reachable by a BSDF ray: max over x, y ∈ D, c ∈ S of |y + L∘c − x| is
   2·|L| = 2·diam(D) (per axis the difference is at most 2L_i). So the Validator requires
   farClip ≥ 2·diam(D). Otherwise NEE would count light that the BSDF technique (and pt) cannot
   see, and pt ≠ pt-nee (survey §2.4, CLAUDE.md invariant).
3. Lights are non-delta. Delta lights have no BSDF technique, so the images outside S would be
   lost: compile error.
4. Occlusion by other images is ordinary occlusion: a shadow ray to image c that meets image c'
   first is blocked, and a BSDF ray along that direction is identified as c'. Same answer on
   both sides.

S contains the nearest image of every light point: for x, y ∈ D the per-axis difference is
< L_i, so the nearest translate has |c_i| ≤ 1 [math]. The 7-cell set (self + face neighbours)
does not always contain it.

### 3.4 Variance of the image choice

Uniform 1/27 is the fewest moving parts and trivially identical on both sides. It spends most
NEE samples on far images. Two drop-in alternatives, both unbiased under the same partition
rule: S = {nearest image of the light centre} with p = 1 (cheapest, discontinuous in x but
unbiased), and p_sel ∝ 1/|centre + L∘c − x|² over the 27 (27 evaluations of arithmetic on both
sides). §3.5 measures all three. A light tree over light images (skeptic's suggestion) is the
x-adaptive version; it changes the tree builder and leaf encoding — step 2 at the earliest.

### 3.5 Float64 twin [checked-num partition_mis_twin.py]

Torus periods (1.0, 1.3, 0.8), farClip 4 (≥ 2·diam(D) = 3.65); an emitting sphere (r = 0.08,
Le = 1) and a black occluding sphere (r = 0.15) in D; every image within the far clip is
ray-cast exactly, so images occlude each other. Irradiance at three receiver points (one near a
corner of D). Estimators: pt (cosine only); uniform-27 with power-heuristic MIS; uniform-27 with
the pt-nee binary combiner; nearest-image MIS; 1/d²-weighted-27 MIS. Each uses 400 000 samples
per point.

| receiver | pt | uniform-27 MIS | uniform-27 pt-nee | nearest MIS | 1/d² MIS |
|---|---|---|---|---|---|
| x₁, n = +y | 0.22428 ± 0.00128 | 0.22484 ± 0.00094 | 0.22485 ± 0.00094 | 0.22426 ± 0.00123 | 0.22442 ± 0.00091 |
| x₂, oblique n | 0.22669 ± 0.00129 | 0.22720 ± 0.00097 | 0.22722 ± 0.00106 | 0.22715 ± 0.00104 | 0.22767 ± 0.00085 |
| x₃, near a corner | 0.17668 ± 0.00114 | 0.17705 ± 0.00085 | 0.17705 ± 0.00085 | 0.17668 ± 0.00114 | 0.17731 ± 0.00085 |

Variance per sample (pt / uniform-27 MIS / uniform-27 pt-nee / nearest / 1/d²):
x₁ 0.654 / 0.351 / 0.352 / 0.603 / 0.334; x₂ 0.661 / 0.372 / 0.446 / 0.432 / 0.290;
x₃ 0.524 / 0.289 / 0.290 / 0.524 / 0.286 [checked-num partition_mis_twin.out].

What this shows:
- **Unbiasedness:** every partition-rule estimator agrees with pt within 0.7 combined standard
  errors at all three points, in both the MIS and the pt-nee (binary) combiner. Caveat: the
  estimators share their BSDF directions with pt, so the z-scores are not independent tests;
  the TS port for vitest should use independent streams and more samples.
- **The irradiance comes from many images.** The light is small (r = 0.08) but the scene is open,
  so far images add up (≈ 0.22, while the nearest image alone subtends much less). That is why
  BSDF sampling keeps a large share and NEE over 27 images only halves the variance.
- **Uniform-27 is a sound default:** about half pt's variance at every point. 1/d² weighting is
  at most ~22% better (x₂) and about equal elsewhere. **Nearest-only is the worst choice**: at x₃
  the nearest image is below the horizon, NEE contributes nothing, and it equals pt exactly.
- Scope of the check: one bounce, a black occluder, a sphere light with cone sampling; it does
  not exercise the GPU code, the light tree or quad/mesh lights.

---

## 4. Far clip and environment

- Today: `#define MAX_DIST 1000.0` in `src/glsl/core/math.glsl:8-11`, read by the dispatcher
  seed, pinhole camera, env CDF sampler, directional light, the analytic medium arm and the walk
  (equiangular call) [checked-code grep]. The curved-space draft already moves it to the space
  occupant ("far clip per space").
- Proposal: a measurement field `farClip?: number` (a truncation; limit ∞), default = the
  space's constant (1000 in E³), emitted as `#define MAX_DIST <farClip>`. Absent, every E³
  program's text is unchanged. It is a measurement field because it changes what the image
  converges to; it has to be per scene in a quotient because its sensible value scales with L.
  One field, one emitter; no second constant.
- In a quotient it means: a segment that meets nothing within farClip ends with no radiance. In
  a finite-horizon scene (every straight line meets an object within some length H, e.g. three
  orthogonal spanning walls, H ≤ √3·max L) farClip ≥ H makes it exact; the Validator cannot
  check H in general, so it only enforces farClip ≥ 2·diam(D) (§3.3). In open-corridor scenes
  it is a real, declared truncation with polynomial tails (skeptic: P(τ > t) ~ 1/t for planar
  corridors [mem via the skeptic]).
- Cost: per segment ≤ `TORUS_MAX_CELLS` full scene queries. At farClip 1000 and L = 2 that is
  871 cells for the worst ray — too slow and a watchdog risk; quotient scenes should declare
  farClip of a few cells to a few tens of cells. NEE shadow rays cross at most ~2·diam(D).
- **Environment:** M is closed; a missed ray carries nothing. Any authored environment other
  than `none` is a compile error (the default is `none` → black,
  [checked-code src/compiler/types.ts:28-29; features/environment.ts:6]). `kernel_score_miss`
  then adds zero; nothing to change.
- **Closed scenes and maxBounces:** paths end only by absorption, RR or the budget, so the
  declared `maxBounces` truncation removes more than in open scenes (survey §3.2). No albedo
  rule: `maxBounces` is required, so the measurement is always finite (the skeptic's
  correction of the albedo < 1 rule).

---

## 5. Authoring

```ts
ambientSpace: { type: 'euclidean', quotient: { kind: 'torus', size: [4, 4, 3] } },
```

- D = [−L/2, L/2]³ around the world origin, so authored coordinates in D read as today.
- Camera: anywhere. The walk reduces any origin to its cell, so orbit and fly controls need no
  App change in milestone 1 (precision is fine within ~10³ cells, §1.2). (H³ will need the App
  to teleport the pose; the curved design lists the camera module separately.)
- Why `ambientSpace.quotient` and not `scene.quotient` [thought through]: the quotient is the
  space; `AmbientSpaceDescription` is where the space lives [checked-code types.ts:43-46], it
  keeps `SceneDescription` flat, and Seifert–Weber later reads
  `{ type: 'hyperbolic', quotient: { kind: 'seifert-weber' } }` with no new top-level field.
- `kind: 'torus'` (orthogonal periods) first. A general lattice (generators as columns of a
  matrix A) is the same walk in lattice coordinates u = A⁻¹x with D a parallelepiped; it is a
  second occupant, not a parameter of the first. The other five orientable flat manifolds have
  screw pairings (rotation + translation): the arrival direction changes chart, so they share
  the H³ machinery (Hit-borne direction, group-element identity) and come after it.
- Registry: a new family `src/components/quotient/` (README contract, `index.ts` registry, one
  folder `torus/` with `torus.ts` descriptor, `torus.glsl` helpers, `torus.md` math note).
  The descriptor declares facts: parameters (`size`), the face planes, the NEE image table S,
  the loop bound formula, and the reach 2·diam(D). The cell walk itself is generated by
  intersection.ts (program structure), calling the occupant's helpers.

---

## 6. Compile errors in quotients (milestone 1)

| Feature | Status | Reason |
|---|---|---|
| point, spot, directional, beam lights | error, by `delta: true` [checked-code lights/point/point.ts:11] | no BSDF technique for images outside S |
| environment ≠ none | error | closed manifold |
| ambient medium, object media, null interfaces ('none' material), GRIN, equiangular | error | §1.3: segments continue without a vertex; event points need reduction |
| plane, any unbounded primitive | error | half-spaces are not lattice-invariant (§2) |
| objects outside the inside-or-spanning rule | error | §2; ghosts are step 2 |
| driven `{param}` placements | error | no compile-time bound |
| farClip < 2·diam(D) | error | §3.3 |
| curved ambient + quotient | error | until H³ step 2 exists |
| meshes, closed meshes, instancing, table dispatch | allowed | bounded, inside D, arms are hit.t-bounded |
| light tree, power, uniform selection | allowed | query shift (§3.2) |
| all surface materials, dispersion, spectral, AOVs, RR, all cameras | allowed | translation-invariant |
| softbeam, quad, sphere, disk, mesh lights, emissive objects | allowed if inside D | non-delta |

---

## 7. Witnesses and tests (written before code)

Vitest (no GPU):
1. **Partition-MIS twin** (TS port of `partition_mis_twin.py`, smaller N): pt = uniform-27 MIS =
   pt-nee binary within a few σ. This is the gate the skeptic asked for.
2. **Cell-walk twin**: the bound and the float32 entry error (port of `dda_bound_twin.py`).
3. **Validator diagnostics**: each row of §6 produces its error; a jungle gym and a wall scene
   pass.
4. glslang compiles the torus scenes (automatic once they are in the registry).
5. Digest: every non-quotient suite scene differs only by the `Hit.cell` field and its fill line;
   `npm run frames -- compare` bit-exact on the fixed cases.

GPU witnesses (`tests/witnesses/scenes/torus*.ts`):
1. **Lattice visibility** (detects wrong pairings, exact): a non-cubic torus (1.0, 1.3, 0.8), one
   off-centre emitting sphere, nothing else, maxBounces 0, equirect camera inside D, farClip 4.
   The mean of the picture (with equirect solid-angle weights) is Le × the fraction of directions
   whose ray meets a light image within farClip — a scalar a float64 TS twin computes. A swapped
   axis, a sign error or a wrong period changes it.
2. **Estimator equality**: pt = pt-nee = pt-mis on a furnished open torus (sphere light,
   lambert and ggx objects, one jungle gym), maxBounces 4 — the image-pdf bookkeeping and the
   shared far clip. Also with the light tree.
3. **Crystal cross-check** (the skeptic's exact witness; needs `farClip` in non-quotient
   programs, which §4 gives): the same scene unrolled as a non-quotient E³ scene with instanced
   copies (emissive instanced sphere batches are light-sampled today
   [checked-code Validator.ts:1187; witnesses/scenes/instanceLightsWitness.ts]). With farClip R and
   maxBounces N, every path vertex stays within N·R of the camera, so a crystal of radius
   N·R + diam(D) gives the identical measurement. Keep R and N small (R = 2·diam(D), N = 2).
4. **Leak test**: a walled room (three orthogonal spanning walls) with a uniform emitter and
   albedo ρ, compared with the same room built as an ordinary closed box in E³. The room spans
   D's faces, so the pairing is exercised; the box room is the exact reference.

---

## 8. Files and size

| File | Change | Lines (est.) |
|---|---|---|
| src/compiler/types.ts | `AmbientSpaceDescription.quotient`, `MeasurementDescription.farClip` | +25 |
| src/glsl/core/structs.glsl | `Hit.cell` | +4 |
| src/glsl/core/math.glsl | `MAX_DIST` moves to an emitted define | −3 |
| src/compiler/plan/measurement.ts, Planner.ts, plan/types.ts | plan the quotient (period, farClip, cell bound) | +50 |
| src/compiler/generate/features/intersection.ts | split cell query, emit the walk, fill `hit.cell` | +80 |
| src/compiler/generate/features/lighting.ts | rename to `…_cover`, emit image wrappers | +40 |
| src/components/transport/combiner.ts | pt-nee out-of-set line | +4 |
| src/components/quotient/{README.md,index.ts,torus/torus.ts,torus/torus.glsl,torus/torus.md} | new family, one occupant | +200 |
| src/compiler/analyze/Validator.ts | §6 rules | +120 |
| demos/torusScene.ts, demos/index.ts | a composed torus scene | +80 |
| tests (twins, validator, witnesses, crystal generator) | §7 | +600 |
| CHANGELOG.md, docs/claude-quotient-torus-plan.md | plan and entry | — |

Source ≈ 500 lines; tests ≈ 600. Contract changes needing the owner's approval: `Hit.cell`
(locked trace-loop type), `farClip` (new measurement field; moves `MAX_DIST`), and
`ambientSpace.quotient`.

---

## 9. Open questions and risks

1. **Owner approval of the Hit change.** A per-space type is the honest long-term form (ivec3 in
   lattices, a group-element index or mat4 in H³). Milestone 1 can use ivec3 everywhere; the H³
   step decides whether `cell` becomes an index into a const table of group elements.
2. **farClip as a measurement field vs the curved draft's per-space constant.** The proposal
   makes the space's constant the default of the field, so both agree; the curved draft should be
   told.
3. **Uniform 1/27 vs a weighted image choice**: §3.5 measured at most ~22% variance gain for
   1/d² weighting in one open scene; the choice is estimator-only (no image change), so it can be
   revisited later without touching the measurement. Recommendation: uniform first.
4. **Cost on SwiftShader and real GPUs**: unmeasured. Each cell crossing re-runs the full scene
   query (TLAS/BVH root descent); open-corridor rays at large farClip dominate warps.
