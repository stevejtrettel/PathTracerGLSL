# fable-audit-2026-07-18 — five-front code audit: findings ledger & pass plan

Full read of the codebase (July 18 2026), five parallel fronts, every claim verified against
source before inclusion. This document is the durable record: the later passes (descriptor,
compiler, engine) are planned FROM this ledger — do not re-derive.

**Verdict:** the load-bearing disciplines HOLD — the values.ts split point is real and
test-enforced; zero structural `#define`s; the static-technique-file rule verified clean
(only pinned PathState core touched); component purity mechanical; exact linkage's
provides/emission mirroring genuine; the engine executor blind. The gap to "clean, modular,
close to the math" is at the edges: seams the test nets don't cover, doors finished at
runtime but not in the types, and predicates spelled N times.

**Owner dispositions (Jul 18):** pass sequencing is
1. **components/GLSL pass** — all points 1–8 approved & authorized (BUILT, see ledger below),
2. **generate-stage pass** — items 4/5/6/7 + polish authorized (BUILT); items 1 (selectWeight)
   and 2 (D1 clamp for driven media) are DISCUSS-FIRST; item 3 (Hit.uv) = KEEP, future
   procedural-material example will be its first reader; item 8 = plan for BVH/meshes arrival,
3. **descriptor/registry pass** (geometry/materials/lights) — separate targeted pass, planned
   carefully; geometry is the reference family but may itself change for unity,
4. **compiler pass** (analyze/validate/plan) — AFTER the descriptor pass,
5. **engine/app pass** — last; owner has not yet read that front's report.

---

## Front 1 — Generate stage (`src/compiler/generate/`)

