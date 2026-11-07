# Area map: authoring and scenes

Scope: `src/authoring/`, `demos/` (scene files + models), `pages/registry.ts`, with the
neighbors they lean on (`tests/witnesses/types.ts`, `tests/witnesses/index.ts`,
`pages/sections.ts`, `pages/scene-lab.ts`, `src/compiler/types.ts` SceneDescription,
`src/components/geometry/custom.ts` defineSDF). Read-only survey, 2026-11-06, branch
`claudeapp`.

## 1. Two-minute summary

A scene is a **plain TypeScript object literal** of type `SceneDescription`
(`src/compiler/types.ts:21`): `id`, `ambientSpace`, a flat `objects[]`, a
`materials` record keyed by name, `lights[]`, optional `environment` and
`ambientMedium`. Objects are one of three kinds: a primitive (`{type, parameters,
material, transform?}`), a mesh (`{kind:'mesh', positions, indices, …}`), or an
instanced batch (`{kind:'instanced', prototype, placements}`). Everything is linked by
strings (material names, primitive type names, light kinds) and validated later by the
compiler's Validator against the component registries.

A scene alone is not a picture. The **camera pose lives on the strategy**
(`measurement.camera.position/target`, owner-pinned: the pose is measurement data), so
each registry entry wraps its strategies with `withPose`/`posed(...)`. A registry
entry (`SceneSuiteEntry`, `tests/witnesses/types.ts:204`) bundles `scene`,
`strategies[]` (keys 1–9 in the lab), prose `exercises`/`expected`, optional
`initialParameters`, and (witness only) machine checks. Demos register in
`demos/index.ts` (530 lines, mostly prose); witnesses in `tests/witnesses/index.ts`
(2558 lines); `pages/registry.ts` merges both for the gallery/lab; `pages/sections.ts`
files every id into a gallery section (import-time guard: every id exactly once).

`src/authoring/` (850 lines, 7 files) is a thin shelf of **definition-time helpers that
return ordinary description data** — nothing downstream knows they exist:

| file | lines | what it does |
|---|---|---|
| `flatten.ts` | 179 | `flattenGroups(nodes)` — authoring-only `GroupNode` trees → flat objects; composes constant similarity chains, stamps `a/b/#i` provenance names, composes packed placements; throws on driven transforms under transformed groups. Also `transformFromSimilarity`. |
| `instance.ts` | 157 | `instance(proto, placements, name|opts)`, `grid(...)`, `scatter(...)` (seeded LCG), and `instanceCloud(table, opts)` (`.inst` table → one packed batch, size/color CPU hooks, `colorDrives` row, `sizeScale` fold). |
| `loadOBJ.ts` | 170 | `parseOBJ(text, opts)` (v/vt/vn/f, fan triangulation, corner dedup, optional area-weighted smooth normals, `closed`), `loadOBJ(url)` async wrapper. |
| `loadInstances.ts` | 109 | `.inst` binary reader: header checks, Float32Array views (positions/sizes/colors/quats + named scalar columns), `loadInstances(url|File)`. Write side: `tools/inst-format.mjs`. |
| `subsurface.ts` | 189 | `subsurfaceMedium({color, radius, anisotropy})` — van de Hulst similarity inversion (OpenPBR/Cycles) → `{sigma_s, sigma_a, phase_g}`; forward/inverse helpers exported for tests. Excellent comments. |
| `opticalGlass.ts` | 25 | Sellmeier constants `N_BK7`, `N_SF11` (SCHOTT data). |
| `strategy.ts` | 21 | `withPose(strategy, position, target)`. |

Notably NOT in `src/authoring/`: `defineSDF` (scene-local SDF fields) lives in
`src/components/geometry/custom.ts` because it registers into the global `PRIMITIVES`
registry as a side effect and returns the type-name string.

Data flow at load: `pages/scene-lab.ts` reads `?scene=<id>` → `sceneSuite[id]` → (async
thunk for `.inst` data scenes) → `app.initialize({scene, strategies,
initialParameters})`. The scene is plain data; the App compiles, then packs.

## 2. demos/ inventory

