# ambient/ — the space the light lives in

**Taxonomy:** scene (the manifold + metric — part of WHAT integral). **Kind:**
pick-one — one space per program.

## What an occupant supplies

Two GLSL files in its folder, registered by one line in `index.ts`:

**`types.glsl`** — the typedefs every other file is written against, included right after
the color model's types and before the core structs:

```glsl
#define Point     ...   // a point of the space (vec3 in Euclidean space)
#define Direction ...   // a tangent vector at a point
```

**`<space>.glsl`** — the metric seam (trace-loop-contract), included after core math and
before `ray.glsl`:

```glsl
float fp_uncertainty(Point p);                             // positional error of an fp-accurate point
Point ambient_geodesic(Point o, Direction d, float t);     // the point at arc length t along the geodesic
Ray   ambient_flow(Ray r, float t);                        // the ray moved by t: the point AND the arrival velocity
float ambient_dot(Direction a, Direction b, Point p);      // the metric at p
Direction ambient_normalize(Direction v, Point p);         // v at unit length in the metric at p
Frame ambient_frame(Point p, Direction n);                 // orthonormal shading frame around n
Direction ambient_parallel_transport(Direction v, Point from_p, Point to_p);
float ambient_distance(Point a, Point b);                  // geodesic distance
Direction ambient_direction_to(Point from, Point to);      // unit start direction of the geodesic from → to
Direction ambient_aim(Point from, Direction along, Point to, out float remaining);
    // shadow-ray aim: the unit direction at `from` of the geodesic to `to` on the arc the ray
    // travels (`along`, its current direction), and in `remaining` the arc length left to `to`
vec3  ambient_sky_key(Point p, Direction v);               // where the sky is looked up for the ray (p, v)
```

`ambient_flow` computes its point with `ambient_geodesic`, so a space states its geodesic
formula once.

**`farClip`** (a descriptor field) — the space's default far clip, an arc length: nothing
beyond it is geometry, and the environment is found there. The compiler emits
`#define MAX_DIST <farClip>` just before the occupant's block, with the measurement's
`farClip` in its place when one is authored (`farClipOf`).

