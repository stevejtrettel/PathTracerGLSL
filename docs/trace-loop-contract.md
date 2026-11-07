# Trace-Loop Contract

**Status:** Design authority for the top-level path-tracing loop and its types. Owner-decided
(July 2026), consolidated from the original `docs/archive/START/contracts/optics/*` +
`pillars/objects.md` design and refined in discussion. **This supersedes Fable's `GeodesicState`
stepper (`fable-compiler-contracts.md` §5) — see "Supersedes" below.**

> **Where the loop lives:** the loop is GENERATED — its source of truth is the walk generator
> in `src/components/transport/integrators/pt/pt.ts`, which composes the static technique
> files under `src/components/transport/techniques/`. This contract
> still governs the loop's types and semantics; read it before touching the emitters. To READ
> a concrete loop, dump the shader for a (scene, strategy) pair — each emitted program contains
> exactly its own estimator.

---

## Wavelength carriage

`Ray` is a seed for light propagation and carries the current wavelength coordinates. `Hit` records the arriving carrier. The original camera wavelengths and sampling
PDFs remain with the estimator; throughput and accumulated radiance remain on `PathState`.
Search bounds still belong to queries. Transport ray construction must supply or inherit the
carrier; wavelength-changing propagation or scattering must be able to produce a new one.
See [spectral design §3.4](claude-spectral-design.md#34-wavelengths-belong-on-the-ray-d3--decided).
RGB uses an initialized placeholder; spectral rendering remains unimplemented.

## The loop — five abstractions

```
Ray  →  scene_intersect  →  Hit  →  interaction (sample/eval/emission)  →  make_ray  →  repeat
```

1. **`Ray`** — a *geodesic seed*: a position, a unit direction and current wavelengths (no search interval; see below).
2. **`scene_intersect(Ray) → Hit`** — advance to the next intersection. One contract; it subsumes
   SDF marching, analytic intersection, triangle meshes with BVHs and instanced batches, taking
   the nearest hit; the backends coordinate through the running nearest distance `hit.t`.
3. **`Hit`** — the landing record: where you arrived, the shading frame, the **geometric
   normal** (`ng` — the true normal of the surface hit, oriented like the shading normal;
   equal to it except where shading is interpolated or perturbed: smooth meshes now, normal
   and bump maps later. Anything that depends on the surface's real orientation reads it:
   `ray_spawn` offsets along it, so a spawned ray starts on the side of the true surface it
   travels into, and a mesh emitter's area → solid-angle conversion uses it), the regions
   flanking the boundary, the owner's sub-element index (`element` — which PIECE of the owning
   region's surface; owner-approved July 2026, fable-instance-attributes: placement index for
   instanced batches, 0 elsewhere; future per-triangle/Stage-B refs ride the same channel),
   and the point's **positional uncertainty** (`eps` — owner-approved Aug 2026,
   impl-plan-epsilon-discipline: the arm that made the hit states how well it knows `p` —
   fp-scale for analytic roots via `spawn_eps_fp`, `MARCH_CLEARANCE` for marched commits,
   fp-scale for triangle hits too. `ray_spawn`'s escape offset is the one reader; the
   dispatcher seeds the conservative default so a missed fill degrades instead of reading
   garbage), the **arrival direction** (`arrival` — the ray's unit velocity at `p`, in `p`'s
   chart; the transport's `wo` is `−arrival`), and the **image** of the hit (`image` — in a
   quotient space, which image of the scene the ray hit, relative to the chart of its origin,
   as an index into the program's NEE image table, −1 when it is not in the table; 0 in
   programs without a quotient). The dispatcher sets both; a quotient walk sets `image` once
   more (see "Quotient spaces" below).
4. **Interaction** — the scattering event (surface BSDF and medium phase unified): `sample` returns
   the next direction + weight; `eval`/`emission` for NEE/MIS.
5. **`make_ray`** — spawn the continuation ray from the hit; iterate.

## `Ray` — the universal, geometry-independent abstraction

```glsl
struct Ray { Point origin; Direction direction; Wavelengths wl; }; // no search interval
```
- A `Ray` **encodes a geodesic by its initial conditions** — `(origin, direction)`, a point of the
  unit tangent bundle. The geodesic flow moves it: `ambient_flow(ray, t)` is the ray at arc length
  t — the point reached and the velocity there — and `ambient_geodesic(origin, direction, t)` is
  that point alone. Only the *space* changes (Euclidean → line, H³ → hyperbolic geodesic,
  S³ → great circle, Schwarzschild → light path). Same `Ray`.
