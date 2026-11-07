# Capability tracking: who implements what, per ambient space

Key: capability-tracking. Repo at 818d433 (branch claudeapp). Nothing in the repo was edited.

Labels: [checked-code] read in source (file:line); [checked-num] a script in this folder ran it;
[math] derived on paper; [mem] from memory, not checked; [web] read from the upstream source
or docs with WebFetch.

Scripts in this folder:
- `matrix.mts` (+ `raw-hooks.mjs`, `raw-register.mjs`, a `?raw`/`?url` loader so node can import
  the real registries): walks 18 registries and prints a support table. Output: `matrix-output.md`.
  Run it from the repo: `npx tsx --import <dir>/raw-register.mjs <dir>/matrix.mts`.
- `design1-mock.mts`: a toy version of design 1 (keyed bodies → matrix + diagnostic).
- `ideal-endpoint.mts`: checks the H³ sky-direction formula used in §3.

---------------------------------------------------------------------------------------------

## 1. How the codebase records support facts today

There is no per-space support fact anywhere. `AMBIENT_SPACES` has one occupant
(components/ambient/index.ts:21-23) and its descriptor is `{ type, glsl }` (ambient/index.ts:14-19)
[checked-code]. Everything else is Euclidean by assumption.

For other axes there are **seven distinct patterns** [checked-code]:

| # | pattern | where | what it says |
|---|---|---|---|
| P1 | **Registry membership** = supported | Validator.ts:56 (ambient), :82 (light kind), :299 (material model), :364 (phase), :484 (env chart), :625 (lightSelection), :675 (meshTraversal), :685 (objectDispatch), :706 (instanceAccel), :756 (camera), :896 (aov), :1045 (accumulator), :1056 (tonemap), :1153 / geometry `resolveBackend` (primitive) | "key exists ⇒ usable". 14 gates, each with its own message. |
| P2 | **Support list naming another family's keys** | `SensorDescriptor.colorModels` (sensor/index.ts:10; cie1931.ts:8 `['spectral']`; index.ts:17 `['rgb']`), read at Validator.ts:857. `ColorModelDescriptor.wavelengthSamplers` (color/index.ts:14), read at :861. `AccumulatorDescriptor.statistics` (accumulator/index.ts:43), read at :1053. `SpectrumKind.roles` (color/spectra/spectrumKind.ts:58), read at propertyValidation.ts:105. | The closest precedent for "supports space X". A list on the occupant, one generic check. |
| P3 | **Optional fact / flag = capability**, read by a generic rule | Primitives: `provides` (descriptors.ts:394, read by `resolveBackend` geometry/index.ts:115-122 and the backend-pin check Validator.ts:1466), `similarityClosed` :405, `uvChart` :411, `thin` :420, `bounds` :425 (absent ⇒ cannot be an instance prototype), `marchBound` :445. Lights: `delta` :218, `deltaQuery` :228 (absent ⇒ rejected under equiangular, Validator.ts:547), `emissionCone` :270, `treeBounds` :287 (absent ⇒ rejected under lightSelection 'bvh', Validator.ts:646). Materials: `usesMicrofacet` :116, `capabilities.{nonDeltaLobes, transmission, support, emissive, readsUv}` :124-148. AOV `requires` (aov/index.ts:19). Estimator registries' `nodeTexture`/`tlasTexture`/`nodesqTexture` (intersection/index.ts). | Facts about one occupant; the compiler composes. This is the house style the descriptor guardrail asks for (descriptors.ts:9-12). |
| P4 | **Name branches in the Validator** (survey finding CF-7) | Validator.ts:507 (equiangular), :587/:595 (volumeSampling), :629 (bvh), :696 (unrolled), :714 (cwbvh), :1007 (`mat.model === 'ggx'`), :1210 (`proto.type === 'sphere'`), :928/:941 (env type), :864/:867 (`colorId === 'spectral'`/`'rgb'`), :878 (hard-coded `['rgb','spectral']` list beside `COLOR_MODELS`), :903 (aovs need rgb) | Mostly **pairwise** rules (occupant × occupant or occupant × scene fact). |
| P5 | **Per-mode limitations function** | `spectralLimitations(scene)` analyze/spectral.ts:11, called at Validator.ts:864 only when color is spectral; `rgbPreviewWarnings` :867 | One function holds every "this mode narrows the scene" rule. Value-domain rules, not occupant support. |
| P6 | **Implicit support by typedef polymorphism**, evidenced by tests | `#define Spectrum vec3/vec4` (color/rgb/types.glsl:1, color/spectral/types.glsl:1); `#define Point vec3`, `Direction vec3` (glsl/core/structs.glsl:4-5). No component declares color support; `tests/compiler/spectralMaterials.test.ts:14` compiles every `MATERIAL_MODELS` entry in spectral. No `#ifdef` variant code in any component (only GRIN tuning `#ifndef`s, transport/volume/grin/grin.glsl:50-90). | "Supported in color model X" = "compiles and the test enumerates it". |
| P7 | **Seam linkage check** | generate/features/merge.ts:43-90: duplicate provide ⇒ `seam-conflict`; a require nobody provides ⇒ error; a provide nobody requires ⇒ dead-code error | Feature granularity, after planning; the message names features and seams, not scene objects. |

