# Curved spaces: design (H³ and S³ first)

Status: model-written design, 2026-11-06. The owner approved the direction (decisions 9–11, 22 in
[decisions.md](decisions.md)); choices the owner has not seen are marked **(provisional)** and
collected in §7. Evidence: [curved/facts.md](curved/facts.md) (every number below was measured by
a script in `curved/` and re-run by an independent checker unless marked *reasoning*).

## Part 1 — the model

**The space.** A scene lives in one Riemannian 3-manifold X, fixed per program:
E³, H³ (curvature −1) or S³ (curvature +1). H²×R is a later goal; nothing here blocks it.
Points are stored in the standard linear model: R³ for E³; the hyperboloid
⟨p,p⟩ = −1, p₄ > 0 in Minkowski R^{3,1} for H³; the unit sphere in R⁴ for S³. A tangent
vector at p is a 4-vector orthogonal to p under the model's form. Curvature is fixed at ±1;
size lives in the shapes' parameters.

**Rays.** A ray is a point of the unit tangent bundle (p, v). The geodesic flow φ_t moves it:

| | position γ(t) | velocity γ′(t) |
|---|---|---|
| E³ | p + t v | v |
| H³ | cosh t · p + sinh t · v | sinh t · p + cosh t · v |
| S³ | cos t · p + sin t · v | −sin t · p + cos t · v |

Radiance is constant along a geodesic in vacuum, so the transport loop is unchanged: it
asks "first hit along this ray", shades at the hit with the *arrival* velocity, and spawns a
new ray. Arc length t is the ray parameter in every space; isometries preserve it.

**Shading.** Materials and phase functions work in an orthonormal tangent frame at the hit
(the existing `microfacet_to_local` / `ambient_frame` route). Their math is unchanged; only
`normalize` and `dot` on world directions must go through the space's metric.

**Light.** Next-event estimation converts area to solid angle with the area density of
geodesic spheres A(r) in place of r²: r² (E³), sinh² r (H³), sin² r (S³). The cosine at the
light uses the geodesic's arrival direction there. Point-light irradiance is I·cos/A(r).
A geodesic ball of radius R at distance d subtends a cone with sin α = S(R)/S(d), S = sinh
or sin. (All verified by Monte Carlo twins: cosine sampling, area sampling, MIS and cone
sampling agree with each other and with closed forms; closed furnaces pass for pt, pt-nee
and pt-mis.)

