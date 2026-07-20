# impl-plan-instancing.md — instancing (mesh + analytic, shared placement-list machinery)

**STATUS: BUILT — GPU-render-verified; numeric witness sweep owner-gated.** Owner-approved: mesh
& analytic share one path; SDF deferred (domain-rep); prototype owns no transform. tsc + vitest 1110
green (incl. the `instance-twin` twin + both backends through glslang). GPU verify: the `forest`
demo renders 20 instanced cacti (shared BLAS) + a row of instanced spheres, correct shadows, on
SwiftShader — both backends through one placement loop. Build record §10. Plan follows for the record.

**Goal:** one prototype geometry, placed at N transforms, sharing the geometry — so a forest of
cacti or a room of teapots costs one upload + a placement list, not N copies.

**Scope (this batch):** mesh + analytic prototypes; constant placements; ONE shared material/region
per batch (opaque, surface-only). **Deferred:** SDF instancing (the domain-rep generalization),
TLAS (scale — the linear loop is v1), per-instance materials, driven/`Value<T>` per-instance
placements, dielectric/interior-media instances (need containment, like glass meshes).

---

## 1. The idiom (why this is composition, not new machinery)

Instancing = **repeated placement of a shared prototype**, and both halves are already universal:
- **placement** = a similarity, with the rigid-frame ABI (`q_inv`, `(t_rigid, s)`) the driven path
  already uses (`buildDrivenPlacement` computes exactly this);
- **intersect-in-local** = ray-into-local, which the driven-mesh wrapper and driven-analytic arm
  already do verbatim.

So an instanced batch is **the driven wrapper, looped over a placement list, against one prototype**.
The only per-backend line is the local-intersect call:

| Backend | prototype (shared, uploaded/emitted once) | local intersect (the one differing line) |
|---|---|---|
| mesh | the BLAS (vertex + BVH textures, via `packMesh`) | `mesh_nearest_bvh(local_ray, …)` |
| analytic | canonical params of one `<type>` | `<type>_intersect(local_ray, params·s)` |

Everything else — the placement read, the conjugation, the `hit.t` bound, the normal map-back, the
region — is shared. It reuses: the placement ABI, ray-into-local, the **data-texture rail from the
BVH batch**, `packMesh`, and the analytic dispatch.

## 2. IR — a flat `InstancedObject` (authoring sugar lowers to it)

`SceneDescription` stays flat: an instanced object is ONE object carrying a placement LIST (array
data, like `MeshObject` carries vertex arrays — not a tree). The authoring layer gets the sugar.

```ts
// compiler/types.ts — joins the ObjectDescription union
interface InstancedObject {
    kind: 'instanced';
    prototype: PrimitiveObject | MeshObject;  // LOCAL geometry; its own transform is folded in
    placements: Transform[];                  // N world similarities (constant in v1)
    material: string;                         // ONE shared material → one batch region
    name?: string;
}
```
- The prototype is **local** geometry (its own `transform`, if any, folds into the prototype's
  canonical form). Each placement is a world similarity.
- Authoring sugar (`src/authoring/`): e.g. `instance(prototype, transforms[])` — and naturally
  `scatter`/`grid` helpers that GENERATE the transform list — producing this flat record.
- SDF prototypes are **Validator-rejected** in v1 with a clear "SDF instancing is the deferred
  domain-repetition feature" message (reject-not-remove).

## 3. Placement data (reuse the BVH rail)

Each placement lowers (CPU) to the rigid-frame pair `q_inv` + `(t_rigid = −Rᵀt, s)` — the SAME
computation as `buildDrivenPlacement`, extracted into a shared helper. Packed **2 RGBA32F texels per
instance** into a placement texture (`extern:instance_<k>_placements`), uploaded via
`registerDataTexture`. `instanceCount` is baked (the compiler has the array). Small-N could be a
uniform array instead, but one texture path handles any N — and "unroll" is already just *authoring
N objects*, so instancing is deliberately the batch-loop path (no threshold needed).

## 4. Generated code — the batch loop (identical skeleton, mesh & analytic)

One function per batch, added to `scene_intersect` alongside the existing arms:

```glsl
bool instance_batch_0(Ray ray, inout Hit hit) {
    bool found = false; vec3 nLocal; vec2 uv;
    for (int i = 0; i < INSTANCE_COUNT_0; i++) {
        vec4 q  = texelFetch(u_inst_0_place, mesh_texel1d(uint(2*i)),   0);
        vec4 ts = texelFetch(u_inst_0_place, mesh_texel1d(uint(2*i+1)), 0);
        float s = placement_scale(ts);
        vec3 ro = placement_rigid(q, ts, ray.origin) / s;   // ray → this instance's local frame
        vec3 rd = placement_dir(q, ray.direction)   / s;    // unnormalized → local t == world t
        if (/* MESH */     mesh_nearest_bvh(<proto BLAS>, PROTO_SMOOTH, ro, rd, hit.t, nLocal, uv)
            /* ANALYTIC */  // <type>_intersect(make_ray(ro,rd), <proto params · s>, t) && t < hit.t
        ) {
            found = true;
            hit.p = ambient_geodesic(ray.origin, ray.direction, hit.t);
            hit.frame = ambient_frame(hit.p, normalize(placement_normal(q, nLocal)));
            hit.region_owner = <batch region>;
            hit.uv = uv;
        }
    }
    return found;
}
```

