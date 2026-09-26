# fable-object-tables.md — Stage B: data-driven objects + the scene TLAS

**STATUS: BUILT Jul 21 2026 — render-verified (bazaar: table ≡ unrolled to 0.02% @~50spp
on SwiftShader); numeric sweep owner-gated.** Build record §9. All §8 forks at the marked picks,
with ONE strengthening from the approval discussion: forks 4/5 resolve to the HYBRID —
table mode keeps a RESIDUAL UNROLLED ARM for driven-placement objects and unbounded
primitives (beside the SDF arm), not a Validator rejection. Rooms (§2a) motivated it:
plane walls must coexist with a tabled scene.
The batch impl-plan-tlas §4 sketched and rail v2 (fable-data-rail) pre-homed: object
parameters move into `data_records`, one SCENE TLAS over all placed things lands in
`data_nodes`, and PBRT's "the aggregate is a primitive" arrives in full form.

**Goal:** make DISTINCT-object count cheap in both currencies at once — **load time**
(today 500 unique objects = 500 unrolled GLSL blocks = a giant shader that compiles
slowly) and **frame time** (the linear `analytic_intersect` if-chain + linear mesh
wrappers = O(objects) per ray) — while keeping the unrolled regime for small scenes,
where baked constants, named symbols, and readable dumps are genuine research virtues.

---

## 1. The two regimes, made explicit

Unrolling is not a mistake to be retired — it is the RESEARCH regime: constants folded,
`shape_ball` consts named after your scene, dumps that read like the math. The table is
the SCALE regime. Both stay; the choice is an **estimator axis** (bias-free by contract —
identical converged image, the meshTraversal/instanceAccel precedent):

```
estimator.objectDispatch: 'unrolled' | 'table'     (default 'unrolled' — zero churn)
```

Registry-shaped (`OBJECT_DISPATCHES` beside the traversal registries), Validator-
gatekept, equality-witnessed. `'table'` IMPLIES the scene TLAS — a table without the
tree would fix load time while leaving frame time linear; one axis, not two.

## 2. What becomes a TLAS leaf (scope: the three ray backends)

The scene TLAS is a BVH over the world AABBs of every PLACED thing, `data_nodes`-
resident, walked by the world ray exactly like a batch TLAS. Leaves are typed OBJECT
RECORDS in `data_records`:

| Leaf kind | Record contents | Leaf action |
|---|---|---|
| analytic | kind tag, region id, canonical params (s-folded) | `<type>_intersect` on a struct READ from the record |
| mesh | region id, geometry slot (v/t/nbase), placement (q_inv, t_rigid, s), smooth flag | conjugate → the existing BLAS walk |
| instance batch | region id, batch slot (placements/tlas bases), prototype record | descend into the existing BATCH walk |

- **SDF objects stay a separate arm** (the marcher; boxed-SDF leaves remain Stage C —
  marching inside a box interval is its own design). A table program = TLAS walk +
  `sdf_intersect` arm + the RESIDUAL unrolled arm (driven/unbounded objects — §5),
  combined by the same `hit.t` protocol as today.

### 2a. Rooms and the tree (the enclosure question, owner-raised)

Walls-as-quads are THIN SLABS — near-ideal BVH citizens (the SAH separates them; rays
only test walls they approach). A closed MESH room's box spans the scene, so every ray
pays its ONE leaf box test, then the room's own BLAS narrows to the face ahead —
enclosures are inherently unprunable at the top and cost exactly what they cost in the
linear chain. Plane walls have no box at all: they live in the residual arm, one honest
test per ray. Rooms are fine; the interior still log-prunes.
- **Instance batches as leaves** close the §2 circle: "distinct vs instanced" dissolves —
  the scene TLAS prunes whole batches by their root boxes before their own TLAS runs.
- Bounds come from the machinery A1 built: `primitiveBounds` (analytic — this makes
  `bounds()` REQUIRED for table-mode analytic objects, same rule as instance prototypes),
  the BLAS root (mesh), the batch TLAS root (instances).

## 3. Records by descriptor — the door stays one-folder-wide

Each primitive descriptor gains a RECORD pair (the recipe extension):

- `recordPack(values) → Float32Array` — canonical params → texels (CPU, App-side pack);
- a GLSL reader in the occupant file — `Sphere sphere_from_record(sampler2D rec, uint base)`
  — the struct's fields fetched in row order.

Row order is already the ONE truth for struct/ctor/validation (A1); the record layout
derives from the same rows, so pack and reader cannot drift (a contract test pins
row-count ↔ texel-count per kind). **A new primitive = the same folder + registry line,
plus its record pair** — the door's width is unchanged.

The generated leaf dispatch is a `switch` over the kind tag calling the readers — the
ONLY per-kind codegen in table mode, emitted once per program (not per object).

## 4. Containment and tables — one truth, no forked params

`scene_region_at` (innermost-wins) currently reads BAKED params per solid object. Table
mode must NOT fork the truth (baked containment + recorded intersection would drift):
solid table-objects' containment also reads the record — the descriptors' existing
`<type>_sdf` bodies called on record-read structs, in a generated loop over the solid
object records. Closed meshes already read channels (containment queries take bases) —
their bases simply come from the record. The dispatcher's §4.2 classification, thin set,
`material_of`, `ior_of` are UNCHANGED — region ids ride the records, the tables stay
region-keyed. (Cost note: region classification stays O(solids) — a containment BVH is
NOT this batch; probes are per-vertex, not per-node.)

## 5. Pins (v1 exclusions, each declared)