**Several geodesics.** E³ and H³ have exactly one geodesic between two points. S³ has two,
of lengths d and 2π − d, leaving in opposite directions, with the same density sin² d.
Both carry light. A light sample in S³ therefore picks an arc: for a one-sided receiver
(the existing `LightQuery.two_sided == false` claim) the arc leaving into the upper
hemisphere, with probability 1 — per sample this equals summing both arcs; otherwise each arc
with probability ½. The MIS side knows the arc from the traveled length (t > π ⇒ long arc).
*(Reasoning, checked against the twins' summed-arc estimator; the ½ rule was measured.)*

**Far boundary and sky.**
- E³: unchanged (far clip 1000, sky looked up by direction).
- H³: the sky is a picture on the sphere at infinity. A ray (p, v) ends at the ideal point
  normalize((p+v).xyz) — exact, independent of t. The far clip is a declared arc length
  T = 10 (cosh overflows float32 near 89; everything cut is far below a pixel). First
  version: a constant sky is sampled by NEE (uniform directions, pdf 1/4π at any point);
  image and procedural skies are looked up by BSDF rays only (an estimator choice: the
  converged image is the same).
- S³: no sky. Every geodesic closes after 2π, so 2π is an exact search limit in vacuum and a
  ray that meets nothing carries zero radiance.

**Objects.** A curved scene places each object by an isometry g (rotation and translation,
no scale). Each shape is canonical at the origin of its own frame; its sizes are parameters.
An authored point v ∈ R³ (a camera position, a placement position, a light position) means
exp_o(v), the point reached by flowing distance |v| from the origin in direction v̂. In E³
that is v itself, so nothing authored today changes meaning. First shapes, each with an
exact distance and a closed-form intersection checked against brute force:

| shape | E³ meaning | H³ / S³ meaning |
|---|---|---|
| sphere | ball | geodesic ball |
| plane | plane | totally geodesic plane (a linear hyperplane of R⁴) |
| disk | disk | geodesic disk in such a plane |

Next tier (also verified, built after the first H³ witness passes): box (three slabs),
cylinder (capped tube about a geodesic), torus (tube about a circle; marched). Menger,
apollonian, bottle, knob and scene-local `defineSDF` fields have no curved meaning: compile
errors. (A Euclidean field in a chart, divided by the chart's stretch bound, is a safe later
route; recorded, not built.)

**Precision.** In float32, hyperboloid coordinates lose accuracy like e^{2D} at distance D
from the world origin (measured: camera-ray direction error 5e-4 rad at D = 4, a pixel is
~1e-3). The first version declares a working radius: the camera and the scene stay within
about 3 of the world origin. Camera-relative coordinates would remove the limit but make
every world constant camera-dependent; not now. S³ coordinates are bounded by 1 and have no
such limit.

**Who implements what.** Each space-dependent component (shapes, lights, cameras, materials,
phase functions, environment charts, guides) keys its GLSL by space. A component supports a
space exactly when it has a body for it; nothing is assumed for a space it does not name.
One compiler check turns an unsupported combination into an error naming the component, the
space and the spaces it does support. A generated support table (a snapshot test, so it can
never go stale) is the human-readable answer to "who implements what".

## Part 2 — how it is wired

### 2.1 The ambient occupant supplies

| function | E³ body (today's arithmetic) | why |
|---|---|---|
| `Point`, `Direction` types | `vec3` (descriptor fact `pointType`, emitted before structs) | H³/S³ use `vec4` |
| `Ray ambient_flow(Ray r, float t)` | `make_ray(r.origin + r.direction * t, r.direction, r.wl)` | arrival direction at hits and medium exits |
| `Point ambient_geodesic(Point o, Direction d, float t)` | `o + d * t` (kept; position only) | |
| `float ambient_dot(a, b, p)` | `dot(a, b)` | metric |
| `Direction ambient_normalize(Direction v, Point p)` | `normalize(v)` | H³ normalize is not Euclidean |
| `Frame ambient_frame(Point p, Direction n)` | unchanged | tangent frame |
| `float ambient_distance(Point a, Point b)` | `length(b - a)` | shadow-ray lengths |
| `Direction ambient_direction_to(Point a, Point b)` | unchanged | short arc; S³ long-arc callers negate it |
| `vec3 ambient_sky_key(Point p, Direction v)` | `v` | sky lookup |
| `MAX_DIST` | `1000.0` | far clip per space |
| `fp_uncertainty(Point p)` | today's body | H³ reads all four coordinates |

`ambient_parallel_transport(v, from, to)` has no caller; it is kept as the seam for planned
work, with its signature changed to the unambiguous (point, direction, length) form when a
caller arrives. Its current (from, to) form is singular at antipodes in S³.

### 2.2 Step 1 — Euclidean refactor, bit-identical (no curved code)

Route every site in the first subset's shared code through §2.1, with E³ bodies equal to
today's expressions, and make components key their GLSL by space. Sites (from the
inventory, `curved/bypass-inventory/notes.md`):

- Arrival direction: `wo = -s.ray.direction` (pt.ts), null-interface re-spawn (pt.ts,
  shadow/media/media.glsl), side test in the dispatcher (intersection.ts), `exit_dir` in the
  analytic medium arm → `ambient_flow(ray, t).direction`.
- Straight-line points in generated code (the SDF march, local hit points) → `ambient_geodesic`.
- Shadow distances (`length(light_p - origin)` in shadow/opaque and shadow/media) →
  `ambient_distance`.
- `normalize` on world directions in lambert, checker, mirror, dielectric, hg, rayleigh and
  core/microfacet.glsl → `ambient_normalize`.
- Sky lookup `environment_radiance(s.ray.direction)` → `ambient_sky_key(origin, direction)`.
- `MAX_DIST` and `fp_uncertainty` move to the occupant (same text).
- `Point`/`Direction` emitted from the occupant's `pointType`; literal `vec3` in generated
  signatures that mean a point or a direction (`scene_region_at`,
  `scene_material_properties`, `LightQuery` constructors) → `Point`/`Direction`.
- Descriptor GLSL keyed by space for the space-dependent families; estimator descriptors
  without GLSL get a `spaces` list; one `spaceGate` helper at the existing registry gates;
  a support-matrix snapshot test.

Not in step 1: light samplers (they get separate curved bodies; their E³ bodies stay
byte-identical), placements (curved objects use a new mat4 arm; the E³ fold and tiers stay).

**Verification, written first.** `npm run frames -- record` before and after on the fixed
cases, `npm run frames -- compare` must report bit-exact pictures. `npm run digest` before
and after: the shader-text differences must be only the respellings above (reviewed by kind
of line). `npx tsc --noEmit`, `npx vitest run` (the support-matrix snapshot is new). The
seam-unused warning count must not rise.

### 2.3 Step 2 — H³, first subset

- `components/ambient/hyperbolic/`: the §2.1 functions (stable distance: asinh form for small
  d, acosh for large; renormalize by recomputing p₄ from p.xyz; `fp_uncertainty` = REL·p₄).
- Per-space bodies: sphere, plane, disk shapes; point, sphere and disk lights; pinhole and
  fisheye cameras (uniforms keep their names, become vec4 P, F, R, U); constant, equirect
  and octahedral sky charts (lookup only); lambert, ggx, mirror, dielectric, rough_dielectric,
  checker, hg, rayleigh list the same file under `hyperbolic` once step 1 made them
  metric-clean.
- Placement: one `mat4` inverse isometry per object, a baked literal when constant, a
  uniform when driven (mat4 uniforms already exist end to end). Normals map by J·(Jn·G⁻¹)
  with J = diag(1,1,1,−1). Authored point rows (sphere center) fold into the placement as a
  pre-translation; `vector`/`area` rows are compile errors (the existing ParamKind fact).
  Scale ≠ 1 is a compile error. Matrices are column-major; a test pins the layout.
- Emissive geometric objects are not light-sampled in curved spaces in the first version:
  BSDF hits still see them (MIS weight 1). Authored point/sphere/disk lights are sampled.
- Compile errors in curved spaces: meshes, instancing, table dispatch, the light tree,
  tracking and GRIN media, equiangular NEE, directional/spot/beam/softbeam/quad lights,
  ambient media, orthographic/thin-lens/equirect/cylindrical cameras, and the scene-local
  fields above.
- App: camera controls get a small per-space TS module (exp, log, transvection, orbit, fly);
  orbit uses the target-centered up rule **(provisional)**.

**Witnesses** (new fixtures, derived values exact):
1. H³ closed furnace: camera inside an emitting lambert ball, albedo 0.8, maxBounces 6 →
   L = Σ_{k≤6} 0.8^k = 3.951424; pt, pt-nee, pt-mis.
2. H³ disk-light irradiance on a white lambert receiver at a closed-form value from the
   twins; pt, pt-nee, pt-mis must agree (this is the test that catches a wrong A(r)).
3. H³ point light: I·cos/sinh² d on the same receiver.
4. Euclidean suite unchanged (frames compare).

### 2.4 Step 3 — S³

Occupant with the S³ formulas; arcs per §1; `MAX_DIST` = 2π; no sky (an authored
environment is a compile error); S³ cone sampler with the second (backward) cone and the
whole-sphere branch when the ball contains −x; `march_epsilon` not grown near the antipode.
Witnesses: S³ furnace; one-sided disk below the receiver lit only through the long arc
(closed form 1.250217 in the twin's configuration); pt = pt-nee = pt-mis.

### 2.5 Later

Box, cylinder, torus, quad as a centered (a, b) rectangle; meshes through Klein (H³) and
gnomonic (S³) charts, where geodesic triangles are flat; image-sky NEE in H³ with the
Jacobian 1/((x+v)₄)²; H²×R (direction-dependent A, no straight chart); quotients
(E³ 3-torus first).

## 7. Provisional choices (model's, unconfirmed)

1. Camera up rule: target-centered (an orbit is an exact rotation about the target).
2. Curved ambient media: compile error in the first version.
3. H³ far clip T = 10 as a declared measurement constant.
4. S³ arc rule as in §1 (one-sided: the upper arc; otherwise ½ each).
5. Emissive geometric objects not light-sampled in curved spaces at first.
6. Curvature fixed at ±1; `ambientSpace.parameters.curvature` becomes an error.
7. Precision limit documented, not checked by the compiler.
8. Authored point rows fold into the placement; vector/area rows are errors.
