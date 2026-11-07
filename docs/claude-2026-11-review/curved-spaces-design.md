# Curved spaces: design (H³ and S³ first)

Status: model-written design, revised 2026-11-07 after three independent reviews
([curved/design-review.md](curved/design-review.md)). The owner approved the direction
(decisions 9–11, 22 in [decisions.md](decisions.md)); choices the owner has not seen are
collected in §7 with why and how to undo them. Evidence: [curved/facts.md](curved/facts.md).
Every number below was measured by a script under `curved/` and re-run by an independent
checker, unless marked *reasoning*.

## Part 1 — the model

**The space.** A scene lives in one Riemannian 3-manifold X, fixed per program: E³, H³
(curvature −1) or S³ (curvature +1); H²×R later. Points are stored in the standard linear
model: R³; the hyperboloid ⟨p,p⟩ = −1, p₄ > 0 in Minkowski R^{3,1}; the unit sphere in R⁴. A
tangent vector at p is a 4-vector orthogonal to p under the model's form. Curvature is fixed
at ±1; sizes live in the shapes' parameters. `scene.ambientSpace` already names the space.

**Rays.** A ray is a point (p, v) of the unit tangent bundle; the geodesic flow moves it:

| | position γ(t) | velocity γ′(t) |
|---|---|---|
| E³ | p + t v | v |
| H³ | cosh t · p + sinh t · v | sinh t · p + cosh t · v |
| S³ | cos t · p + sin t · v | −sin t · p + cos t · v |

Radiance is constant along geodesics in vacuum, so the transport loop keeps its shape: first
hit along the ray, shade with the *arrival* velocity, spawn. Arc length t is the ray parameter
everywhere and isometries preserve it.

**Shading.** Materials and phase functions work in an orthonormal tangent frame. Their math is
unchanged; `normalize` and `dot` on world directions go through the space's metric, and phase
functions must be told the point where they scatter (they are not today).

**Light.** Next-event estimation converts area to solid angle with the area density of geodesic
spheres A(r) in place of r²: r² (E³), sinh² r (H³), sin² r (S³). The emitter cosine uses the
geodesic's arrival direction there. Point-light irradiance is I·cos/A(r). A geodesic disk of
radius ρ has area 2π(cosh ρ − 1) (H³) or 2π(1 − cos ρ) (S³), and uniform area samples have
radius acosh(1 + u(cosh ρ − 1)) resp. acos(1 − u(1 − cos ρ)) — not the Euclidean
concentric-disk map. A geodesic ball of radius R at distance d subtends a cone with
sin α = S(R)/S(d) (S = sinh or sin; in S³ only for R < d < π − R). These were verified by Monte
Carlo twins in which cosine sampling, area sampling, MIS and cone sampling agree with each
other and with closed forms.

**Several geodesics (S³).** Two geodesics join any two points of S³, of lengths d and 2π − d;
they leave in opposite directions, arrive in opposite directions, and have the same density
sin² d. Both carry light. A light sample picks the arc inside the light's sample body, before
the emitter's back-face test:
- a one-sided surface receiver (`!q.two_sided && q.n ≠ 0`) takes the arc that leaves into its
  upper hemisphere, with probability 1 — per sample this equals summing both arcs;
- a two-sided receiver or a medium event takes each arc with probability ½.
The MIS pdf needs no arc information: the selection factor is the same for both arcs, A is the
same, and cos_y comes from the arrival velocity at the emitter hit. (Measured in
`curved/review-mc/arc_rule.ts`: every surface case |z| ≤ 1.55 against cosine sampling; the medium case
loses half the light if the one-sided rule is applied without `n ≠ 0`.)

**Shadow rays** are defined by a destination *and the arc they are on*: one seam returns the
direction at the current origin and the remaining length along that arc. E³: normalize and
length. S³: the short-arc direction if it agrees with the ray's direction, else its negation
with length 2π − d. This keeps occluders on the far part of a long arc in the test.

