# Compiler front half — map and findings

Area: src/compiler/Compiler.ts, index.ts, types.ts, analyze/ (Analyzer, Validator,
propertyValidation, rgbPreview, spectral, types), src/errors/, and the SceneDescription /
RenderStrategy types (both defined in src/compiler/types.ts). Read-only survey, 2026-11-06,
branch claudeapp.

## 1. Files and line counts

| File | Lines | Role |
|---|---|---|
| src/compiler/Compiler.ts | 73 | `Compiler.compile` / `compileScene`: analyze once → validate per strategy → planRenderers (all strategies) → generate per strategy → validateCompiledRenderer. Throws `CompilationError` on the first bag with errors; collects warnings as deduplicated strings. |
| src/compiler/index.ts | 16 | Public re-exports (Compiler + a handful of types). |
| src/compiler/types.ts | 1183 | Three things in one file: (a) the scene description language (l.21–548), (b) RenderStrategy (l.554–761), (c) the locked compiler↔engine contract (CompiledRenderer, pipeline, uniforms, exports, l.763–1183). Also 12 runtime predicates (media routing: mediumRoutesToTracking, mediumWeightsAbsorption, …) and constants (SETTING_ROLES, RESERVED_PARAM_*). 231 files import it. |
| src/compiler/analyze/types.ts | 46 | `SceneFeatures` — the census record. |
| src/compiler/analyze/Analyzer.ts | 69 | Builds the census: media flags, total light count (authored + samplable emitter objects via plan/dataTenants), env samplable, ambient space id, `hasMeshes`. |
| src/compiler/analyze/Validator.ts | 1809 | `validate(features, scene, strategy, bag)` — one ~1340-line function (l.50–1387) plus helpers: validateGeometryObject, validateRotation, validateScale, placementProblem, validatePrimitiveConstraint, isVec3, validateExpressionParams, collectParamPaths, validateFinite. ~170 diagnostics. |
| src/compiler/analyze/propertyValidation.ts | 204 | The one checker for an authored value in a setting (named spectrum kind / GLSL expression / {param} slider / constant), with role-derived domains (`roleDomain`, `slotDomain`) and the RowConstraint interpreter (`constraintViolation`). Clean, well-factored. |
| src/compiler/analyze/rgbPreview.ts | 27 | Warns when a named reflectance spectrum's RGB stand-in clips. |
| src/compiler/analyze/spectral.ts | 58 | Spectral-only limits: reflectance ≤ 1, media ceilings for the tracking bound. |
| src/errors/index.ts | 33 | Barrel. |
| src/errors/RenderErrors.ts | 93 | Typed error classes (RenderError base + 7 subclasses). Only SessionError, RenderStoppedError, EnvironmentLoadError are used outside src/errors. |
| src/errors/core/Diagnostic.ts | 146 | Diagnostic record (severity, code, message, source, location w/ originalLocation path, suggestions, relatedInfo). |
| src/errors/core/DiagnosticBag.ts | 347 | Fluent builder (`bag.error(code,msg).withOriginal(...).suggest(...).add()`), `throwIfErrors`, core `CompilationError`. |
| src/errors/core/codes.ts | 402 | Registry of code ids with category + description. Only `isKnownCode` is used (by tests/compiler/diagnosticCodes.test.ts); `category`/`description` are never read. |
| src/errors/compiler/validation.ts | 347 | `validateCompiledRenderer` — structural check of compiler output (lives in errors/, used by Compiler.ts). |
| src/errors/reporters/DiagnosticReporter.ts | 328 | ConsoleReporter (used by RendererManager), JSONReporter. |
| src/errors/resources/validation.ts | 255 | HDR/texture validation (used by engine HDREnvironmentLoader). |

## 2. Data flow

