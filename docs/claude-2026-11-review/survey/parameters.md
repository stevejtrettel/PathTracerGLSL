# The parameter system, end to end (read-only survey, 2026-11-06)

Scope: how a live value ("a parameter", "a slider") travels from authoring to a GPU uniform,
and the App behaviours hung on it (reset, lock, sessions, panel). Every claim below cites
file:line; "checked" = I read the code; "inferred" = reasoning only.

## 1. Two-minute summary

A scene or strategy field may be a constant or a slider `{ param: 'lamp.power', default, min?, max? }`
(`ValueParam<T>`, src/compiler/types.ts:265). Constants are baked into GLSL as literals; a slider
becomes a uniform named `u_<path with dots→underscores>` (`paramToUniform`,
src/components/glsl-format.ts:38). Each compiler *feature* (core, intersection, materials,
lighting, pixel, camera, environment, aov, transport, accumulation; features/index.ts:37-46)
returns a `FeatureContribution` holding `uniforms: PlannedUniform[]` and
`parameters: Record<path, ParameterMetadata>` (features/types.ts:43-58). `mergeContributions`
dedups uniforms by name and `Object.assign`s the metadata (features/merge.ts:91-110).
`buildUniforms` turns each `PlannedUniform` into the locked engine contract type
`UniformBinding {uniform, parameters: string[], type, compute}` — a plain slider gets the default
closure `params[path] ?? default` (generate/PipelineBuilder.ts:50-66). Derived uniforms (camera
basis, tan(fov/2), light-selection CDF, driven placement quaternions, majorants, blackbody
normalization, RGB stand-ins) carry their own CPU `compute` closure over several paths.

At run time the App's `ParameterStore` (app/ParameterStore.ts) holds what the user/extension
set. Its single `onChange` callback (App.ts:97-125) mirrors every change into the Engine's own
map (`Engine.customParameters`, engine/Engine.ts:44,259), emits PARAMETER_CHANGED, and asks
`_triggersReset(path)` (App.ts:406-412): compiled `ParameterMetadata.triggersReset` if the
ACTIVE renderer declares the path, else a name-prefix heuristic (`shouldResetAccumulation`,
app/events.ts:63-67). Each frame the Engine builds `{engine.* builtins} ∪ customParameters`
(Engine.ts:231-254) and `ParameterManager.setUniformsForShader` (engine/ParameterManager.ts:88-145)
runs each binding's closure when its inputs changed and uploads when the value changed.
The panel (`ParameterPanelExtension`) builds widgets from the active renderer's metadata via
`WidgetFactory`; production locks the store wholesale (ParameterStore.ts:23-31, ProductionOrchestrator.ts:110,205,235).

Some live values deliberately bypass the store and go straight to the engine: measured env
table sizes/weight (`env.size`, `env.sizeOct`, `env.totalWeight`; App.ts:226-239, 348) and the
displayed picture index (`renderer.picture`; App.ts:770, 786).

## 2. File map (lines)