Counts [checked-num, matrix.mts]: **64 occupants in 18 registries**; 56 carry a `glsl` field; 8
(LIGHT_SELECTIONS ×3, MESH_TRAVERSALS ×2, INSTANCE_ACCELS ×3, OBJECT_DISPATCHES ×2 — the
latter three emit their walks from TypeScript) have none. Not counted: 5 spectrum kinds, 1
integrator, 3 techniques.

**GLSL with no descriptor at all** [checked-code]: the compiler imports 12 component GLSL files
directly (grep of `?raw` imports in src/compiler): accel/bvh, accel/cwbvh, accel/light_tree,
intersection/mesh, transport/shadow/{opaque,media}, transport/volume/{analytic, analytic/emission,
delta_tracking, grin}, env/sampler_cdf, color/spectrum.glsl; plus 10 glsl/core files and
generator-emitted GLSL (march loop, FD normals, hit fill — survey geometry-accel.md E2/E3/E6).
No descriptor field can record their support; they need a different home (§2, part B).

What spectral support tells us [checked-code + math]: color-model support works without any
per-component fact because radiometry is pointwise in wavelength — the same BSDF code is
correct for vec3 and vec4. **Space does not have that property.** A component written against
`Point`/`Direction` and `ambient_*` can compile in H³ and still be wrong: a point light's
irradiance is I/r² in E³, I/sinh²r in H³ and I/sin²r in S³ (geodesic sphere areas 4πr²,
4π sinh²r, 4π sin²r) [math]; area-light pdfs carry the same Jacobian; every closed-form
intersection differs. So "compiles in space X" is not evidence of support, and P6 alone would
be a guess. Materials and phase functions are the exception: they work in an orthonormal
tangent frame (they call only `ambient_dot`, the frame and `microfacet_to_local`, e.g.
materials/checker/checker.glsl:21-42, ggx/ggx.glsl:17-29) [checked-code], so the same file is
correct in every space once the frame is orthonormal for the metric [math].

## 2. How Mitsuba 3 and pbrt-v4 do it

**Mitsuba 3** [web]:
- A variant is a whole-build choice (color mode, backend, precision); "All variants are
  automatically created from a single generic codebase" (docs, key_topics/variants).
- Every plugin is a template `template <typename Float, typename Spectrum>` (src/bsdfs/diffuse.cpp)
  ending in `MI_EXPORT_PLUGIN(SmoothDiffuse)` (object.h: expands to `init_plugin` calling
  `MI_REGISTER_PLUGIN`).
- resources/configure.py generates `MI_REGISTER_PLUGIN` and `MI_INSTANTIATE_CLASS` by looping
  over the one global `enabled` list: **every plugin is instantiated for every enabled variant**.
  There is no per-plugin list of supported variants; the only restriction is the global
  `enabled` list (+ cuda/metal platform filter).
- Unsupported combinations are handled inside the plugin with `if constexpr`:
  `blackbody.cpp` throws `"Not implemented for non-spectral modes"` at **run time**, from
  `eval_impl`/`pdf_spectrum`/`sample_spectrum`; `polarizer.cpp` in a non-polarized variant
  **degrades** to `0.5f * transmittance` with no warning.
- Lesson: no support table exists; "unsupported" is either a late runtime throw or a silent
  substitute. Both violate the owner's rule ("explicit compile errors, never guesses").

**pbrt-v4** [web]:
- No variants. Each interface is a closed type list: `class Shape : public TaggedPointer<Sphere,
  Cylinder, Disk, Triangle, BilinearPatch, Curve>` (base/shape.h); `Dispatch` switches on a 7-bit
  tag (util/taggedptr.h: `tagShift = 57`). Completeness is static: every listed type must
  implement every interface method or C++ fails to compile.
