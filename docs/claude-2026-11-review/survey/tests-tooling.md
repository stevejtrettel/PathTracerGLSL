# Verification and tooling — map (read-only survey, 2026-11-06)

Area: tests/ (all), colocated src/**/*.test.ts, tests/witnesses, scripts/, tools/,
.github/workflows/ci.yml, package.json scripts, vite.config.ts.

NOTE ON METHOD: the shell's `grep` in this environment is a wrapper that silently returned
nothing on some plain-file searches. Every absence claim below was re-run with /usr/bin/grep.

## 1. The gates at a glance (measured on this Mac, Rosetta installed, unless noted)

| Gate | Command | What runs | Time | In CI |
|---|---|---|---|---|
| Typecheck | `npx tsc --noEmit` | src, tests, pages (tsconfig `include`) — NOT scripts/, NOT tools/*.mjs | 6 s, clean | every push |
| Unit/structure | `npx vitest run` | 114 files, 4229 tests, 424 suites — all pass | 87 s wall (glsl-compile alone 65 s) | every push (~3 min on Linux) |
| Spectral asset audit | `npm run audit:spectral` | quadrature of the serialized RGB→spectrum lift | short | every push |
| Compiled-output digest | `npm run digest -- out.json` / `--compare a b` | compiles all 274 sync suite scenes with compileScene; hashes shaders, uniforms, closure results at 2 param points, params, source maps, sceneData plan incl. packed contents, dataReads, warnings | 2.8 s | no (manual) |
| Frames | `npm run frames -- record dir` / `compare a b` | 8 fixed cases rendered fresh on SwiftShader at pinned salt; bit-exact compare | ~37 s typical (one 338 s outlier recorded in docs) | no |
| GLSL probe witnesses | `npm run witness:color / :spectral / :spectral-bindings / :spectral-majorant / :environment / :wavelengths` | execute shipped or generated GLSL in a float framebuffer (tools/render-glsl-probes.mjs), assert numbers, mutation shaders must fail | minutes | manual GPU job only |
| More probe witnesses | `witness:dispersion`, `witness:blackbody`, `witness:spectral-lifecycle`, `witness:spectral-live` | same style | ? | NOT in CI GPU job |
| GPU witness sweep | `npm run witness` | 180 witness scenes with checks (+50 fixture partners), 330 non-perf checks, SwiftShader, pinned salt 1234, frame cache | 45–90 min | manual GPU job |
| Perf | `npm run witness -- --perf` | 22 perf rows, real GPU, report-only | ? | no |

Counts from the live registry (vite-node over pages/registry.ts):
witness entries 230 (180 with checks, 50 partners), checks 352 = mean 176 (175 exact, 1
cross-check), equality 82, twin 58, noise 7, identical 6, tiled 1, perf 22; 413 witness
(scene,strategy) pairs. Demos: 51 entries (7 async .inst data scenes), 101 pairs.

## 2. tests/ layout and counts

| Folder | files | test files | lines (ts) | What it checks |
|---|---|---|---|---|
| tests/app | 17 | 15 | 1450 | App managers with fakes: ParameterStore, RenderCoordinator, ProductionOrchestrator, RendererManager, tiling plan, tiled saves, file export (RGBE/PNG), capture validation, worker, events fallback, shortcuts, builtin assets; sceneData byte fingerprints for every suite scene (snapshot 31 KB) |
| tests/authoring | 5 | 5 | 827 | OBJ parser, group flattening, .inst round trip, instanceCloud fixture compiles (+glslang), subsurface albedo inversion (20 s) |
| tests/compiler | 58 | 55 | 6269 | Validator (1005 lines), Analyzer, planner helpers, light census/desugar/CDF, data reads/layout, pictures/AOV, null budget, spectral planning (~12 files), dispersion, blackbody, snapshots (generated GLSL 3.5 MB for 50 pairs; ProgramDescription 1.1 MB for every pair; spectrum diagnostics 46 KB), glslang compile of every pair under RGB and a 2-channel canary (1038 tests), compile-order independence, suite integrity, source-scanning lint tests (valuesSplitPoint) |
| tests/components | 25 | 24 | 3425 | family contracts (geometry, materials, lights, camera, volume scattering, color), purity (import rule), structure (one-folder rule), row grammar, BVH / flat-SAH / CWBVH / light tree builders, march bounds contain shapes, similarity algebra, instancing pack equivalence, blackbody, D65, gaussian kind, spectrum kinds, ledger, topology, epsilon coupling; fieldTwins.ts helper |
| tests/engine | 7 | 6 | 431 | HDR loader, env sampler table builder, extern textures, draw buffers, resource ids, uniform equality |
| tests/helpers | 11 | 1 | 738 | glslangCheck (validator wrapper + ANGLE `__` rule), compiledJson (stable text of compiled output, shared with the digest), glslDefine (read a #define), halfspace.ts (Chandrasekhar H-function reference, itself gated by halfspace.test.ts), Planck reference, legacy blackbody (for an audit), rgCanary color model (2-channel test representation) |
| tests/witnesses | 66 | 3 | 11091 | the GPU witness registry (index.ts 2558 lines), check vocabulary (types.ts), 60 scene fixture files, README (335 lines, gate policy + standing failures); 3 vitest files pin fixture facts (slab fixture authors the medium it claims, shadow-aim expected values, shader constants) |
| tests/fixtures | 1 | 0 | – | cloud-500.inst |
| src (colocated) | 5 | 5 | 990 | TS twins: ggx (χ² histogram + triple + pdf agreement), rough_dielectric (same + reciprocity, η=1), equiangular (χ² + normalization, 33 s), GRIN Verlet ODE, octahedral equal-area map |

Slowest vitest files: glsl-compile 65 s, equiangular 33 s, subsurface 20 s,
rough_dielectric 17 s, halfspace 9 s, slabAlbedo 8 s.

## 3. What is actually verified, by layer

- **Structure / decisions (compiler)**: very thorough. Validator diagnostics, Planner
  decisions (ProgramDescription snapshot of every pair), exact linkage, layout, order
  independence, packing fingerprints.
- **GLSL text**: snapshot for 50 hand-picked pairs; digest for all 274 scenes (manual).
- **GLSL parses/types**: glslang ES static compile of every registry pair (vertex+fragment),
  mesh backends, plus checks glslang cannot do (no `__` identifiers; one `hit.eps =` per
  `hit.p =`). Runs under RGB and the rg-canary color model to catch hard-coded vec3.
  Limit stated in code: glslang is not ANGLE.
- **Sampling math (TS twins)**: ggx, rough_dielectric, equiangular, GRIN, octahedral have TS
  transcriptions with χ²/pdf tests. The twin is hand-copied ("change one, change both");
  nothing runs the GLSL and the twin on the same inputs. Lambert, mirror, dielectric,
  checker, HG and Rayleigh phase functions, the light samplers have no twin test.
- **GLSL executed (probes)**: color/spectral/wavelength/environment/bindings/majorant/
  dispersion/blackbody scripts run real GLSL in headless Chromium and compare against
  independent quadratures, with deliberately broken mutation shaders that must fail.
  All are spectral/color/env; none touches BSDF or transport technique math.
- **Whole renders (witnesses)**: derived numbers (furnace 0.4, slab transmittance,
  Chandrasekhar plane albedo, η² factors…), estimator equality (pt ≡ pt-nee ≡ pt-mis, χ² on
  measured variance when arms share event coverage, display-space RMSE otherwise),
  cross-backend twins (analytic vs marched vs table vs mesh), bit-identical pairs, tiling.
- **App/engine runtime**: unit tests with fakes, plus the 8 frame cases and the witness
  sweep (which drive the real App in a page).
- **Not verified anywhere automatically**: UI extensions (panels, orbit controls) beyond
  shortcuts; scripts/*.ts types; tools/*.mjs against App API changes (runtime only).

## 4. How the witness runner works (tools/witness.mjs, 1273 lines, plain JS)

- Starts (or reuses) the Vite dev server on :3000, launches Chromium with SwiftShader.
- Bootstrap page `lab.html?witness` exposes `window.app`, `window.sceneSuite`,
  `window.witnessSuite`, `window.__witnessDigest` (pages/scene-lab.ts:51-53, 77).
- Cache: frames (not verdicts) in `.witness-cache/` keyed on the in-page per-pair digest
  (compile() shader text + scene/strategy/params JSON) + a hash of ALL src/**/*.ts +
  src/glsl/shared/*.glsl + public assets + size/spp/salt/mode. Any .ts edit under src/
  invalidates every frame. 1361 cached frames exist locally.
- Each render: new page, `app.stop()`, `app.pinResetSalt(1234)`, select renderer, resize,
  `renderProduction(spp)`, read back float exports. Variance arms clone the strategy with
  `variance: true` and `__var` id and re-initialize the App in-page; an intermittent
  "active renderer lost" race is handled by a selection toggle + one retry.
- Checks: mean (tier exact / cross-check), equality, twin, identical, noise, tiled, perf.
  Exit code = failed + disagreeing checks.
- `--frames record|compare` (same file): 8 FRAME_CASES, bit-exact.

## 5. How a refactor is proven behavior-preserving today

1. `npm run digest -- before.json --keep .digest/before` (3 s) → change →
   `digest after` → `--compare`. Proves compiled output (all 274 sync scenes) unchanged,
   including closure values and packed scene data. Does NOT cover: App/engine runtime, the 7
   async scenes, invalid-scene diagnostics (spectrumDiagnostics snapshot covers that),
   App packing beyond the plan (sceneData.test.ts covers that).
2. `npx vitest run` (87 s): snapshots catch the same compiler drift for their subsets.
3. `npm run frames -- record` before/after + `compare` (~40 s each): bit-exact pictures for 8
   cases through the real App + engine + SwiftShader.
4. Witness sweep only when sampling/transport GLSL changes (45–90 min; and because the cache
   keys on every src .ts file, a pure TS refactor re-renders everything).

For an App reorg (docs/claude-app-decisions.md) the binding contract is the App API the
runner/scripts call by name from untyped JS: stop, pinResetSalt, renderProduction,
readExport, selectRendererByStrategy, initialize, resize, getCanvas, setParameters, save,
renderTiled, getResetSalt, getPictures, getActiveStrategy, getActiveRenderer, saveSession,
restoreSession, getStats, getCanvasSize, getAvailableExports, getActiveRendererId,
extendProduction, capture, buildRenderStamp; plus window.app/sceneSuite/witnessSuite/
__witnessDigest, liveRenderer, lossExtension, initialSession. The app-decisions doc does
not mention the runner.

## 6. scripts/ and tools/ (lines)

scripts (run by vite-node; not typechecked — 14 errors when checked with the project flags):
digest-compiled 157, dump-shaders 78, audit-spectral 60, audit-spectral-emission 42,
audit-spectral-media 30, audit-blackbody 161 (reference generators whose numbers are
copied into witness fixtures), benchmark-spectral 88, witness-spectral 124,
witness-wavelengths 197, witness-spectral-bindings 363, witness-spectral-majorant 101,
witness-environment 120, witness-dispersion 206, witness-blackbody 151.
Each of 10 scripts carries its own copy of the spectral .bin reader; several spectral
scripts are written in a dense one-line style.

tools: witness.mjs 1273 (sweep + perf + frames), render-glsl-probes.mjs 63 (the shared GLSL
execution harness), witness-color.mjs 125, witness-spectral-lifecycle 51,
witness-spectral-live 89 (need a running server), gen-bluenoise 125, inst-format 115,
make-inst-fixture 49, spectral/generate.py (+vendor).

## 7. CI (.github/workflows/ci.yml)

- `test` job, every push/PR: npm ci → audit:spectral → tsc → vitest (Linux, glslang native).
- `witnesses` job, manual dispatch only: Playwright Chromium → witness:color, :spectral,
  :spectral-bindings, :spectral-majorant, :environment, :wavelengths → full sweep; table
  to the run summary; red while standing failures remain.

## 8. vite.config.ts

Git short hash (+ "-dirty") baked as `__GIT_HASH__` for export stamps; port 3000; vitest
`globals: true`, node environment; build inputs index.html (gallery) + lab.html; no minify;
`.hdr` as assets. pages/registry.ts imports tests/witnesses — the built gallery ships the
witness fixtures (deliberate: every witness is viewable in the lab).

## 9. Curved-space readiness of the verification system

- Estimator-equality checks (pt ≡ nee ≡ mis), identical/tiled checks and the closed-box
  furnace (E/(1−ρ)) carry over to any space unchanged: these are the natural first gates
  for H³/S³/H²×R.
- BSDF twins live in the local tangent frame (ambient_dot = dot) — valid in any space.
- Euclidean-specific: slab/half-space derived values, equiangular twin (extrinsic
  distance), witness values using MAX_DIST as the far clip (fog-sky exp(−σ·MAX_DIST)),
  every fixture states `ambientSpace: { type: 'euclidean' }` (53 files).
- No contract test iterates AMBIENT_SPACES (camera, lights, materials, geometry, volume
  scattering each have one). A second ambient occupant gets glslang coverage only through
  scenes that use it.

## 10. Findings — see the structured result for evidence and suggestions.