36 `.ts` files, 4627 lines; `demos/models/` holds `teapot.obj` (210 KB) and `cactus.obj`
(53 KB), imported as `?raw` strings (no runtime fetch). 51 demo entries (7 async data
scenes); 230 witness entries. Biggest scene files: mediaScenes 329, originalPresets 317,
sssLab 238, dataScenes 234, bottleArray 215, porcelain 194. 74 `RenderStrategy` literals
across demos; 50 repeat `accumulation: { type: 'average' }`, 19 use the
`{...base, estimator: {...base.estimator, X}}` A/B spread idiom.

Demo kinds: Cornell variants/cameras; analytic/SDF mixes; meshes (models, meshes, cacti,
forest); instancing (spheres, forest, embers, sdf-knot, gyroid-field); table dispatch
(grand-bazaar, sdf-field); `.inst` data clouds (clebsch, croissant, steiner, crixxi,
octic, c32, clebsch-glow); SSS (sss-lab, porcelain, porcelain-array, sss-presets,
marble); media (fogcube, fogblobs, glowblobs, groundfog, mist, rayleigh); GRIN/black
holes (grin, maxwell, glassball, blackhole, accretion); spectral showcase; tonemaps;
lasers; charts/paint (uv + expression materials).

## 3. Three authoring experiences

### 3a. Simple: Cornell box (`tests/witnesses/scenes/cornellBox.ts`, 76 lines)
Eight literal objects (6 planes, a box, a sphere), four lambert materials (one with a
`{param}` albedo → live slider), one point light. Strategy literal beside it with a
`{param}` fov. Clean and readable. Friction:
- The pose `[0,1,4] → [0,1,0]` is NOT in this file; it is in `demos/index.ts:233`
  (`posed(...)`) and again in the witness registry. To see "the picture" you read two
  or three files.
- Plane convention is `n·x + offset = 0` (normal `[0,-1,0]`, offset 2 is the ceiling at
  y = 2; normal `[1,0,0]`, offset 1.5 is the wall at x = −1.5). Authors annotate every
  wall (`dataScenes.ts:117-122`), a sign that the spelling is not self-evident.
- One-sided planes force a "front wall behind the camera".

### 3b. Mesh / instance heavy: `modelsScene.ts`, `forestScene.ts`, `dataScenes.ts`
- OBJ: `parseOBJ(objRaw, {material, smoothNormals, name})` at module load, then
  `{ ...teapot, transform: {position, scale} }` in `objects` (parseOBJ also accepts
  `transform` — two spellings). The `material` is bound at parse time.
- Instancing: `instance(cactus, scatter(300, 16, {seed, scaleMin, scaleMax}), 'cacti')` —
  one line for 300 placements. `grid(...)` for lattices. Placements are Euclidean TRS.
- `.inst` clouds: an `AsyncSceneSuiteEntry` whose `scene` is a thunk; `buildCloudScene`
  fetches `/test-data/<x>.inst` (untracked), wraps a 6-plane room + quad lamp around
  `instanceCloud(table, {shape:'sphere', material:'point', ...hooks})`. `buildGlowScene`
  rewrites the batch's albedo attribute into a per-instance emission attribute.
- A/B strategies by spread (`modelsBruteStrategy = {...bvh, estimator: {...,
  meshTraversal:'brute'}}`).
Verbosity is moderate; the instancing helpers are good. Confusing parts: the material
binding at parse time; two ways to set a mesh transform; `instanceCloud` carries its own
two-entry shape table (`CLOUD_SHAPES`, `instance.ts:58`: 'sphere', 'cube' → box) — a
second, tiny shape vocabulary.

### 3c. SDF / fractal: `fractalsScene.ts`, `customFieldsScene.ts`, `sdfShapesScene.ts`
- Registry SDFs are used exactly like analytic primitives: `{type:'menger',
  parameters:{size, iterations}, transform:{position, rotation}}`. The author never says
  "march"; the compiler picks the backend.
- Scene-local fields: `const gyroid = defineSDF({name, params, glsl, field, marchBound,
  stepBudget})` at module top, then `type: gyroid` (a string). One call holds the GLSL
  field, its TS twin (used by the Validator to sample-check the declared bound at
  authored values), and the bound. Rows are canonical (point rows rejected) — the
  "canonical shape + placement" idiom.
