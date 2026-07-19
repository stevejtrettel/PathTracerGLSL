# impl-plan-meshes.md — the triangle-mesh geometry backend (BVH)

**STATUS: v0 BUILT — GPU-UNSWEPT (owner review + GPU witness sweep pending).** The naive slice
(§ SCOPE) is implemented and passes tsc + the full vitest suite (1078) incl. glslang static
compile of the mesh shaders (flat / smooth+uv / driven). The GPU witness sweep is owner-gated
and NOT yet run — `mesh-furnace` (mean 0.4) and `mesh-quad-twin ⇄ mesh-quad-ref` are registered
and await the owner's `npm run witness`. Build record at the bottom (§12). The pre-build DRAFT
plan follows unchanged for the record.

**Goal:** add the third geometry class — OBJ triangle meshes — behind the existing
`scene_intersect` dispatcher, without disturbing the SDF marcher, the analytic backend, or the
region/media contract.

**SCOPE (owner-set, this batch) — the naive first slice, BVH-ready:**
- **Thin surfaces** — no interior containment (§3).
- **Single material per mesh** — one region id.
- **Ray-into-local** transforms — no vertex baking, driven-capable.
- **NO BVH to start** — `mesh_intersect` is a brute-force linear scan over the triangle soup,
  but the **infra is BVH-ready**: triangle data already lives in data textures, and the traversal
  seam is shaped so adding a BVH later is a drop-in (wrap the triangle loop in a node walk, add two
  node textures). The brute-force body *is* three-mesh-bvh's leaf function (`intersectTriangles`
  over the whole `[0, triCount)` range) — the BVH upgrade only changes *which* range(s) it scans.

This resolves forks #1, #3, #4 and adds the v0/v1 split (§11).

---

## 1. What already exists (the doors were left open)

The mesh backend is the single most anticipated axis in the codebase. The seams are already cut:

- **The IR stub.** `MeshObject { kind: 'mesh'; data: Float32Array; material; transform?; name? }`
  is already in the `ObjectDescription` union ([compiler/types.ts:109](src/compiler/types.ts#L109)).
  It is currently *hard-rejected* — [Validator.ts:46](src/compiler/analyze/Validator.ts#L46)
  errors `'Mesh objects not yet supported'`; [Analyzer.ts:62](src/compiler/analyze/Analyzer.ts#L62)
  already computes `hasMeshes`.
- **The intersection registry is held for exactly this.**
  [intersection/README.md:20](src/components/intersection/README.md) — *"The future mesh backend's
  BVH traversal is this family's next occupant."* Today the family has one occupant, `raymarch/`
  (the SDF engine); the analytic backend needs no engine (generated closed-form dispatch).
- **The trace-loop contract names the capability.**
  [trace-loop-contract.md:112](docs/trace-loop-contract.md#L112) reserves *"Capability geometry
  (mesh/BVH `ray?`, `instances?`) and the `inout Ray` multi-backend coordination"* as deferred —
  `scene_intersect` already "subsumes SDF marching, analytic intersection, and (future) mesh/BVH
  as geometry capabilities … taking the nearest hit and coordinating via `tmax`" (line 27).
  The `inout Hit`, `hit.t`-as-running-nearest protocol is exactly what a third backend plugs into.
- **The data-texture upload rail is built and generic.** The `extern:` chain
  (FeatureContribution `textures: PlannedTexture[]` → merge → PipelineBuilder → ShaderBuilder emits
  `uniform sampler2D` → `RenderExecutor` binds via `TextureRegistry`) already carries the env map,
  its CDFs, and blue-noise. **`blue_noise` is the exact template** we copy: a scene/data-driven,
  app-registered, non-framebuffer data texture bound purely through `extern:`
  ([engine/loaders/blueNoise.ts](src/engine/loaders/blueNoise.ts)). No change to the locked
  compiler↔engine contract is required — `RenderPass.inputs.textures: Record<string,string>`
  is already generic enough.
- **The region model already handles "surfaces that don't enclose."** Quads/disks are `thin`
  (never claim containment in `scene_region_at`); the dispatcher's §4.2 classification already
  has the thin branch. Meshes reuse this (see §3).

So this is *populating* anticipated seams, not carving new ones.

---

## 2. The reference implementation (transcribe, don't re-derive)

The mature, battle-tested WebGL2 approach is **three-mesh-bvh / three-gpu-pathtracer**
(gkjohnson). We transcribe its data layout and traversal, adapting symbols to our contract
(the same discipline as `fable-reference-implementations.md`). Concretely, from
`three-mesh-bvh/src/webgl/glsl/bvh_ray_functions.glsl.js`:

- **Node bounds texture** `bvhBounds` (float, NEAREST): **2 texels per node** — texel `2i` =
  `boundsMin.xyz`, texel `2i+1` = `boundsMax.xyz`.
- **Node contents texture** `bvhContents` (**u**int, NEAREST): **1 uvec2 texel per node**.
  `x` high 16 bits = isLeaf flag; leaf ⇒ `x & 0xffff` = triangle count, `y` = triangle offset;
  internal ⇒ `x & 0xffff` = split axis, left child = `node+1` (implicit), `y` = right-child
  relative offset.
- **Vertex attribute textures** `position` (float, `texelFetch1D` by vertex index); `index`
  (uint, `uvec3` per triangle).
- **Traversal is stack-based** (not stackless): a fixed `stack[BVH_STACK_DEPTH]`, front-to-back
  child ordering by `rayDirection[splitAxis]` sign, prune when `boundsHitDistance > triangleDistance`.
  Möller–Trumbore triangle test (`intersectsTriangle`), returning barycentric coords + geometric
  normal + `side`.

`BVH_STACK_DEPTH` is a numeric `#define` (like `MAX_MARCH_STEPS`), so it stays a define under the
"no structural defines" rule — it's a knob, not a gate.

Sources: [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) ·
[three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer) ·
[saaaji/WebGL-2-Path-Tracer](https://github.com/saaaji/WebGL-2-Path-Tracer) (flattened DFS BVH,
2 RGBA32F texels/node) · [Ray Tracey GPU BVH tutorial](http://raytracey.blogspot.com/2016/01/gpu-path-tracing-tutorial-3-take-your.html).

---

## 3. THE central design tension: regions & containment

This is the crux and deserves the most care, because the whole renderer is region-based:
`scene_region_at(p)` classifies every point by *innermost-wins over signed distances*; the
dispatcher classifies `region_from`/`region_to` via an outward-normal probe into `scene_region_at`;
media, dielectrics (ior_of), and emission all key off regions. **SDF and analytic primitives both
supply a signed distance for containment. A triangle mesh does not** (no cheap SDF; the honest
inside-test is a BVH-accelerated generalized winding number or a ray-parity cast).

### The decision: v1 meshes are `thin`-like surfaces — no interior containment.

A mesh owns a region and is intersected, but is **excluded from `scene_region_at`** — exactly the
`thin` treatment quads already receive. This is not a hack; it is the honest statement "we model the
mesh's *surface*, not its *interior volume*," and the existing machinery already supports it. Crucially,
this is **fully correct** for the cases that matter first, because of how the dispatcher classifies:

- **Shading** keys on `region_owner` → `material_of(region_owner)` shades. ✓ Always correct.
- **Emission** keys on `region_to`, and on a **front-face hit the dispatcher sets
  `region_to = region_owner` regardless of `thin`** ([intersection.ts:548-551](src/compiler/generate/features/intersection.ts#L548-L551)).
  So **emissive meshes emit correctly** (path-found, one-sided — identical to one-sided quads). ✓
- The `thin` fact only changes the **back-face `region_from`** branch (probe the entering side
  instead of fabricating `owner`). Meshes get added to the generated `scene_region_thin` set.

**What v1 gives up (declared truncations, in the spirit of `measurement.shadows: 'opaque-dielectrics'`):**

- **Dielectric/glass meshes** — the exit hit misclassifies `region_from` (mesh not in
  `scene_region_at`, so the probe returns ambient, not the glass interior). Needs real containment.
- **Interior media inside a mesh** — same reason; a fog-filled bunny needs containment.
- **NEE-sampling of mesh emitters** (`samplableAsLight`) — triangle-area-CDF sampling of a mesh
  light is a separate feature (see §10). v1 emissive meshes are **path-found only**, exactly like
  emissive media/materials are today.

These are honest limits, not silent wrong answers, and each has a clear v2 path (§10). This keeps
the hard part (containment) out of v1 while delivering opaque + emissive meshes — which covers the
"complex multi-material objects" priority for the common case.

---

## 4. Architecture — where each piece lives (layering: Authoring → App → Engine → Compiler → Components)

| Concern | Home | Notes |
|---|---|---|
| OBJ parsing → mesh data | **Authoring** `src/authoring/loadOBJ.ts` | fetch + parse `.obj` (+`.mtl` later) → an enriched `MeshObject`. The compiler never parses OBJ. |
| BVH build (SAH/median) + texture packing | **Components** `src/components/intersection/bvh/bvh.ts` | pure TS ("precompute the HOW"); importable by the App. Produces `{ bounds:Float32Array, contents:Uint32Array, position:Float32Array, index:Uint32Array, normals?, uvs?, texDims }`. |
| BVH traversal GLSL | **Components** `src/components/intersection/bvh/bvh.glsl` | the transcribed `mesh_intersect` / `mesh_intersect_any` + attribute fetch; the intersection family's second occupant. |
| Mesh dispatch codegen + dispatcher integration | **Compiler** `features/intersection.ts` | extends the existing SDF+analytic composition (it already owns `scene_intersect`, the thin set, region tables). |
| Mesh resolution → `PlannedMesh` + extern/uniform declarations | **Compiler** `plan/Planner.ts` | assigns region id (scene order, shared space), material, transform; declares the externs + texture-dim uniforms. |
| Program capability flag | **Compiler** `plan/types.ts` `ProgramDescription.intersection` | `mesh: boolean` (twin of the existing hasSDF/hasAnalytic capability). |
| Data-texture factories (RGBA32F, uint) + generic register | **Engine** `TextureFactory.ts`, `Engine.registerDataTexture` | RGBA32F + `usampler2D`/RG32UI upload helpers; a generic name→data upload (env-shaped API generalized). |
| Upload orchestration (build BVH, upload textures, set dim params) | **App** `App.initialize` | mirrors the env-map load path — before the first frame. App imports the shared builder from Components. |

**Why the App builds the BVH (not the compiler):** it mirrors the env map exactly. The env feature
declares `extern:env_map` + `env.size` params; the *App* fetches/uploads and sets the dims. Same here:
the compiler declares `extern:mesh_N_*` + `mesh.N.*TexWidth` uniforms; the App builds the BVH once from
the scene's mesh data, uploads the textures, and sets the width uniforms. This keeps the compiler pure
(no multi-MB `Float32Array` traveling inside `CompiledRenderer`) and the locked contract untouched.

---

## 5. The mesh engine: build, layout, traversal

The occupant folder is the intersection family's mesh engine. Suggested name `intersection/mesh/`
(honest at v0 — a linear scan is not a BVH; the README's forward-reference calls it `bvh/`, which is
the destination not the v0 reality — small naming fork, §11.7). One GLSL file, wholesale-included
(§2.12); one TS builder.

### 5.1 v0 build (CPU/TS, `intersection/mesh/mesh.ts`) — no BVH

- Input: triangle soup (positions + indices, optional per-vertex normals/UVs).
- Output: pack the attribute typed arrays + their 2D texture dimensions (pick a width, height =
  ceil(count/width); pass width as a uniform for the index→texel math). **No node array yet.**
- This is deliberately trivial — the point of v0 is to stand up the full *rail* (build → upload →
  extern → texelFetch → dispatch) end-to-end with the cheapest possible traversal.

### 5.2 Texture layout

**v0 textures (brute force):**

| Texture | Format | Factory needed | Contents |
|---|---|---|---|
| `mesh_N_position` | RGBA32F | **new `createRGBA32F`** | 1 texel/vertex (xyz) |
| `mesh_N_index` | RGB32UI (usampler2D) | **new uint helper** | 1 texel/triangle (uvec3 vertex indices) |
| `mesh_N_normal` (opt.) | RGBA32F | createRGBA32F | per-vertex normals for smooth shading |
| `mesh_N_uv` (opt.) | RG32F | (RG variant) | per-vertex UVs — **the first real `Hit.uv` chart** |

**BVH upgrade adds two more (v1) — nothing above changes:**

| Texture | Format | Contents |
|---|---|---|
| `mesh_N_bounds` | RGBA32F (xyz used) | 2 texels/node (AABB min, max) |
| `mesh_N_contents` | RG32UI (usampler2D) | 1 texel/node (leaf-flag/count/axis, offset/right-child) |

The v1 builder gains a **binned-SAH** pass (median as a fallback knob) emitting the flattened
depth-first node array with the three-mesh-bvh contents packing (§2). Gaps confirmed by the engine
audit: `TextureFactory` has only `createR32F`/`createRGB32F`; we add `createRGBA32F` and uint
(`usampler2D`) variants (trivial mirrors). No SSBO/UBO exists — everything is
`sampler2D`/`usampler2D` + `texelFetch`, which is correct and what we want.

### 5.3 Traversal GLSL — one occupant file, BVH-ready seam

```glsl
// mesh_intersect(Ray ray, inout Hit hit) — nearest-hit, bounded by hit.t (the running nearest).
//   Fills hit GEOMETRY + owner on a closer triangle; region_from/to classified by the dispatcher (§4.2).
// mesh_intersect_any(Ray ray, float maxDist) — any-hit occlusion for NEE.
//
// v0 body:  intersect_triangles(0u, triCount, ...)         // brute-force linear scan
// v1 body:  stack walk over nodes → intersect_triangles(leaf.offset, leaf.count, ...)
// The leaf function intersect_triangles(offset,count,...) is IDENTICAL in both — the BVH only
// changes which ranges call it. That shared leaf IS the BVH-ready seam.
```

Transcribed from §2, with our vocabulary: `hit.t` is the bound (not a local `triangleDistance`);
`ambient_geodesic`/`ambient_frame` build `hit.p`/`hit.frame` (cross-backend agreement, like the
analytic arm); `hit.uv` from barycentric-interpolated vertex UVs (or the placeholder chart if the
mesh carries none); `region_owner` from the mesh's region id. Per-mesh externs are threaded as
function parameters (the three-mesh-bvh macro trick) so multiple meshes reuse one traversal body.

---

## 6. Trace-loop integration (the interface, per contract)

1. **Dispatcher** ([intersection.ts:540](src/compiler/generate/features/intersection.ts#L540)) gains a
   third arm, in the same `inout Hit`/`hit.t` protocol:
   ```glsl
   if (analytic_intersect(ray, hit)) found = true;
   if (sdf_intersect(ray, hit))      found = true;
   if (mesh_intersect(ray, hit))     found = true;   // NEW — bounded by hit.t, only closer wins
   ```
   The §4.2 classification step is unchanged; mesh region ids join `scene_region_thin`.
2. **Occlusion**: `scene_intersect_any` gains `if (mesh_intersect_any(ray, maxDist)) return true;`
   (gated by the existing `anyQuery` seam decision).
3. **Transforms**: v1 supports **driven/constant placement by ray-into-local** — the BVH lives in the
   mesh's local frame and the intersect arm conjugates the ray into it (exactly the driven-analytic
   pattern, [intersection.ts:346](src/compiler/generate/features/intersection.ts#L346)). This is
   *simpler and better* than baking (no BVH rebuild when a slider moves the mesh → "sliders move
   objects zero-recompile" holds), and normals map back by `placement_normal`. Constant placement can
   still fold, but ray-into-local is the natural default for meshes.
4. **Region tables**: `material_of` / `scene_region_at` already span backends and pick up the mesh
   region rows for free (mesh excluded from `scene_region_at` per §3).
5. **`Hit.uv` becomes real** for meshes — the first genuine per-primitive chart (the `checker`
   material is the first reader; today's `UV_PLANAR_SCALE` is a placeholder). Non-mesh hits keep the
   planar placeholder until per-primitive charts land.

---

## 7. Data flow (compile-time → runtime)

```
authoring: loadOBJ(url) ──► MeshObject{positions,indices,normals?,uvs?,material,transform?}
                                   │  (in SceneDescription.objects)
compiler (Planner):  MeshObject ──► PlannedMesh{region id, materialId, texDims, placement}
                     features/intersection.ts declares:
                        textures: extern:mesh_N_bounds, _contents, _position, _index, (_normal,_uv)
                        uniforms: mesh.N.boundsTexW, contentsTexW, positionTexW, indexTexW
                     emits: bvh.glsl (wholesale) + generated mesh_intersect dispatch arm
app (initialize, before frame 0):
   for each mesh: build BVH (components/intersection/bvh) → typed arrays
                  Engine.registerDataTexture('mesh_N_bounds', ...) etc.  (TextureRegistry)
                  set mesh.N.*TexW parameters
engine (per frame): RenderExecutor binds extern:mesh_N_* to units; GLSL texelFetches.
```

Mirrors the procedural-env bake / HDR-env load orchestration in `App.initialize`
([App.ts:145-193](src/app/App.ts#L145-L193)).

---

## 8. Scope

**v0 (THIS batch — naive, BVH-ready):**
- Opaque + emissive single-material triangle meshes, arbitrary count.
- **Brute-force linear triangle scan** (no BVH) — but full data-texture rail in place.
- Geometric + optional smooth (vertex-interpolated) normals; real barycentric UVs.
- Occlusion (`mesh_intersect_any`) → NEE shadow rays work.
- Constant + driven placement by ray-into-local (zero-recompile slider moves).
- OBJ loader in authoring; `MeshObject` un-rejected and planned.

**v1 (next — the drop-in accel):**
- Binned-SAH BVH: two more textures (`bounds`, `contents`) + the node walk around the shared leaf
  function. Nothing in v0 changes.

**Deferred (v2+, each a declared truncation, not a silent gap):**
- **Multi-material meshes** — THE priority follow-up. Small extension: triangles carry a
  material-group id; the mesh spans several region ids; `mesh_intersect` sets `region_owner` from the
  triangle's stored group. Design the triangle/leaf record to carry a group slot from day one so this
  is additive, not a rework.
- **Dielectric / interior-medium meshes** — needs real containment (BVH-accelerated generalized
  winding number feeding `scene_region_at`). This is the honest v2 for the region crux.
- **Mesh area lights (NEE `samplableAsLight`)** — triangle-area CDF + sampling.
- **Instancing / TLAS** — one BLAS, many instances (the contract's `instances?` capability).
- **.mtl material import**, tangent frames from UVs (anisotropy/normal maps).

---

## 9. Verification (witness discipline)

The cross-backend twin discipline is the sharpest gate and applies perfectly to meshes:

- **`mesh-quad-twin`** — two triangles forming a quad ≡ the analytic `quad` witness (same numbers).
- **`mesh-box-twin`** — 12 triangles forming a cube ≡ the SDF `box` twin.
- **`mesh-furnace`** — an icosphere in the furnace env → **0.4 exactly** (the mesh must not leak or
  absorb energy; the classic furnace gate applied to the new backend).
- **`mesh-emissive`** — an emissive mesh, pt vs pt (region_to=owner emission path-found), display-RMSE
  tripwire (chance-hit arm — NEE-sampling deferred, so no equality arm yet).
- Cheap gates between iterations: `npx tsc --noEmit` + `npx vitest run` (glslang static-compiles the
  new traversal for every registry pair, incl. the kitchen-sink scene). The GPU `npm run witness`
  sweep is **owner-gated** — run once per batch when the owner calls it.

---

## 10. Suggested build order (STOP points for discussion)

**v0 (this batch):**
1. **Interface + region decision** (this doc, §3–§6). — **STOP: owner review.**
2. Un-reject `MeshObject`; enrich the IR (positions/indices/normals/uvs); OBJ loader in authoring.
3. Engine: `createRGBA32F` + uint texture helpers; `Engine.registerDataTexture`.
4. Components: `intersection/mesh/mesh.ts` v0 packer; `mesh.glsl` brute-force traversal (the shared
   `intersect_triangles` leaf + `mesh_intersect`/`mesh_intersect_any`).
5. Compiler: Planner `PlannedMesh` + externs/uniforms; `features/intersection.ts` dispatch arm +
   thin-set + `ProgramDescription.intersection.mesh`.
6. App: build + upload + dim params in `initialize`.
7. Witnesses (§9); tsc+vitest green. — **STOP: owner calls the GPU sweep.**

**v1 (next batch — do NOT mix with v0):** add the SAH build + `bounds`/`contents` textures + the
node walk around the shared leaf. Witness: unchanged images, faster.

Do not mix this with unrelated refactors (batch discipline).

---

## 11. Decisions

**Resolved by the owner (this batch):**
1. **Region model** — meshes are `thin`-like/surface-only; dielectric+interior-media meshes deferred
   to winding-number containment (§3). ✓
3. **Single material per mesh** — one region id. Multi-material is the v2+ priority follow-up;
   design the (future) leaf record to carry a material-group slot so it's additive. ✓
4. **Transform** — ray-into-local (driven-capable, no vertex baking/rebuild). ✓
   *(no-BVH-first)* — brute-force linear scan in v0, BVH-ready infra (§5, §8). ✓

**All resolved (owner, this batch):**
2. **Intersection registry shape — REFACTOR.** Replace the fake `method: 'raymarch'` singleton with
   a symmetric backend-capability set `IntersectionDesc { backends: { sdf, analytic, mesh }; anyQuery;
   drivenPlacement }`. Done as an ISOLATED, byte-identical step 0 (mesh:false everywhere; snapshots
   unchanged prove it), THEN mesh built on the clean shape. This is the decision-hoist principle
   (backend presence is a link-map decision, answered once). ✓
6. **`MeshObject` enriched** to `{ kind:'mesh'; positions; indices; normals?; uvs?; material; transform?;
   name? }` — built from incoming data (OBJ). The flat `data: Float32Array` blob is dropped. ✓
7. **Occupant name `intersection/mesh/`.** ✓

---

## 12. Build record (v0 — GPU-unswept)

Built in one batch, in the §10 order. tsc clean; full vitest 1078 green (glsl-compile now
statically compiles the mesh shaders). GPU sweep owner-gated — NOT run.

- **Step 0 (isolated refactor):** `IntersectionDesc.method` → `backends: { sdf, analytic, mesh }`
  ([plan/types.ts](../src/compiler/plan/types.ts), [Planner.ts](../src/compiler/plan/Planner.ts),
  [intersection.ts](../src/compiler/generate/features/intersection.ts)). Byte-identical — only the
  program-description structural snapshot re-golden; every emitted-GLSL snapshot unchanged.
- **IR:** `MeshObject` enriched to `{ positions, indices, normals?, uvs? }`
  ([compiler/types.ts](../src/compiler/types.ts)); the flat `data` blob dropped.
- **Component:** [components/intersection/mesh/](../src/components/intersection/mesh/) — `mesh.glsl`
  (Möller–Trumbore leaf `mesh_nearest_local`/`mesh_any_local`, t-preserving), `mesh.ts` (packer +
  `MESH_TEX_WIDTH` + `meshExternNames`), `mesh.md`. All four data textures RGBA32F (index as exact
  float → no usampler2D, no ShaderBuilder change).
- **Compiler:** `PlannedMesh` + Planner resolution (region id, ray-into-local placement, baked
  triCount); `features/intersection.ts` emits the externs + per-mesh wrappers + the `mesh_intersect`
  arm in the dispatcher + mesh regions in the thin set + `material_of`.
- **Engine:** `TextureFactory.createRGBA32F` (NEAREST/CLAMP) + `Engine.registerDataTexture`.
- **Authoring:** [authoring/loadOBJ.ts](../src/authoring/loadOBJ.ts) — `parseOBJ`/`loadOBJ`
  (corner dedup, fan-triangulation, negative indices; 6 unit tests).
- **App:** `_uploadMeshes` in `initialize` packs + registers each mesh's externs before frame 0.
- **Witnesses:** `mesh-furnace` (mean 0.4), `mesh-quad-twin ⇄ mesh-quad-ref` (cross-backend twin,
  rmse gate) — [meshWitness.ts](../tests/witnesses/scenes/meshWitness.ts); box winding verified by
  a scratch geometry check. Registered in the witness suite (viewable in the gallery via the merge).

**Next (owner):** run `npm run witness -- mesh-furnace mesh-quad-twin` (the GPU gate). Then v1: the
SAH BVH (§8) — two textures + a node walk around the shared leaf; nothing in v0 changes.
