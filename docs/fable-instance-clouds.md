# fable-instance-clouds.md — the instance-cloud data system (`.inst` files)

**STATUS: BUILT Aug 7 2026 (same day as design approval; §9 steps 1–5 complete).
vitest 1355 green (round-trip gate, packed≡Transform[] equality gate, fixture compile
through glslang); both data scenes render via `lab.html?scene=clebsch|croissant` on
SwiftShader with pixel stats matching the one-off probe (which is deleted). `.inst`
files: clebsch 6.2 MB / croissant 9.2 MB (from 38/57 MB JSON). ONE deviation from the
approved design: 'cube' is DEFERRED (§8 first row — box is deliberately SDF-only;
found at build, owner-pending).** Design authority for loading large
(50 MB+) externally-generated instance datasets into scenes: the file format, the
loader, the packed-placement contract extension, converters, and the async registry
seam. Downstream of `packInstanceBatch` NOTHING changes — the rail (fable-data-rail),
the TLAS (impl-plan-tlas), instance attributes (fable-instance-attributes), and the
generated walks are all count-invariant and already built.

**Goal:** a render-ready, zero-parse binary format for "N placements of one prototype"
— position / size / color / orientation / named scalar columns — with ONE dumb loader,
per-dataset science pushed OFFLINE into converter scripts, and a retune loop (resize,
recolor) that never recompiles a shader.

Prototype evidence (Aug 7 2026): 193,856-instance clebsch cloud and 288,645-instance
croissant cloud rendered through the existing pipeline (one analytic-sphere batch +
per-instance albedo attributes + per-batch TLAS) with zero compiler changes — the
input edge was the only rough part: runtime `fetch` of 38–57 MB JSON (~2 s parse,
~300k heap objects), a bespoke page outside the registry, radius-law retuning by
editing constants and reloading.

---

## 1. Pins (each with its reason)

1. **The compiler never fetches; `SceneDescription` stays a complete value.** The
   Planner needs counts at plan time (the ledger bakes bases from `instanceCount`) and
   the App needs payloads at pack time (the TLAS needs positions) — so resolution must
   complete before compilation regardless. Async lives at the authoring/page seam.
   Precedent: the env-image `extern:` chain (App-orchestrated load, compiler sees a
   description) and `MeshObject` carrying the OBJ loader's vertex buffers as values.

