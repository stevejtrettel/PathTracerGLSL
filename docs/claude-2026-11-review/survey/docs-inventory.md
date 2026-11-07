# Documentation inventory — PathTracerGLSL (survey of 2026-11-06, read-only)

Scope: every top-level file in `docs/` (141 files, 140 docs + `docs/README.md`, ~38,000 lines),
`docs/claude-2026-11-review/` (1 file), `docs/archive/` (listing only: 129 files), root
`README.md` (127 lines), `CHANGELOG.md` (2,714 lines, newest first, 85 dated entries; the
top ~200 lines read), `CLAUDE.md` (305 lines), `AGENTS.md` (27 lines, untracked).

Also relevant but outside docs/: 26 `README.md` files under `src/` (one per component family plus
a few others; 67 `.md` files in `src/` in total) and `tests/witnesses/README.md`. In practice these
are the live contracts for the component families. (Counted with `find src -name README.md`.)

How the statuses below were found: the first lines of every doc (its own status header), the last
commit that touched it (`git log -1`), and cheap checks against code where noted ("checked" = I read
the code that shows it). "Header" means the doc's own status line, which I did not re-verify.

Status legend:
- **AUTH**: current design authority (present-tense, still governs).
- **AUTH*:** authority, but parts contradict the current code (details in §3).
- **EXEC**: plan executed; now a build record (history).
- **OPEN**: in-progress design or plan, not (fully) built. Keep. It serves future work.
- **HOLD / SHELVED / DEFERRED / PARKED**: deliberately paused; keep.
- **WITHDRAWN**: rejected by the owner.
- **SUPERSEDED**: replaced by a named doc.
- **HANDOFF**: session handoff (history; process lessons).
- **RECORD**: review, audit, research or measurement record (history / evidence).
- **GUIDE**: user-facing how-to.

## 1. Root files