```
SceneDescription ──analyze()──► SceneFeatures (census, 8 fields)
        │                              │
        └──────────┬───────────────────┘
                   ▼  (once per strategy; first error throws)
     validate(features, scene, strategy, bag)
                   ▼
     planRenderers(features, scene, strategies, bag)   [plan/ — out of this area]
                   ▼
     generate(plan_i, scene, strategy_i, bag) + validateCompiledRenderer
                   ▼
     CompiledScene { renderers[], dataReads, sceneData, warnings[] }
```

Analyzer runs on unvalidated input, so its helpers must be total (they are: e.g.
samplableEmitterObjects skips unknown materials). Analyzer imports plan/dataTenants (the one light
census) — the analyze stage depends on a plan-stage module.

## 3. The scene description language (what an author writes)

```ts
SceneDescription {
  id, name?,
  ambientSpace: { type: 'euclidean'|'hyperbolic'|'spherical', parameters?: { curvature? } },
  objects: (PrimitiveObject | MeshObject | InstancedObject)[],
  materials: Record<name, MaterialDescription>,   // ids = insertion order
  lights: LightDescription[],                    // { kind, emission, ...descriptor rows }
  environment?: none | constant{color,intensity,sampleAsLight} | procedural{glsl,…} | image{url,…},
  ambientMedium?: <material name whose medium fills region −1>,
  provenance?: string,
}
```

- PrimitiveObject: `{ type (registry key incl. defineSDF-registered locals), parameters:
  Record<string, number|number[]> (constant only), material, transform?, name?, backend? }`.
  No `kind` field — discriminated by absence.
- MeshObject: `{ kind:'mesh', positions, indices, normals?, uvs?, material, transform?, closed?, name? }`.
- InstancedObject: `{ kind:'instanced', prototype, placements: Transform[] | PackedPlacements,
  attributes?, placementRecord?: 'frame', name? }`.
- Transform: Euclidean similarity TRS, every field `Value<>` (constant or `{param}`); rotation
  axis-angle or quaternion; scale a positive scalar.
- Value<T> = T | { param, default?, min?, max? }. GlslExpression = { kind:'glsl', source, params? }.
- Spectrum values: number | Vec3 | {param} | GlslExpression | named kinds (blackbody, gaussian);
  index values add cauchy/sellmeier. Seven aliases: ScalarProperty, IndexProperty,
  SpectrumProperty, SpectrumValue, NamedSpectrumValue, MaterialProperty, LightEmission.
- MaterialDescription: `model` (registry key, or 'none' = null interface) + open-vocabulary
  property keys (index signature) + `medium?` + `sampleAsLight?`.
- MediumDescription: sigma_a, sigma_s, emission, ior (GRIN), phase_g, model, majorant.
- LightDescription: `{ kind, emission, [key]: unknown }`; rows declared by the light descriptor.
- `CustomSDF` interface (types.ts:221) is "RESERVED" and referenced nowhere else in src;
  scene-local fields are delivered instead by `defineSDF` (components/geometry/custom.ts), which
  registers into the global PRIMITIVES registry at module load.

## 4. Strategy (measurement / estimator / view)

docs/fable-strategy-taxonomy.md (pinned): scene + measurement = the integral, estimator = the
computation (never changes the converged image), view = display. The types follow it:

- MeasurementDescription: camera (CameraPose + `type` + descriptor rows), response?
  ('radiance' only), maxBounces (required), maxNullCrossings?, scattering?, shadows?
  ('opaque-dielectrics' only), color?, sensor?, aovs?.
- EstimatorDescription: wavelengths?, directLighting (required), lightSelection?,
  envSelectWeight?, russianRoulette (required, null = off), volumeSampling?,
  mediumLightSampling?, envSampler?, envCompensation?, meshTraversal?, instanceAccel?,
  objectDispatch?, accumulation (required). 13 flat fields.
- ViewDescription: tonemap { type, exposure?, … }.

Defaults: measurement defaults are applied once in plan/measurement.ts `resolveMeasurement`;
estimator defaults have no resolver and are applied ad hoc with `??` in Validator, Planner,
dataTenants and App (see findings).

