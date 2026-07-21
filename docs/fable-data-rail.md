# fable-data-rail.md — the data-driven scene substrate (rail v2)

**STATUS: BUILT Jul 20 2026 (all §9 forks owner-approved at the marked picks) —
render-verified on SwiftShader; the owner's 16-unit-GPU render of `cacti` is the
remaining acceptance check.** Build record §10.
Supersedes the ad-hoc per-object extern model (per-mesh/per-batch/per-light textures) and
absorbs `components/data_textures.ts`. Commissioned after MAX_TEXTURE_IMAGE_UNITS(16)
rejected a 4-mesh scene (Jul 20 2026) — the symptom; the subject is the substrate.

**Goal:** ONE clean, modular substrate for every system that consumes scene-scale array
data on the GPU — meshes, BVHs, instancing, per-instance attributes, mesh lights today;
Stage B object tables, the light BVH, majorant grids, per-triangle material groups
tomorrow — with a **fixed, small, program-known texture-unit budget** and one layout truth
shared by compiler and app.

---

## 1. The diagnosis (why per-object externs are the wrong model)

The current model mints textures per OBJECT: 5 per distinct mesh, 2–3 per instance batch,
2 per mesh light. Texture units are the ONE GPU resource that scales with *tenant count*
under this model, and the guaranteed floor is 16 fragment samplers — a 4-mesh scene
already died on real hardware (SwiftShader's higher limit hid it; the witness scenes,
mostly 1–2 meshes, never probed it). Every future data-driven system would inherit the
same disease. And no layer OWNS the budget: the compiler emits samplers freely, the
Validator says nothing, and the first authority to object is the driver at link time.

Two structural conclusions:
1. **Texture count must scale with ROLE count, never tenant count** — tenants become
   REGIONS (baked base offsets) inside role-shaped channels.
2. **The sampler budget must be a compile-time fact with a compile-time diagnostic** —
   never a driver surprise.

## 2. Ontology — channel, region, ledger

- **Channel** — one named RGBA32F data texture (one unit), owned by the rail, holding one
  KIND of data for ALL tenants. The roster is small and fixed (§3).
- **Region** — a contiguous texel range within a channel owned by one tenant instance
  (mesh 2's vertices; batch 0's placements; light 1's CDF). A region's `base` is a baked
  literal in generated GLSL; ids STORED in texels stay tenant-LOCAL (vertex ids, node
  refs) — only fetches add the base. The addressing idiom everywhere:
  `texelFetch(channel, data_texel1d(base + local), 0)`.
- **Ledger** — THE layout truth: one pure function computing every region's base and every
  channel's total from scene counts. Planner calls it to bake literals; the App calls the
  SAME function to pack payloads. The ordinal-truth pattern (audit A5), promoted from
  "who is tenant #k" to "where tenant #k's bytes live."

Modularity lives in the LEDGER AND THE PACKERS, not in texture separation: each family
owns its regions' contents (packMesh, packPlacements, packMeshLight…), the rail owns
where they go and how they're addressed. A family never mints a texture again.

## 3. The channel roster (six, forever)

| Channel | Regions (tenants) | Indexed by | Notes |
|---|---|---|---|
| `data_vertices` | per-mesh positions; per-mesh-light WORLD positions | vbase + vertex id | light world-bakes are vertex-shaped — same channel, own regions |
| `data_normals` | per-mesh normals | vbase + vertex id | zero-filled regions when unauthored (leaf contract unchanged) |
| `data_uvs` | per-mesh uvs | vbase + vertex id | 〃 |
| `data_indices` | per-mesh triangle indices | tbase + tri id | xyz = vertex ids; **`.w` RESERVED = the per-triangle material-group slot** (multi-material meshes ride in free) |
| `data_nodes` | per-mesh BLAS; per-batch TLAS; future light-BVH / scene-TLAS | nbase + node texel | one node format (accel/bvh) — all trees, one channel |
| `data_records` | per-batch placements; per-batch attrs; per-light area CDFs; **future Stage B object-param tables** | rbase + record offset | THE generic record channel — anything array-of-records lands here |

Worst-case unit inventory per program: 6 channels + blue-noise + accumulation reads (≤2)
+ env set (≤4) = **≤13 of 16**, independent of scene size. Channels are exact-linkage
gated per program (a meshless scene declares none; `data_records` only when a batch/
light/table tenant exists). Declared cost: when ANY mesh exists, all four vertex-ish
channels + nodes declare together (the leaf's fixed sampler signature — same as today's
"all four always present" pin; 2 units of slack traded for zero signature branching).

Deliberately OUTSIDE the rail: the env system (image-shaped, filtered, its own pipeline
and formats) and blue-noise (a loader-owned image). They already scale O(1); folding them
buys nothing and couples systems. Revisit only if unit pressure returns.

## 4. The ledger — deterministic, baked, padded where honesty requires

`planDataLayout(tenants) → { channelTotals, regions }`, pure, in the rail module.
Region order = the shared enumerators' order (sceneMeshes, then mesh-prototype batches,
then batches' records, then mesh lights) — Planner and App cannot disagree by
construction.

**Offsets are BAKED LITERALS** (fork §9.2, my pick): the precompute-ship rule, zero
runtime indirection, and the compiler knows the whole layout (dumps read plainly). The
cost: bases must be computable at PLAN time, but node counts come from the App-side BVH
build. Resolution: **declared padding bounds** — a binary tree over T leaves has ≤ 2T−1
nodes, so a mesh's node region is padded to 2(2T−1) texels; a TLAS over N instances to
2(2N−1). Waste is bounded (<2× on the smallest channel) and buys plan-time layout with
zero shipped state. Every padding bound is declared in the ledger with its proof-sketch
comment; the App ASSERTS its packed sizes fit the ledger's regions (a violated bound is a
loud error, never corruption).