| File | Lines | Role |
|---|---|---|
| src/components/param.ts | 35 | `isValueParam`, `SLIDER_KEYS`, `valueParamProblems` (slider structure; default required) |
| src/compiler/types.ts (parts) | 1183 | `Value<T>`/`ValueParam` (:263-271), `GlslExpressionParam` (:279), `UniformType` (:769), `UniformBinding` (:793), `RESERVED_PARAM_PREFIXES/PATHS` (:814-815), `ParameterMetadata` (:823-846), `CompiledRenderer.uniforms/.parameters` (:1095,1101) |
| src/compiler/plan/types.ts (parts) | 684 | `PlannedUniform` (:558-577), `DrivenPlacement` with its own `parameters` (:585-595) |
| src/compiler/plan/values.ts | 40 | resolve authored value → planned value; scalar `{param}` default broadcast to vec3 (:18-25) |
| src/compiler/generate/values.ts | 201 | `emitValue` (use site: literal vs `u_` name), `mintValueUniform` (declaration + metadata row), `standInUniform` (hashed name for RGB stand-ins of named spectrum kinds) |
| src/compiler/generate/features/merge.ts | 129 | merge contributions; uniform dedup/conflict by (type, parameterPath); metadata last-wins |
| src/compiler/generate/PipelineBuilder.ts | 91 | `buildUniforms` PlannedUniform → UniformBinding |
| src/compiler/generate/Generator.ts | 91 | appends display-pass bindings `u_resolution`, `u_picture` (:56-62) |
| src/compiler/generate/ShaderBuilder.ts | — | hand-declares display uniforms (:91-94) and emits feature uniform decls (:211-216) |
| src/compiler/generate/features/camera.ts | 161 | camera pose, basis closures, fov → u_tanFov, model controls/derived (`mintControl`, `mintDerived`) |
| src/components/camera/index.ts | 127 | `CameraControl`, `CameraDerived`, `AuthoredCameraParamSpec` ('value-number' shape) |
| src/components/camera/basis.ts | 56 | Euclidean look-at frame |
| src/compiler/generate/features/environment.ts | 252 | `env.intensity`, `env.rotation` sliders; `u_envSize` bound to `env.size`/`env.sizeOct` |
| src/compiler/generate/features/lighting.ts | 940 | `env.selectProb` slider or derived; driven light emission; `u_light_cdf/selpdf` float[] closures |
| src/compiler/generate/features/materials.ts | 954 | material/medium/phase rows → mintValueUniform; derived σ̄ and derived-field uniforms |
| src/compiler/plan/Planner.ts:750-870 | — | `buildDrivenPlacement`: TRS sliders → two vec4 uniforms (inverse rigid frame) with fp64 closures + own metadata rows |
| src/components/color/spectra/spectrumKind.ts | 94 | `MintContext` (kinds mint their own sliders/uniforms), `KindField.slider` |
| src/components/color/spectra/blackbody/blackbody.ts | 143 | blackbody `mint`: kelvin slider + vec2 temperature uniform |
| src/compiler/analyze/Validator.ts:176-218 | — | namespace checks: reserved paths/prefixes, identifier form, `paramToUniform` collisions; `collectParamPaths` (:1776) |
| src/compiler/analyze/propertyValidation.ts | 204 | `numberProblems`: slider structure/default/bounds vs domain (materials, lights, env, expressions, kind fields) |
| Validator.ts:786-822 | — | camera 'value-number' slider checks (separate implementation) |
| Validator.ts:1338-1345, 1586-1670 | — | transform slider checks (separate implementation; default optional) |
| src/engine/ParameterManager.ts | 281 | location cache, closure-run-on-input-change, upload-on-value-change |
| src/engine/utils/shader-uniform-utils.ts | 167 | `setUniformValue`, exact `uniformValuesEqual` |
| src/engine/Engine.ts | 535 | `customParameters` map, `_buildParameters` builtins, `setParameter`, `clearAccumulation` → `parameterManager.clearCache()` |
| src/app/ParameterStore.ts | 132 | value map, lock, change batches, serialize/restore, `resendAll` |
| src/app/App.ts | 968 | onChange wiring, `_triggersReset`, `getParameter` (store else metadata default), sessions, `imageParameters` snapshot, MEASURED_ENV_PARAMS |
| src/app/events.ts | 67 | PARAMETER_CHANGED event, `shouldResetAccumulation` prefix heuristic |
| src/app/RendererManager.ts | 401 | `initialParameters` → store.batch (:81,131), `resendAll` on switch/recompile (:247,275), `getParameterMetadata` (active renderer only, :343-356) |
| src/app/RenderCoordinator.ts | 324 | `requestAccumulationReset` (deferred if stopped) |
| src/app/ProductionOrchestrator.ts | 241 | lock/unlock around production |
| src/app/extensions/ParameterPanelExtension.ts | 312 | widgets from metadata, 16 ms throttle, disabled in production |
| src/app/ui/WidgetFactory.ts | 172 | metadata.type → Slider/NumberInput/Dropdown/Checkbox/ColorPicker/HdrColorInput/VectorInput |
| src/app/extensions/OrbitControls.ts / KeyboardControls.ts | 235 / 386 | write `camera.position`/`camera.target` via `setParameters` |