- Side effect: `defineSDF` mutates the global `PRIMITIVES` registry; names are global per
  session (custom.ts header + idempotent-redefine branch).
This is the most principled door in the authoring surface. Friction: writing the field
twice (GLSL + TS) — acknowledged and optional.

## 4. Helpers in detail

**Groups/flattening** (`flatten.ts`). Only consumer outside tests:
`tests/witnesses/scenes/transformWitness.ts:154`. No demo uses groups (the header at
flatten.ts:13-14 says "fixtures and demos call flattenGroups()"). Lights are not
groupable (they live in `lights[]`, have no `transform`, and flatten only walks objects;
fable-authoring-language §10.4 lists light folding as open). Naming rule D5
(flatten.ts:122-126: a leaf name is a path segment) is NOT applied to driven leaves
(flatten.ts:109 keeps a bare `node.name`).

**OBJ** (`loadOBJ.ts`). Solid, well-commented parser. Ignores `usemtl`/groups
(multi-material meshes are deferred). `loadOBJ(url)` (async fetch) has no callers —
demos import `?raw` and call `parseOBJ`.

**.inst** (`loadInstances.ts`). Strict header validation, zero-copy views, named scalar
columns for CPU hooks. `File` arm unused (drag-drop is deferred, fable-instance-clouds
§8). Header comment points to `tools/convert-*.mjs`, which does not exist in `tools/`
(the doc places the converter untracked in `test-data/`).

**Subsurface inversion** (`subsurface.ts`). Constant-only by construction; clamps α at
0.999999; anisotropy cap 0.99 duplicates `MAX_PHASE_G` in `Validator.ts:36`.

**Optical glass** (`opticalGlass.ts`). Two constants with sources. Used by spectral
showcase and tests.

**Camera poses** (`strategy.ts`). `withPose` copies a strategy with
`measurement.camera.position/target`. `posed(...)` is re-declared in `demos/index.ts:54`
and `tests/witnesses/index.ts:147`; three demo scene files call `withPose` themselves
(cacti, dataScenes, grandBazaar), the rest are posed in `demos/index.ts`. CPU look-at
frame (`components/camera/basis.ts`) is `normalize(target − position)` with a +Y up
reference — Euclidean.

## 5. Registry wiring (pages/registry.ts, 28 lines)

`sceneSuite = {...witnessSuite, ...demoSuite}` with a throw on key collision;
`DEFAULT_SCENE = 'two-light'`. Production pages import from `tests/witnesses/` (the
witness registry and the `SceneSuiteEntry` type live under `tests/`). Adding a demo
touches: the scene file, `demos/index.ts` (import, entry, pose, prose), and
`pages/sections.ts` (filing). Registry keys and `scene.id` are two identities that
disagree in 8 entries (measured: demo `cornell-fisheye`, `cornell-oneshot` → `cornell`,
`tonemap` → `sky`; witness `thinlens-zero`, `driven-theta2`, `light-driven-theta2`,
`light-off`, `het-driven-theta2`). `suiteIntegrity.test.ts:5-7` says it checks this;
it does not.

## 6. Verbosity / confusion list (observed)

1. Picture spread across files: scene file, pose + prose in `demos/index.ts`, filing in
   `pages/sections.ts`. Prose drifts: `demos/index.ts:128` ("Brute-force traversal (no
   BVH yet)") and `:478` ("Chiang 2016 α(A) + Christensen-Burley") describe superseded
   states (`sssLabScene.ts:58-63` says the van de Hulst inversion replaced Chiang/Burley).