## 5. The budget — owned, itemized, enforced at compile time

- `ProgramDescription.resources = { samplers: string[] }` — the Planner derives the full
  sampler roster from decisions it already makes (channels from backends/lights facts +
  blue-noise + accumulation inputs + the env set). The link map gains the one resource
  that is genuinely program-shaped.
- **Planner diagnostic** (the C7 voice): roster size > 16 → error listing every sampler
  and its owner — "this program binds 17 samplers (floor 16): data_vertices, …, env_cdf_…"
  — at compile time, never link time. The floor is the SPEC guarantee (16), not the
  queried device limit: scenes must be valid on the portability floor (fork §9.3).
- A structural test pins the worst-case roster of the kitchen-sink scene ≤ 13, so channel
  creep is caught in vitest before any GPU sees it.

## 6. What each system looks like on rail v2

- **Meshes** (standalone + instance prototypes): every mesh.glsl query takes
  `(vbase, tbase, nbase)`; generated wrappers pass ledger literals. One set of channels
  regardless of mesh count. Containment queries identical (`+ nbase`).
- **Instancing**: the placement/attrs reads address `data_records` at baked rbases; the
  TLAS walk addresses `data_nodes` at its nbase. `INSTANCE_COUNT`/traversal registry
  unchanged — only addressing moves.
- **Mesh lights**: world positions = a `data_vertices` region; the area CDF = a
  `data_records` region; the sampler's texture args become channels + two baked bases.
- **Stage B (distinct-object tables), when it comes**: object params = `data_records`
  regions; the scene TLAS = a `data_nodes` region; leaf refs index records. The batch
  becomes "write the packer + the generated leaf reader" — the substrate exists.
- **Light BVH / majorant grids, when they come**: nodes in `data_nodes` / a grid channel
  decision then; queries stay domain-local (the accel doctrine).

## 7. Home + module shape

`components/data/` — the second SUBSTRATE family (the accel precedent): `README.md`
(this contract), `channels.ts` (the roster + extern names), `ledger.ts`
(`planDataLayout` + padding bounds), `pack.ts` (the grid packers, absorbed from
`data_textures.ts`). Families keep their payload packers (mesh/instancing/lights own
what the bytes MEAN); the rail owns where bytes LIVE and how they're addressed.
`glsl/core/data_texture.glsl` (addressing) is unchanged.

## 8. Migration (four batches, each gated; owner sweep at the end)