## 3. Data flow of one slider

1. Author: `albedo: { param: 'clay.albedo', default: [0.8,0.2,0.2], min: 0, max: 1 }`.
2. Validate: `collectParamPaths` gathers every `{param}` in scene + measurement (Validator.ts:186-218):
   reserved names, identifier form, uniform-name collision. Slider structure and domain via
   `numberProblems` (propertyValidation.ts:133-163) for material/light/env rows.
3. Plan: `resolveColorProperty` keeps the ValueParam, broadcasting a scalar default (plan/values.ts:18-25).
4. Generate use site: `emitValue` → `u_clay_albedo` (generate/values.ts:74).
5. Generate declaration: `mintValueUniform` pushes `PlannedUniform{name,type:'vec3',parameterPath,default,compute(broadcast)}`
   and a `ParameterMetadata{type:'color', default, name:'Albedo', group:'clay', triggersReset:true, range}` (:150-179).
6. Merge (merge.ts:91-110) → `buildUniforms` → `CompiledRenderer.uniforms` + `.parameters`.
7. Engine load: `ParameterManager.initialize(programs, bindings)` caches locations (Engine.ts:181).
8. Run: panel slider → `queueUpdate` → `app.setParameter` → store.set → onChange → engine.setParameter
   + reset decision → next frame `_buildParameters` → ParameterManager runs closure → `gl.uniform3fv`.

## 4. How many representations of "a parameter"?

Authored spellings (4): `ValueParam<T>` (types.ts:265; default optional in the type);
`GlslExpressionParam` (types.ts:279; same keys, default required); a kind's `KindField.slider`
(spectrumKind.ts:46-55); camera row shape `'value-number'` (camera/index.ts:104).

Compiler-internal (6): `CameraControl` + `CameraDerived` (camera/index.ts:40,57); `PlannedUniform`
(plan/types.ts:558); `ParameterMetadata` (types.ts:823); `DrivenPlacement.parameters`
(plan/types.ts:594); `MintContext` (spectrumKind.ts:28); `FeatureContribution.uniforms/.parameters`.

Engine contract (2): `UniformBinding` (types.ts:793), `CompiledRenderer.parameters`.

Runtime value holders (5): `ParameterStore.parameters` (ParameterStore.ts:5); `Engine.customParameters`
(Engine.ts:44); ParameterManager's `uniformValueCache`/`inputSnapshots`/`computedValues`
(ParameterManager.ts:34-42); `App.imageParameters` snapshot (App.ts:56); `SessionData.parameters`.

Name registries (5): `RESERVED_PARAM_PREFIXES/PATHS` (types.ts:814-815); the prefix heuristic
(events.ts:63-67); `MEASURED_ENV_PARAMS` (App.ts:968); engine builtin names (Engine.ts:238-246);
the `u_` naming rule (`paramToUniform`) plus hashed `u_standin_*` (generate/values.ts:189).

Where a parameter's *default* lives (up to 4 copies): authored `ValueParam.default`;
`PlannedUniform.default` (used by the engine closure when the store has no value);
`ParameterMetadata.default` (used by the panel and `App.getParameter`, App.ts:573-577);
fallbacks inside closures (`?? def`, Planner.ts:776-833; camera.ts:64; blackbody.ts:120).

The word "parameters" itself means four things: primitive shape rows
(`ObjectDescription.parameters`, compiler/types.ts:108), live-slider metadata
(`CompiledRenderer.parameters`), a binding's input paths (`UniformBinding.parameters`), and the
per-frame value map (`Engine._buildParameters`).

## 5. Findings (see structured output for full evidence)

