# Trace-Loop Contract

**Status:** Design authority for the top-level path-tracing loop and its types. Owner-decided
(July 2026), consolidated from the original `docs/archive/START/contracts/optics/*` +
`pillars/objects.md` design and refined in discussion. **This supersedes Fable's `GeodesicState`
stepper (`fable-compiler-contracts.md` §5) — see "Supersedes" below.**

> **Where the loop lives (item-9 split, July 2026):** the loop is GENERATED — its source of
> truth is `emitTransportTrace` + the segment emitters in
> `src/compiler/generate/features/transport.ts` (`path_trace.glsl` is deleted). This contract
> still governs the loop's types and semantics; read it before touching the emitters. To READ
> a concrete loop, dump the shader for a (scene, strategy) pair — each emitted program contains
> exactly its own estimator.

---

## The loop — five abstractions

```
Ray  →  scene_intersect  →  Hit  →  interaction (sample/eval/emission)  →  make_ray  →  repeat
```

1. **`Ray`** — a *geodesic seed*: a position and a unit direction, plus the interval to search.
2. **`scene_intersect(Ray) → Hit`** — advance to the next intersection. One contract; it subsumes
   SDF marching, analytic intersection, and (future) mesh/BVH as geometry **capabilities**
   (`sdf?` / `ray?` / `instances?`), taking the nearest hit and coordinating via `tmax`.
3. **`Hit`** — the landing record: where you arrived, the shading frame, the regions flanking
   the boundary, the owner's sub-element index (`element` — which PIECE of the owning
   region's surface; owner-approved July 2026, fable-instance-attributes: placement index for
   instanced batches, 0 elsewhere; future per-triangle/Stage-B refs ride the same channel),
   and the point's **positional uncertainty** (`eps` — owner-approved Aug 2026,
   impl-plan-epsilon-discipline: the arm that made the hit states how well it knows `p` —
   fp-scale for analytic roots via `spawn_eps_analytic`, `MARCH_CLEARANCE` for marched commits,
   `MESH_T_MIN` for triangle hits. `ray_spawn`'s escape offset is the one reader; the
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
  - **near bound** (`tmin`): the analytic primitives search strictly ahead (`t > 0`) —
    self-intersection is handled entirely by the origin offset (impl-plan-epsilon-discipline);
    the marched and mesh tiers keep their own named clearances (`MARCH_CLEARANCE`,
    `MESH_T_MIN`), derived where they are defined.
  - **running nearest** (the old `tmax` shrinking): lives on **`hit.t`**. For a nearest-hit search
    "the bound" and "the nearest distance found" are the *same quantity*, so `hit.t` holds both —
    initialized to `MAX_DIST`, shrunk by each backend. (A Hit's fields other than `t` are valid only
    when `scene_intersect` returns true.)
  - **occlusion far-bound**: an explicit `maxDist` **argument** to `scene_intersect_any` (the light
    distance) — an input, not ray state.
- **Self-intersection escape is an origin offset**, done via the geodesic:
  `origin = ambient_geodesic(hit.p, n, hit.eps)` — the offset is the hit's OWN positional
  uncertainty (provenance-filled; impl-plan-epsilon-discipline replaced the old global
  `EPSILON` here). Robust at grazing angles (offset along the normal)
  and curved-space-correct (the exp-map step). The true geometric point lives on `Hit.p`; the ray's
  `origin` is legitimately the escaped point.
  - Offset direction is `+n` for reflection; dielectric transmission will offset toward `wi`'s side
    (`sign(ambient_dot(wi, n, p))·n`) via a spawn helper — deferred to the dielectric material.

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

There is no local-frame BSDF yet (Lambert works in world space), so **today every physical dot is
`ambient_dot`**; the raw-`dot` exception first appears with GGX-style `to_local` materials.

## Updated signatures (vs the current slice)

```glsl
bool     scene_intersect     (Ray ray, out Hit hit);                   // hit.t = MAX_DIST in; running nearest out. Ray READ-ONLY.
bool     <backend>_intersect (Ray ray, inout Hit hit);                 // accumulate nearest into hit (bound = hit.t); never mutate ray
bool     scene_intersect_any (Ray ray, float maxDist);                 // occlusion bound is an argument
Spectrum shadow_transmittance(Ray shadow_ray, Point light_p);          // destination is a POINT, not a distance — see below
Point    ambient_geodesic    (Point origin, Direction dir, float t);   // UNCHANGED — the geodesic mechanism
float    ambient_dot         (Direction a, Direction b, Point p);      // UNCHANGED — now actually called
```
The **running nearest lives on `hit.t`** (not on the Ray, and not `inout Ray`): each backend reads
`hit.t` as its far bound and, on a closer hit, fills the whole Hit and shrinks `hit.t`. The Ray is
never mutated by intersection — it is a pure seed.

## Supersedes

- **Fable §5 `GeodesicState` + `geodesic_step` stepper — deleted.** The geodesic abstraction is
  `ambient_geodesic(origin, dir, t) → Point`; that signature holds in *every* space, including a
  black hole (which integrates the ODE internally — an implementation/perf detail of the ambient
  module, never a type in the loop). There is no stepper state in the trace loop.
- **Fable §6.3** `shadow_transmittance(p, wi, dist)` → `shadow_transmittance(Ray, Point light_p)`.
  **A shadow ray is defined by its DESTINATION, not a distance.** The scalar `maxDist` form (an
  earlier revision) was non-robust for the media segment-walk: the walker decremented `remaining`
  and re-spawned the ray (offset) at each null-interface crossing without subtracting that
  offset, so the light back-off drifted by one spawn offset per crossing. After ≥2 crossings
  (entering + exiting one bounded medium) the drift exceeded the fixed light margin and the AREA
  LIGHT'S OWN surface blocked the shadow ray → NEE went dark through any bounded medium (pt, which
  reaches the light via the emitter-hit, stayed correct). Passing the light POINT lets each segment
  re-derive the back-off against the fixed target (pbrt's `SpawnRayTo` discipline), so no drift can
  accumulate. The opaque fast path derives its `maxDist` from the point; the media walk measures
  `length(light_p − seg_ray.origin) − SHADOW_BACKOFF` per segment (the back-off's derivation —
  angle-amplified, never fp-relative — lives on the constant in core math). (length() is Euclidean; a geodesic
  ambient-distance helper is the curved-space follow-up, like the straight-ray march itself.)

## Deferred (not this contract)

Capability geometry (mesh/BVH `ray?`, `instances?`) and the `inout Ray` multi-backend coordination
(one backend exists now); curved ambient spaces (H³/Schwarzschild — `ambient_*` are the seam);
`Point`→`vec4` per space; the dielectric spawn-offset side; BVH under non-straight geodesics
(open in the archive too); Fable's bare-`f`-vs-`f·cos` cosine-placement question (orthogonal).
