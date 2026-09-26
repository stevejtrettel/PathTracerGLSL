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

## The loop — five abstractions

```
Ray  →  scene_intersect  →  Hit  →  interaction (sample/eval/emission)  →  make_ray  →  repeat
```

1. **`Ray`** — a *geodesic seed*: a position and a unit direction (no search interval; see below).
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
   garbage).
4. **Interaction** — the scattering event (surface BSDF and medium phase unified): `sample` returns
   the next direction + weight; `eval`/`emission` for NEE/MIS.
5. **`make_ray`** — spawn the continuation ray from the hit; iterate.

## `Ray` — the universal, geometry-independent abstraction

```glsl
struct Ray { Point origin; Direction direction; };   // PURE geodesic seed — no search interval
```
- A `Ray` **encodes a geodesic by its initial conditions** — `(origin, direction)`, a point of the
  unit tangent bundle. It flows via `ambient_geodesic(origin, direction, t)`; only the *space*
  changes (Euclidean → line, H³ → hyperbolic geodesic, Schwarzschild → light path). Same `Ray`.
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
Ray make_ray(Point origin, Direction dir);   // just {origin, direction} — no interval
```

## The Riemannian metric — `ambient_dot`, paid once

Any inner product of **two world-space physical directions** (transport cosines, same-hemisphere
tests, phase-angle cosines) is a *metric* operation → `ambient_dot(a, b, p)`, not raw `dot`. In
Euclidean space `ambient_dot` unpacks to `dot`, so this is invisible today — and silently wrong the
day curvature turns on, which is exactly why we name it now.

**The rule (mechanical, so the compiler-less discipline is checkable by eye):**
- world-space direction · direction, or the world↔frame projection (`to_local`/`from_local`) → **`ambient_dot`**
- dots between vectors **already in local-frame components** → raw **`dot`** — the frame is
  metric-orthonormal by construction, so the metric is the identity there. *The metric is paid
  exactly once, at the world↔frame crossing.*

Lambert works in world space, so every dot it takes is `ambient_dot`. The GGX-family materials
evaluate in a local frame: `microfacet_to_local` (glsl/core/microfacet.glsl) projects each world
direction with `ambient_dot`, and dots between the resulting local vectors are raw `dot`.

## Updated signatures (vs the current slice)

```glsl
bool     scene_intersect     (Ray ray, out Hit hit);                   // hit.t = MAX_DIST in; running nearest out. Ray READ-ONLY.
bool     <backend>_intersect (Ray ray, inout Hit hit);                 // accumulate nearest into hit (bound = hit.t); never mutate ray
bool     scene_intersect_any (Ray ray, float maxDist);                 // occlusion bound is an argument
Spectrum shadow_transmittance(Ray shadow_ray, Point light_p, int crossings_left);   // destination is a POINT — see below
Point    ambient_geodesic    (Point origin, Direction dir, float t);   // UNCHANGED — the geodesic mechanism
float    ambient_dot         (Direction a, Direction b, Point p);      // UNCHANGED — now actually called
Direction ambient_direction_to(Point from, Point to);                 // unit start direction of the geodesic from → to (aims shadow rays)
```
The **running nearest lives on `hit.t`** (not on the Ray, and not `inout Ray`): each backend reads
`hit.t` as its far bound and, on a closer hit, fills the whole Hit and shrinks `hit.t`. The Ray is
never mutated by intersection — it is a pure seed.

## Supersedes

- **Fable §5 `GeodesicState` + `geodesic_step` stepper — deleted.** The geodesic abstraction is
  `ambient_geodesic(origin, dir, t) → Point`; that signature holds in *every* space, including a
  black hole (which integrates the ODE internally — an implementation/perf detail of the ambient
  module, never a type in the loop). There is no stepper state in the trace loop.
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
  (moved ε off the surface) and sets the direction to `ambient_direction_to(origin, light_p)`. A
  ray that kept the direction computed from the unmoved hit point would be the true segment shifted
  by ε: it passes beside the light point, and when the light is seen at a slant it meets the light's
  own surface before the back-off — whenever ε·[(−n_g·n_l)/cos θ_l − cos θ] > `SHADOW_BACKOFF`
  (θ from the receiver's normal n_g, θ_l from the light's normal n_l). Only visibility uses the
  aimed direction; the BSDF, the cosine and the pdfs keep the sampled one (witnesses
  `shadow-aim-march`, `shadow-aim-far`). The opaque fast path derives its `maxDist` from the point; the media walk measures
  `length(light_p − seg_ray.origin) − SHADOW_BACKOFF` per segment (the back-off's derivation —
  angle-amplified, never fp-relative — lives on the constant in core math). (length() is Euclidean; a geodesic
  ambient-distance helper is the curved-space follow-up, like the straight-ray march itself.)
  **`crossings_left` is the path's unspent null-crossing budget.** `measurement.maxNullCrossings`
  bounds the null crossings of a whole path, and a shadow ray is a path's last segment, so the
  caller passes what the path has left (`shadow_crossings_left(s)`, generated with the walk) and
  a shadow ray that needs more returns zero. The walk ends a BSDF-sampled path at the same total,
  so every technique drops the same paths. The opaque form ignores the argument: without media
  there are no null interfaces.

## Deferred (not this contract)

Curved ambient spaces (H³/Schwarzschild — `ambient_*` are the seam);
`Point`→`vec4` per space; BVH under non-straight geodesics
(open in the archive too); Fable's bare-`f`-vs-`f·cos` cosine-placement question (orthogonal).