2. Strategy boilerplate: 74 literals, mostly the same four fields.
3. Silent inert constants: a constant key that the material's model does not read is
   accepted silently (`Validator.ts:1016-1018`). Measured: `albedo` on `dielectric`
   glass in glass-lab, custom-fields, sdf-shapes and the field-glass witness — an
   intended tint that renders nothing (dielectric's rows: transmittance, ior).
4. Two spellings for one fact: sphere/disk LIGHTS take `position`, sphere/disk
   PRIMITIVES take `center`; primitives can be placed by `center` param (132 uses) or by
   `transform.position` (72 uses); area light as `lights:[{kind:'quad'}]` or as an
   emissive quad object; mesh transform via `parseOBJ` opts or spread;
   `instance()` third arg string or options.
5. GLSL expressions reference mangled uniform names (`fog.gain` → `u_fog_gain`), and a
   shared parameter is redeclared in each expression that reads it
   (`mediaScenes.ts:290` and `:299`, `blob.sharp`).
6. 14 copies of the same seeded LCG across demos/witness scenes and `instance.ts:147`;
   two copies of `hueRGB`.

## 7. What a curved-space scene needs from authoring

Context: `AmbientSpaceDescription` is `{type: 'euclidean'|'hyperbolic'|'spherical',
parameters?: {curvature}}` (`types.ts:43-46`) — a hardcoded union, while the Validator
gates on the `AMBIENT_SPACES` registry (only `euclidean`). The ambient GLSL seam
(`ambient_dot`, `ambient_geodesic`, `ambient_direction_to`) exists.
`docs/fable-authoring-language.md` (DRAFT, unbuilt) already says "geometry first": the
space scopes the shape and placement vocabulary. `docs/fable-transforms.md §1` says a
placement is "an element of the ambient space's structure group" and only the
Euclidean lowering should know TRS.

What breaks today, by layer of the authoring surface:
- **Choosing the space**: union has no product geometries (H²×R, S²×R) and no slot for a
  quotient/lattice.
- **Placement**: `Transform` = TRS similarity with `scale`; `PackedPlacements` = positions
  + sizes + quats; `.inst` format the same; `flattenGroups` composes `Similarity`;
  `grid`/`scatter` are flat-plane generators. In H³/S³ there is no scale; in H²×R the
  group is Isom(H²)×Isom(R).
- **Shape parameters**: many rows are Euclidean coordinates (sphere/box/disk `center`,
  quad `corner`+`edge1/edge2` vectors, plane `normal`+`offset`). `ParamKind`
  (descriptors.ts:332: point / vector / direction / length / angle / area / scalar) is
  the right asset: point/direction transform under isometries; vector/length/area
  scaling is similarity-only. Canonical shapes + placement (what `defineSDF` already
  enforces) is the idiom that ports.
- **Lights**: authored in raw coordinates, no `transform`, not groupable.
- **Camera**: pose is two Vec3s; look-at frame uses `target − position`. Curved spaces need
  the two-point geodesic direction (`ambient_direction_to` on CPU) or an authored frame.
- **Authored GLSL**: `defineSDF` regex requires `float <name>_sdf(vec3 p, …)` (custom.ts);
  medium/material expressions treat `p` as vec3 and use `dot(p−c, p−c)` as distance.
  CLAUDE.md says `Point` may become vec4.
- **Quotients/lattices** (thurston-rebuild): there a scene is built against a
  `TeleportationSet` (generators of a discrete group + fundamental domain; rays are
  teleported back into the domain; shapes are "local" or "global"). Objects are placed with
  `new Isometry().makeTranslationFromDir(new Vector(x,y,z))` — i.e., a tangent vector at
  the origin exponentiated. That spelling is space-independent and is the identity map
  in E³, so `transform.position: [x,y,z]` could keep its meaning everywhere if defined as
  exp_o(v) (thought through, not checked). A quotient is part of the manifold (the
  integral), so it belongs with `ambientSpace`, not with strategies. Finite tilings could
  ride the existing instancing (placements = group elements up to word length); true
  quotients need teleportation in the trace loop (not authoring).

## 8. Unfinished-on-purpose (in-progress, not dead)

- `loadOBJ(url)` async and `loadInstances(File)`: runtime loading / drag-drop
  (fable-instance-clouds §8).
- `flattenGroups` with one witness user: the static half of the planned authoring tree
  (fable-transforms §4, fable-authoring-language Stage B).
- `CustomSDF` interface (`types.ts:221`): reserved custom-geometry door.
- `ambientSpace` hyperbolic/spherical values in the type: the curved-space seam.
- `fable-authoring-language.md`: draft design (classes, freeze, prefabs, Source lights);
  nothing built. Its §10.1b claim that the Planner sorts materials by name is stale
  (Planner.ts:96 iterates insertion order).