- **R1 — the rail module**: `components/data/` (channels/ledger/pack), tests for the
  ledger (region disjointness, order stability, padding-bound assertions). No behavior
  change.
- **R2 — geometry channels**: mesh.glsl base threading; feature/Planner/App on the
  ledger; standalone meshes + instance mesh prototypes + containment. Witnesses guard
  (extern renames make byte gates impossible — DECLARED; the numeric suite is the net).
- **R3 — records channel**: placements/TLAS/attrs + mesh-light tables move in; the
  per-batch and per-light externs die.
- **R4 — the budget**: `resources` in ProgramDescription, the Planner diagnostic, the
  roster test. CLAUDE.md + docs updated; cacti renders on a 16-unit GPU as the
  acceptance demo.

## 9. Decision forks (owner)

1. **The six-channel roster** (§3) — vs maximal consolidation (1–2 mega-textures:
   rejected — role clarity and future per-role formats die for units we don't need) vs
   texture arrays (rejected — uniform layer dimensions, new sampler type, no cross-mesh
   atlasing). My pick: the six.
2. **Baked offsets via declared padding bounds** (§4) vs shipped offset uniforms (exact,
   no padding — but runtime indirection, a new compiler↔app protocol, and the compiler
   loses whole-layout knowledge). My pick: baked.
3. **Budget floor = spec 16** vs queried device limit. My pick: the floor — scenes valid
   everywhere; the day a scene legitimately needs more, that's a strategy-level decision,
   not a silent portability break.
4. **`data_records` consolidation** (placements+attrs+CDFs+future tables in one channel)
   vs per-purpose channels. My pick: consolidate — records are shapeless texel ranges;
   the ledger provides the clarity separation would.
5. **Env/blue-noise stay out** (§3). My pick: yes.

---

## 10. Build record (R1–R4, one session — 1224 vitest green)

- **R1** — `components/data/` (the second substrate family): `channels.ts` (the six-channel
  roster), `ledger.ts` (`planDataLayout` + the 2T−1 node bound + `assertFits`), `pack.ts`
  (channel assembly, absorbing `data_textures.ts` — deleted), README; the scene→tenants
  adapter `compiler/plan/dataTenants.ts` (compiler-side: it needs the samplable-emitter
  predicate — `meshIsSamplableEmitter` is now THE one predicate, shared by ledger, Planner
  route, and App packing). Ledger unit tests (disjointness/order/bounds/determinism).
- **R2/R3** — every tenant onto the channels in one coordinated pass: mesh.glsl queries
  take `(vbase, tbase, nbase)` (stored ids stay LOCAL; fetches add bases); the traversal
  registries emit channel calls from ledger slots; instance walks read `data_nodes`/
  `data_records` at batch slots; attrs fetch `data_records` (AttributeValue carries its
  base); mesh-light tables became a `vertices` region (world bake) + a `records` region
  (CDF); packers (`packMesh`/`packInstanceBatch`/`packMeshLight`) emit RAW payloads —
  families own meaning, the rail owns placement; the App's `_uploadSceneGeometry`
  assembles all six channels from the SAME adapter+ledger call the Planner bakes from.
  Every per-object extern (u_mesh_N_*, u_inst_K_*, light tables) is DEAD.
- **R4** — the budget: the Generator counts each assembled program's `sampler2D` roster
  against the spec floor (16) and errors ITEMIZED (placed at assembly, not the Planner —
  the assembled source is the one true roster, a declared deviation from §5's sketch);
  glsl-compile therefore sweeps the whole suite; `samplerBudget.test.ts` PINS cacti ≤ 13
  and forest ≤ 13.
- **Verification:** tsc clean; vitest 1224 (glslang across every pair on the channels);
  zero re-goldens of non-mesh emitted-GLSL snapshots; SwiftShader smoke renders of
  cacti / forest / attr-twin / mesh-light-twin / mesh-glass-box / mesh-submerged all
  match their pre-rail frame means to noise precision (attr-twin EXACTLY) — the
  migration changed addressing, not bytes. The numeric witness suite re-asserts at the
  owner's next sweep.
