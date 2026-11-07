# Compiler Plan stage — map (read-only survey, 2026-11-06)

Area: `src/compiler/plan/*`, `src/compiler/sceneData.ts`, `src/compiler/EnvironmentBake.ts`,
`src/components/data/{ledger,channels,pack}.ts`. Intent docs: docs/fable-compiler-contracts.md
(§2.12 exact linkage, §5 curved space, §6.2 light registry), docs/claude-data-exact-linkage.md.

## Files and sizes

| File | Lines | What it does |
|---|---|---|
| plan/Planner.ts | 1053 | `planRenderers` (entry), `planScene`, `placeScene`, `planProgram`, `planPipeline`, driven-placement closures, SDF placement fold, material/medium value resolution, `sceneWorldRadius`, dispersion + spectrum-kind census |
| plan/dataTenants.ts | 442 | Scene→ledger adapter `dataTenantsOf`; the shared scene predicates (light census `samplableEmitterObjects`, `lightRosterOf`, `keepsLocalFrame`, `materialReadsUv`, `batchPlacementRecordOf`, `batchLightEligible`, `batchNeedsInterior`, `regionLightKind`, `regionCountOf`); `dataReadsOf`/`unionDataReads`; scene-table eligibility + record order |
| plan/types.ts | 684 | `ProgramDescription` (the decision record: measurement / estimator / view + link tables intersection/materials/media/emitters/environment), `RenderPlan`, `PlacedScene`, `ScenePlan`, planned record types, `PlannedPipeline`, `PlannedPicture`, `DrivenPlacement`, `PlannedUniform`, `AttributeValue` |
| plan/measurement.ts | 35 | `resolveMeasurement` — authored measurement + defaults (also used by App for export stamps) |
| plan/pictures.ts | 52 | `planPictures` (main + statistic + AOVs, one MRT attachment each), `pictureBuffer` (_current/_previous rule), `bufferRef` |
| plan/values.ts | 40 | `resolveColorProperty` / `resolveScalarProperty` — the one spelling→value resolver |
| sceneData.ts | 192 | `sceneDataPlanOf(scene, placed)` → `SceneDataPlan` the App executes (geometry slots, mesh lights, batches, object-table records+leaves, light-tree rows+powers, region→material ids) |
| EnvironmentBake.ts | 97 | `compileEnvironmentBake` — a standalone one-pass CompiledRenderer that bakes a procedural sky into an equirect/octahedral table; `envTableSize` |
| components/data/ledger.ts | 199 | `planDataLayout(DataTenants)` → `DataLayout` (bases per channel, padded bounds); `assertFits` |
| components/data/channels.ts | 30 | channel roster (6 float + 1 uint `nodesq`) and extern/uniform names |
| components/data/pack.ts | 87 | channel alloc + strided writers (App-side writer half) |

## Data flow

```
Compiler.compileScene(scene, strategies)
  analyze(scene) -> SceneFeatures                      (Analyzer: media/light/env census)
  validate(...) per strategy
  planRenderers(features, scene, strategies, bag)      (Planner.ts:72)
     planScene(scene, bag)            -> ScenePlan     (no strategy, no addresses)
     planProgram(features, scene, strategy, scenePlan) -> ProgramDescription  (per strategy)
     reads = unionDataReads(programs.map(dataReadsOf)) (cwbvh / lightTree / sceneTable)
     placeScene(scene, scenePlan, reads) -> PlacedScene
         dataTenantsOf(scene, reads) -> SceneDataTenants (re-derives from RAW scene)
         planDataLayout(tenants)     -> DataLayout
         attach slots to meshes/batches/mesh lights; patch attribute rows into
         materials; mark tabled objects; build PlannedSceneTable + lightTree slot
     plans[i] = { ...placed, program, pipeline: planPipeline(program) }
  generate(plans[i], scene, strategy, bag)  (scene/strategy used only for renderer id)
  sceneDataPlanOf(scene, placed) -> SceneDataPlan  -> App (app/sceneData.ts) packs bytes
App separately: envVariants(strategies) + compileEnvironmentBake(scene, chart) (App.ts:955, :323)
```

## Key types

- `ScenePlan` (types.ts:665): objects/meshes/batches/materials/lights with ids, ambientMedium,
  lightBatches. `Scene*` record types are `Omit<Planned*, address fields>` (types.ts:677-684).
- `PlacedScene = Omit<RenderPlan,'program'|'pipeline'>` (types.ts:654) — adds slots, tabled
  flags, sceneTable, lightTree, attribute-patched materials, `data: {tenants, layout}`.
- `ProgramDescription` (types.ts:39) — the one decision record generators read.
- `DataTenants`/`DataLayout` (ledger.ts:52/102) — counts in, bases out.
- `SceneDataPlan` (sceneData.ts:34) — what to pack where.

