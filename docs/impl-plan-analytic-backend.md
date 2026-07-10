# Impl plan — analytic intersection backend (sphere + plane)

Add a second geometry **capability** so a scene can put a primitive behind *analytic* ray
intersection (closed-form) instead of *SDF marching* — and `scene_intersect` dispatches over
whichever backends the scene uses. This is the archive's capability model
(`UnifiedGeometryIdea.md`, `multi-tracing.md`) and Fable's V1-C3 relaxation, made real. It
validates the `Ray → scene_intersect → Hit` abstraction we just locked: **same `Ray`, same
`Hit`, the geometry difference lives entirely inside `scene_intersect`.**

**Provenance:** `docs/archive/PROGRESS/world/SCENE/multi-tracing.md` (dual-mode primitives, the
two-kernel model, "use the SDF hit to limit the other backend" via `tmax`), `UnifiedGeometryIdea.md`
(sdf?/ray? capabilities), `docs/trace-loop-contract.md` (the loop + Ray convention).

---

## Structural decisions (confirm these)

1. **`scene_intersect` becomes a GENERATED dispatcher.** `raymarch.glsl`'s `scene_intersect` /
   `scene_intersect_any` are renamed to the **SDF backend**: `sdf_intersect(Ray, out Hit)` /
   `sdf_intersect_any(Ray)`. The analytic backend is `analytic_intersect(Ray, out Hit)` /
   `analytic_intersect_any(Ray)`. The Generator emits the top-level `scene_intersect` /
   `scene_intersect_any` combining **only the backends the scene uses** — so:
   - pure-SDF scene → `scene_intersect(r,h){ return sdf_intersect(r,h); }` (behavior byte-identical to today)
   - pure-analytic → `{ return analytic_intersect(r,h); }`
   - mixed → nearest-hit of both.

2. **`tmax` coordination — analytic first.** Analytic is a cheap one-shot; the SDF march is the
   expensive loop. So in a mixed scene: run `analytic_intersect` first, shrink `ray.tmax = hit.t`,
   then `sdf_intersect` marches *bounded by the shortened `tmax`* — anything it finds is necessarily
   closer, so nearest-hit falls out. This is your `multi-tracing.md` §5 trick, now live.
   ```glsl
   bool scene_intersect(Ray ray, out Hit hit) {          // generated, mixed case
       bool found = analytic_intersect(ray, hit);
       if (found) ray.tmax = hit.t;                       // bound the march
       Hit sdfHit;
       if (sdf_intersect(ray, sdfHit)) { hit = sdfHit; found = true; }
       return found;
   }
   ```

3. **Planner: analytic objects share the region-index space with SDF objects.** Today the Planner
   drops them. Change: walk `scene.objects` in order, assign `index` by position regardless of kind,
   route each to `plan.objects` (SDF) or new `plan.analyticObjects`. `material_of(region)` spans
   **both** lists (regions stay globally unique — §2.3). No change to the `Hit` contract:
   analytic sets `region_to = owner`, `region_from = -1`, exactly like the marcher.

4. **Analytic normals match the SDF gradient's orientation** so shading agrees across backends:
   sphere → `normalize(p - center)`, plane → the plane `normal`. (Both equal the SDF gradient of
   `|p-c|-r` and `dot(p,n)+offset`.) `p = ray.origin + t·ray.direction`.

5. **Analytic is Euclidean *for now*, not by nature.** Closed-form intersection of a *geodesic*
   with a surface exists in curved spaces too (a geodesic meeting a geodesic-sphere in H³, etc.) —
   that's a later geometer's job, not precluded. The current `ray_sphere`/`ray_plane` use
   straight-ray algebra simply because the whole tracer is Euclidean today. So the backend is
   flat *for now*; the abstraction does not bake in "analytic ⇒ straight."

---

## Target GLSL