Euclidean space unpacks these to `o + t·d`, `dot`, `normalize`, `length(to − from)` and the
direction itself — which is why components write the `ambient_*` names instead of the raw
operations: every direction·direction product, every normalization of a world direction,
every arrival direction (`ambient_flow(ray, t).direction`, not `ray.direction`), every
shadow-ray aim and length, and every sky lookup goes through the seam. The seam's
signatures and the generated signatures (`scene_region_at`, `scene_material_properties`,
`scene_medium_properties`, `ior_of`, `sdf_<id>`, `environment_pdf`, the LightQuery
constructors) write points and tangent vectors as `Point` and `Direction`; hand-written
locals inside component bodies (the cameras' look-at frames, for one) still say `vec3`.

## Curved spaces

A curved occupant (`hyperbolic/`: H³, curvature −1, the hyperboloid model; `spherical/`: S³,
curvature +1, the unit sphere in R⁴) stores points and tangent vectors as 4-vectors (`Point` and
`Direction` are `vec4`) and supplies, besides the contract above:

- **`Direction isometry_direction(mat4 inverse, Direction v)`** — the world image G·v of a tangent
  vector given in an object's frame, from the object's INVERSE placement G⁻¹ (H³:
  J·((J·v)·G⁻¹), J = diag(1,1,1,−1); S³: v·G⁻¹; the generated arms map normals with it).
- **Its CPU geometry** (`<type>.ts`, the `CurvedGeometry` of `isometry.ts`): the form, exp_o and
  log_o at the origin o = (0,0,0,1), the transvection by a tangent vector at o, and the exact
  inverse of an isometry. Registered as the descriptor's `curved` field; its presence is the one
  fact "this space is curved" (`curvedGeometryOf`).

**Marched fields.** A marched object (`backend: 'sdf'`, or a `defineSDF` field with a body for the
space) is sphere-traced along the space's geodesics in its own frame: the generated
`<type>_sdf_intersect` evaluates its field at `ambient_geodesic(ray.origin, ray.direction, t)`
(re-flowed from the seed each step), and the generated `<type>_sdf_normal(Ray at, S s)` takes four
taps at arc length NORMAL_EPSILON along tetrahedral combinations of `ambient_frame(p, arrival)` —
a tangent vector, mapped to world by `isometry_direction`. A field is a function of a point of the
model (a vec4) and must be a true geodesic distance or a 1-Lipschitz lower bound of one (then
|f(p)| ≤ the distance to its zero set, all sphere tracing needs). The vocabulary for writing one:

```glsl
Point sdf_point(vec3 v);                                    // exp_o(v), an authored point (sdf.glsl)
float sdf_ball(Point p, Point c, float r);                  // ambient_distance(p, c) − r (sdf.glsl)
float sdf_plane(Point p, Direction n, float offset);       // the plane rows' plane (each occupant)
float sdf_tube(Point p, Point a, Direction u, float r);    // distance to the geodesic (a, u) − r (each occupant)
float sdf_smooth_union(float a, float b, float k);          // and _intersection, _subtraction (sdf.glsl)
```

`sdf.glsl` (this folder) is written over the seam and serves both curved spaces; it is included
when a curved program marches. min and max are union and intersection. The smooth union lies at
most k/4 below min(a, b), so a march bound must contain {min(pieces) ≤ k/4}. A field's march bound
is a sphere at the object's origin (the Validator rejects any other center) or `'unbounded'`; in S³
a ray starting inside the bound searches the whole period (it leaves and comes back around).
Euclidean `defineSDF` fields can also serve H³ through the Klein chart (`kleinChart: true`; the
chart never stretches distance, so the bound holds with no factor). The fp64 twins of all of this
are tests/witnesses/scenes/curvedSdfTwins.ts (checked by tests/components/curvedSdf.test.ts).

S³ adds two facts no other space has. Two geodesics join any two points, of lengths d and 2π − d,
leaving and arriving in opposite directions: `ambient_aim` keeps a shadow ray on the arc it
travels, and the S³ light bodies choose an arc per sample (`spherical_light_arc`; the lights
README). And every geodesic closes after 2π: `MAX_DIST` is 2π exactly, there is no sky (an
environment is an error), and a ray that meets nothing reads 0. A geodesic radius lies below π,
the diameter of the space: the sphere, disk and disk-light radius rows declare `SPHERICAL_RADIUS`
as their spherical `constraintIn`, and the Validator rejects a radius ≥ π. A box's half-sizes and a
cylinder's radius and half-height lie below π/2 (`SPHERICAL_HALF_EXTENT`): the shape then lies in
the open hemisphere about its center, which the S³ box and cylinder bodies rely on.

What the compiler does with it (all fp64 on the CPU, compiler/plan/curved.ts):

- **Authored points.** A Vec3 naming a point (a camera position or target, a placement position,
  a light position, a shape's center) means exp_o(v): the point at distance |v| from o in
  direction v̂. In Euclidean space that is v itself.
- **Placements.** Every object is placed by one isometry g = T(position)·R(rotation)·T(point row):
  its shape sits canonically at o with only its intrinsic rows (lengths, and direction rows as
  tangent vectors at o, `Direction(x, y, z, 0.0)`); the point row (a sphere's center) folds in as
  a pre-translation. The program holds G⁻¹ as a column-major `mat4` — a named const when constant,
  a mat4 uniform recomputed from the parameter map when {param}-driven. A scale other than 1 is a
  limitation row.
- **Lights.** A light's point row becomes g·o and its direction rows g applied to them at o, with
  g the isometry its backing region is placed by (`placementIsometry` makes both), so the sampled
  disk is the disk rays hit.
- **The camera.** `curvedCameraBasis` (components/camera/basis.ts): the camera point exp_o(position)
  and an orthonormal tangent frame there, by the target-centered up rule (the Euclidean look-at
  taken with the target pulled back to o), shipped as four vec4 uniforms. The pose must be
  authored (the Euclidean default lies outside the working radius).
- **Curvature** is ±1; sizes carry the scale (`ambientSpace.parameters.curvature` is an error).
- **The working radius.** float32 hyperboloid coordinates lose accuracy like e^{2D} at distance D
  from o; keep the camera and the scene within about 3 of the origin. Documented, not checked.

## Who implements what

An occupant supports a space exactly when it says so; compiling in a space is no evidence of
being correct there (a point light falls off as 1/r² in E³ and 1/sinh² r in H³).

- **Occupants with GLSL** (geometry, lights, materials, volume_scattering, camera, env
  charts, aov): the descriptor's `glsl` is a `SpaceBodies` record (components/descriptors.ts),
  one body `{ origin, source }` per space, keyed by the AMBIENT_SPACES key. A body correct in
  several spaces is listed under each space it has been checked in, with one origin. There is
  no wildcard key. Generators take the body with `bodyFor(d.glsl, space, …)`; a scene-local
  SDF (`defineSDF`) has a Euclidean body.
- **Estimator occupants emitted from TypeScript** (light selection, mesh traversal, instance
  traversal, object dispatch) carry a `spaces` list.
- **The gate**: the Validator checks each occupant at its registry gate with `spaceGate`
  (compiler/analyze/curved.ts), one message: `<occupant> has no <space> implementation
  (implemented in: …)`. A hittable light kind is gated with the primitive and the material
  model backing it (`LIGHT_BACKING_MODEL`); a marched primitive with the chain of primitives
  bounding its march (`marchBoundTypes`, the chain the generator links); an emissive object
  the program samples (under next-event estimation) with its light kind; a phase model and
  an env chart where the program links them.
- **Features without a descriptor** are rows of `SPACE_LIMITATIONS`, checked by
  `curvedLimitations(scene, strategy, features)` on resolved values, together with the
  estimator occupants the program resolves to (defaults applied, including the size-based
  table dispatch): mesh objects, instanced objects, scale ≠ 1, tracking media, GRIN media,
  an ambient medium, equiangular medium NEE, an environment, an environment sampled as a
  light, emissive objects sampled as lights. Under pure path tracing nothing samples an
  emissive object, so it renders in any space its shape and material implement; under
  next-event estimation `sampleAsLight: false` leaves it to BSDF hits (MIS weight 1).
- **The table**: [`support.md`](support.md) is generated from all of the above by
  tests/components/spaceSupport.test.ts (`npx vitest run -u` rewrites it). Shared files with
  no descriptor (ray.glsl, the shadow walkers, microfacet.glsl) are not in it: the witnesses
  of each space establish them.

Adding a space: one occupant folder and one registry line here, then a body or a `spaces`
entry for each occupant checked in the new space, and the limitation rows it lifts.

## Status & the honest caveat

Occupants: `euclidean/`, `hyperbolic/` (H³) and `spherical/` (S³). In both curved spaces: sphere,
plane, disk, box, cylinder and quad shapes; marched balls and scene-local marched fields (and, in
H³, Klein-chart Euclidean fields); point, disk and quad lights; lambert; pinhole and fisheye; hg in homogeneous
object media; in H³ also sky lookup by BSDF rays (support.md has the full table). Places that are Euclidean beyond the seam and need new
bodies, not just an occupant: the other light samplers (Euclidean solid-angle constructions;
their files carry a METRIC EXEMPTION note), rayleigh's `build_basis`, the registry marched shapes
(torus, bottle, knob, menger, apollonian: no curved body), the similarity-placement arms, the environment samplers, equiangular placement, the uv charts, and
`flattenGroups` (it composes groups as Euclidean similarities, so in a curved space a group with a
non-identity transform is an error there).

## Invariants & witnesses

- H³ (tests/witnesses/scenes/h3Witness.ts; every occupant and estimator key listed under
  hyperbolic in support.md is rendered by one of them, the environment row through a constant and
  a procedural sky — no H³ witness renders an image sky): `h3-furnace` (six emissive planes,
  Σ_{k≤6} 0.8^k exactly, through a pinhole and a fisheye), `h3-disk-light` and `h3-point-light`
  (a lambert disk receiver against closed forms integrated over the readout window by
  tests/witnesses/scenes/h3Twins.ts; the latter under power and uniform selection of two
  lights), `h3-medium` (pt = pt-nee = pt-mis for a scattering ball, the light out of frame),
  `h3-sky` (a direction-dependent sky read at the sky key, pinhole and fisheye), `h3-sky-ball`
  (a lambert ball reads ρ·L under a constant sky; its placement is the {param}-driven mat4
  uniform). The CPU geometry, the column-major layout and
  `isometry_direction`'s arithmetic are pinned by tests/components/hyperbolic.test.ts.
- S³ (tests/witnesses/scenes/s3Witness.ts; every occupant and estimator key listed under spherical
  in support.md is rendered by one of them): `s3-furnace` (six emissive great spheres, Σ_{k≤6} 0.8^k
  exactly, pinhole and fisheye), `s3-long-arc` (a disk receiver lit only through the long arc by a
  disk light facing away from it, against the closed form integrated over the window by
  tests/witnesses/scenes/s3Twins.ts), `s3-long-arc-blocker` (an opaque ball on every long arc
  beyond the short-arc distance: 0), `s3-point-light` (point lights above and below, power and
  uniform selection), `s3-medium` (pt = pt-nee = pt-mis for a scattering ball lit through both arcs,
  the ½ rule). The CPU geometry and the occupant's arc arithmetic are pinned by
  tests/components/spherical.test.ts.
- Box, cylinder, quad and the quad light, both spaces (tests/witnesses/scenes/curvedShapesWitness.ts):
  `h3-shapes`, `s3-shapes` (a rotated box, a tilted cylinder and a quad under a point light; readout
  windows on a box face, the tube, a cap and the quad, and in S³ a box face lit only through the
  long arc, against the fp64 transcriptions of tests/witnesses/scenes/curvedShapeTwins.ts) and
  `h3-quad-light`, `s3-quad-light` (the direct-lighting receiver under a quad light, in S³ through
  the long arc; pt = pt-nee = pt-mis = the quadrature over the quad). The transcriptions are checked
  against marched membership (chart coordinates and axis distances, not the bodies' face normals),
  normals against finite differences, and the quad light's density against the Gauss–Bonnet area by
  tests/components/curvedShapes.test.ts. box_sdf and cylinder_sdf, read only for containment
  (scene_region_at), are checked there as transcriptions; no witness fills a curved box or cylinder
  with a medium.
- Marched fields (tests/witnesses/scenes/curvedSdfWitness.ts): `h3-sdf-ball` / `s3-sdf-ball` (a marched
  ball off o under a point light against the closed form, and against the closed-form ball scene;
  in S³ the window is lit through both arcs), `h3-klein-ball` (the same ball as a Klein-chart
  Euclidean sphere), `h3-sdf-furnace` / `s3-sdf-furnace` (Σ_{k≤6} 0.8^k inside a marched cavity — a
  no-leak test), `h3-sdf-blend` / `s3-sdf-blend` (a placed smooth-union sculpture against its fp64
  twin, tests/witnesses/curvedSdfTwins.test.ts).
- A change to the seam that is a respelling must leave every Euclidean scene bit-identical
  (`npm run frames -- compare`).
- The gate and the limitation rows are exercised with a test-only space registered in memory
  (tests/compiler/spaceGate.test.ts).
