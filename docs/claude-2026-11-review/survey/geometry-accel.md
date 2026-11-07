# Geometry, intersection, accel, data rail, core GLSL — survey notes

Read-only survey, Nov 6 2026, branch `claudeapp`. All line numbers are from that tree.
"checked" = I read the code that proves it. "inferred" = reasoning, not verified.

## 1. Two-minute picture

A scene object is a *shape* (registry key `type`) plus a placement (Euclidean similarity
`x -> s R x + t`). Each shape is one folder in `components/geometry/<type>/` holding ONE GLSL
file (its signed field `<type>_sdf`, and when it has a closed form `<type>_intersect` /
`<type>_normal` / `<type>_interval` / `<type>_uv`) plus a TS descriptor of facts (param rows
with geometric `kind`, `similarityClosed`, `thin`, `marchBound`, `stepBudget`, `refine`,
`bounds`, `canonicalize`, `fold`, `validateValues`). The GLSL struct, its constructor, the
march loop, the march refinement and the gradient normal are GENERATED from the descriptor
(`components/geometry/index.ts`). Scene-local fields enter through `defineSDF` (custom.ts),
which writes a descriptor into the same registry at module load.

The intersection feature (`compiler/generate/features/intersection.ts`, 1728 lines — the
biggest file in the area) turns the plan into GLSL: `scene_intersect(Ray, out Hit)`,
`scene_intersect_any(Ray, maxDist)`, `scene_region_at(vec3 p)` (innermost-wins containment by
signed distance), `material_of`, `ior_of`. It emits one arm per object per query. There are
three *geometry classes* (closed-form/marched primitive, triangle mesh, instanced batch) and
three *dispatch regimes* (unrolled per-object arms; instanced batches walked by a TLAS; the
scene "table": typed records in a texture under one scene TLAS, plus a residual unrolled arm
for driven/unbounded objects). Each cell has a nearest, an any-hit and a containment variant.
After the nearest hit, the dispatcher classifies `region_from/region_to` once with one
`scene_region_at` probe along `hit.ng` at `EPS_INTERFACE`.

Placement is handled four ways: constant placements fold into the shape's params when the
shape is `similarityClosed` (sphere, plane, quad, disk); otherwise a residual rigid motion is
applied by a generated mat3 wrapper; driven (`{param}`) placements use the two-vec4 rigid-frame
ABI in `glsl/core/placement.glsl` (`q` = inverse quaternion, `ts` = (−Rᵀt, s)) with params
×s in-shader so t stays a world distance; meshes use ÷s ray conjugation into the unscaled
BLAS frame.

Meshes: triangle soup in shared data textures, binned-SAH BVH (accel/bvh, 2 texels/node),
Möller–Trumbore leaf (mesh.glsl), closed meshes get containment (first-hit-facing + closest
triangle distance). Instancing: one prototype × N placements, per-batch TLAS over world AABBs,
records either "params tier" (folded sphere params, 1 texel) or "frame tier" (q, ts, 2 texels).
CWBVH (8-wide compressed BVH) is a maintained non-default alternative for params-tier batches
(measured 0.85× on WebGL2).

Data rail (`components/data/`): six RGBA32F channels (vertices, normals, uvs, indices,
nodes, records) plus a seventh integer `nodesq` for CWBVH; `planDataLayout` (ledger.ts) is the
one layout truth, called once by the Planner (`placeScene`); bases are baked as GLSL literals;
build-dependent sizes padded to declared bounds (2T−1 nodes) and asserted App-side.

Core GLSL contract (`src/glsl/core/`): `Point`/`Direction` = `#define vec3`; `Ray {origin,
direction, wl}` (no tmin/tmax); `Hit {wl, t, p, frame, ng, region_from/to/owner, uv, element,
eps}`; `ray_spawn` offsets along `ng` by `hit.eps` through `ambient_geodesic`; `fp_uncertainty`
(Wächter–Binder constants) gives analytic/triangle hits an fp-relative eps; marched hits use
`MARCH_CLEARANCE` (0.001). `MAX_DIST = 1000` absolute far clip.

## 2. File map (line counts)