- P1 (guess) reset decision: every compiled metadata row says `triggersReset: true` (all 18 sites
  grep'd); the prefix heuristic decides only for paths the ACTIVE renderer does not declare.
  The owner already deferred a "parameter system revamp" with exactly this diagnosis
  (docs/claude-outputs-accumulation.md:239-258).
- P2 (duplication) ParameterMetadata rows are hand-built at ~12 sites with three label rules.
- P3 (duplication) `mintValueUniform(prop, glslType, metaType, …, hdr, color, role)`: glslType,
  metaType and hdr are functions of (shape, role); call sites disagree (materials hdr only for
  the emission key; media pass no role/color).
- P4 (duplication/guess) three slider validators with different default rules; transform
  sliders may omit default and the Planner substitutes [0,0,0]/identity/0/1.
- P5 (duplication) scalar→vec3 broadcast in three places.
- P6 (duplication) two value stores (store + engine mirror); `resendAll` is a no-op on the engine.
- P7 (duplication) three array-equality helpers.
- P8 (duplication) display-pass uniforms declared by hand in ShaderBuilder and bound in Generator,
  both testing `pictures.length > 1`.
- P9 (complexity) metadata precedence differs: first-wins inside a feature (`seen`), last-wins
  across features (`Object.assign`), `??=` for RGB-kind sliders.
- P10 (doc-code mismatch) compiler-engine-contract.md §7 example; fable-compiler-contracts §2.10;
  compiler/types.ts:810 comment on camera.frame coercion.
- P11 (euclidean) placement payload and camera pose are Euclidean-shaped; the binding machinery
  itself (multi-path closures, mat4 type) is geometry-neutral.
- P12 (research note) compute closures make CompiledRenderer non-serializable; relevant to the
  owner's "export independent scene programs" goal.
- P13 (complexity) `env.*` prefix covers both user sliders and measured load-time data.
- P14 (in-progress) unused-yet surfaces: metadata step/values/options/help/int/bool/vec2;
  PARAMETER_CHANGED (no listener); `engine.time`; ParameterManager debug getters. Keep.
- P15 (defect, minor) panel flush issues one store.set per path → one reset per path per flush.
- P16 (complexity, minor) `restoreSession` strips MEASURED_ENV_PARAMS for old sessions (compat shim).

## 6. A minimal clean model (thought-through, NOT checked by building)

What one parameter needs to carry, once, from the compiler:

```
LiveParameter {
  path: string                      // 'clay.albedo' — the only identity
  shape: 'float'|'vec3'|'vec4'|…    // value shape the store holds
  default: number|number[]          // REQUIRED, one copy
  range?: [min,max]
  widget: 'slider'|'number'|'color'|'hdr-color'|'vector'   // derived from (shape, role) by ONE function
  label, group                      // derived by ONE function from path (+ owning feature)
  section: 'measurement'|'estimator'|'view'                // decides reset; view = no reset
}
UniformBinding { uniform, type, inputs: string[], compute? }  // unchanged contract
```

- One builder `liveParameter(valueParam, shape, role?, group?)` used by every minter
  (materials, lights, env, camera, placement, kinds, expressions) replaces the ~12 inline rows.
- Defaults: the engine closure reads `values[path]`, and the App seeds the store from the
  compiled defaults on load; then neither `PlannedUniform.default` nor `?? def` fallbacks are
  needed for plain sliders (derived closures still need their plan-time evaluation for the digest).
- Reset: "any store change resets unless its section is 'view'". No prefix heuristic; values that
  are not choices (measured env sizes, picture index) already bypass the store.
- Production lock: the same `section` fact (lock what resets; let 'view' through) — the owner's
  own one-fact proposal (claude-outputs-accumulation.md:246-247).
- One value holder: either the engine receives the full value map each frame from the App, or
  the store *is* what the engine reads; not a mirror.
- Pros: fewer moving parts, one place for label/widget rules, removes the only name-prefix guess.
- Cons: touches every minter (wide diff, digest-checkable since shader text and closures do not
  change); `section` must be supplied by each minter (but it is known where the field lives:
  scene/measurement/estimator/view); App changes need owner discussion per AGENTS.md.