## 5. Validation and diagnostics

- Validator order: ambient-space gate → NEE-needs-a-light → lights (per-kind row schema,
  emission, validateAuthored) → per-object geometry (validateGeometryObject: backend pin,
  descriptor degeneracy, row schema, mesh buffer sanity, closed-mesh topology, defineSDF bound
  containment + conservativeness via TS twin) → finiteness sweep → expression params →
  parameter namespace → material names → validateSceneProperties (all rows, media, phase) →
  sampleAsLight / phantom-light rules → model registration → media rules (majorant,
  GRIN matrix, phase_g) → estimator axes (envSelectWeight, budgets, RR, envSampler,
  envCompensation, equiangular pins, volumeSampling, lightSelection 'bvh' pins,
  meshTraversal/objectDispatch/instanceAccel incl. cwbvh pins) → camera row schema + pose →
  color/sensor/wavelengths + spectral limits + rgb preview → measurement enums → aovs → RR
  start depth → exposure → environment → ambientMedium → region-table rows + ggx roughness +
  inert {param} keys → empty scene → accumulation/tonemap → missing material refs → instanced
  batches (placements, prototype, emitters, attributes) → transmissive-on-thin → transforms.
- Codes used in Validator: invalid-setting (106 errors + 27 warnings), incompatible-options
  (15), invalid-transform (14 + 3), missing-material (2), missing-geometry (1), empty-scene (1).
- Diagnostics reach the user as message strings; Compiler.ts keeps warnings as a deduplicated
  string list. Locations (`withOriginal('scene', path)`) are attached on only some rules.

## 6. Readiness for a "space" choice (Euclidean / S³ / H³ / H²×R)

Present: `scene.ambientSpace.type`, registry-gated by AMBIENT_SPACES (one occupant,
euclidean), census field, ProgramDescription.measurement.ambient, and the GLSL seam
(ambient_geodesic/frame/dot/parallel_transport/direction_to in
components/ambient/euclidean/euclidean.glsl). That is the right door.

Euclidean-typed parts of the description that a curved space would have to answer for (math,
checked against the types):
- Transform.scale and PackedPlacements.sizes: S³, H³ and H²×R have no homotheties; their
  isometry groups contain no scaling. A "similarity" placement does not exist there.
- Transform.rotation as a full SO(3) element: the point stabilizer in S³ and H³ is SO(3), but in
  H²×R it is O(2)×Z/2 — a general 3D rotation is not an isometry of H²×R.
- Transform.position / PackedPlacements.positions / CameraPose / light `point` rows as Vec3: need
  a declared chart (e.g. exponential coordinates at a base point, or a model like the Poincaré
  ball / hyperboloid), and translations no longer commute, so TRS composition order matters.
- ParamKind 'direction' rows (directional, beam lights) and the environment ("what a ray sees
  when it hits nothing", MAX_DIST far clip): S³ is compact — geodesics close, nothing escapes —
  and in H³ "a direction at infinity" is an ideal point, not a parallel family.
- `ambientSpace.parameters.curvature` is declared but read nowhere; the TS union lists
  'hyperbolic' and 'spherical' (not product spaces).
- No per-space validation exists: nothing says which placements, primitive types, light kinds,
  env kinds or cameras a space supports.

## 7. Notes on neighbors

- plan/measurement.ts resolves measurement defaults (and falls back `ambientSpace?.type ??
  'euclidean'` although the field is required).
- plan/dataTenants.ts owns the light census used by Analyzer and Validator.
- App.ts envVariants re-derives the env chart default ('equirect') — documented exception in
  CLAUDE.md, but the literal default is a second copy.
- docs/claude-review-2026-09-25.md Part 2 and docs/claude-improvements-2026-09.md item 4
  ("Declarative strategy schema") already flagged parts of what is below.