New fixed `glsl/analytic_primitives.glsl`:
```glsl
// Closed-form ray–primitive intersection. Straight-ray algebra because the tracer is Euclidean
// FOR NOW — closed-form geodesic–surface intersection in curved spaces is a later job, not precluded.
// Returns nearest t in (tmin,tmax).
bool ray_sphere(Ray ray, vec3 center, float radius, out float t) {
    vec3 oc = ray.origin - center;                       // direction is unit → a = 1
    float b = dot(oc, ray.direction);
    float c = dot(oc, oc) - radius * radius;
    float disc = b*b - c;
    if (disc < 0.0) return false;
    float s = sqrt(disc);
    float t0 = -b - s;
    t = (t0 > ray.tmin) ? t0 : (-b + s);                 // nearest root ahead
    return (t > ray.tmin && t < ray.tmax);
}
bool ray_plane(Ray ray, vec3 normal, float offset, out float t) {   // plane: dot(p,n)+offset = 0
    float denom = dot(ray.direction, normal);
    if (abs(denom) < 1e-8) return false;
    t = -(dot(ray.origin, normal) + offset) / denom;
    return (t > ray.tmin && t < ray.tmax);
}
```
Generated `analytic_intersect` (nearest over analytic objects) + `analytic_intersect_any`
(first blocker), mirroring the SDF dispatch. Each object wrapper sets the `Hit` (p, frame via
`ambient_frame(p, normal)`, `region_to = index`, `region_from = -1`, uv).

*(The `dot`s here are analytic ray-geometry algebra in a Euclidean-only path — raw `dot`, not
`ambient_dot`; per the contract's rule, and moot since analytic is flat-only.)*

---

## In scope

1. **`plan/types.ts`** — `PlannedAnalyticObject { index, materialId, shapeType: 'sphere'|'plane', parameters }`; `RenderPlan.analyticObjects`.
2. **`Planner.ts`** — position-ordered `index`; route by kind into `objects` / `analyticObjects`; shared counter.
3. **`glsl/analytic_primitives.glsl`** (new) + **`raymarch.glsl`** rename `scene_intersect*`→`sdf_intersect*`.
4. **`intersection.ts`** — include SDF backend iff `plan.objects.length`; analytic backend iff `plan.analyticObjects.length`; `material_of` over both; generate the combined `scene_intersect`/`scene_intersect_any` dispatcher; generate `analytic_intersect`/`_any`.
5. **Validation scenes** — (a) a **mixed** scene (e.g. analytic plane + SDF sphere, or vice-versa) proving the dispatcher combines backends *and* casts shadows across them; (b) an **all-analytic** twin of `minimalScene` for the **cross-method convergence** check.

No engine/App changes. No Ray/Hit/interaction changes (the whole point — the abstraction holds).

---

## Verification

- **Snapshot**: existing SDF scenes gain a trivial `scene_intersect` wrapper + `sdf_intersect` rename — behavior byte-identical, GLSL changed; review + `-u`. New analytic/mixed scenes get fresh snapshots.
- **Typecheck** + full suite green.
- **Live GPU — the real proof:**
  - existing SDF scenes (cornell, two-light) render **byte-identical** (wrapper inlines).
  - **cross-method convergence**: all-analytic minimal vs SDF minimal converge to the **same image** (the dual-mode-primitive check — your `multi-tracing.md`). This is the pass condition that says the backends agree.
  - **mixed scene**: analytic and SDF objects shadow each other correctly (proves `scene_intersect_any` combines backends and `tmax` coordination works).

---

## Deferred (not this build)

Triangle meshes + BVH (`ray?` with real acceleration), `instances?` (sphere clouds), analytic
box/torus, dual-mode (one primitive exposing *both* sdf and analytic with compiler auto-choose),
`inside()`/containment for analytic volumes (needed when analytic meets media), **curved-space
analytic intersection** (closed-form geodesic–surface — a geometer's later job, NOT precluded).
