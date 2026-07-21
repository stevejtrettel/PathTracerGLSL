# fable-instance-attributes.md — per-instance material properties

**STATUS: BUILT — owner-approved Jul 20 2026 (all §7 forks resolved to the marked picks);
GPU numeric sweep owner-gated.** Build record in §8; the §1–§7 design follows as approved.

**Goal:** one instanced batch, one material MODEL, chosen properties varying per instance —
500 lambert spheres with 500 albedos, a forest of color-jittered cacti — without per-instance
materials, without region explosion, at one texture read per shading event.

---

## 1. The idiom: `attribute` is the fourth storage class

The §3.4/Model-B property system already classifies every material row's storage:

| storage | value source | mechanism |
|---|---|---|
| constant | authored literal | baked inline (values.ts) |
| driven | `{param}` | `u_` uniform (values.ts) |
| expression | GLSL formula | inlined source (heterogeneous media) |
| **attribute** (NEW) | **per-element table** | **data-rail texture, indexed by the hit's element** |

An attribute value is authored as an ARRAY parallel to the batch's placements. It is not a
new property vocabulary — the legal keys are still exactly the model's schema rows; only the
storage differs. This is the honest generalization: the property system's question was always
"where does this row's value come from at the shading point," and "from a table indexed by
which element you hit" is a fourth answer, not a hack on the first three.

## 2. THE contract edit: `Hit.element`

The instance loop knows the placement index `i` at record time; shading does not. The hit must
carry it. **This is a `Hit` edit — trace-loop-contract vocabulary — and is the one owner-level
decision in this design** (§7.1).

```glsl
struct Hit {
    ...
    int element;   // sub-element of the OWNING region that produced this hit:
                   // instanced batch → placement index; everything else → 0 today.
                   // Future tenants: per-triangle index (multi-material/多-chart meshes),
                   // Stage B object refs. The region says WHOSE surface; element says
                   // WHICH PIECE of it.
};
```

- Every backend arm writes it (`0` for sdf/analytic/mesh today; `i` in the instance leaf).
  One line per arm; the dispatcher never reads it.
- `element` is the SAME channel Stage B's data-driven objects and the multi-material-objects
  future need ("which piece of this object did I hit") — this batch is a deliberate small
  pilot of that pattern, so the channel must be named for the general role, not for instancing.

## 3. Authoring + IR

```ts
// compiler/types.ts
interface InstancedObject {
    kind: 'instanced';
    prototype: PrimitiveObject | MeshObject;
    placements: Transform[];
    /** Per-instance values for schema rows of the prototype material's model.
     *  Each array is parallel to `placements` (length N). v1: plain constants only. */
    attributes?: Record<string, number[] | [number, number, number][]>;
    name?: string;
}
```

Authoring sugar grows naturally: `scatter(...)` and friends can return `{ placements,
attributes }`; a `vary(rows, fn)` helper can generate arrays from an index function. Sugar is
authoring-layer; the IR stays flat arrays (the placement-list precedent).

**Validator rules (all reject-not-degrade):**
- every `attributes` key must be a schema row of the prototype material's model
  (unknown-key = the C7 voice); array length must equal `placements.length`; per-entry shape
  must match the row (scalar/vec3, finite);
- **excluded rows:** the region-table row (`ior` — meaningless while batches are thin, and
  region-indexed by construction) and `emission` (per-instance emission on a samplable
  emitter would need per-instance rows in the power CDF/samplers — deferred; path-found
  emission variation can be revisited when someone wants it);
- an attribute-carrying batch's material must not be shared with other objects (the fill
  for that materialId becomes element-dependent; sharing would silently change the other
  objects' shading). Explicit error, never an auto-clone.

## 4. Storage + fill

- **Texture:** `instance_k_attrs` on the data rail — `A` texels per instance (`A` = number of
  attribute rows, declared order), one texel per row (scalar in `.x`, vec3 in `.xyz`).
  **Packed in TLAS-leaf order** — `packInstanceBatch` already computes the reorder for
  placements; the attrs pack rides the same `order` (one reorder truth).
