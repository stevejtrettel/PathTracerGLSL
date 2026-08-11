# impl-plan-region-materials.md — the region→material decomposition

**STATUS: BUILT (Aug 11 2026, same session as the plan — owner-ordered; design origin:
`impl-plan-sdf-as-shape.md` §6.2). vitest 2017 + glslang green; the owner's witness
sweep re-gates the table twins (sdf-table-twin, bazaar, accel-triple) as always.**

**BUILD RECORD.**
- **T1 census result**: `material_of` and `ior_of` are the ONLY object-count-sized
  generated constructs. Everything else checked out material-keyed
  (`scene_material_properties`, `medium_*`, `material_is_emissive`,
  `is_null_interface` — all take a MATERIAL id), roster-sized (`light_of`), or
  quad-sized (`scene_region_thin` — left, with its re-trigger noted in §1).
- **Measured**: the 3000-object knot program dropped **4515 → 1470 lines**
  (`material_of` 3002 → a 9-line fetch); GPU-verified end-to-end (headless
  SwiftShader render of the tabled knot — per-object materials correct through the
  rail). Compile-time claims stay unmeasured per §3.
- **As-built notes**: `regionMaterialsOf(scene)` in dataTenants.ts is the scene-side
  mirror (objects in order, then desugared hittable-light regions; material ids =
  insertion order, then minted `__light_*` ids), Planner-ASSERTED id-for-id on every
  tabled compile (the light-roster pattern); the tenant appends LAST in the ledger
  (bases byte-stable, pinned by ledger.test); `regionLookup` rides
  `ProgramDescription.materials`, decided with objectDispatch (hoisted to one truth);
  the generator's presence-guard mirrors tableMode's exactly. The baked arms are
  BYTE-UNTOUCHED for unrolled programs (snapshot gate held: churn = the
  regionLookup field only). The open-transmissive-mesh exclusion carries over as
  explicit per-mesh 1.0 arms (sized by that warned configuration, not by objects);
  region −1 answers before any fetch (ambient pins preserved). Bonus fix: the App's
  rail-upload early-return now includes `sceneTable` — a tabled scene with no
  meshes/batches and a tree-ineligible roster previously skipped its upload
  entirely (latent, found at T2).
- Gates: `tests/compiler/regionMaterials.test.ts` (mirror incl. desugared +
  delta lights, data form emitted under 'table', baked form byte-kept under
  'unrolled'), ledger base pin, all 268 registry pairs through glslang.

## 0. The problem, stated once

Under table dispatch every *geometry* construct already scales with the TLAS, not the
object count — but the region-keyed lookup tables still bake one arm per REGION:

```glsl
int material_of(int region) {
    if (region == 0) return 0;
    if (region == 1) return 2;
    ...                          // × every object in the scene
}
```

The symptom is `material_of`; the cause is a FUSED lookup. Every such table bakes
*region → value* directly, when the value is a property of the MATERIAL, not the
region. Regions are thousands; materials are a handful. The last construct whose
emitted size grows with object count.

## 1. The decomposition (the design, pinned in §6.2)

```
region   → material     per-object DATA  (a rail tenant, under table dispatch)
material → value        GENERATED        (sized by the material count)
```

- `material_of(region)` becomes ONE rail fetch: a `regionMaterials` tenant, ids
  packed four to a texel, base ledger-baked as usual. The in-texel pick is a 4-way
  COMPONENT SELECT, never a dynamic vector index (the standing dialect rule:
  glslang accepts what ANGLE rejects).
- `ior_of(region, p)` becomes `ior_of_material(material_of(region), p)`. This is
  *why* the decomposition matters and not just a texture: a material's index may be
  a FORMULA (GRIN) or a driven uniform, so material→ior must STAY generated —
  fusing it to regions is exactly what made it O(N).
- Material ids are small integers; they ride the float rail exactly (f32 is exact
  to 2²⁴ — the object ceiling is orders of magnitude below).
- **UNROLLED dispatch keeps the baked arms**: small scenes want the constants to
  fold, and the witnesses that pin them stay byte-stable. Which form a program uses
  is a `ProgramDescription` link-map decision (e.g. `materials.regionLookup:
  'baked' | 'data'`), decided in Plan, never re-derived by a generator — the
  decision-hoist rule.

Explicitly NOT in scope:
- `light_of` — already sized by the emitter roster, not the object count.
- `scene_region_thin` — a disjunction sized by thin quads, not objects. Leave it;
  the same fix applies the day a scene ships thousands of thin regions (that is the
  re-trigger, noted here so it isn't rediscovered).

## 2. Stages

**T1 — census (verification before design-freeze).** Enumerate every generated
construct keyed by region id (grep the generators for the `region ==` arm pattern
and the region-table emitters): `material_of`, `ior_of`, and whatever the census
actually finds (medium/emission region tables are the suspects). For each: is the
value a material property (decomposes), a per-object property (stays data), or
roster-sized (untouched)? The census table goes in this doc before T2 starts.

**T2 — the tenant.** `regionMaterials` stanza in `dataTenantsOf` (APPENDED LAST —
existing bases byte-stable, the ledger discipline), packed App-side from
`sceneMeshes`/the one ordinal truth: region id order = object index order, four ids
per RGBA32F texel. Vitest: pack/read round-trip + a pinned layout test.

**T3 — the generator + the decision.** `regionLookup` lands in
`ProgramDescription.materials`; the Planner sets `'data'` exactly when
`objectDispatch === 'table'` (one decision, one reader). Under `'data'` the
generator emits the fetch-based `material_of` + component select, and each
downstream region-keyed table re-targets `material_of(...)` through its
material-keyed form. Under `'baked'` nothing changes — **byte-identity across every
unrolled registry pair is the gate**, the strongest one the repo has.

**T4 — measure and gate.**
- The knot program's line count (4515 → expect ~1500s) — recorded here.
- Equality: `sdf-table-twin` and `bazaar` re-gate (identical-stream, so ~0.00%);
  the tabled arm now reads materials through the rail, the unrolled arm bakes —
  the twin is exactly the cross-form check.
- `npm run witness -- --perf` rows on the table fixtures: the fetch replaces
  constant-folded arms, so the perf claim ("a fetch beats a 3000-arm if-chain")
  gets a number instead of an assumption.
- glslang across all pairs; snapshots re-goldened with the diff audited to the
  named class (baked arms → fetch, table scenes only).
- Owner witness sweep at the end, as always.

## 3. Risks, named

- **The component select** must be branch-shaped or mask-shaped, not
  `v[dynamic_i]` — ANGLE. The emitter comment carries the rule.
- **Driven materials under 'data'**: material→value tables keep their uniform
  slots; nothing about driving changes, because the driven half was never
  region-keyed. T1 verifies that claim per table.
- **Compile-cost claims stay unmeasured** until the `compile` witness check exists
  (sdf-as-shape §6.3) — report line counts and frame times only.