- **`ray.direction` is the direction at the origin.** Anything that needs the direction where the
  ray ARRIVES reads the flow: `scene_intersect` stores `ambient_flow(ray, hit.t).direction` on
  `hit.arrival` (its side test reads it there, and so does `wo` at a surface hit); the
  continuation through a null interface and a medium event's incident direction read
  `ambient_flow(ray, t).direction` themselves. In Euclidean space the two are the same vector; in
  a curved space they are not.
- `scene_intersect` seeds `Hit.wl` from `Ray.wl`; geometry helpers preserve it.
  `ray_spawn` inherits `Hit.wl`; local-frame rays preserve wavelengths without spatial scaling.
- `direction` is a **unit** tangent — unit *in the metric*.
- **No `tmin`/`tmax` on the Ray.** Search bounds are the *query's* concern, not the ray's identity.
  We tried the interval on the Ray and it conflated three roles (ray identity / query far-bound /
  running-nearest) — the by-value-vs-`inout` confusion was the symptom. The bounds' real homes:
  - **near bound** (`tmin`): analytic primitives and triangle meshes search strictly ahead
    (`t > 0`) — self-intersection is handled entirely by the origin offset along `ng`; the
    marched tier keeps its own named clearance (`MARCH_CLEARANCE`), derived where it is defined.
  - **running nearest** (the old `tmax` shrinking): lives on **`hit.t`**. For a nearest-hit search
    "the bound" and "the nearest distance found" are the *same quantity*, so `hit.t` holds both —
    initialized to `MAX_DIST`, shrunk by each backend. (A Hit's fields other than `t` are valid only
    when `scene_intersect` returns true.)
  - **occlusion far-bound**: an explicit `maxDist` **argument** to `scene_intersect_any` (the light
    distance) — an input, not ray state.
- **Self-intersection escape is an origin offset**, done via the geodesic (`ray_spawn`):
  `origin = ambient_geodesic(hit.p, side·ng, hit.eps)` with `side = +1` if `ambient_dot(wi, ng, p) ≥ 0`, else `−1`
  — the offset is the hit's OWN positional uncertainty (provenance-filled, impl-plan-epsilon-
  discipline), along the GEOMETRIC normal, toward the side of the true surface `wi` travels
  into (reflection and transmission alike). Robust at grazing angles (offset along the normal)
  and curved-space-correct (the exp-map step). The true geometric point lives on `Hit.p`; the ray's
  `origin` is legitimately the escaped point.

```glsl
Ray make_ray(Point origin, Direction dir, Wavelengths wl); // explicit carrier, no interval
```

## The Riemannian metric — `ambient_dot`, paid once

Any inner product of **two world-space physical directions** (transport cosines, same-hemisphere
tests, phase-angle cosines) is a *metric* operation → `ambient_dot(a, b, p)`, not raw `dot`. In
Euclidean space `ambient_dot` unpacks to `dot`, so this is invisible today — and silently wrong the
day curvature turns on, which is exactly why we name it now.

**The rule (mechanical, so the compiler-less discipline is checkable by eye):**
- world-space direction · direction, or the world↔frame projection (`to_local`/`from_local`) → **`ambient_dot`**
- normalizing a world-space direction (a sampled direction recombined from frame components, a
  reflection or refraction, a camera ray) → **`ambient_normalize(v, p)`** at the point it is tangent to
- dots between vectors **already in local-frame components** → raw **`dot`** — the frame is
  metric-orthonormal by construction, so the metric is the identity there. *The metric is paid
  exactly once, at the world↔frame crossing.*

Lambert works in world space, so every dot it takes is `ambient_dot`. The GGX-family materials
evaluate in a local frame: `microfacet_to_local` (glsl/core/microfacet.glsl) projects each world
direction with `ambient_dot`, dots between the resulting local vectors are raw `dot`, and
`microfacet_from_local` normalizes the recombined world vector with `ambient_normalize` at the
frame's point.