- The GPU (wavefront) path rejects unsupported options with scattered `ErrorExit`s
  (`"The wavefront integrator does not support --force-diffuse."`, the mix-material texture
  check) and, for the integrator name, **warns and substitutes** volpath
  (`"Ignoring specified integrator ..."`) (wavefront/integrator.cpp).
- Lesson: completeness by "every type implements every method" is the analogue of this repo's
  symbol-iff-declared contract tests (tests/components/geometryContract.test.ts:66-126); feature
  gaps are ad hoc checks, and one is a degrade.

**thurston-rebuild** (survey thurston-port.md §2.2) [checked-code of the survey]: each geometry
has its own folder of shapes/lights; support = present in that geometry's folder; geometry chosen
at bundle time by monkey-patching prototypes (listed under "what NOT to copy", §7.1). No table.

Neither renderer has a support matrix; both allow late or silent outcomes. A design that checks
before code generation and prints a table would be stricter than both [reasoning].

## 3. Candidate designs

The common part of every candidate: **the ambient registry keys are the space names**, and the
matrix columns are `Object.keys(AMBIENT_SPACES)`.

### Design 1 (recommended, simplest): bodies keyed by space; "supports X" = "has a body for X"

**A. Occupants with a GLSL body (56 occupants; 7 space-dependent families).**

- In the space-dependent families (geometry, lights, materials, volume_scattering, camera, env
  charts, aov) the descriptor's `glsl: string` becomes `glsl: Partial<Record<SpaceKey, GlslFile>>`,
  `GlslFile = { origin, source }` (the existing `EnvGlslFile` shape, env/index.ts:14-17).
- `supports(d, space) ⇔ d.glsl[space] !== undefined`. One helper `bodyFor(d, space)`.
- **No wildcard key.** A space-free body (lambert) is listed under each space it has been
  checked in, pointing to the same file. A wildcard would claim support for spaces added later
  (Nil, H²×R) without anyone checking: a guess.
- **Families that never see a Point** stay unchanged: tonemap, accumulator, pixel, sampler,
  sensor, color, spectrum kinds (they act on film values) [checked-num: matrix.mts heuristic
  scan finds no ambient or vector operations in them]. They are space-free by contract; one
  line in each family README; the matrix prints them as "all spaces (film-side)".
- **Origins.** Today the origin is derived from the key (`components/<fam>/<key>/<key>.glsl`,
  e.g. intersection.ts:166, lighting.ts:119, materials.ts:75). A shared body listed under three
  spaces must keep one origin, so the origin moves into the value (`GlslFile`). The Euclidean
  origins stay byte-identical ⇒ source maps and the digest stay identical [reasoning; verify
  with `npm run digest` before/after].
- **Facts that change with the body move into the entry, only when a space needs it.**
  Primitives: `provides` (a hyperbolic torus is likely SDF-only), so the primitive entry is
  `{ file, provides }` and `resolveBackend(type, pin)` (geometry/index.ts:115) takes the space.
  Everything else (`params`, constraints, `toValues`, `power`) stays shared until a space
  needs a different value (the "dissolve a conflated fact when a reader asks" rule,
  descriptors.ts:136-139). `power` is a selection heuristic, variance-only (descriptors.ts:271-277),
  so the Euclidean formula is unbiased in H³/S³ [checked-code for "variance-only"].
- **The diagnostic.** One helper, called at the existing P1 gates (no new census):
  `spaceGate(family, key, d, space)` → `"<family> '<key>' has no <space> implementation
  (implemented in: euclidean, hyperbolic)"` [checked-num: design1-mock.mts prints exactly
  this]. Call sites: light kind (Validator.ts:82) **and its backing primitive**
  (`region.primitive`), primitive objects/prototypes (via `resolveBackend`), a primitive's
  `marchBound.type`, material (:299), phase (:364), camera (:756), env chart (:484), aov (:896).
  Reusing the gates avoids a second "which occupants does this scene use" census, which the
  Analyzer was deliberately slimmed to avoid (analyze/types.ts:3-7).
- **Scene-local SDFs** (`defineSDF`, geometry/custom.ts) mint descriptors with one body; they
  would key it by the scene's space (one line in defineSDF) [checked-code that intersection.ts:176
  reads `d.glsl` for local fields].