2. **Files are render-ready; science lives in converters.** A `.inst` file draws
   without any scene-side law: sizes and colors are baked by the offline converter
   (radius laws, sRGB→linear, palettes — the per-dataset decisions this session proved
   irreducible: clebsch's law pinned 99.6% of croissant at the floor). A collaborator's
   next ad-hoc JSON costs a 30-line converter script, never a runtime feature.

3. **Laws never run on the GPU.** Not just the precompute discipline
   ("GPU consumes, never derives") — structural: TLAS boxes are CPU-built from actual
   radii; a shader-computed radius cannot feed back into the tree, so geometry would
   escape its bounds. Size/color hooks are CPU functions evaluated at pack time.

4. **Retune = repack + re-upload, never recompile.** `planDataLayout` is
   count-determined — sizes/colors/TLAS nodes are pure data within count-sized regions.
   Changing every radius re-runs the App-side pack (~2–5 s SAH at 300k) against
   unchanged shaders and layout. This is what makes hooks and `sizeScale` cheap, and
   what a future in-app retune (deferred, §8) rides on.

5. **Scalar columns are named, f32, and K ≥ 0 — and that is ALL the schema there is.**
   The extensibility fix for "one anonymous param" (meaning collides at the second
   driver) without re-growing the point-table: names are the only metadata; dtype is
   fixed; categoricals/strings/records are converter territory (bake them). A dataset
   needing richer runtime semantics is a converter problem by definition.

6. **Shape and material are scene-side; the file is renderer-agnostic.** Shape without
   material is half a decision (a cube of what — lambert? mirror?), and material models
   are renderer semantics data must not pin. The same file renders as chrome cubes
   tomorrow. "Color" is just a per-instance override of whichever schema row the batch
   config points it at (`albedo` on lambert, `f0` on mirror) — the existing attribute
   machinery, material-agnostic for free.

7. **`size` is ONE float — the similarity scale.** Placements are similarities
   (uniform s > 0, fable-transforms pin); ellipsoids are a shape parameter, never a
   non-uniform scale.

8. **One file = one instance list = one batch.** Composition is scene-side (load
   several files). Multi-material clouds = multiple files/batches.

## 2. The `.inst` format (version 1)

Binary, little-endian, all payload blocks f32 and 4-byte aligned. Columnar — the
loader's output is `Float32Array` views/copies, never per-instance objects. For scale:
croissant (289k points, positions+sizes+colors + 1 scalar) is 9.2 MB vs 57 MB as JSON,
with zero parse cost; the 1.4M-point octic is 44.8 MB vs 281 MB.

```
offset  size   field
0       4      magic 'INST' (0x49 4E 53 54)
4       4      u32 version = 1
8       4      u32 count N
12      4      u32 flags: bit0 sizes, bit1 colors, bit2 orientations
16      24     POSITIONS-ONLY AABB: min.xyz, max.xyz (f32×6) — deliberately excludes
               sphere extents: sizes may be overridden by a pack-time hook (§4), so a
               placed-cloud box would silently go stale; positions are hook-invariant.
               Consumers (camera framing, Validator sanity) pad anyway.
40      4      u32 K — scalar column count
44      K×32   column names: UTF-8, zero-padded to 32 bytes each
…       4      u32 P — provenance byte length
…       P(+pad) provenance UTF-8 (converter id + date + source), padded to 4
—— blocks, in this fixed order, each present iff flagged ——
positions      f32 × 3N   REQUIRED
sizes          f32 × N    optional (absent → 1.0)
colors         f32 × 3N   optional — LINEAR RGB (converters do sRGB→linear)
orientations   f32 × 4N   optional — unit quaternions (x,y,z,w), identity (0,0,0,1)
                          (matches similarity.ts's [x,y,z,w] Hamilton convention — verified)
scalars        K × (f32 × N), in header name order
```

Loader validation (all cheap, all loud): magic/version, buffer length arithmetic
(header + flagged blocks must equal byte length exactly), finite AABB, N > 0. The
header AABB is the converter's statement of extent — instant camera framing and a
Validator sanity bound without scanning 300k positions.

## 3. The loader (authoring layer)

`src/authoring/loadInstances.ts`:

- `parseInstances(buffer: ArrayBuffer): InstanceTable` — pure, sync, view-making.
- `loadInstances(src: string | File): Promise<InstanceTable>` — fetch/FileReader + parse.
  Accepting `File` makes drag-drop (deferred, §8) free.
- `InstanceTable = { count, aabb, provenance, positions, sizes?, colors?,
  orientations?, scalars: Record<string, Float32Array> }`.

Mirrors `loadOBJ.ts` in layer and shape. No science, no options.

## 4. Scene integration

**The one contract extension** (`compiler/types.ts`): `InstancedObject.placements`
becomes a union — `Transform[]` (the hand-authoring arm, unchanged) **or** a packed
form `{ count, positions: Float32Array, sizes?: Float32Array, orientations?:
Float32Array }`. Likewise per-instance `attributes` rows accept `Float32Array`
(3N, leaf-permuted by the same TLAS order) alongside literal arrays. The compiler
normalizes at its boundary; 300k `Transform` objects are never manufactured just to
be torn back down. The scene remains a complete value whose payload fields are typed
arrays — exactly the `MeshObject` precedent.

**Authoring sugar** (`src/authoring/instance.ts`, beside `instance()`):

```
instanceCloud(table, {
    shape: 'sphere' | 'cube' | …,        // any similarity-closed analytic primitive
    material: '<scene material id>',
    name?: string,
    colorDrives?: '<schema row>',        // default 'albedo' when table.colors present
    sizeScale?: number,                  // the cheap dial — multiplies baked/hooked sizes
    size?:  (cols, i) => number,        // CPU hook, overrides baked sizes (pin 3, 4)
    color?: (cols, i) => [r, g, b],     // CPU hook, overrides baked colors (colormaps)
}) → InstancedObject
```

Hooks read `table.scalars` by name; referencing an absent column is an authoring-time
error. Priority: hook > baked column > default (size 1.0 / no color attribute).
Hooks run once, at scene build — their output is baked into the packed arrays the
compiler sees, honoring pin 1 (the description stays a value).

**Validator additions** (cheap, made possible by the header): batch count vs the
nodes-channel ceiling (~1M instances at `DATA_TEX_WIDTH` 2048 — fail at compile, not
at upload), AABB finite/nonempty.

## 5. The pipeline, file → GPU (what changes, what doesn't)

1. **Load** — `loadInstances` → views. New (§3).
2. **Author** — `instanceCloud(table, config)` → `InstancedObject` with packed
   placements + typed attribute arrays. New sugar (§4); hooks evaluated here.
3. **Compile** — Analyze/Validate/Plan read `count` from the packed form; the ledger
   (`dataTenantsOf` → `planDataLayout`) bakes records/nodes/attrs bases from counts
   exactly as today. Touched only by the union normalization + new Validator rules.
4. **Pack** — `packInstanceBatch` gains a packed-placements arm: world boxes from the
   prototype's local box under each (position, size, quat), binned SAH, the ONE leaf
   permutation reordering placements AND color/attribute arrays (Hit.element indexes
   both), `rigidInverse` per instance (quat inverse = conjugate) → the 8-float §6.1
   records. Object-free from file bytes to records. The AABB[] SAH feeder stays as-is
   (§8 triggers its typed-array rewrite).
5. **Upload** — the six fixed rail channels; placements 2 texels/inst + color 1
   texel/inst in `records`, TLAS ≤ 2(2N−1) node-pairs in `nodes`. No new textures;
   sampler budget untouched.
6. **Render** — the existing generated `instance_<name>` TLAS walk + attribute
   fetches. Byte-identical GLSL modulo baked bases.

Scalar columns NEVER reach the GPU (pin 3) — they exist only as hook inputs.

## 6. Converters + fixtures

**The encoder is ONE shared module**: `tools/inst-format.mjs` (plain JS so node
scripts AND vitest can import it) — the single write-side layout truth, the ledger
pattern applied to the file format. Every writer (converters, the fixture generator)
imports it; hand-rolling the byte layout anywhere else is the drift class this kills.
The vitest **round-trip gate** (encode via `inst-format.mjs` → `parseInstances` →
deep-equal) is the format's contract test — encoder and decoder cannot drift apart
silently.

**Boundary (owner-pinned Aug 7 2026): the renderer knows ONE data format — `.inst`.**
External-schema converters are USER-LOCAL scripts, not repo surface: they live in the
gitignored `test-data/` (or anywhere), beside the data they convert, importing the
repo's encoder. The repo ships only format-owned tooling: `tools/inst-format.mjs`
(encoder) and `tools/make-inst-fixture.mjs` (test fixture). A collaborator's schema
never appears in tracked code.

`test-data/convert-pointset.mjs` (untracked) — the current collaborator-JSON bridge.
Each preset encodes its dataset's science and writes `test-data/<name>.inst`:

- **clebsch**: r = clamp(0.15/√h, 0.01, —) baked into `sizes`; hex→linear into
  `colors`; `height` shipped as the scalar column. (0.01 = 10× the GLSL `EPSILON`
  spawn offset — radii below it shadow-tunnel; the floor is physics, not taste.)
- **croissant**: r = clamp(0.425/√h, 0.01, 0.0225) likewise; `height` shipped.

`tools/make-inst-fixture.mjs` writes the ONE committed fixture:
`tests/fixtures/cloud-500.inst` (~500 instances, every optional column + one scalar
column, a few KB). Vitest exercises `parseInstances` (round-trip vs the generator),
the packed-placement compile path (glslang + snapshot on a fixture scene), and hook
override semantics — the REAL code path at toy scale; codegen is count-invariant, so
this is full structural coverage. The 50 MB files stay untracked in `test-data/`
forever. Optional (owner's call): one witness scene on the fixture for a durable
GPU gate.

## 7. Registry seam (async entries)

`SceneSuiteEntry.scene` grows the async form `SceneDescription |
(() => Promise<SceneDescription>)`. Async entries must carry their display metadata
(`name`, the `exercises` blurb) at the ENTRY level — today's gallery cards read
`scene.name`, which doesn't exist until the thunk is awaited; cards never await.
`scene-lab.ts` awaits the thunk on click-through.

**Reproducibility stamp addendum**: the export stamp's `scene` field is the scene ID
(verified — App.ts stamps no payload, so there is no stamp-bloat problem), but for a
data scene `(scene id, strategy)` no longer determines the image — the `.inst`
content does. Data-scene exports must add the file's header provenance string to the
stamp. That is what the provenance field is FOR. Witness runner and the
registry-iterating vitest files handle only what they select — data scenes ship
fixture-backed test entries (§6), big-file entries are lab/gallery-only. The
`pages/clebsch.ts` one-off and `clebsch.html` are DELETED once the clebsch/croissant
entries render through this seam.

## 8. Deferred, with triggers

| Item | Trigger |
|---|---|
| **'cube' shape** | needs an analytic box intersector, and box is DELIBERATELY SDF-only (params not closed under rotation — the top-level fold would silently drop a rotated box's rotation, which is WHY `provides.analytic` is false). The instanced local-frame arm is rotation-safe, so the prerequisite is a per-context backend fact ("analytic under instancing, SDF top-level") — a descriptor-axis design discussion, not a build-batch improvisation. v1 = sphere-only; found at build time (§9.3). |
| ~~Typed-array SAH builder + Web Worker pack~~ **DONE Aug 8 2026** | trigger fired at steiner/crixxi/octic (724k/745k/1.4M). Flat core (fused bounds+centroid pass, tri-axis single-pass binning) is BYTE-IDENTICAL to the old builder (reference-twin gate `tests/components/bvhFlat.test.ts`) at 2.8× (1M boxes 5.3s→1.9s; octic full pack 6.4→4.0s node-side); the pack runs in a Web Worker (`src/app/utils/packWorker.ts` — App-side plumbing, sync core stays in components; copy-in/transfer-out so table views never detach; loud sync fallback), so the page stays interactive during load. |
| ~~`DATA_TEX_WIDTH` 2048 → 4096~~ **DONE Aug 7 2026** | the 1.4M-instance octic cloud tripped the ceiling the same day — trigger fired as written; vitest 1355 green, zero snapshot churn |
| In-app retune (re-run hooks + repack + re-upload, no reload) | wanting to PLAY with laws; pin 4 makes it a data-only op |
| Drag-drop `File` into the page | owner want; loader already accepts `File` |
| Non-scalar columns / richer schema | NO trigger — converter territory by pin 5 |
| Instanced-batch emitters (glowing clouds) | many-lights sampling work; path-found-only until then |

## 9. Build plan (one batch, no mixed refactors)

1. Format: `tools/inst-format.mjs` encoder + `parseInstances`/`loadInstances` +
   fixture generator + the round-trip contract gate.
2. `InstancedObject` packed-placement union + attribute typed arrays + Validator
   rules + `packInstanceBatch` packed arm (byte-gate: `Transform[]` scenes unchanged).
3. `instanceCloud()` sugar + hooks.
4. Converters; regenerate clebsch/croissant as `.inst`.
5. Async registry seam (entry-level metadata) + the two gallery entries + fixture
   test entry + the stamp provenance addendum; delete the one-off page.

Gates: tsc + targeted vitest per step; full vitest at batch end; witness sweep
owner-called.