Phase functions work in world space at the scattering event, so they take its point:
`<id>_eval(wi, wo, p, mp)`, `<id>_sample(wo, p, mp, xi)`, `<id>_pdf(wi, wo, p, mp)` and the
generated `interaction_medium_*` dispatch over them. The phase-angle cosine is
`ambient_dot(wi, -wo, p)`, and a sampled direction is normalized with `ambient_normalize` at `p`.
The sampling basis is the tangent frame at `p`, `ambient_frame(p, -wo)` (hg; rayleigh still uses
core math's Euclidean `build_basis` and is Euclidean-only — components/volume_scattering/README.md).

## Updated signatures (vs the current slice)

```glsl
bool     scene_intersect     (Ray ray, out Hit hit);                   // hit.t = MAX_DIST in; running nearest out. Ray READ-ONLY.
bool     <backend>_intersect (Ray ray, inout Hit hit);                 // accumulate nearest into hit (bound = hit.t); never mutate ray
bool     scene_intersect_any (Ray ray, float maxDist);                 // occlusion bound is an argument
Spectrum shadow_transmittance(Ray shadow_ray, Point light_p, int crossings_left);   // destination is a POINT — see below
Point    ambient_geodesic    (Point origin, Direction dir, float t);   // the point at arc length t
Ray      ambient_flow        (Ray r, float t);                         // the ray at arc length t (point + arrival velocity)
float    ambient_dot         (Direction a, Direction b, Point p);      // the metric at p
Direction ambient_normalize  (Direction v, Point p);                   // unit length in the metric at p
Direction ambient_aim        (Point from, Direction along, Point to, out float remaining);
                                                                       // shadow-ray aim + arc length left (see below)
float    ambient_distance    (Point a, Point b);                       // geodesic distance (light samplers, the aim's arc length)
vec3     ambient_sky_key     (Point p, Direction v);                   // what the sky is looked up by, for the ray (p, v)
```
The ambient occupant supplies these, with `Point`/`Direction` (its `types.glsl`) and
`fp_uncertainty` (components/ambient/README.md); `MAX_DIST` is its descriptor's `farClip`, or the
measurement's `farClip` when authored, emitted by the compiler just before the occupant's block. A space states its geodesic formula once:
`ambient_flow` computes its point with `ambient_geodesic`. A missed ray finds the environment at
`environment_radiance(ambient_sky_key(ray.origin, ray.direction), wl)`; in Euclidean space the key
is the direction; in H³ it is the ray's ideal endpoint, normalize((p + v).xyz), exact for any t; in
H²×R it is the ideal point of the ray's H² part with its angle from the vertical; S³ has no sky (an
environment is an error there). `MAX_DIST` is an arc length: 1000 in Euclidean space,
10 in H³ and H²×R (float32 cosh overflows near 89; a scene within the working radius, about 3 from the
origin, loses only sub-pixel grazing bands of its planes there), 2π in S³, where every geodesic
closes: the first hit within one period is the first hit, and a ray that meets nothing in it reads
0 exactly.

In a curved space every object is intersected in its own frame: the generated arm moves the ray
by the object's inverse isometry, applied by the occupant's `isometry_point` and `isometry_tangent`
(a matrix product in H³ and S³; in H²×R, whose isometries are affine on the 4-vector, a decode of
the mat4 encoding), the shape's closed form returns
the arc length t (an isometry preserves it, so it is compared with `hit.t` unchanged), the hit
point is taken along the WORLD ray (`ambient_geodesic(ray.origin, ray.direction, t)`), and the
normal computed in the object's frame is mapped back by the occupant's `isometry_direction`
(components/ambient/README.md, "Curved spaces").
In S³ two geodesics join any two points (the short arc of length d and the long arc of length
2π − d, leaving and arriving in opposite directions), and both carry light. A light sample chooses
its arc inside the light's body, before the emitter's back-face test, from the stored
`LightQuery`: a one-sided surface receiver (`!q.two_sided`, `q.n ≠ 0`; `q.n` is `hit.frame.n`,
which `scene_intersect` has already turned toward the side the ray arrived from) takes the arc
leaving into its upper hemisphere, and anything else takes each arc with probability ½. The MIS
query `lighting_pdf(q, wo, light_id, light_hit)` takes `wo` at the emitter hit — the arrival
direction reversed — because only the emitter cosine depends on the arc a ray travelled
(components/lights/README.md).

**Quotient spaces** (components/quotient). In M = X/Γ the scene is one copy inside a fundamental
domain D, and `scene_intersect` is a generated walk: it queries that copy with the ray clipped at
the face where it leaves D (`scene_intersect_cell`, today's dispatcher), and if it finds nothing,
moves the ray across the face by the paired isometry and repeats. So `hit.t` is summed over the
cells crossed, and `hit.p`, the frame, `ng` and `arrival` are in D's chart (the cell query's). The
flow of the original ray is in the wrong chart after a crossing, which is why `wo` reads
`hit.arrival`. The walk sets `hit.image` from what it crossed: in the 3-torus the cell index, in
the Seifert–Weber space the crossing count (0 → image 0, one crossing through face f → 1 + f,
more → −1). The image-aware light sampler draws an image of the table and runs the light sampler
at the query moved by that image's map; the MIS pdf reads `hit.image` and moves the stored query
the same way (−1: density 0, so that BSDF hit keeps weight 1).