- **Fill site:** `scene_material_properties(int id, vec3 p)` grows the element argument:
  `scene_material_properties(int id, vec3 p, int element)` — callers are all generated
  (transport emitters pass `hit.element`). For an attribute row of the batch's material,
  the generated fill reads
  `texelFetch(u_inst_k_attrs, data_texel1d(uint(element * A + a)), 0)` instead of a
  literal/uniform. Exact linkage: the extern + the element plumbing exist ONLY when a batch
  declares attributes (`ProgramDescription.materials` gains an `attributeRows` decision).
- The medium fill (`scene_medium_properties`) is untouched — batches are thin, no interior.

## 5. What this deliberately does not do

- No per-instance material MODELS (one model per batch — model dispatch stays regional).
- No per-instance region ids (the region space stays O(objects), tables stay small).
- No driven/`Value<T>` attribute entries in v1 (arrays are constants; a driven whole-array
  is a texture re-upload path, deferred with driven placements).
- No GPU-side variation generation (hash-in-shader) — variation is authored/CPU-generated
  data on the rail (precompute-ship-uniforms discipline).

## 6. Verification

- **Witness `attr-twin ⇄ attr-twin-ref`:** a batch of K spheres with per-instance albedos ≡
  the same K spheres authored individually with those albedos (twin gate, the
  instance-twin pattern — also proves the TLAS reorder carried the attrs correctly, since
  leaf order ≠ scene order).
- glslang across both instanceAccel arms; the element channel is inert for every existing
  scene (all-zero) — emitted-GLSL byte gate on non-attribute scenes.

## 7. Decision forks (owner)

1. **The `Hit.element` contract edit** — name and semantics as §2 (my pick: `element`, int,
   owner-defined per backend, 0 default). This edits glsl/core/structs.glsl and gets a
   trace-loop-contract note.
2. **Fill-site signature** — extend `scene_material_properties` with `element` (my pick) vs
   a separate attribute-fetch seam. One signature keeps the one-fill-site truth.
3. **Excluded rows** — ior + emission per §3 (my pick), or allow path-found-only emission
   variation in v1.
4. **Sequencing** — before or after mesh containment (independent seams; see the chat
   summary's recommendation).

---

## 8. Build record (BUILT Jul 20 2026 — GPU-render-verified; numeric sweep owner-gated)

Built as designed; all forks resolved to the marked picks. tsc clean; vitest 1152 green.
One addition found during build: rows feeding a DERIVED field (ggx roughness → alpha) are
Validator-rejected — the derived rail computes once per material, so a per-instance input
would need per-instance derived slots (precompute-and-ship an extra table column; deferred).

- **Contract:** `Hit.element` in glsl/core/structs.glsl + the trace-loop-contract note;
  every backend arm writes it (0; the instance leaf writes the leaf-order placement index).
- **IR/plan:** `InstancedObject.attributes`; `AttributeValue` joins `ResolvedProperty`
  (`isAttributeValue`); `PlannedInstanceBatch.attributeRows` (slot order).
- **One truths:** `instanceAttributeRows` (components/intersection/instancing) = the slot
  order shared by Planner and App; `packInstanceBatch` reorders attrs by the SAME TLAS
  permutation as placements; `emitAttributeValue` (values.ts, the fourth storage class's
  one legal emitter — `emitValue` throws on attributes as a backstop).
- **Codegen:** `scene_material_properties(int id, vec3 p, int element)` (both call sites:
  the pt walk + kernel.glsl's emission fetch); attribute rows emit the element-indexed
  `texelFetch` on `u_inst_k_attrs`; the materials feature declares the extern (exact
  linkage — declared where consumed) and requires `data_texel1d` (now a declared
  intersection seam for order-independence).
- **Validator:** row-membership/emission/region-table/derived-input/parallel-length/
  finiteness/material-exclusivity rules, all tested.
- **Witness:** `attr-twin ⇄ attr-twin-ref` (3 per-instance albedos ≡ 3 individual
  materials; a reorder bug shows as swapped colors). Registered; sweep owner-gated.
- **Snapshots:** 43 emitted-GLSL snaps re-goldened; git-diff audit confirmed the change is
  EXACTLY the declared class (element writes + the signature + source-map line shifts).
- **GPU render:** attr-twin headless — three correctly-colored spheres in scene-order
  positions (the reorder proof), no errors, ~30 fps SwiftShader.