### src/glsl/core (contract)
| file | lines | role |
|---|---|---|
| structs.glsl | 99 | `#define Point vec3`, `Direction vec3` (4–5); Ray, Frame, Hit (24–58), LightQuery, LightSample; UV_PLANAR_SCALE |
| ray.glsl | 32 | make_ray, ray_spawn (29–32) |
| math.glsl | 102 | PI, MAX_DIST (1000), EPS_INTERFACE (0.001), MARCH_CLEARANCE (0.001), SHADOW_BACKOFF (0.002), fp_uncertainty, build_basis (declared Euclidean sampler helper), concentric_disk, schlick/dielectric Fresnel |
| march.glsl | 20 | MAX_MARCH_STEPS 512, MARCH_EPSILON 1e-4, NORMAL_EPSILON 1e-3, MARCH_EPSILON_MAX 5e-4, march_epsilon(t) — included only when something marches |
| placement.glsl | 41 | rigid-frame ABI: placement_qrot/rigid/dir/normal/scale (vec3 throughout) |
| data_texture.glsl | 9 | data_texel1d(uint) → ivec2 at DATA_TEX_WIDTH |
| interaction.glsl | 18 | LOBE_* flags, InteractionSample |
| microfacet.glsl | 54 | (materials) frame maps via ambient_dot |
| structs_media / math_media | 29 / 3 | media |
| shared/*.glsl | ~58 | display, fullscreen vert, noise, views (not geometry) |

### src/components/ambient (the curved-space seam — one occupant)
| file | lines | role |
|---|---|---|
| index.ts | 23 | AMBIENT_SPACES registry {euclidean} |
| euclidean/euclidean.glsl | 33 | ambient_geodesic, ambient_frame, ambient_dot, ambient_parallel_transport (unused — in-progress seam), ambient_direction_to |
| README.md / euclidean.md | 34 / 27 | claims the seam is the "entire preparation" for curved spaces (see finding D-ambient-overclaim) |

### src/components/geometry
| file | lines | role |
|---|---|---|
| index.ts | 518 | PRIMITIVES registry (11 shapes); primitiveIsBounded/primitiveBounds (AABB derived from cross-type marchBound); resolveBackend; resolvePrimitiveValues; emitCtor (×s by kind); emitSdfCall/AnalyticTest/NormalCall/SignedDistance; **emitSdfIntersect** (generated sign-tracked march + optional refine, 232–330); **emitSdfNormal** (4-tap tetrahedral FD, 337–348); derivedFold (kind table); canonicalizePrimitiveParameters; foldPlacementIntoParameters; paramsRecordFloats; classifyPlacement |
| similarity.ts | 261 | Similarity {quat, t, s}; compose/inverse; rigidInverse (the §6.1 ABI); isDrivenTransform; similarityFromTransform; classifySimilarity |
| custom.ts | 155 | defineSDF — scene-local field door; validates, then writes into PRIMITIVES |
| boundCheck.ts | 126 | BOUND_FIELDS (sphere/box/cylinder TS fields), checkConservativeness, checkBoundContainment |
| sphere | 89+26 | analytic (robust Haines quadratic) + sdf + interval + uv; similarityClosed |
| plane | 31+48 | analytic + sdf; unbounded; fold override |
| box | 61+28 | analytic slab + sdf + interval; center row; not closed |
| cylinder | 106+28 | analytic + sdf + interval; center row; Y axis canonical |
| quad / disk | 41+67 / 35+46 | analytic only, thin; quad bakes normal as derived field |
| torus | 29+41 | marched only; bound = cylinder |
| bottle / knob / menger / apollonian | 81+74 / 141+49 / 43+34 / 57+54 | marched only; canonical; knob is vendored; apollonian bound measured |
| README.md | 143 | occupant contract and recipe |

### src/components/intersection
| file | lines | role |
|---|---|---|
| index.ts | 213 | MESH_TRAVERSALS {brute, bvh}; INSTANCE_ACCELS {linear, tlas, cwbvh (inline GLSL walk ~55 lines)}; OBJECT_DISPATCHES {unrolled, table}; MARCHED_TABLE_THRESHOLD 9; ANALYTIC_RECORD_TEXELS 5; LEAF_* codes |
| mesh/mesh.glsl | 321 | mesh_tri_test (MT), fetch, test_range/any_range/side_range, brute, BVH nearest/any, inside (fixed-direction parity), closest distance (Ericson) — four hand-written BVH walks |
| mesh/mesh.ts | 51 | sceneMeshes (ordinal truth), packMesh |
| mesh/topology.ts | 93 | meshClosedness (watertight + winding), meshLocalBox |
| instancing/instancing.ts | 269 | sceneInstanceBatches, placementCount, attribute rows, packInstanceBatch (world AABBs, TLAS, frame/params records, attrs, cwbvh twin) |
| README.md | 47 | stale references (see findings) |

### src/components/accel
| file | lines | role |
|---|---|---|
| bvh/bvh.ts | 486 | binned-SAH flat builder (byte-identical rewrite), BVH_STACK_DEPTH 64, BVH_TFAR_PAD, bvhWalkLines (ray walk emitter), bvhPointWalkLines (containment walk emitter), buildBVH (triangles), transformAABB, bvhNodeBound |
| bvh/bvh.glsl | 61 | bvh_aabb_hit, bvh_aabb_hit_range, bvh_aabb_contains |
| cwbvh/cwbvh.ts / .glsl | 502 / 18 | Ylitie et al. 2017 port; collapse DP, quantized 5×u32 node; popc8, findMSB24 |
| light_tree/light_tree.ts / .glsl | 134 / 77 | energy-weighted SAH light tree; importance function |

### src/components/data
| file | lines | role |
|---|---|---|
| channels.ts | 30 | 6 float channels + nodesq |
| ledger.ts | 199 | DataTenants/DataLayout types, planDataLayout, nodeTexelBound, assertFits |
| pack.ts | 87 | DATA_TEX_WIDTH 4096, alloc/write helpers |

### Neighbors that carry this area's logic
- `compiler/generate/features/intersection.ts` (1728): all GLSL dispatch generation.
- `compiler/plan/dataTenants.ts` (442): scene → tenants adapter; table eligibility; light-tree tenants.
- `compiler/generate/records.ts` (114): row-generated record pack + GLSL reader (one truth).
- `compiler/plan/Planner.ts` placeScene (356+), table marking (397–417).
- `compiler/sceneData.ts` (192) + `app/sceneData.ts` (159): scene-data plan and its executor.

## 3. Data flow

1. Validator checks rows, transforms (s > 0, no reflections), mesh closedness, defineSDF twins.
2. Planner: canonicalize + resolve params once; classifyPlacement folds constant placements;
   driven placements → uniform pairs; decides per object `intersect: 'closed-form'|'march'`,
   `tabled`; `dataTenantsOf(scene, reads)` → `planDataLayout` → slots baked into
   PlannedMesh/PlannedInstanceBatch/PlannedSceneTable.
3. Generator (intersection.ts): includes the present shapes' GLSL + generated structs,
   march blocks for marched types, placement.glsl when needed, data rail + bvh.glsl, mesh
   leaf; emits primitive dispatch (one list), mesh wrappers, instance walks, scene table,
   material_of/ior_of, scene_region_at, scene_intersect(_any).
4. App executes the compiler's scene-data plan: builds BVHs/TLAS/CWBVH, packs channels at the
   baked bases (asserting fits), uploads.

## 4. The arm matrix (the main source of size)

| class \ regime | unrolled | instanced (TLAS/linear/cwbvh) | table (scene TLAS) |
|---|---|---|---|
| closed-form primitive | analyticObjectArm (folded / placed) | instanceLeafItem params-tier / frame-tier | scene_table_leaf analytic records |
| marched primitive | sdfObjectArm (+ interval bound) | instanceLeafItem marched | sdfLeafArm (node box = interval) |
| mesh | generateMeshDispatch wrapper | instanceLeafItem mesh (hard-codes mesh_*_bvh) | LEAF_MESH → same wrapper |

Each cell has nearest + any (mostly via a `bound` parameter; the table leaf writes both out),
and containment lives in a separate generator (generateSceneRegionAt, instanceContainmentItem,
sdf fields, sdf_leaf_field_*, emitMeshPointQuery). primitiveHitFill is the one hit-fill for
primitive arms; mesh hit-fill is written twice (intersection.ts 904–911, 1022–1028).

## 5. Euclidean assumptions (curved-space audit)

What already goes through the seam (checked): `ray_spawn` (ray.glsl, ambient_dot +
ambient_geodesic); every hit's `hit.p = ambient_geodesic(ray.origin, ray.direction, t)` and
`hit.frame = ambient_frame(...)` in generated arms (intersection.ts 707–709, 904–906,
1023–1025); the region probe `scene_region_at(ambient_geodesic(hit.p, hit.ng, ±EPS_INTERFACE))`
and the side test `ambient_dot(ray.direction, hit.ng, hit.p)` (1693–1707); shadow ray aiming
via ambient_direction_to (light.glsl 20–22, media.glsl 59).

What does not (each checked unless marked):

| # | site | assumption | why it blocks S³/H³/H²×R |
|---|---|---|---|
| E1 | glsl/core/structs.glsl:4–5 | `#define Point vec3`, `#define Direction vec3` live in core, not in the ambient occupant | a hyperboloid/4-vector model needs the occupant to define them |
| E2 | geometry/index.ts:234 | generated march samples `ray.origin + t * ray.direction` | marcher never calls ambient_geodesic — in a vec4 model this leaves the manifold |
| E3 | intersection.ts:559, 763–765, 1052–1053, 1062, 1343 | local hit point for normals/uv = `lray.origin + t*lray.direction` | same |
| E4 | intersection.ts:1694; pt.ts:420 | side test and `wo` use the seed `ray.direction` (tangent at the ORIGIN) against `hit.ng` at hit.p | needs the arrival direction (parallel-transported velocity) — reference-implementations §10 lists it as Open |
| E5 | every primitive .glsl (sphere 28–51, plane 14–19, quad 9–22, disk 10–17, box 22–58, cylinder) | closed-form Euclidean roots/normals/intervals; `vec3 p` signatures | one GLSL per primitive, no per-space variant slot in PrimitiveDescriptor |
| E6 | geometry/index.ts:337–348 | 4-tap FD normal `p + k*NORMAL_EPSILON` in coordinates, `normalize` | curved models need frame-based taps and metric-raised gradients (old repo uses `smallShift` along a frame) |
| E7 | similarity.ts (whole), placement.glsl (whole), index.ts:146–157, 356–385 | placement = Euclidean similarity; params scale by `kind` | H³/S³ have isometries only; doc fable-transforms §1 already plans the structure-group seam |
| E8 | bvh.glsl:28–53, bvh.ts transformAABB 474, instancing.ts:139–155, cwbvh walk | AABB slab tests on straight rays; world boxes by 8-corner similarity | straight in the Klein/gnomonic models, NOT in H²×R (see research note R1) |
| E9 | mesh.glsl:41–59, 197–298 | Möller–Trumbore, fixed-direction parity ray, Euclidean point–triangle distance | as E8 |
| E10 | math.glsl:11; intersection.ts:1682; env/directional `distance = MAX_DIST` | absolute far clip 1000, "environment found at MAX_DIST" | S³ geodesics close after 2π; cosh(1000) overflows in H³ |
| E11 | math.glsl:54–56 | fp_uncertainty reads `p.x, p.y, p.z` coordinate magnitudes | vec4 Point ignores w; hyperboloid coords grow like cosh(d) |
| E12 | math.glsl:12, 28; march.glsl | EPS_INTERFACE, MARCH_CLEARANCE, march_epsilon absolute lengths | fine if t is arc length; flag only |
| E13 | boundCheck.ts:24–40; fieldTwins; checkConservativeness | gates use Math.hypot (Euclidean distance) | SDF Lipschitz-1 gate must be w.r.t. the space's metric |
| E14 | opaque.glsl:17, media.glsl:39 | `length(light_p − origin)` | contract already flags; needs ambient_distance |
| E15 | light_tree.glsl:28–77 | Euclidean box distance/cosine importance | variance only, not bias |
| E16 | intersection.ts:404, 1122 | `int scene_region_at(vec3 p)` signature literal | should be Point |
| E17 | sphere_uv/disk_uv/torus_uv, UV_PLANAR_SCALE fill (intersection.ts:679–680) | Euclidean charts | cosmetic per space |

## 6. Research notes (thought-through-not-checked)

R1. Projective models make most of the mesh/BVH machinery reusable. In the Klein (projective)
model of H³ and in a gnomonic chart of S³, geodesics are straight lines and totally geodesic
planes are affine planes, so geodesic triangles are flat triangles: Möller–Trumbore, slab
tests and SAH BVHs work unchanged on chart coordinates; only t is a monotone
reparameterization of arc length (convert with atanh/atan of a chart quantity). S³ needs two
charts (hemispheres) and a ray crosses the projective line at infinity at arc length π/2 —
two segments per π. H²×R is different: a geodesic is (γ(as), bs); in Klein×R coordinates it
lies in a vertical plane but is not a straight line, so the AABB test must become a
space-specific "box interval" (Klein line ∩ footprint → H² arc-length interval → z interval).
This suggests the right seam is `ambient_box_interval(Ray, bmin, bmax)` rather than a
hyperboloid vec4 Point everywhere. The old repo (thurston-rebuild) uses vec4 hyperboloid
`Point`, `Vector {Point pos; vec4 dir}` (tangent vectors carry their base point), `flow(v,t)`
returning point AND direction, `frame(p)`, `reduceError` — all-SDF, no meshes.
R2. `ambient_geodesic` returns only the point; E4 shows the loop also needs the velocity at t.
The old repo's `flow(Vector, t) → Vector` is the shape that answers it.

## 7. Doc–code mismatches found

- ambient/euclidean.md:16–19 and reference-implementations §10 say the march loop and every
  point-along-ray follow without edits; geometry/index.ts:234 and intersection.ts local hit
  points use raw straight lines.
- fable-sdf-contract §5 (177–178) and descriptors.ts `fieldTwin` say the twin is REQUIRED;
  custom.ts:36–42 makes it optional (owner-decided Aug 11).
- descriptors.ts `refine` doc and fable-sdf-contract §4 say 8 bisections; code uses 14
  (index.ts:267–272).
- data/README.md:12–13, ledger.ts:4–5, dataTenants.ts:3–5 say the App calls the ledger/adapter;
  only Planner.placeScene calls planDataLayout (grep of src/app empty).
- intersection/README.md:35 and accel/README.md:30 reference deleted
  `components/data_textures.ts`; intersection README lists only brute|bvh and linear|tlas.
- fable-data-rail §3 "six, forever"; code has a seventh integer channel (documented in
  channels.ts:14–17).
- fable-transforms §5.3 (211–214) and §6 (243–246) describe ÷s local-frame conjugation and
  mat4 `u_object<i>_w2l` uniforms; built form is the §6.1 rigid two-vec4 ABI (only §6.1 says so).
- light_tree.glsl header (7–10) gives the v1.5 cos(θi−θu) formula; body (58–76) implements the
  corner-based v1.5.1 form.

## 8. In-progress scaffolding (not dead)

- `ambient_parallel_transport` (euclidean.glsl:25) — no caller; the curved-space seam.
- AMBIENT_SPACES with one occupant — H³/Schwarzschild door.
- CWBVH — maintained non-default alternative (0.85× measured); keep.
- `data_indices.w` reserved for per-triangle material groups (pack.ts:84); `Hit.element`
  future per-triangle refs — multi-material meshes (CLAUDE.md "Not built").
- `brute` mesh traversal and `linear` instance accel — A/B baselines for estimator-equality witnesses.
- `ObjectDispatchDescriptor` empty interface — registry for membership/default only.
- `<type>_data` orbit-trap outputs, composition operators — fable-sdf-contract §9 deferred.

## 9. Other findings (summary; details in the structured result)

- Duplicated decisions: epsilon couplings restated as separate #defines and pinned by
  epsilonCoupling.test.ts (the "mirror and assert" pattern CLAUDE.md forbids); BOUND_FIELDS
  (boundCheck.ts:24–40) vs tests/components/fieldTwins.ts:19–38 (sphere/box/cylinder twice);
  packParamsRecords re-implements derivedFold for point/length rows and three hand-inlined
  quaternion expansions in instancing.ts (twin-gated, allocation-motivated); five placement
  lowerings (emitPlacementQuery, emitSdfPlacement, emitMeshPlacement, emitMeshPointQuery,
  placementRefs) each re-dispatch classifySimilarity; six copies of BVH node decoding (4 in
  mesh.glsl + bvhWalkLines + bvhPointWalkLines) — bvhPointWalkLines' comment records a past
  drift bug of exactly this kind; mesh hit fill written twice; scene_table_leaf vs _leaf_any.
- Guess: whether a scene-local field authored its own normal is decided by a regex over its
  GLSL (intersection.ts:175–176), not by a declared spec field.
- Silent truncation: BVH/CWBVH stack overflow drops subtrees; builder only console.warns
  (bvh.ts:367–371, cwbvh.ts:364–369).
- Global mutable registry: defineSDF writes into PRIMITIVES at module load (custom.ts:153).
- Extension friction for curved spaces: PrimitiveDescriptor has one `glsl` string — no slot for
  per-space variants of a shape.
