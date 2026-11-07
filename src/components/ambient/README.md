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
#define MAX_DIST ...                                       // the far clip, an arc length
float fp_uncertainty(Point p);                             // positional error of an fp-accurate point
Point ambient_geodesic(Point o, Direction d, float t);     // the point at arc length t along the geodesic
Ray   ambient_flow(Ray r, float t);                        // the ray moved by t: the point AND the arrival velocity
float ambient_dot(Direction a, Direction b, Point p);      // the metric at p
Direction ambient_normalize(Direction v, Point p);         // v at unit length in the metric at p
Frame ambient_frame(Point p, Direction n);                 // orthonormal shading frame around n
Direction ambient_parallel_transport(Direction v, Point from_p, Point to_p);
Direction ambient_direction_to(Point from, Point to);      // unit start direction of the geodesic from → to
Direction ambient_aim(Point from, Direction along, Point to, out float remaining);
    // shadow-ray aim: the unit direction at `from` of the geodesic to `to` on the arc the ray
    // travels (`along`, its current direction), and in `remaining` the arc length left to `to`
vec3  ambient_sky_key(Point p, Direction v);               // where the sky is looked up for the ray (p, v)
```

`ambient_flow` computes its point with `ambient_geodesic`, so a space states its geodesic
formula once.

Euclidean space unpacks these to `o + t·d`, `dot`, `normalize`, `length(to − from)` and the
direction itself — which is why components write the `ambient_*` names instead of the raw
operations: every direction·direction product, every normalization of a world direction,
every arrival direction (`ambient_flow(ray, t).direction`, not `ray.direction`), every
shadow-ray aim and length, and every sky lookup goes through the seam. The seam's
signatures and the generated signatures (`scene_region_at`, `scene_material_properties`,
`scene_medium_properties`, `ior_of`, `sdf_<id>`, `environment_pdf`, the LightQuery
constructors) write points and tangent vectors as `Point` and `Direction`; hand-written
locals inside component bodies (the cameras' look-at frames, for one) still say `vec3`.

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
  (implemented in: …)`. A light kind is gated with the primitive backing it; a marched
  primitive with the primitive bounding its march; an emissive object with its light kind; a
  phase model and an env chart where the program links them.
- **Features without a descriptor** are rows of `SPACE_LIMITATIONS`, checked by
  `curvedLimitations(scene, strategy, features)` on resolved values, together with the
  estimator occupants the program resolves to (defaults applied, including the size-based
  table dispatch): mesh objects, instanced objects, scale ≠ 1, tracking media, GRIN media,
  an ambient medium, equiangular medium NEE, an environment, an environment sampled as a
  light, emissive objects sampled as lights.
- **The table**: [`support.md`](support.md) is generated from all of the above by
  tests/components/spaceSupport.test.ts (`npx vitest run -u` rewrites it). Shared files with
  no descriptor (ray.glsl, the shadow walkers, microfacet.glsl) are not in it: the witnesses
  of each space establish them.

Adding a space: one occupant folder and one registry line here, then a body or a `spaces`
entry for each occupant checked in the new space, and the limitation rows it lifts.

## Status & the honest caveat

Sole occupant: `euclidean/`. Several places are Euclidean beyond the seam and need new
bodies in a curved space, not just a new occupant: the light samplers (Euclidean solid-angle
constructions; their files carry a METRIC EXEMPTION note), the phase functions' sampling
basis (`build_basis`), the SDF march and the similarity-placement arms, the camera frame
uniforms, the environment samplers, and equiangular placement (extrinsic closest-approach
geometry).

## Invariants & witnesses

None space-specific yet (one occupant). A respelling of the seam must leave every Euclidean
scene bit-identical (`npm run frames -- compare`). The gate and the limitation rows are
exercised with a test-only space registered in memory (tests/compiler/spaceGate.test.ts).