| File | What | Status | Contradicts code? |
|---|---|---|---|
| CLAUDE.md | Orientation, architecture, invariants, conventions, verification, status, design-authority table | AUTH (has uncommitted "How to work here" section pointing at AGENTS.md) | Family list (line ~"geometry, materials, lights, …") omits `aov` and `color`, which exist in `src/components/` (checked). Status heading says "September 2026" though it includes Oct 1 AOVs. Defect count "221 of 265 synchronous suite scenes" predates the 5 `guides` scenes (digest now reports 268+5; CHANGELOG 2026-10-01). Design-authority table: see §4. |
| AGENTS.md | Owner's working constraints (no speculative machinery, one concrete change at a time, no commits unless asked, App rewrite withdrawn 2026-10-04) | AUTH (untracked) | — |
| README.md | Public README: four layers, status, quick start, architecture box, example, keys, features | AUTH* | "Still Euclidean-only: heterogeneous media and curved spaces … are the road ahead" (heterogeneous media are built, CLAUDE.md Status). Component box lists `phase`, `film` (now `volume_scattering`, `accumulator`, `tonemap`, checked). The keys table lacks `m` (picture cycle), `p`, `j`, `o`, `\` (AppShortcutsExtension.ts:83-153, checked). Example's comment "strategies: transport, camera, accumulation, display" predates measurement/estimator/view. |
| CHANGELOG.md | History, newest first | AUTH (history) | Top entry 2026-10-04 (uncommitted) says the rollback recovery copy is at `/private/tmp/pathtracer-before-app-rollback-w081s938`; **that directory no longer exists** (checked with ls). The bottom block (lines ~2650-2714) is an older "BUILT" narrative style. |

## 2. docs/ — every file

### 2a. Index and current-review folder

| File | Lines | What | Status | Notes |
|---|---|---|---|---|
| README.md | 76 | Docs index: "Reference" (≈58 rows), "Guides" (3), Archive pointer | AUTH* | Lists 61 of 140 docs; **79 docs are not indexed** (checked with a loop over `ls`), among them 5 of the 15 CLAUDE.md design authorities: fable-strategy-taxonomy (owner-pinned), trace-loop-contract, fable-components, fable-data-rail, fable-light-bvh. Lists architecture.md as "Full system reference" while CLAUDE.md says to prefer CLAUDE.md over it. Wrong rows: step-6 plan "(PROPOSED)" (built Oct 1), fable-rough-dielectric "NOT built" (built Aug 11), fable-epsilon-discipline "NOTHING BUILT" (built via impl-plan-epsilon-discipline), fable-sdf-contract "facts sheet (bound, lipschitz, …)" (lipschitz deleted, sdf-contract line 83). The first row is the outputs plan, not an authority. |
| claude-2026-11-review/decisions.md | 35 | Owner decisions of this review (scope, branch commits allowed, goals: Euclidean/S³/H³/H²×R, black holes if feasible, quotients later, WebGL2 for good, App open for redesign, order b→a→c) | AUTH (untracked) | Item 7 refers to "App decisions 1–17 (docs/claude-app-decisions.md history…)" but that history is **not in the repo**: the file is untracked (no git history) and now holds only the withdrawal note; the /private/tmp recovery copy is gone. The only surviving summary is the model's memory file `app-reorg-state.md`. |

### 2b. Design authorities and contracts (fable-*, contracts)

| File | Lines | Last commit | What | Status | Contradiction notes |
|---|---|---|---|---|---|
| fable-strategy-taxonomy.md | 233 | 09-30 | Meaning of measurement / estimator / view; bias ledger | AUTH (owner-pinned) | Header says the schema restructure "lands with the decision-hoist batch; until then … flat schema" — decision-hoist is built and `RenderStrategy` is `{id, measurement, estimator, view}` (src/compiler/types.ts:561-566, checked). Stale header only. |
| trace-loop-contract.md | 160 | 09-26 | Ray / scene_intersect / Hit / interaction loop; ambient_dot rule; ray_spawn; shadow_transmittance to a point | AUTH* | Line 24: "RGB uses an initialized placeholder; spectral rendering remains unimplemented." False since Sep 27 (four-wavelength spectral built, CLAUDE.md status). Struct shapes match src/glsl/core/structs.glsl:11-38 (checked). It says "length() is Euclidean; a geodesic ambient-distance helper is the curved-space follow-up". |
| fable-compiler-contracts.md | 754 | 09-30 | GLSL contracts: conventions §2, materials §3, Hit/regions/media §4, curved space §5, lights §6, transport §7, spectral §8, stress tests §9, migration §10, validation §11 | AUTH* | Top status: "item 9 (transport split) deliberately last"; §10.1 item 9 says DONE. §1 non-goals list "mesh/BVH geometry" (built). §1.1 V1-C1 (homogeneous only), V1-C2 (analytic lights only), V1-C3 (SDF-only intersection) are all relaxed in code. §5.1 names `ambient_transport`; code has `ambient_parallel_transport` and `ambient_direction_to` (src/components/ambient/euclidean/euclidean.glsl:25,31, checked). §8: "Spectral rendering … remain planned" (built). §5.3: "NEE/MIS in general spacetimes is analytically hopeless … curved scenes select BSDF-sampling": the owner's chosen spaces have analytic two-point geodesics, so this framing needs revisiting. |
| compiler-engine-contract.md | 1293 | 10-01 | "LOCKED" compiler↔engine types: CompiledRenderer, RenderPipeline, examples, responsibilities | AUTH* | §2 RenderPipeline matches code (types.ts:980-991, checked). Extensions (ldrRecipe, picture facts) are maintained. **§1 is stale:** `RenderStrategy { algorithms, settings }` vs code `{ id, measurement, estimator, view }`; `SceneDescription {objects, materials[], lights}` vs code with `id, ambientSpace, materials: Record, environment, ambientMedium, provenance` (types.ts:21-41); `sourceMap: SourceMap` vs code `sourceMaps?: Map<…>` (types.ts:1097). §7 "Project"/`compileProject` don't exist; the code uses `Compiler.compileScene` (Compiler.ts:26). Dated "January 2025". |
| fable-components.md | 306 | 07-15 | Component library: families, one-folder rule, purity, transport anatomy (§7) | AUTH* | §4 tree is stale: `film/`, `phase/`, `components/transport/pt/transport.ts`; code has `accumulator/`, `tonemap/`, `volume_scattering/`, `aov/`, `color/`, `sensor/`, `pixel/`, `transport/integrators/pt/pt.ts` (checked by ls). The rules text (folder rule, README per family, purity) still holds. |
| fable-module-anatomy.md | 169 | 09-28 | Descriptor and property-schema shapes | AUTH* (drifted sketch) | §2 `MaterialModelDescriptor` has `capabilities.deltaLobes/transmission/emissive`; code has `nonDeltaLobes`, `transmission`, `support`, `emissive`, `readsUv`, plus `albedo`, `derived`, `usesMicrofacet` (src/components/descriptors.ts:104-158, checked; the code comment itself says "Polarity flipped vs module-anatomy §2's sketch"). Header "File reorganization is DEFERRED", but impl-plan-descriptor-reorg is BUILT. The real authority is now descriptors.ts. |
| fable-reference-implementations.md | 717 | 09-26 | "Normative" GLSL to transcribe: Lambert, dielectric, HG, shadow, v1 loop, light samplers, GGX, rough dielectric, MIS diff, classifier, ambient geodesics (H³ sketch §10) | AUTH* | §1 Lambert uses raw `dot(wi, hit.frame.n)` (line ~368); the built lambert.glsl:10 uses `ambient_dot(…, hit.p)` as the trace-loop contract requires (checked). §10 uses `ambient_transport` (name drift). The H³ hyperboloid sketch in §10 is in-progress design for curved space. It flags the open "direction at a far hit (wo)" question. |
| fable-validation-scenes.md | 119 | 09-30 | Validation scenes with derived expected values; July scoreboard | AUTH (derivations); scoreboard historical | The live scoreboard and standing failures are in tests/witnesses/README.md. |
| fable-transport-verification.md | 95 | 09-25 | Adversarial traces: innermost-wins, no medium stack, null interfaces | AUTH (rationale) | Seam names it relies on exist (checked: scene_region_at, ior_of, material_of, medium_sample, medium_transmittance, shadow_transmittance). |
| fable-volumetric-component.md | 235 | 09-27 | Media seams; interface vs segment separation; chromatic sampling | AUTH | 31 code comments cite it. |
| fable-heterogeneous-media.md | 370 | 09-27 | Heterogeneous media design (majorant ceiling, 2×2 dispatch, tracking) | AUTH | — |
| fable-transforms.md | 439 | 08-09 | Placement = Euclidean similarity; flat SceneDescription; groups in authoring | AUTH | `flattenGroups` in src/authoring/flatten.ts (ls). The similarity commitment is explicitly Euclidean, so it is a curved-space design question (isometries of H³/S³/H²×R). |
| fable-data-rail.md | 193 | 09-25 | Six shared data textures ("six, forever"), ledger | AUTH | DATA_CHANNELS has the six (src/components/data/channels.ts:11); the seventh (integer `nodesq`, CWBVH) is outside the "six" roster (channels.ts:18). The doc mentions CWBVH once. |
| fable-sdf-contract.md | 264 | 08-11 | SDF object contract: canonical field + declared facts; generated march/normal; `defineSDF` | AUTH | Updated in place (lipschitz deletion recorded at line 83). |
| fable-light-bvh.md | 329 | 09-25 | Light tree design (no cones v1; stage 2 instance clouds) | AUTH | Stage 2 status not checked. |
| fable-variable-ior.md | 332 | 09-27 | GRIN media authority (Sharma ODE, Verlet, interfaces, L/n²) | AUTH | It points to the external `~/Code/PathTracer/docs/curved-light-blackhole.md` (exists). The GRIN walker is the only curved-ray integrator so far. |
| fable-sdf-accel.md | 106 | 08-10 | Boxed-SDF leaves (LEAF_SDF) design | AUTH (built) | — |
| fable-rough-dielectric.md | 266 | 08-11 | Rough dielectric design + two-sided NEE policy | AUTH (built Aug 11; the index wrongly says NOT built) | — |
| fable-instance-clouds.md | 255 | 08-08 | `.inst` instance-cloud system design | AUTH (built) | `cube` shape deferred. |
| fable-instance-attributes.md | 159 | 09-28 | Per-instance material attributes (4th storage class) | AUTH (built) | — |
| fable-mesh-containment.md | 184 | 07-21 | Closed meshes in scene_region_at | AUTH/EXEC (built) | — |
| fable-mesh-lights.md | 142 | 07-21 | Emissive mesh NEE/MIS | AUTH/EXEC (built) | — |
| fable-object-tables.md | 176 | 09-25 | Stage B object tables + scene TLAS | AUTH/EXEC (built) | — |
| fable-accel-cwbvh.md | 239 | 09-25 | CWBVH experiment: built, measured 0.85×, NO-GO, kept as non-default occupant | RECORD (negative result; the occupant is deliberately maintained) | Not dead: kept on purpose as the documented alternative. |
| fable-epsilon-discipline.md | 326 | 08-12 | Investigation of surface-proximity epsilons, confidence-graded | RECORD (header "NOTHING BUILT" is stale: impl-plan-epsilon-discipline BUILT from it) | — |
| fable-subsurface.md | 597 | 08-12 | Subsurface research, owner decisions, plan; steps 1–3 built, step 4 unstarted | OPEN | 49 code comments cite it (the most cited doc). |
| fable-imagery.md | 161 | 07-22 | Imagery pass menu: P1 UV charts BUILT; P2 expression materials, P3 filters, P4 PNG export, P5 showcases pending | OPEN (partly stale) | P4 ("dead `ldr` target") looks addressed by the ldrRecipe/save work (inferred). P3: only a `box` pixel filter exists (ls src/components/pixel). Serves photorealism goal (c). |
| fable-emitter-profiles.md | 96 | 08-10 | Angular emission axis; build when a 2nd profile is wanted | OPEN (future possibility) | — |
| fable-expression-machinery.md | 140 | 07-22 | Symbolic algebra layer (parse/differentiate GLSL expressions) | OPEN (handoff, not approved) | Relevant to algebraic surfaces/varieties and curved space. |
| fable-authoring-language.md | 372 | 07-17 | High-level scene authoring language (classes, prefabs, build phase) | OPEN (DRAFT, "nothing here is authority yet") | src/authoring/ implements only flattening/loaders. Relevant to the App/authoring simplification. |
| fable-measurement-bench.md | 127 | 09-30 | Witness runner + variance + stamps (owner-cut proposal) | EXEC/RECORD | — |
| fable-component-system.md | 392 | 07-17 | End-to-end walkthrough with "REAL compiled output" | RECORD (snapshot of Jul 17) | Its compiled excerpts certainly predate spectral/outputs changes (inferred). |
| fable-geometry-materials-target.md | 392 | 09-26 | Before/after tags [BUILT]/[ASPIRATIONAL], as-built ledger | RECORD (+ some ASPIRATIONAL items = OPEN) | — |
| fable-transport-glsl-target.md | 432 | 07-13 | Target emitted loop shape; BUILT | EXEC | Says technique bodies are `techniques/*.glsl`; now subfolders (ls). |
| fable-review.md | 162 | 07-11 | July code review + status updates | RECORD | — |
| fable-audit-2026-07-18.md | 206 | 07-19 | Five-front audit ledger | RECORD | — |
| fable-naming-audit.md | 219 | 07-17 | Naming audit, resolved | RECORD | — |
| fable-light-bvh-starter.md | 98 | 08-10 | Session starter | SUPERSEDED (by fable-light-bvh) | — |
| fable-sdf-accel-starter.md | 107 | 08-09 | Session starter | SUPERSEDED (by fable-sdf-accel) | — |
| fable-sdf-accel-research.md | 239 | 08-10 | Research record behind LEAF_SDF | RECORD | — |
| fable-inst-format.md | 203 | 08-08 | `.inst` spec + writer's guide (self-contained) | GUIDE (external) | — |
| fable-webgpu-handoff.md | 479 | 07-17 | Self-contained project description for the WebGPU successor | RECORD (July snapshot) | Superseded in detail by later work. |

### 2c. claude-* docs (Sep–Nov 2026)

| File | Lines | What | Status |
|---|---|---|---|
| claude-app-decisions.md | 39 | App simplification: withdrawal 2026-10-04, owner's goals, "how to continue" | AUTH (untracked; decisions 1–17 text lost, see §2a) |
| claude-outputs-accumulation.md | 442 | THE outputs/pictures plan + build record (steps 0–6 built) | AUTH for pictures/outputs (plan §1–§10 as approved + "The build so far") |
| claude-outputs-accumulation-discussion.md | 768 | Design discussion + 3 reviews | RECORD (marked "superseded by the plan") |
| claude-outputs-accumulation-revised.md | 380 | Revised draft | SUPERSEDED (merged into the plan) |
| claude-outputs-step0-plan.md … step6-plan.md | 188/80/70/119/100/153/406 | Per-step plans, each "Built … every prediction held" | EXEC |
| claude-outputs-step7-plan.md | 277 | OIDN denoising step 7 | OPEN (proposed, not built; untracked; not indexed) |
| claude-outputs-review-cleanup-plan.md | 35 | Cleanup after the steps 1–5 review | EXEC |
| claude-oidn-test-plan.md | 554 | Earlier OIDN plan | HOLD (superseded in practice by step-7 plan; keeps oidn-web facts) |
| claude-grin-spawn-floor-plan.md | 227 | Remove GRIN 0.001 spawn floor | EXEC (Oct 1) |
| claude-data-exact-linkage.md | 87 | Scene data by exact linkage | AUTH/EXEC (built Sep 25; one App-side derivation `envVariants` remains, as CLAUDE.md says) |
| claude-scene-once-plan.md | 199 | Plan the scene once, then each renderer | EXEC (CHANGELOG 09-26 "steps 0–3") |
| claude-lamp-power-plan.md | 73 | Sky's share of light samples under the light tree | EXEC (Sep 28) |
| claude-review-2026-09-25.md | 259 | Review of 33 commits; findings + batch order | RECORD (partly open; CLAUDE.md cites it as the list of open items) |
| claude-review-batch2..5-plan.md | 237/207/415/116 | Review batches | EXEC (batch 5 item 5.5 paused, owner item 3 open) |
| claude-review-handoff.md | 176 | Where the Sep 25 review stands; batch 6 next | HANDOFF (stale: says "update or delete it when the review is done"; batch 6 never resumed) |
| claude-improvements-2026-09.md | 516 | Suggested next work: correctness, features, speed, structure, tooling, curved spaces (Part 6), unverified audits | OPEN (menu; items 1.1, 1.2 built) |
| claude-design-review-2026-09-28.md | 666 | Whole-renderer design review; Part 7 = docs (index out of date, spectral docs bloat, lab-notebook READMEs) | RECORD/OPEN ("everything else below is still open") |
| claude-spectral-design.md | 1472 | Spectral design (color family, lifts, storage, majorants, film) | AUTH-ish (math & reasons), status header updated |
| claude-spectral-implementation-plan.md | 1468 | Spectral build plan; still titled "draft for adversarial review" | EXEC/OPEN (S2 forms remain); title stale (checked); the Sep 28 review says D2/D4/D8 are marked Proposed though built (reviewer claim, not re-checked) |
| claude-spectral-review-2026-09-28.md | 457 | Spectral code review | RECORD |
| claude-spectral-bugfix-plan.md | 147 | Fixes A1… from that review | EXEC |
| claude-spectral-authoring-survey.md | 135 | Production practice research (Indigo, Octane, Maxwell, Wētā, pbrt, Mitsuba) | RECORD (research) |
| claude-spectral-showcase-plan.md | 133 | Spectral showcase scene + Gaussian material | EXEC (Sep 28) |
| claude-blackbody-comparison.md | 132 | Kim vs Planck measured comparison | RECORD |
| claude-spectrum-spec.md | 418 | One spectrum type (owner-approved) | AUTH (§1–3) / step 4 parked |
| claude-spectrum-bindings.md | 181 | Bindings design (step 4) | PARKED |
| claude-spectrum-fields.md | 1159 | Spectra in every slot; steps 1–4 built; step 5 plan (fog glow takes any light spectrum) | OPEN (uncommitted edits add "Step 5 in full", awaiting owner) |

### 2d. impl-plan-* (build records, mostly July–Aug 2026)

| File | Lines | Header status | Actual status |
|---|---|---|---|
| impl-plan-2.10-contributions.md | 108 | "in progress (July 2026)" | Stale header: `FeatureContribution` is used by pt.ts, pixel.ts, camera.ts (grep, checked); contracts §10.1 says items absorbed into the §2.10 block, which landed. Probably EXEC (inferred). |
| impl-plan-analytic-backend.md | 126 | dated plan note | EXEC |
| impl-plan-area-lights.md | 226 | DONE | EXEC |
| impl-plan-audit-hardening.md | 151 | "proposed — pending owner review" | Stale: fable-review.md line 9 and impl-plan-env-as-light.md:10 ("Prerequisite: impl-plan-audit-hardening.md (built)") say built (checked text). EXEC |
| impl-plan-blackbody-uv.md | 62 | Historical; superseded by blackbody README | SUPERSEDED |
| impl-plan-cameras.md | 226 | BUILT | EXEC |
| impl-plan-decision-hoist.md | 160 | BUILT | EXEC |
| impl-plan-descriptor-reorg.md | 174 | BUILT | EXEC |
| impl-plan-descriptor-unification.md | 128 | BUILT | EXEC |
| impl-plan-dielectric.md | 190 | IMPLEMENTED | EXEC |
| impl-plan-directional-beam.md | 191 | BUILT | EXEC |
| impl-plan-display.md | 148 | "PLANNED (Jul 14)" | Stale: `accumulator/` and `tonemap/` families exist with 2+7 occupants (ls, checked). EXEC |
| impl-plan-driven-lights.md | 108 | "PLAN — implementation not started" | Probably stale for Stage A: light rows accept `ValueParam` (descriptors.ts:39) and CHANGELOG line 1015 mentions "a light emission slider". Stage B (driven light geometry) OPEN per CLAUDE.md "Not built". (inferred) |
| impl-plan-engine-app.md | 85 | ALL BUILT | EXEC |
| impl-plan-env-as-light.md | 318 | BUILT | EXEC |
| impl-plan-env-power-selection.md | 82 | owner-authorized | EXEC (inferred) |
| impl-plan-epsilon-discipline.md | 170 | BUILT | EXEC (carries the tier table; effectively the epsilon authority) |
| impl-plan-equiangular.md | 115 | BUILT | EXEC (area-light equiangular arms OPEN per CLAUDE.md) |
| impl-plan-exact-linkage.md | 109 | BUILT | EXEC |
| impl-plan-expression-machinery.md | 281 | DEFERRED (owner) | DEFERRED, keep (varieties/curved-space customers) |
| impl-plan-geometry-descriptors.md | 229 | BUILT | EXEC |
| impl-plan-glsl-layout.md | 67 | BUILT | EXEC |
| impl-plan-grin-interface.md | 108 | BUILT | EXEC |
| impl-plan-grin-media.md | 114 | BUILT (batches 1–2); per-region step knobs PLAN awaiting go | EXEC + small OPEN |
| impl-plan-heterogeneous-media.md | 194 | BUILT | EXEC |
| impl-plan-instanced-containment.md | 220 | BUILT (line 109) | EXEC |
| impl-plan-instancing.md | 174 | BUILT | EXEC |
| impl-plan-interaction-reshape.md | 113 | (no header) | EXEC (contracts §10.1 item 1 done) |
| impl-plan-item2-hit-regions.md | 121 | (no header) | EXEC |
| impl-plan-item3-lightsample.md | 146 | (no header) | EXEC |
| impl-plan-item5-shadow-transmittance.md | 136 | dated note | EXEC |
| impl-plan-item6-spectral-discipline.md | 94 | (no header) | EXEC |
| impl-plan-media.md | 187 | DONE | EXEC |
| impl-plan-medium-emission.md | 202 | BUILT | EXEC |
| impl-plan-mesh-bvh.md | 182 | BUILT | EXEC |
| impl-plan-meshes.md | 372 | "v0 BUILT — GPU-UNSWEPT" | EXEC |
| impl-plan-placement-fold.md | 123 | stages 1–3 BUILT | EXEC |
| impl-plan-realistic-camera.md | 209 | SHELVED (owner-declined; re-triggers listed: spectral) | SHELVED, keep (spectral landed, so its trigger may have fired) |
| impl-plan-region-materials.md | 124 | BUILT | EXEC |
| impl-plan-rough-dielectric.md | 104 | build ledger | EXEC |
| impl-plan-scattering.md | 90 | "PLANNED (Jul 14)" | Stale: `volume_scattering/` with `hg`, `rayleigh` exists (ls, checked). EXEC |
| impl-plan-sdf-accel.md | 106 | owner-approved, built | EXEC |
| impl-plan-sdf-as-shape.md | 244 | owner-approved; §1 reversed by sdf-contract | EXEC (partly superseded) |
| impl-plan-sensor.md | 77 | "PLANNED (Jul 14)" | Stale: `sensor/` with `ideal`, `cie1931` exists (ls, checked). EXEC |
| impl-plan-tabulated-env.md | 95 | BUILT, superseded by env-as-light | SUPERSEDED |
| impl-plan-tlas.md | 159 | Stage A BUILT | EXEC (Stage B = object tables, built) |
| impl-plan-transport-split.md | 144 | BUILT | EXEC |

### 2e. Older architecture docs, handoffs, guides

| File | Lines | Last commit | What | Status | Notes |
|---|---|---|---|---|---|
| architecture.md | 1344 | 09-30 | "Full system reference" (App/Engine detail, data flows) | AUTH* / largely stale | Says the compiler is a "minimal vertical slice (step zero) … real compiler unbuilt" (lines ~267-277, ~1278). Points at `TODO.md` (missing), `src/math/` (missing), `src/compiler/scenes/` and `__tests__/` (missing), all checked with ls. App/Engine sections are probably still useful (not checked in depth). CLAUDE.md already says to prefer CLAUDE.md. |
| architecture-decisions.md | 330 | 03-04 | "LOCKED" Jan 2025 decisions summary | SUPERSEDED (de facto) | "Simple, one-at-a-time compilation" contradicts `Compiler.compileScene(scene, strategies[])` (Compiler.ts:26). Its dev/prod `compiled.js` mode is not in code (grep, no match). |
| compiler-system.md | 521 | 09-26 | "As built" compiler description | AUTH* / largely stale | The top pipeline is updated, but §"GLSL Architecture" lists `rng.glsl`, `raymarch.glsl`, `lambert.glsl` library files, `path_trace.glsl`/`main_accumulate.glsl` templates, and "Current Limitations: SDF sphere/plane/box, Lambert, point lights" (lines ~412-521). None match the code (src/glsl/core, src/components). architecture.md calls it the authoritative compiler doc. |
| compiler-new-plan.md | 475 | 07-07 | Original compiler plan | SUPERSEDED (self-marked HISTORICAL) | — |
| compiler-next-architecture.md | 349 | 07-07 | Next-step compiler ideas | SUPERSEDED (partly; §1 scene/strategy split now built as compileScene) | — |
| design-scene-graph-transforms.md | 617 | 07-16 | External transforms draft | SUPERSEDED (by fable-transforms) | — |
| deferred-owen-sobol-sampler.md | 208 | 07-08 | Owen-Sobol sampler: built, verified, reverted; conditions to re-adopt | DEFERRED, keep | Says active sampler is `src/compiler/generate/glsl/rng.glsl`; it is now `src/components/sampler/pcg4d/pcg4d.glsl` (ls, checked). |
| handoff-2026-07-16.md | 133 | 07-17 | Session handoff with behavioral contract | HANDOFF | — |
| handoff-2026-07-18-descriptor-compute.md | 189 | 07-18 | "Descriptors compute" abstraction (design, not built at the time) | HANDOFF | values.ts header holds the result (inferred). |
| HANDOFF-2026-07-22-grin-session.md | 121 | 08-08 | GRIN session ended over process; revert or keep question | HANDOFF (resolved: GRIN built) | — |
| HANDOFF-2026-08-10-sdf-accel-session.md | 187 | 08-10 | SDF-accel session adjudication | HANDOFF (resolved) | — |
| inst-onepager.md | 106 | 08-08 | `.inst` writer's one-pager for collaborators | GUIDE (external) | — |
| layout-system.md | 404 | 2025-11-27 | App layout modes | GUIDE | `LayoutMode = 'fullscreen' \| 'centered' \| 'editor' \| 'split'` (AppLayout.ts:15) matches (checked). |
| ui-components.md | 479 | 2025-11-27 | UI component library | GUIDE | Not checked in depth. |
| production-rendering.md | 317 | 09-30 | Production renders, tiling, save | GUIDE | All 17 `app.*` methods it uses exist in App.ts (checked by grep). Current. |

### 2f. docs/archive (listing only)

129 files: `BUILD-STRATEGY.md`, `SIMPLE-COMPILER-BUILD-PLAN.md`, `README.md`, `PROGRESS/` (module/recipe era: app, engine, errors, guides, reference, world), `START/` (20-phase plan, contracts, pillars), `rebuild/`. CLAUDE.md: dead architecture, but its problem analyses are useful (trace-loop-contract cites `archive/START/contracts/optics/*`). The archive README's "What's current" section points at `CURRENT-STATE.md`, `ARCHITECTURE.md`, `docs/COMPILER-ENGINE-ARCHITECTURE.md`, `docs/ARCHITECTURE-DECISIONS-SUMMARY.md`; none exist under those names (checked).

## 3. Cross-cutting facts

- Size: 140 docs, ~38k lines; the 15 design authorities total ~4,800 lines; the spectral docs
  alone (design + plan + fields + spec + bindings + review + survey) ~5,100 lines.
- Code cites docs heavily: 306 references to `fable-*/impl-plan-*/claude-*/…​.md` in 74 files under
  src/tests/tools/scripts/pages (grep -o, checked). Top: fable-subsurface 49,
  fable-volumetric-component 31, fable-heterogeneous-media 16, fable-variable-ior 9. No reference
  from code points at a missing doc (checked by loop). **Renaming or moving docs breaks
  these pointers.** Many cite sections (§), so a doc rewrite also shifts targets.
- Dangling links between docs: none, except an intentional external path
  (`~/Code/PathTracer/docs/curved-light-blackhole.md`, which exists).
- Live contracts actually moved into `src/components/<family>/README.md` (26 READMEs) and
  `<occupant>.md` math notes. The docs index does not mention them.
- Prior self-review of the docs: claude-design-review-2026-09-28.md Part 7 (index lists 47 of
  117, 9 historical docs not archived, 4 plans saying "planned" for built work, spectral docs
  ~3,700 lines for ~550 lines of code, READMEs as lab notebooks, CHANGELOG verbosity). Most of
  it is still true (the index is now 61 of 140).

## 4. CLAUDE.md "Design authority" table: accuracy

| Doc | Verdict |
|---|---|
| fable-strategy-taxonomy | Accurate concept; stale header. Not in docs index. |
| trace-loop-contract | Accurate types; one false line (spectral "unimplemented"). Not in index. |
| fable-compiler-contracts | Mixed. §2 conventions, §3–4, §6–7 likely still govern. §1 non-goals, §1.1 v1 constraints, §5.1 names, §8, top status, §10.1 are stale. |
| fable-components | Rules hold; §4 tree stale. Not in index. |
| fable-module-anatomy | Descriptor sketch drifted; code is the authority. |
| fable-reference-implementations | Math holds; Lambert transcription violates the ambient_dot rule the code follows; `ambient_transport` name drift. |
| fable-validation-scenes | Derivations hold. |
| fable-transport-verification | Holds. |
| fable-volumetric-component | Holds (seams exist). |
| fable-heterogeneous-media | Holds (not deeply checked). |
| fable-transforms | Holds for Euclidean. |
| fable-data-rail | Holds; 7th integer texture outside its "six". Not in index. |
| fable-sdf-contract | Holds, kept current. |
| fable-light-bvh | Holds (not deeply checked). Not in index. |
| compiler-engine-contract | §2 pipeline and extensions hold; §1 types, §7 Project stale. |

Missing from the table though they govern live code: the spectral contract
(`src/components/color/spectral/README.md`, `color/spectra/README.md`, claude-spectrum-spec), the
outputs/pictures plan (claude-outputs-accumulation.md), the epsilon tier table
(impl-plan-epsilon-discipline.md), GRIN (fable-variable-ior), instance clouds, the witness system
(tests/witnesses/README.md). No doc governs curved space as a whole: only contracts §5,
trace-loop-contract, reference §10, the ambient README and improvements Part 6.

## 5. What a newcomer actually needs (in reading order)

1. CLAUDE.md, AGENTS.md, docs/claude-2026-11-review/decisions.md
2. fable-strategy-taxonomy.md (what an image means)
3. trace-loop-contract.md (the loop and its types; the ambient seam)
4. fable-compiler-contracts.md §2–§4, §6–§7 only (conventions, materials, Hit/regions, lights, transport)
5. fable-transport-verification.md (why there's no medium stack: read before "fixing")
6. src/components/README.md + the family READMEs for the area being touched
7. compiler-engine-contract.md §2 + the extension notes
8. Area authorities as needed: fable-transforms, fable-sdf-contract, fable-data-rail,
   fable-volumetric-component, fable-heterogeneous-media, fable-variable-ior, fable-light-bvh,
   claude-outputs-accumulation (pictures), spectral README, impl-plan-epsilon-discipline (tiers)
9. tests/witnesses/README.md + fable-validation-scenes.md (how correctness is checked)
10. Guides: production-rendering, layout-system, ui-components

Everything else (≈100 docs) is history or open plans and can be found from the index on demand.

## 6. Proposed docs structure (thought-through-not-checked)

Constraint found: 306 code comments cite docs by **file name** (often without `docs/`), with § numbers.
So the lowest-cost structure keeps file names and paths and changes only the index and the status
headers.

**Option A, index-only (recommended to discuss first):**
- Rewrite `docs/README.md` as four tables: *Authorities* (the ~20 in §5, each with a one-line
  "governs" and a "known stale sections" note), *Open plans and in-progress designs* (OIDN step 7,
  spectrum-fields step 5, subsurface step 4, imagery P2–P5, expression machinery, authoring
  language, emitter profiles, driven lights stage B, realistic camera, Owen-Sobol, improvements
  menu, design review, review open items), *Guides*, *History* (every executed plan, handoff,
  review, audit and research record, grouped by topic with date).
- Fix the 6 stale status headers (impl-plan-display/scattering/sensor/audit-hardening/2.10, and
  fable-epsilon-discipline "NOTHING BUILT"), and the false lines in authorities (trace-loop
  line 24; contracts §1/§1.1/§5.1/§8 status notes; compiler-engine-contract §1/§7).
- Pros: no broken pointers, nothing deleted, small diff, the owner can review it in one sitting.
- Cons: docs/ stays a flat folder of 140 files, and the index has to be maintained by hand.

**Option B, folders (git mv):** `docs/design/`, `docs/plans/`, `docs/records/` (or
`docs/archive/2026/`), `docs/guides/`, `docs/reviews/`.
- Pros: the folder itself shows status.
- Cons: ~306 code citations and many doc cross-links to rewrite (mechanical but large, and easy to
  get wrong with § anchors). Docs also change category over time (plan → record), which means
  another move each time. Not recommended unless the owner wants it.

**Separately (thought-through-not-checked):** architecture.md + compiler-system.md +
architecture-decisions.md are three overlapping "system overview" docs and all are stale in the
compiler part. One short present-tense overview (or CLAUDE.md's Architecture section, which is
already that) would replace all three. They would be marked superseded, not deleted.
Pro: removes the most misleading docs for a newcomer. Con: the App/Engine detail in architecture.md
(data flows, ping-pong, MRT, sessions) has to be checked and kept somewhere first.