## Every decision the Planner makes, and where it is recorded

### planScene (scene facts; ScenePlan)
| Decision | Where computed | Recorded in |
|---|---|---|
| Material ids = insertion order; values from schema rows (`authored ?? row.default`) | Planner.ts:94-104, `resolveMaterialValues` :929 | `PlannedMaterial.values` |
| Medium resolution; phase model default 'hg' | `resolveMedium` :947 | `PlannedMaterial.medium` |
| Region ids: scene order across objects/meshes/batches; desugared light regions after | :128-274, :303 | `.index` on every record |
| Mesh/batch ordinals | `sceneMeshes`/`sceneInstanceBatches` :126-127 | `.ordinal` |
| Backend (closed-form vs march) | `resolveBackend` :176, :207 | `PlannedPrimitiveObject.intersect`, prototype.intersect |
| Placement fold / residual / retained frame / driven | :219-273, `resolveSDFPlacement` :885, `classifyPlacement`, `keepsLocalFrame` | `.parameters`, `.placement` |
| Batch placement-record tier (frame/params) | `batchPlacementRecordOf` (dataTenants:123) at :199 | `prototype.record` |
| Batch interior | `batchNeedsInterior` :172/:188 | `hasInterior` |
| Per-instance attribute slot order | `instanceAttributeRows` :165 | `attributeRows` |
| Light roster & ids; authored-area-light desugar (synth lambert albedo 0 material + region) | `lightRosterOf` :287-334 | `lights`, extra `materials`/`objects` |
| Light values (authored: `toValues`; emissive object: `valuesFromRegion`; mesh: radiance+area) | :293, :328, :333 | `SceneLight.values` |
| Selection-power world radius | `sceneWorldRadius` :982 | `SceneLight.powerCtx` |
| Ambient medium material id | :344 | `ambientMedium` |
| Light-eligible instance batches | `lightBatchesOf` :348 | `lightBatches` |

### planProgram (per strategy; ProgramDescription)
measurement (resolveMeasurement); estimator.lighting (method/selection/envSelectWeight) :493-507;
wavelengths :567; volumeSampling :572; mediumLightSampling :574; envSampler chart+compensation
:577; accumulation :585; view.tonemap :591; intersection.classes/meshTraversal/instanceAccel/
objectDispatch (scene-dependent default: ≥ MARCHED_TABLE_THRESHOLD=9 marched objects → 'table')
:557/:598-622; anyQuery; drivenPlacement (from RAW scene :621); materials.models / regionLookup /
surfaceEval / surfacePdf / twoSidedShading / emissionCones / albedo / materialsReadUv (RAW scene
:649); media.* :651-675 (`models` from RAW scene.materials :671-674); emitters.* :676-683;
environment (resolveEnvironment :51); environmentSamplable/Pdf/SelectionLive :685-691;
dispersion + spectrumKinds :561-564.

### placeScene (addresses; PlacedScene)
data layout from `dataTenantsOf(scene, reads)` + `planDataLayout`; mesh/batch slots; attribute
refs patched into the batch material's values :376-383; mesh-light bases :388-394; tabled
flags + PlannedSceneTable :400-421; global light-index space for batch lights + lightTree slot
:426-442.

### planPipeline
pictures (planPictures), MRT double buffer `accumulation`, `screen`, on-demand `ldr`; passes
pathtracer + display; one swap. Planner.ts:699-744.

## Decisions answered in more than one place (checked)

1. Scene "world radius" for infinite-light power: `sceneWorldRadius` (Planner.ts:982, AABB of
   folded analytic + closed meshes, fallback 10) for directional Φ vs `sceneRadiusEstimate`
   (generate/features/lighting.ts:456, |point rows| + Σ length rows incl. SDFs and lights, floor
   1) for env Φ. Two heuristics for one pbrt quantity; the env-vs-directional split uses
   inconsistent R. Fallback 10 is mirrored in directional.ts:29.
2. Light selection power: `lightPower(l, params)` (lighting.ts:353, passes `l.powerCtx`) vs
   sceneData.ts:164 `d.power(l.values)` (no ctx) vs App sceneData.ts:135 `d.power(values)`.
3. Table eligibility of a non-closed rotated analytic shape: dataTenants.ts:363 restates what
   `classifyPlacement`'s residual already decided in planScene (Planner.ts:256-271); SDF
   eligibility calls `classifyPlacement` again (dataTenants.ts:393). Root cause:
   `dataTenantsOf` re-derives from the raw SceneDescription although it now runs only inside
   placeScene, which has the ScenePlan.