This is byte-for-byte the driven wrapper's body — the placement just comes from a texture per `i`.
The batch is **one region** (`material_of(region)=material`), **thin-like** (surface-only, opaque
v1 — joins the thin set; no `scene_region_at` containment). The occlusion twin `instance_batch_any`
mirrors it for shadow rays.

## 5. Wiring

- **Planner:** `PlannedInstanceBatch { region, materialId, backend: 'mesh'|'analytic', prototype…,
  placements: rigid-pairs[], smooth }`; assigned a region id in the shared space. `ProgramDescription.
  intersection` grows an `instanced` capability (twin of `mesh`).
- **Feature (`intersection.ts`):** emit the prototype (mesh BLAS externs / analytic params), the
  placement extern + `INSTANCE_COUNT_k` define, the `instance_batch_k` loop, the `scene_intersect`
  arm, the batch region in `material_of` + the thin set.
- **App:** for each batch, `packMesh(prototype)` (mesh) once + pack the placement texture; register
  the externs before frame 0 (the `_uploadMeshes` sibling — `_uploadInstances`).

## 6. Verification

- **Twin (the correctness gate):** an instanced batch of K placements ≡ the SAME K prototypes
  authored as individual objects → identical converged image (a witness `instance-twin` ⇄
  `instance-twin-ref`, rmse gate; covers mesh AND analytic prototypes).
- **Builder-adjacent TS test:** the placement-pair CPU lowering matches `buildDrivenPlacement`'s ABI
  for the same transform (shared helper → one truth).
- glslang static-compiles the batch loop (auto via the suite); tsc + vitest between iterations; GPU
  witness sweep owner-gated. Demo: a scattered forest (many cacti / teapots) — the payoff shot.

## 7. Build order (STOP points)

1. **Interface** (this doc §2–§4). — **STOP: owner review.**
2. Extract the rigid-frame lowering into a shared helper (used by driven placement AND instancing).
3. `InstancedObject` IR + Validator (SDF-reject); authoring `instance()` + a `grid`/`scatter` helper.
4. Planner `PlannedInstanceBatch` + `ProgramDescription.intersection.instanced`.
5. Feature: placement extern + `instance_batch_k` (mesh + analytic) + scene_intersect arm + region.
6. App `_uploadInstances`; witnesses (`instance-twin`); tsc + vitest + glslang green; demo forest.
   — **STOP: owner GPU sweep.**

## 8. Decisions (my picks — correct me)

1. **IR:** flat `InstancedObject` + authoring sugar (§2). *Pick: yes — flat-forever consistent.*
2. **v1 = one region / batch, opaque, thin-like** (§4). *Pick: yes — matches "one region ID per
   batch"; per-instance material + dielectric/media instances deferred.*
3. **Always texture-loop, no unroll threshold** (§3) — unrolling IS "author N objects." *Pick: yes.*
4. **mesh + analytic now; SDF later** (owner-decided) — SDF = the domain-rep generalization.
5. **Linear loop now; TLAS later** — reuses `buildBVH` over instance AABBs when scale demands it.

---

## 10. Build record (BUILT — GPU-render-verified)

Built in the §7 order; tsc clean, vitest 1110 green.

- **Shared ABI** — `rigidInverse(Similarity) → {q, ts}` extracted into `components/geometry/similarity.ts`;
  `buildDrivenPlacement` now uses it too (one truth for driven placement + instancing).
- **IR** — `InstancedObject { kind:'instanced'; prototype; placements[]; name? }` in the
  ObjectDescription union; prototype's material = batch material, prototype's transform ignored.
  Type guards `isMeshObject`/`isInstancedObject`/`isPrimitiveObject` replaced the now-ambiguous
  `'kind' in obj`. Validator: SDF-prototype reject, empty/driven-placement reject, prototype geom
  sanity, prototype-transform-ignored warning. Authoring `instance()` + `grid()`/`scatter()`;
  `flattenGroups` composes a parent group transform into each placement.
- **Component** — `components/intersection/instancing/instancing.ts`: `instanceExternNames`,
  `packPlacements` (2 RGBA32F texels/instance, on the mesh rail).
- **Planner** — `PlannedInstanceBatch` (backend + counts/flags; region in the shared space);
  `ProgramDescription.intersection.backends.instanced`.
- **Feature** — `generateInstanceDispatch`: `instance_batch_k` (+ `_any_k`) loops reading the
  placement texture, conjugating via placement ABI, calling `mesh_nearest_bvh` (mesh) or
  `<type>_intersect` with s-scaled params (analytic); one region/batch in the thin set + material_of;
  `scene_intersect` arm. mesh.glsl (the shared `mesh_texel1d`) pulled in for any instancing.
- **App** — `_uploadInstances`: placement texture always + the prototype BLAS for mesh prototypes.
- **Witness** — `instance-twin ⇄ instance-twin-ref` (3 spheres as a batch ≡ 3 objects, rmse gate).
- **Demo** — `forest`: 20 instanced cacti (shared BLAS) + a row of instanced analytic spheres.

**GPU verify:** `forest` renders 20 rotated/size-varied cacti + instanced spheres with correct
shadows on SwiftShader (~23k tris "in scene" for one cactus of memory); both backends through the
one placement loop.

**Next (owner):** `npm run witness` (instance-twin + the mesh/instancing regressions). Deferred:
per-instance materials, driven/`Value<T>` placements, TLAS (buildBVH over instance AABBs — the scale
step), SDF instancing (the domain-repetition generalization).
