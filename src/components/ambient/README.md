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
shadow-ray aim and length, and every sky lookup goes through the seam. Points and tangent
vectors are written as `Point` and `Direction`, never a literal `vec3`.

## Status & the honest caveat

Sole occupant: `euclidean/`. Several places are Euclidean beyond the seam and need new
bodies in a curved space, not just a new occupant: the light samplers (Euclidean solid-angle
constructions; their files carry a METRIC EXEMPTION note), the phase functions (no point
argument; `build_basis`), the SDF march and the similarity-placement arms, the camera frame
uniforms, the environment samplers, and equiangular placement (extrinsic closest-approach
geometry).

## Invariants & witnesses

None space-specific yet (one occupant). A respelling of the seam must leave every Euclidean
scene bit-identical (`npm run frames -- compare`).