4. SDF record budget: dataTenants.ts:387-388 re-implements `sdfTailTexel` (generate/records.ts:54)
   "Mirrors sdfTailTexel's alignment".
5. Region count: `regionCountOf` (dataTenants.ts:302) vs the Planner's objectIndex assignment
   (Planner.ts:128-303) vs sceneData's sorted id list (sceneData.ts:185).
6. Light count: Analyzer `scene.lights.length + samplableEmitterObjects(scene).length`
   (Analyzer.ts:36) used by planProgram :495 while `scenePlan.lights` (lightRosterOf) is in hand.
7. Scattering presence: `scatteringArms` uses `features.media.hasScatteringMedia` (Planner:519)
   beside `scatteringMedia` computed from planned materials (:531) — same predicate, two sources.
8. `media.models` from raw `scene.materials` with its own `?? 'hg'` (Planner:671-674), duplicating
   resolveMedium's default (:948) and not restricted to `scatteringMedia`.
9. `intersection.drivenPlacement` from raw scene (:621) while the generator derives drivenRecords
   from planned placements (intersection.ts:87-90).
10. envSampler defaults: Planner.ts:578-579 and App.ts:958-959 (`envVariants`).
11. Marched-object count: Planner.ts:558 vs Validator.ts:697.
12. env_rotate_cs GLSL + PI/TWO_PI: EnvironmentBake.ts:44-57 vs environment.ts:30-35, glsl/core/math.glsl:6-7.

## Planning logic in generators / App (checked)

- Generator decides existence of generated/included pieces beyond ProgramDescription:
  placement.glsl gate broadened (intersection.ts:103 `drivenPlacement || hasInstanced ||
  placedAnalytic || tabledSdfPresent`), `ior_of` seam (intersection.ts:331, :388 — same
  predicate twice), data-rail need (:76), nodes texture (:286), medium emission.glsl
  (materials.ts:144), env selection probability policy (lighting.ts:488). This contradicts
  types.ts:28-31 ("every 'does this program contain X' question is answered here, once").
- Generator validates draw-buffer and sampler floors (Generator.ts:27-50) — deliberately (it
  needs the assembled source).
- App: `envVariants` (App.ts:955) decides which env CDF tables to build from raw strategies,
  ignoring `environmentSamplable` (documented open item in claude-data-exact-linkage.md).
- App builds batch-light values by naming the sphere kind's rows and the params record layout
  (app/sceneData.ts:124-131: `{ center, radius: 0, radiance }`, `recs[4k..4k+3]`).
- sceneData.ts imports from generate/ (records.ts, features/lighting.ts `resolveLightValues`) —
  the scene-data plan depends on a generator module.
- Planner emits the 'missing-geometry' diagnostic for plain objects (Planner.ts:211); the Validator
  does it for instanced prototypes (Validator.ts:1154) — validation split across stages.

## Stale docs (checked)

- dataTenants.ts:3-5, ledger.ts:3-6, components/data/README.md:12-13,20-21, lights/table.ts:5:
  "the App calls the SAME function" — the App no longer calls dataTenantsOf/planDataLayout (only
  Planner.ts:359 does; grep over src/app finds none).
- ledger.ts:66-81 and types.ts:621-628: table/light tree "allocated strategy-independently, the
  always-upload precedent" — now gated on `reads` (dataTenants.ts:407, :420).
- SceneDataTenants.batchPlacementRecord (dataTenants.ts:104-109) "Planner and App both read this
  array" — nothing outside dataTenantsOf reads it.
- ProgramDescription doc "All fields are RESOLVED ... no optionals" (types.ts:36) — several
  deliberate optionals (aovs, emissionCones, albedo, envSelectWeight, wavelengths,
  colorModelVersion) for byte stability.

## Euclidean assumptions (checked)

planScene is built on Euclidean similarities: `placementOf = similarityFromTransform`,
`classifyPlacement` folding T,s into primitive parameters, `rigidInverse` with quaternion +
translation + scale (`buildDrivenPlacement` :764), `meshWorldArea(..., scale)` (s² area),
`sceneWorldRadius` (hypot about origin), AABB bounds feeding every BVH (sceneData.ts boxes).
The ambient decision lives only in `measurement.ambient` (measurement.ts:23), which planScene
never reads; nothing in plan/ consults it.

## In-progress scaffolding (not dead)

- `measurement.ambient` + AMBIENT_SPACES with one occupant: the curved-space seam.
- CWBVH tenants (`reads.cwbvh`, nodesq channel): an experiment selectable by strategy.
- `response: 'radiance'` with one RESPONSE_PICTURES entry: room for other responses.
- `pack.ts` writeUvec3s `.w` reserved for per-triangle material group (multi-material meshes).
- `shadows: 'opaque-dielectrics'` single value: transparent shadows deferred.