**Far boundary and sky.**
- E³: unchanged.
- H³: the sky is a picture on the sphere at infinity, looked up at the ray's ideal endpoint
  normalize((p+v).xyz), exact for any t. Far clip: a declared arc length T = 10 (cosh overflows
  float32 near 89). With the scene inside the working radius, T cuts only the grazing band of
  each plane near its ideal circle (≈ 2 sinh h · e^{−2T} rad). First version: every sky is
  lookup-only from BSDF rays (`sampleAsLight: true` is an error in H³); an image sky must say
  `sampleAsLight: false` — no silent default change. An H³ scene lit only by a sky therefore
  runs `pt` only.
- S³: no sky (an authored environment is an error). Every geodesic closes after 2π, so the
  search interval (0, 2π) is exact in vacuum; a ray that meets nothing carries zero radiance; a
  ray leaving an open disk returns to its back face at ≈ 2π, which is correct physics.

**Objects.** Each object is placed by an isometry g (no scale); each shape is canonical at the
origin of its own frame with its sizes as parameters. An authored point v ∈ R³ (camera
position, placement position, light position) means exp_o(v), the point at distance |v| from
the origin in direction v̂ — in E³ that is v itself. A `direction` row (a disk's normal) is a
tangent vector at the canonical origin, applied before the placement. A light backed by a
primitive region reads the same placement as its region, produced by one CPU function.

First shapes (exact distance, closed-form intersection checked against brute force):
geodesic ball (sphere), totally geodesic plane (plane), geodesic disk (disk). The first subset
has **no marched shape**: the march, its epsilon and curved finite-difference normals arrive
with the torus. Next tier, also verified: box (three slabs), cylinder (capped tube about a
geodesic), torus (tube about a circle; marched; bounding ball R + r). Recorded for later, not
built: a Euclidean SDF evaluated in an object's Klein chart is a safe sphere-tracing step in H³
(the chart never stretches distances, measured), which would let every Euclidean fractal and
`defineSDF` field render in H³ as its Klein image; S³ needs the stereographic chart for the same
trick.

**Precision.** Float32 hyperboloid coordinates lose accuracy like e^{2D} at distance D from the
world origin (camera-ray direction error 5e-4 rad at D = 4; a pixel is ~1e-3). Working radius:
the camera and the scene stay within about 3 of the world origin. Documented, not checked (§7).
Spawn offsets use fp_uncertainty = REL·p₄ (all four coordinates), and points are renormalized
by recomputing p₄ from p.xyz (radial renormalization is measured to be worse). S³ coordinates
are bounded by 1 and have no such limit.

**Who implements what.** Each space-dependent component family keys its GLSL by space; a
component supports a space exactly when it has a body for it (no wildcard). Features that
have no descriptor (meshes, instancing, table dispatch including the Planner's size-based
default, tracking and GRIN media, ambient media, equiangular NEE, sky sampling, emissive-object
sampling, scale ≠ 1) are rejected by one named function in the style of `spectralLimitations`,
checking resolved values (after defaults). A snapshot test prints both as one support table.
Shared files without a descriptor (ray.glsl, the shadow walkers, microfacet.glsl) are not in
the table: witnesses establish them.

## Part 2 — how it is wired

### 2.1 The ambient occupant supplies

| | E³ body (today's arithmetic) | why |
|---|---|---|
| `types.glsl`: `Point`, `Direction` | `#define Point vec3`, `#define Direction vec3` (moved from structs.glsl; emitted right after the color model's types, the same convention) | H³/S³ use vec4 |
| `Ray ambient_flow(Ray r, float t)` | `Ray(r.origin + r.direction * t, r.direction, r.wl)` | arrival direction |
| `Point ambient_geodesic(Point o, Direction d, float t)` | `o + d * t`; curved occupants define it through the same formula as ambient_flow | |
| `float ambient_dot(a, b, p)` | `dot(a, b)` | metric |
| `Direction ambient_normalize(Direction v, Point p)` | `normalize(v)` | |
| `Frame ambient_frame(Point p, Direction n)` | unchanged | |
| `Direction ambient_aim(Point from, Direction along, Point to, out float remaining)` | `remaining = length(to - from); return normalize(to - from);` | shadow rays (arc-aware in S³) |
| `Direction ambient_direction_to(Point a, Point b)` | unchanged (callers move to ambient_aim) | |
| `vec3 ambient_sky_key(Point p, Direction v)` | `v` | sky lookup |
| `MAX_DIST` | `1000.0` | far clip |
| `fp_uncertainty(Point p)` | today's body (constants stay in math.glsl) | spawn offsets |

`ambient_parallel_transport` carries a spawned ray's direction to its moved origin (`ray_spawn`; the identity in E³). Without it a specular chain in a curved space accumulates a non-tangent error of about eps·cos per bounce, and after two internal reflections in a glass ball the next spawn lands on the wrong side ([curved/next-materials-plan.md](curved/next-materials-plan.md) §6).

### 2.2 Step 1 — Euclidean respelling, bit-identical, no new mechanism

1. **Coverage first.** Add frame cases to `tools/witness.mjs` so every respelled file is
   rendered: shadow-aim-fog (media walker through null interfaces), one driven/placed-analytic
   scene, one rayleigh scene, one image-sky scene. Record the baseline (`npm run frames --
   record`) on the unmodified tree, and a digest.
2. **Respell** (each E³ body is the same IEEE arithmetic):
   - arrival direction: `wo = -s.ray.direction` and the null re-spawn in pt.ts, the side test in
     the dispatcher (intersection.ts), `exit_dir` in the analytic medium arm, the null re-spawn
     in shadow/media → `ambient_flow(ray, t).direction`;
   - shadow aim and length in shadow/opaque, shadow/media, techniques/light → `ambient_aim`;
   - `normalize` on world directions in lambert, checker, mirror, dielectric,
     core/microfacet.glsl, pinhole, fisheye → `ambient_normalize`;
   - sky lookup → `ambient_sky_key`;
   - `MAX_DIST`, `fp_uncertainty` → the occupant; `Point`/`Direction` → the occupant's types file;
   - literal `vec3` meaning a point or direction in generated signatures (`scene_region_at`,
     `scene_material_properties`, `ior_of`/`ior_of_material`, `scene_medium_properties`,
     `sdf_<id>`, `environment_pdf`, LightQuery constructors) → `Point`/`Direction`.
3. **Phase functions** (a contract change, its own commit): `<id>_eval/_sample/_pdf` and the
   generated `interaction_medium_*` seams gain `Point p`; `dot` → `ambient_dot`. The sampling
   basis stays `build_basis` in this commit (bit-identical); it is replaced by `ambient_frame`
   in step 2, where a curved key needs it, verified by medium witnesses (the sampled
   directions change, their distribution does not).
4. **Not in step 1:** the SDF march and the Euclidean placed-arm local points (no curved path
   reaches them), light samplers (curved bodies are separate), placements, keyed descriptors.

**Verification.** `npm run frames -- compare` bit-exact on every case (measured on SwiftShader;
GLSL ES 3.00 has no `precise`). Digest before/after: only respellings, reviewed by kind of line.
`npx tsc --noEmit`, `npx vitest run` (shaderConstants.ts follows MAX_DIST to the occupant;
generated-GLSL and program snapshots updated). Seam-unused warnings must not rise.

### 2.3 Step 2 — H³, smallest useful subset

- **Mechanism (first commit):** descriptor GLSL keyed by space for geometry, lights, materials,
  volume_scattering, camera, env charts and aov; `spaces` lists on the GLSL-less estimator
  descriptors; one gate helper at the existing registry gates (a light kind and its backing
  primitive gated together); `curvedLimitations(scene, strategy, space)` for the features
  without descriptors; the support-table snapshot. Now the gate can fail.
- **Occupant** `components/ambient/hyperbolic/` (§2.1 functions; distance by the stable asinh
  form, with the acosh branch only if a measurement shows in-scene separations need it).
- **Bodies:** sphere, plane, disk shapes; point and disk lights (disk: curved area and
  inverse-CDF radius; pdf via A(r) and the arrival cosine); lambert; pinhole and fisheye (one
  shared file each, listed under both spaces; frame computed on the CPU, target-centered up
  rule); hg (basis via ambient_frame) and the analytic homogeneous medium inside objects;
  equirect/octahedral/constant sky lookup.
- **Placement:** one inverse isometry `mat4` per object (baked literal when constant, uniform
  when driven — mat4 uniforms exist end to end); normals map by J·((J n)·G⁻¹) with
  J = diag(1,1,1,−1); column-major, pinned by a test; point rows fold into the placement as a
  pre-translation; scale ≠ 1 is an error. A missing uv chart is an error for uv-reading
  materials (no planar fallback).
- **Emissive geometric objects** are not light-sampled in curved spaces in this version (BSDF
  hits see them, MIS weight 1); authored point and disk lights are.
- **Not here:** App orbit/fly controls (today's controls write Vec3 position/target, which are
  valid poses under exp_o; isometric controls belong to the App redesign), other materials,
  the sphere light, marched shapes. Each later occupant arrives with its own witness.

**Witnesses** (new fixtures; small disk receiver, maxBounces 1, no sky, closed forms integrated
over the readout window):
1. H³ furnace, pt only: spawn, intersection and emission bookkeeping (L = Σ_{k≤6} 0.8^k).
2. H³ disk light on a lambert receiver; pt = pt-nee = pt-mis and the closed form (catches A(r),
   the curved area sampler, the emitter arrival cosine).
3. H³ point light: I·cos/sinh² d.
4. H³ homogeneous scattering ball lit by an outside disk light; pt = pt-nee = pt-mis (catches the
   phase metric, exit_dir, the medium shadow walker).
5. Euclidean suite unchanged (frames compare).

### 2.4 Step 3 — S³

Occupant with the S³ formulas (J = I for normals: G⁻¹ = Gᵀ); search interval (0, 2π); no sky;
arc choice inside the point and disk light bodies (the body takes the LightQuery; the ½ choice
draws one extra `random()`); curved pdf bodies take the arrival direction (`wo`) from the
combiner — a signature change to the curved pdf bodies only. Witnesses, pt = pt-nee = pt-mis:
a one-sided disk below a small disk receiver lit only through the long arc; the same with an
opaque blocker on the long arc beyond distance d (expected 0); a medium ball (½ rule); the S³
furnace, pt only. The receiver is not a plane (a great sphere would block every long arc).

### 2.5 Later

Box, cylinder, torus (with the march through ambient_flow and curved normals), quad as a
centered (a, b) rectangle, the sphere light (cone sampler; S³ flip rule: sample the forward
cone, flip ω below n or with probability ½, light distance 2π − far root), other materials with
witnesses, Klein-chart Euclidean SDFs in H³, meshes through Klein/gnomonic charts, image-sky NEE
in H³ (Jacobian 1/((x+v)₄)², evaluated at the scattering vertex), isometric App controls,
quotients ([quotients plan](quotients-plan.md) when written). H²×R has its own plan and first
subset: [curved/h2xr-plan.md](curved/h2xr-plan.md).

## 7. Provisional choices (model's, unconfirmed)

| # | choice | why | undo |
|---|---|---|---|
| 1 | camera up rule target-centered | an orbit is an exact rotation about the target | swap the CPU frame function |
| 2 | ambient (unbounded) media: error in curved spaces | exact S³ value needs unbounded segments; H³ sky leaks through a clipped fog | lift the limitation row |
| 3 | H³ far clip T = 10 | float32 range; cuts only sub-pixel bands inside the working radius | one constant in the occupant |
| 4 | S³ arc rule (one-sided: upper arc; else ½) | measured unbiased; no extra shadow rays | sample both arcs instead |
| 5 | emissive geometric objects not light-sampled in curved spaces | sampling them needs the placement in the emitter path; MIS keeps it unbiased | add them to the roster later |
| 6 | curvature fixed at ±1; `parameters.curvature` is an error | sizes carry the scale; one formula per space | accept a curvature scale |
| 7 | H³ working radius documented, not checked | a check is one more mechanism; owner prefers fewer guards | add a Validator rule |
| 8 | phase basis: build_basis kept in step 1, ambient_frame in step 2 | keeps step 1 bit-identical; step 2 is verified by witnesses | keep a build_basis seam per space |
| 9 | first H³ subset without marched shapes and with only lambert | each further occupant needs its own witness | add with witnesses (next tier) |