**B. Things with no descriptor body (8 GLSL-less estimator occupants, 12 directly imported
component files, generator-emitted code).** One table, one function, in the style of P5
(`spectralLimitations`): `spaceLimitations(scene, strategy, space)` in analyze/, driven by a
list of rows `{ name, spaces: SpaceKey[], present(scene, strategy): boolean }`. The same rows
feed the matrix. For the first build the rows would be (from the owner's subset):

| row | present when | spaces |
|---|---|---|
| mesh objects | `isMeshObject` | euclidean |
| instanced objects | `isInstancedObject` | euclidean |
| table dispatch | `objectDispatch === 'table'` **or the Planner default would pick it** (Planner.ts:558, ≥ `MARCHED_TABLE_THRESHOLD` = 9 marched objects, intersection/index.ts:186) | euclidean |
| light tree | `lightSelection === 'bvh'` | euclidean |
| tracking media | volumeSampling 'delta-tracking' or a medium routed to tracking | euclidean |
| GRIN media | `mediumIsDeflecting` | euclidean |
| equiangular | `mediumLightSampling === 'equiangular'` | euclidean |
| environment | `scene.environment` present | euclidean, hyperbolic |

Directional lights, other cameras and the normal AOV need no row: they simply get no H³/S³ body
(part A). The Planner default at Planner.ts:558 is a silent Euclidean-only choice; the row turns
it into an error instead of a guess. **This table names occupants (`'bvh'`, `'table'`) by name**,
which is the CF-7 smell; it is the honest home only because their "body" is TypeScript generator
code, not a file. When a second space gets a body for one of them, that occupant moves to part A.

**C. The matrix.** One vitest test builds the markdown table from the registries (part A, plus
"all spaces" for film-side families) and the part-B rows, and compares it with a checked-in
file using `toMatchFileSnapshot` (vitest 3.2.4, package.json:37; the API is present in
node_modules/vitest/dist [checked-code]). CI fails if the file is stale; `npx vitest run -u`
regenerates it. Snapshot tests are an existing pattern (tests/compiler/spectrumDiagnostics.test.ts:147,
program-description.snapshot.test.ts:42). No new npm script.

**Completeness tests per space** (extend existing ones, no new kind): the symbol-iff-declared
contract tests (geometryContract.test.ts:66-126, lightsContract.test.ts:32-37, materials,
volumeScattering) iterate `(occupant, space)` pairs; a light kind with a body for X requires its
`region.primitive` to have a body for X; a primitive with `marchBound.type` likewise. The
glslang compile tests compile each body in its space's prelude. The contract regexes hard-code
`vec3 p` signatures (geometryContract.test.ts:67, 121, 126); curved bodies use `Point p`
(vec4), so those regexes must accept `Point`.

**Size (estimated, not measured)**: ~15 lines of types/helpers; 38 one-line descriptor edits
(11 primitives also move `provides`); ~10 compiler readers of `.glsl` (listed in §5) and ~29 test
lines that read `.glsl`; ~25 Validator lines (helper + ~9 calls); ~40 lines for the part-B table
and rule; ~40 lines for the matrix test. ≈ 200 changed lines plus mechanical edits. Euclidean
output: no generated text changes if origins are kept (digest-checkable).

**Pros.** The support fact *is* the code's existence, so it cannot drift; one diagnostic voice;
one table; descriptors still state facts about one occupant (the guardrail holds); a mathematician
reading `sphere.ts` sees which spaces it has. **Cons.** A shared body must be relisted per space
(deliberate); part B is a second form (a rows table); `GlslFile` origins are a small new
convention; primitives' `provides` moves.

**Variant 1a (smaller diff, not recommended):** allow `glsl: string | keyed`, plain string
meaning Euclidean only. Saves the 38 edits but every reader branches and the same fact has two
spellings (against "one answer per fact").

### Design 2: a registry per space (thurston-rebuild style)

Each ambient occupant owns `{ primitives, lights, materials, cameras, ... }` registries;
supported = present in that space's registry; Euclidean registries untouched.
**Pros:** zero edits to Euclidean descriptors and readers (lowest Euclidean risk); a space's code
sits together. **Cons:** the TS facts (rows, constraints, `toValues`) are copied or spread
(`{ ...PRIMITIVES.sphere, glsl }`), so which facts differ per space is implicit; every registry
lookup must become space-aware, not only the GLSL readers: ~140 lookup lines across
PRIMITIVES (26), LIGHT_KINDS (39), MATERIAL_MODELS (41), VOLUME_SCATTERING_MODELS (11),
ENV_CHARTS (10), AOVS (9), CAMERA_MODELS (4) [checked-num: grep counts, include imports]; breaks
"one folder per occupant"; the matrix must union N registries. Larger than design 1 (estimated
300-500 lines) and more places to forget.

### Design 3: one body per component, typedef-polymorphic (the Mitsuba/Spectrum model)

Every component is written once against `Point`/`Direction` and `ambient_*`; no support facts;
"supported" = it compiles; the ambient decides by typedef. **Pros:** the fewest facts (none);
matches how color models work today (P6). **Cons:** compiling is not evidence of correctness in
curved space (falloffs, Jacobians, intersections differ, §1). Unsupported combinations would
come out as GLSL errors or as silently wrong images: a guess. It also gives no table. Usable
only for the space-free subset (materials, phase functions), which design 1 already covers by
relisting the same file.

(Not a separate candidate: an allow-list on the ambient descriptor ("H³ supports sphere,
lambert, ...") breaks the guardrail (a descriptor naming other components) and still needs the
per-space bodies of design 1, so it adds a list that can drift.)

## 4. Absorbing the scattered name-based rules (option only)

- **What fits naturally:** the matrix test can also print the existing P2/P3 facts as extra
  columns (sensor `colorModels`, light `delta`/`deltaQuery`/`treeBounds`, primitive
  `provides`/`similarityClosed`/`bounds`, material `capabilities`) — read-only, zero Validator
  change, and it gives one page for "who implements what" on every axis.
- **What should not move:** the CF-7 rules are mostly pairwise (equiangular × area lights,
  cwbvh × tree lights, bvh × equiangular; Validator.ts:507-581, 629-666, 714-752). A per-space
  support fact cannot express them; moving them is the over-reach the survey checker already
  flagged (findings.md CF-7 checker note).
- **Small, separate cleanups the table would expose:** Validator.ts:878 hard-codes
  `['rgb','spectral']` beside `COLOR_MODELS` (two answers for one fact); :903 (AOVs need rgb)
  could be an AOV support list in the P2 style. Not part of the curved-space work.
- **Spectral column:** not recommended. Color support is by typedef and evidenced by
  spectralMaterials.test.ts; adding a declared color list per component would be a new claim to
  keep in sync.

## 5. Facts for the design author

- GLSL readers that would call `bodyFor` [checked-code]: intersection.ts:166, 176;
  lighting.ts:119; materials.ts:75, 178; camera.ts:110; environment.ts:58; EnvironmentBake.ts:60
  (App-side procedural bake reads `ENV_CHARTS[chart].glsl`); aov.ts:14; core.ts:28 (ambient
  itself, not keyed).
- `MAX_DIST`/far-limit and placement validation (CF-8) are per-space rules but not "who
  implements what"; they belong to the ambient descriptor or the placement design, not this table.
- The ambient seam for the H³ sky: the sky direction of the geodesic γ(t) = cosh t·p + sinh t·v
  is (p+v)_xyz / (p+v)_w [math], matched to 2.4e-13 at t = 30 over 1000 random rays
  [checked-num: ideal-endpoint.mts, float64]. So the env charts (functions of a unit 3-vector)
  are reusable in H³ once the ambient supplies this one map: in design 1 the two chart
  descriptors list the same file under `euclidean` and `hyperbolic`; S³ gets no key, so
  any environment in S³ is an error (part-B row).
- Light kinds back onto primitives (`region.primitive`, descriptors.ts:248-251) and emissive
  objects are lights (`samplableEmitterObjects`): the space check must cover both the light kind
  and its primitive.
- Cameras: pinhole/fisheye build rays from `vec3` basis uniforms (camera/pinhole/pinhole.glsl:11-15,
  fisheye.glsl:29-37) [checked-code]; their projection math is space-free but the ray
  construction is not. Whether they get one shared body (basis uniforms typed `Direction`,
  computed by the ambient) or per-space bodies is a camera-design question; either way design 1
  records it.

## 6. H²×R

Tracking is unchanged: one more key. Differences that show in the table: meshes/BVH stay
unsupported longer (Klein×R lines are not straight, survey geometry-accel.md R1), so the part-B
mesh/table rows exclude it; the environment row excludes it until its boundary is designed;
shapes that exist only there (vertical cylinder) are just bodies under that key only. Placement
(stabilizer O(2)×Z/2, CF-8) is not part of this mechanism.

## 7. Machinery flags

- `GlslFile` origins in the value (new small convention; needed for shared bodies).
- Part B is a second form beside part A (unavoidable while those occupants' code lives in
  TypeScript generators).
- Planner.ts:558's size-dependent default needs the space (or the part-B row must catch it).
- Contract-test regexes must learn `Point` signatures.