Overall: strongest layer. DERIVED done right repeatedly (rotation cos/sin, u_tanFov, u_aspect,
camera basis, folded placement mat3, one CDF builder shared by five consumers); every
`provides` entry textually mirrors its emission condition; schema.ts kills field drift.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| F1 | M | `lighting.ts:44` guard `(constant \|\| image)` silently drops a procedural env's authored `selectWeight` | **BUILT Jul 19** — `selectWeight` deleted from the scene env; see impl-plan-env-power-selection |
| F2 | M-H | D1 majorant clamp emitted only for `isHeterogeneousMedium` (expressions); `{param}`-driven constant-σ media routed to tracking arms get NO clamp — slider above baked σ̄ → negative null coefficient | **BUILT Jul 19** — DERIVED `u_majorant` closure; emit-driven witness (sweep pending) |
| F3 | M | `Hit.uv` written ×4 (magic `0.1` planar projection: `intersection.ts:355,371`, `raymarch.glsl:56,83`), read ×0 | KEEP (owner) — rendering focus hasn't arrived; first reader = a procedural material example; constant now named `UV_PLANAR_SCALE` |
| F4 | M | Third private copy of may-be-nonzero: `materials.ts:48 isScattering` ≡ exported `mediumMayScatter`; Analyzer has `mayBeNonzero` | FIXED this batch |
| F5 | M | Constant env mints `u_environment_intensity` @ `environment.intensity` (snake_case, outside reserved `env.`, dodges clobber guards) vs image/procedural `u_envIntensity` @ `env.intensity` | FIXED this batch |
| F6 | L-M | `ShaderBuilder.ts:176` declares `u_previous` unconditionally ("always needed" is false — oneshot never reads it); accumulator texture inputs hardcoded in builder instead of contributed | FIXED this batch (declarations ride the accumulation feature, gated on occupant) |
| F7 | L | `lighting.ts:107` hardcodes `'vec3'/'color'` for every driven light row — first driven float row (spot cone) mints a mistyped uniform; `formatVec3(l.values[q.positionRow])` bypasses emitValue (inert under geometry-constant-v1 pin) | FIXED this batch (minting consults the kind's row shape) |
| F8 | L | `intersection.method !== 'raymarch'` statically dead; `'raymarch'` a misnomer post-B1 (also covers pure-analytic) | compiler pass, WITH the BVH/mesh arrival: make it the honest decision `backends: {sdf, analytic, …}` |
| polish | L | camera basis computed 3× per pose change (one closure per u_cameraForward/Right/Up); `void bag` in environment.ts; unused destructure @ environment.ts:153; `computeSelectPdf` re-run per array default; `features[0]`-is-core positional splice; accumulation gate enumerates every type (always true) | FIXED this batch except the features[0] splice (left, commented) |

Taxonomy observation (not graded): `selectWeight` is an estimator control authored on the
scene's EnvironmentDescription — decided in impl-plan-env-as-light D3/O1, but it is where
F1/H3 hid. See §Discussion.

## Front 2 — Components GLSL + src/glsl (ALL points approved & BUILT Jul 19)

Verified fully clean: structural defines (zero), static-file rule, radiometric-literal
discipline (zero raw `vec3()` radiometric), epsilon vocabulary (coherent, named, rationaled),
ambient_dot discipline (documented exemptions only).

| # | Sev | Finding | Action taken |
|---|---|---|---|
| H1 | H | `equiangular.glsl:39` raw `exp()` on a Spectrum — the corpus's ONLY §2.5 breach | `spectrum_exp` |
| M1 | M | `pt.ts:201` bare `32` null-crossing budget (every sibling budget named+pinned); RR cap `0.95` inline | named |
| M2 | M | `Hit.uv` dead + magic 0.1 ×4 | kept per owner; constant named once |
| M3 | M | Concentric disk duplicated (thinlens `concentric_disk` + `disk_light_concentric`) — thinlens's own "promote when a second user appears" trigger FIRED | promoted to core, both copies deleted |
| M4 | M | Schlick five-power inlined ×3 (ggx ×2, mirror) — f0 ROW already deliberately shared | core helper |
| M5 | M-L | Two ONBs: `build_basis` (y-pivot, 0.999) vs `ambient_frame` (x-pivot, 0.9), nothing documenting why | documented (metric seam vs declared-Euclidean sampler helper); NOT merged — merging changes sampling realizations |
| M6 | M | `delta_tracking.glsl:79` comment still describes the REJECTED design ("v1 media don't emit… Le lands RIGHT HERE") in a file that collects emission pre-lottery — following it re-introduces double-counting | rewritten |
| M7 | M | Stale `hg_*` dependency headers on model-generic sites (light_medium, equiangular, kernel_phase, combiner.ts:15) — claim the hardwired-hg coupling the code correctly doesn't have | fixed |
| L1 | L | `sampler_cdf.glsl` unnamed `0.9999999` ×2 | named |
| L2 | L | delta_tracking RR triple: `T /= 0.25` silently encodes 1−q | q named, pair coupled |
| L3 | L | `fresnel_dielectric` op-first (convention: `dielectric_fresnel`) | renamed |
| L4 | L | thinlens `concentric_disk` unprefixed | resolved by M3 |
| L5 | L | raymarch hit-commit block duplicated (in-loop vs stall-exhaustion accepts) | helper extracted |
| L6 | L | point.glsl lone light sampler without the METRIC EXEMPTION header | added |
| L7 | L | delta_tracking inlines `origin + t*dir` where equiangular uses `ambient_geodesic` | routed through the seam |
| L8 | L | octahedral.glsl:3,16 name `env_rotate_y` on a path that provides `env_rotate_cs` | comments fixed |
| L9 | L | `local_to_world` in math.glsl Provides header: zero callers | deleted |

Exemplary (the style bar): dielectric.glsl η² block, quad/disk sampler-pdf adjacency with
pitfall ledgers, placement.glsl, sampler_cdf.glsl, analytic.glsl + pcg4d.glsl transcription
provenance, raymarch.glsl epsilon reasoning.

## Front 3 — Analyze / Validate / Plan (compiler pass — AFTER the descriptor pass)

| # | Sev | Finding |
|---|---|---|
| H1 | H | **Octahedral procedural bake BROKEN**: `EnvironmentBake.ts:47-56` shims the old contract (`const u_envRotation` + `env_rotate_y`) but octahedral.glsl calls `env_rotate_cs`/`u_envRotCS` → undeclared identifiers at bake compile. No test imports `compileEnvironmentBake`. Verified by hand. FIX EARLY (bug, not cleanup) + add a bake compile test. |
| H2 | H | `LightDescription` still a closed union (types.ts:344) — the door test itself casts `as unknown as LightDescription`; `DirectionalLight` is a typed shape whose only role is rejection. B1 treatment due (kind: string + open record). |
| H3 | H | `selectWeight` never validated (no 0<w<1 rule) — authored 1.5 ships invalid selection probability, silent estimator wrongness. **BUILT Jul 19** — `estimator.envSelectWeight` override, Validator-checked (0,1) + inert-knob warning; default is the DERIVED power partition (impl-plan-env-power-selection). |
| M1 | M | Validator quad-degeneracy name-branch (`Validator.ts:161` + private `quadCrossSq`) duplicates descriptor-declared `validateAuthored`/`quadArea`; no multi-row constraint slot on PrimitiveDescriptor — add `validateValues?` fact (descriptor pass). |
| M2 | M | plan/types.ts:157 stale comment ("orthographic … unregistered"); `CameraDesc`/`AccumulationDesc`/`TonemapDesc` hand-mirror the authored unions member-for-member. |
| M3 | M | Camera/tonemap door claims overstated: registries keyed by closed unions mirrored in two files; `CAMERA_MODELS` vestigial `\| undefined` + dead Validator filter. |
| M4 | M | `SceneFeatures.materials.hasProcedural`: dead flag (zero consumers) with a hardcoded 4-field property list contradicting the open row vocabulary. |
| M5 | M | Dead census fields (geometry counts, lighting counts, `media.hasHeterogeneousMedia`); heterogeneous routing computed 3× (Analyzer field dead, Validator `sceneNeedsTracking`, Planner `heterogeneousArms`). |
| M6 | M | Emissive-samplable predicate spelled 5× (Analyzer census, Validator ×2, Planner route, driven-transform exclusion); constant-nonzero-emission leg alone ×3. Export ONE predicate (the `mediumRoutesToTracking` pattern). Guards pt ≡ pt-nee. |
| M7 | M | `ProgramDescription.environment` embeds RAW authored env, violating the record's own "all fields RESOLVED" pin — Generate re-applies defaults; where F1 hid. Resolve env into the plan record. Also: env is the only occupant family with no registry (chart ternaries ×2 sites). |
| M8 | M | `IntersectionDesc.method: 'raymarch'` single-variant + unconditionally set; real backend composition re-derived in Generate. Make honest with BVH arrival (`backends: {…}`). |
| L1-L10 | L | Stale `StandardAnalytic` comment (Validator.ts:50); duplicate tracking-need computed twice in one function (Validator.ts:441/455); stale phase-registry header ("HG sole occupant" above rayleigh); tonemap header self-contradiction (allowlist); B2 fossils (plan/types.ts:285 "color·intensity"); dead 'exponential' plan branch (Validator rejects first); Analyzer `mayBeNonzero` dup (FIXED in generate batch); `ldr` allocation note (RESOLVED — target exists now); env-samplable census asymmetry (constant checks intensity>0, image/procedural don't — inert-knob class); correctly-fenced name-branches (ggx softrange, 'directional' message, lambert-as-backing — no action). |

Exemplary: geometry/index.ts end-to-end (the door done right), Planner light desugar fully
descriptor-fact-driven, `EMITTING_MODELS` derived-from-registry with rot rationale,
Generator reads exactly `${strategy.id}-${scene.id}` outside the plan.

## Front 4 — Descriptor/registry layer (`src/components/*.ts`, `src/authoring/`) — NEXT targeted pass

Reference family: **geometry** (declarative ParamKind + constraint, required-XOR-default
enforced, canonicalize/fold seams, two-direction symbol contracts). Owner: happy to change
geometry too where it buys unity.

| # | Sev | Finding |
|---|---|---|
| M1 | M | Lights door closed at the authoring-type surface (= Front-3 H2). |
| M2 | M | Camera/tonemap registries keyed by compiler unions (= Front-3 M3). |
| M3 | M | Four occupant families with NO registry: **accumulator** (type→path if-chain in accumulation.ts — the hasLambert pattern), **env charts** (ternaries), **ambient**, **intersection**. Ambient is the non-Euclidean seam — carve its door BEFORE the first curved-space occupant. |
| M4 | M | Constraint vocabulary ×3: geometry `constraint:{kind}`, materials `domain:`, lights imperative (sphere/disk hand-write positive-radius/min-length that geometry declares). Reserve `validateAuthored` for genuinely coupled rules. |
| M5 | M | `authoredParams` has no `default` slot — disk light's normal default in CODE at 2 sites (`?? DEFAULT_NORMAL`), a 3rd copy of geometry's declared row default; schema can't say optional-with-default vs optional-and-computed (spot falloffStart legitimately computed). |
| M6 | M | Materials lack the DERIVED compute rail cameras have (CameraDerived) — ggx recomputes `roughness²` ×3 per evaluation; the deferred material half of descriptor-compute. |
| M7 | M | Quad light's derived `area` declared `kind: 'length'` — area scales s², not s; latent (kind only picks typedef today) but sits on the rail docs promise will drive Value<T>-light transform rules. ParamKind lacks `area`/derived-opaque. |
| L1 | L | Phase family three names: folder `volume_scattering/`, type `PhaseModelDescriptor`, CLAUDE.md `phase/`. |
| L2 | L | Stale comments same family (registry header "HG sole", hg.ts "phase_hg.glsl"). |
| L3 | L | Provenance `origin` inconsistent: hand-written (camera/tonemap/pixel, untested), derived-at-consumer (materials/lights), absent (sampler/sensor, consumer hardcodes). Derive everywhere. |
| L4 | L | Camera param-path naming mixed: `camera.fisheyeFov`/`camera.cylHfov` vs generic `camera.aperture`/`camera.scale`. |
| L5 | L | `Value<>` spelling vestigial in CameraDescription (fov wrapped, aperture bare — ALL always-live under the instrument principle). One spelling should win. |
| L6 | L | Lights contract test misses geometry's kinds-imply-shapes check (`kind:'point', shape:'number'` would pass). |
| L7 | L | materials registry order load-bearing (Planner dispatch order) documented only at consumer; geometry documents at the registry. |
| L8 | L | lights/index.ts ↔ occupant ESM cycle via `radiantScalar` — extract `lights/power.ts` (basis.ts/similarity.ts precedent). |
| L9 | L | Duplicate `Vec3Tuple` (octahedral.ts vs similarity.ts). |
| L10 | L | Five families' contract tests live in `materialsContract.test.ts` — split/rename. |
| L11 | L | `flattenGroups` leaf-name replaces path while group-name is a segment — two `ball` leaves in different groups collide (caught late by symbol-clobber with a worse message). |
| L12 | L | Key-matches-id test exists only for materials+geometry. |

Verified clean: purity (incl. type-vs-value), all geometry kinds correct (incl. plane's
coupled fold, disk's derived direction fold, spot cosines as similarity-invariant angles),
required-XOR-default, 1-component-1-folder, desugar totality both directions. The
constant-vs-driven authoring surface is principled-and-declared except M6/L5.

Doc note: CLAUDE.md family names stale — `phase/` → `volume_scattering/`, `film/` →
`accumulator/` + `sensor/` + `tonemap/`; pixel→sensor/tonemap carve unreflected.

## Front 5 — Engine + App (LAST pass; owner has not read this report yet)

| # | Sev | Finding |
|---|---|---|
| F1 | M-H | `Engine.renderLdr` hardcodes four compiler names outside the locked contract (`display-pass`, `'ldr'`, `accumulation_previous`, `u_radiance`) — ship as data on CompiledRenderer (extend exportTargets/ldrRecipe), extend the contract doc. |
| F16 | M | RenderControls hardwires `autoExportAllAOVs: true` → `exportAllAOVs` THROWS on every standard renderer (only hdr/ldr/±variance targets exist) → autoSave skipped, "Production render failed". |
| F6 | M | ParameterManager runs every compute closure per frame per linked shader (value cache skips only the GPU upload); the `parameterToBindings` change-index built for recompute is used only by a debug accessor. The scaling cliff for hundreds-of-objects; fix = dirty-set flush via the existing index. |
| F11 | M | Reset-prefix vocabulary duplicated & drifted (`app/events.ts` ParamPrefix vs compiler `RESERVED_PARAM_PREFIXES`): missing `env.` → spurious "Unknown parameter prefix: env.size" warn every env scene load; `developer./scene./material./light.` dead. One list. |
| F13 | M | ColorPicker is LDR ([0,1] clamps both directions) but driven emissions mint `'color'` widgets — touching the swatch destroys HDR radiometry (e.g. 40 → ≤1). Needs color×intensity split or non-clamping vector widget. (The scalar→broadcast widget fix itself is correct.) |
| F2 | M | Estimator math in engine loaders: `build-environment-sampler.ts` owns CDF construction, per-chart Jacobian ("must match env_texel_dOmega"), NEE blur, MIS compensation; `HDREnvironmentLoader` hardcodes extern names. Move beside the charts in components (octahedral-twin precedent); engine keeps dumb upload. |
| F20 | L-M | `recompile(scene)` with a CHANGED scene id leaks old renderers (manager + engine + GPU buffers), shifts 1-9 indices. Diff-and-unload. |
| F12 | M-L | ParameterPanel `GROUP_ORDER` is dead-architecture vocabulary (2 of 9 names exist; 'Placement' + object groups unsorted). Ordering belongs on ParameterMetadata or first-appearance. |
| F9 | M-L | KeyboardControls Q/E roll is a no-op under the pose-only camera rail (frame state can silently disagree with shader). Cut roll or add a rail control. |
| F4 | L | `engine.time` injected per frame, ZERO consumers (u_time left in exact-linkage) — dead builtin + accessors; CLAUDE.md list stale. |
| F7 | L | Stale two-variant `EngineState` exported from engine/types.ts vs real four-variant; `cacheUniformLocations` zero callers; `Engine.getParameter/getAllParameters` zero callers. |
| F8 | L | `camera.frame` a reserved fossil (ParameterStore.restore coercion + reservation, never set/read). |
| F10 | L | Orbit/keyboard fire two `setParameter` per input event → two accumulation resets per tick; `ParameterStore.batch` exists. |
| F14 | L | `cycleDisplayMode` probes `debug./renderer.displayMode` — emitted nowhere; M-key always "No display mode parameter found". |
| F15 | info | exportPNG/'ldr' known-gap is FIXED (buildExportTargets defines ldr; chain complete) — ledgers updated. |
| F17 | L | Unlistened events (CAMERA_MOVED etc.) — fine as API; CAMERA_MOVED duplicates store flow. |
| F18 | L | TiledRenderer export-only; if revived, its tile exports carry NO reproducibility stamp (saveTile omits the stamp arg). |
| F3 | L | Stale engine comments (scene.metallic example; TextureRegistry "bind()" reference in HDREnvironmentLoader). |

Exemplary: `RenderExecutor._bindTextures` (§2.10 done right), `_buildParameters` exact-six
builtins, recompile compile→GPU-validate→commit staging, reset-trigger single decision point,
resize-resets-all (Engine-#4 fix intact), id namespacing + clobber protection all verified.

---

## Discussion items (owner + model, before code)

**selectWeight.** What it is: the two-stage NEE selection probability P(sample the env) vs
P(sample a scene light), wrapping the baked env CDF as `u_envSelectProb`. Nothing else in the
lighting system is authored this way — scene lights get selection probabilities DERIVED from
the area-aware power CDF. The env is special today only because its "power" wasn't derived.
Direction under discussion: derive the env's entry in the same power CDF (env power estimate
from the baked luminance integral × solid measure), demote `selectWeight` to an optional
estimator-side override, validate its domain, and resolve it into ProgramDescription (closes
F1/H3/M7 in one move).

**D1 clamp for driven-σ tracking media (F2).** Two candidate shapes: (a) widen the clamp gate
— emit `min(σ, σ̄)` in the lookup for ANY tracking-routed medium with a live coefficient;
(b) make the majorant DERIVED — for `{param}`-driven constant-σ media the exact majorant IS
max-channel σ_t of the live values, a per-frame CPU compute closure (category 5), so the
slider moves and σ̄ follows exactly; clamp-in-lookup remains for expression media (where σ̄
cannot be derived). (b) is the correct system by the ceiling-as-definition semantics and the
precompute-the-HOW rule; cost is σ̄ becoming a uniform in the tracking arms for such media.

**Hit.uv (F3).** Kept. First reader: a procedural material example (e.g. checker/grid via a
schema-declared expression or a small procedural occupant) — makes uv real and forces the
"which chart owns uv" question (today: hardcoded planar xz × `UV_PLANAR_SCALE`; a real design
would put the chart on the primitive descriptor).

**BVH/meshes (F8/M8).** When the second intersection backend arrives: registry-carve the
intersection family (Front-4 M3), replace `method: 'raymarch'` with the honest
`backends: {sdf, analytic, mesh…}` decision in ProgramDescription, and the dead guard
disappears with it.