The **running nearest lives on `hit.t`** (not on the Ray, and not `inout Ray`): each backend reads
`hit.t` as its far bound and, on a closer hit, fills the whole Hit and shrinks `hit.t`. The Ray is
never mutated by intersection — it is a pure seed.

## Supersedes

- **Fable §5 `GeodesicState` + `geodesic_step` stepper — deleted.** The geodesic abstraction is
  `ambient_geodesic(origin, dir, t) → Point` and `ambient_flow(ray, t) → Ray`; those signatures
  hold in *every* space, including a black hole (which integrates the ODE internally — an
  implementation/perf detail of the ambient module, never a type in the loop). There is no
  stepper state in the trace loop.
- **Fable §6.3** `shadow_transmittance(p, wi, dist)` → `shadow_transmittance(Ray, Point light_p, int crossings_left)`.
  **A shadow ray is defined by its DESTINATION, not a distance.** The scalar `maxDist` form (an
  earlier revision) was non-robust for the media segment-walk: the walker decremented `remaining`
  and re-spawned the ray (offset) at each null-interface crossing without subtracting that
  offset, so the light back-off drifted by one spawn offset per crossing. After ≥2 crossings
  (entering + exiting one bounded medium) the drift exceeded the fixed light margin and the AREA
  LIGHT'S OWN surface blocked the shadow ray → NEE went dark through any bounded medium (pt, which
  reaches the light via the emitter-hit, stayed correct). Passing the light POINT lets each segment
  re-derive the back-off against the fixed target (pbrt's `SpawnRayTo` discipline), so no drift can
  accumulate. **The ray is aimed at the destination as well.** The caller takes the origin from `ray_spawn`
  (moved ε off the surface) and sets the direction to `ambient_aim(origin, ls.wi, light_p, …)`:
  the unit direction at the origin of the geodesic to the light point that continues the arc the
  sampled direction starts on (one arc in Euclidean space and H³; two in S³, where `along` picks
  one, so an occluder on the far part of a long arc stays in the test). A
  ray that kept the direction computed from the unmoved hit point would be the true segment shifted
  by ε: it passes beside the light point, and when the light is seen at a slant it meets the light's
  own surface before the back-off — whenever ε·[(−n_g·n_l)/cos θ_l − cos θ] > `SHADOW_BACKOFF`
  (θ from the receiver's normal n_g, θ_l from the light's normal n_l). Only visibility uses the
  aimed direction; the BSDF, the cosine and the pdfs keep the sampled one (witnesses
  `shadow-aim-march`, `shadow-aim-far`). The media walk re-aims the same way at every null
  crossing, where it re-spawns along the arrival direction there (`ambient_flow`)
  (`shadow-aim-fog`). Both forms take the far bound from the point: the arc length `ambient_aim`
  returns from the segment's origin, minus `SHADOW_BACKOFF` (the back-off's derivation —
  angle-amplified, never fp-relative — lives on the constant in core math).
  **`crossings_left` is the path's unspent null-crossing budget.** `measurement.maxNullCrossings`
  bounds the null crossings of a whole path, and a shadow ray is a path's last segment, so the
  caller passes what the path has left (`shadow_crossings_left(s)`, generated with the walk) and
  a shadow ray that needs more returns zero. The walk ends a BSDF-sampled path at the same total,
  so every technique drops the same paths. The opaque form ignores the argument: without media
  there are no null interfaces.

## Deferred (not this contract)

Further curved ambient occupants (H²×R next — docs/claude-2026-11-review/curved-spaces-design.md).
H³ (the hyperboloid model) and S³ (the unit sphere in R⁴) are registered (`Point` = `vec4`); which
components run in each is decided
outside the loop: each space-dependent occupant has a GLSL body per space it implements, and the
Validator rejects a program that uses one without a body (components/ambient/README.md, "Who
implements what"; the table is components/ambient/support.md).
BVH under non-straight geodesics
(open in the archive too); Fable's bare-`f`-vs-`f·cos` cosine-placement question (orthogonal).