- **Driven placements stay in the RESIDUAL unrolled arm** (owner-resolved at approval:
  the hybrid, not a rejection). A `{param}`-driven object's params/box change live —
  a static record/tree cannot hold it; the residual arm runs it exactly as today.
  Driven MESHES join the residual for the same reason (their world box moves).
- **Samplable emitters keep their light-side baking** — the lights registry, samplers,
  and power CDF are untouched (few lights; independent of intersect dispatch). Emissive
  table-objects still glow path-found through the unchanged region tables.
- **SDF objects**: outside the table (the separate arm), Stage C's business.
- **Unbounded primitives (plane) live in the residual arm** under table mode (owner-
  resolved: "out of the TABLE", not out of the scene) — a plane is hittable from
  everywhere, so a per-ray test is its honest cost in any renderer.
- Per-object named symbols (`shape_<name>` consts, `sdf_<name>`) are an UNROLLED-regime
  feature; tabled objects trade them for scale (names survive as provenance; residual
  objects keep theirs).

## 6. What it buys, concretely

- A 500-unique-object scene: ONE leaf dispatch + records ≈ the same shader size as a
  5-object scene (load time collapses); frame cost ~log N (the spheres-demo TLAS win,
  now for distinct objects).
- The Stage C and multi-material futures inherit the leaf-record idiom; the light BVH
  inherits the "typed records + tree" pattern wholesale.

## 7. Verification

- **Estimator-swap equality** (THE gate): existing scenes under `'unrolled'` ≡ `'table'`
  — near-exact (identical stream, identical candidate sets; the bvh≡brute discipline).
  Registry: equality arms on analytic-minimal-class scenes + a new `bazaar` witness/demo
  (many UNIQUE objects: mixed spheres/quads/disks/meshes, the load-time payoff shot),
  gated twin vs its unrolled arm.
- Record contract tests: per-kind pack↔reader texel-count pins; ledger regions disjoint.
- Perf record (not a gate): compile time + ms/frame on `bazaar`, both modes.
- tsc + vitest + glslang per batch; the owner's sweep at the end.

## 8. Decision forks (owner)

1. **The axis** — `estimator.objectDispatch: 'unrolled' | 'table'`, default `'unrolled'`,
   table implies the scene TLAS (my pick) — vs an automatic size threshold (silent
   regime flips; rejected) or table-always (kills the research regime; rejected).
2. **Leaf scope v1** — analytic + mesh + instance-batch roots, SDF arm separate (my
   pick) — vs analytic-only (leaves mesh scenes linear; less value for the same seams).
3. **Containment reads records too** (§4 — one truth; my pick) vs baked containment
   under table mode (param fork; rejected on principle).
4. **Driven placement Validator-rejected under 'table'** in v1 (my pick) vs the hybrid
   driven-stays-unrolled (more machinery now; the natural v2).
5. **`bounds()` required for table-mode analytic objects** (the A1 rule generalized; my
   pick — plane et al. stay unrolled-only until someone needs them in a table).

---

## 9. Build record (BUILT Jul 21 2026 — 1231 vitest green)

- **Axis**: `estimator.objectDispatch` (registry `OBJECT_DISPATCHES`, default 'unrolled',
  Validator-gatekept); `ProgramDescription.intersection.objectDispatch`. The only
  suite-wide churn: 161 program-description snapshots gained the one field (audited).
- **Ledger/adapter**: `DataTenants.sceneTable` + `SceneTableSlot` (leafList + analytic
  records in `records`, the scene TLAS in `nodes`, 2(2L−1)-padded); the adapter's
  `SceneTable` = THE truth (eligibility, SOLIDS-FIRST record order, registry-order kind
  codes, canonical leaf order) read by the Planner and by the compiler's scene-data plan
  (compiler/sceneData.ts), which the App executes. Built only when some renderer on the
  scene reads it (a 'table' program — `DataReads.sceneTable`).
- **Records — a §3 strengthening**: BOTH sides generated from the descriptor ROWS
  (`compiler/generate/records.ts`: `recordPack` + `generateRecordReader`) — zero
  per-descriptor record code; stride overflow is a loud generator error. Wire format:
  header texel (primKindCode, regionId) + dense row/derived floats.
- **Codegen**: `generateSceneTable` (readers + typed leaf dispatch + nearest/any walks);
  mesh/batch leaves dispatch into the SAME generated wrappers the unrolled arms use
  (`mesh_<id>` / `instance_<id>` — one math, two addressings); residual splits
  (analytic dispatch over non-tabled, mesh aggregator over driven meshes, batch
  aggregator dropped under table); `scene_region_at` excludes tabled solids from baked
  arms and appends the O(1)-code record LOOP over [0, solidCount) (§4's one truth).
- **App**: analytic records folded via the SAME canonicalize+fold chain the Planner
  bakes (bake ≡ ship); leaf boxes from primitiveBounds / BLAS roots / batch-TLAS roots;
  leaf list written in TLAS-leaf order.
- **Verification**: emitted-GLSL snapshots for the default regime BYTE-IDENTICAL (43/43
  untouched); glslang across both regimes; the `bazaar` witness (~35 unique objects +
  plane floor and driven sphere in the residual arm + a mesh + a batch) equality-gated
  table ≡ unrolled (identical-stream, rmse 0.01) — SwiftShader renders agree to 0.02%;
  budget pinned ≤ 13 samplers under table. Owner's sweep pending; perf A/B (compile
  time + ms/frame) readable live on the bazaar card, keys 1/2.
