# Naming Systems Audit — current state + problem ledger

**Status: FACTUAL AUDIT (July 16 2026). Deliberately contains NO design.** This is
the input brief for the naming-modernization batch (sequenced after the
geometry-descriptor batch). One candidate direction discussed in-session is
quarantined in §5 and carries no authority — a designer reading this doc should form
their own position from §1–§4 first.

**How to use:** §1 is the inventory (every namespace in the system, what it
identifies, who consumes it). §2 is the problem ledger, ranked. §3 lists the pinned
constraints any redesign must respect. §4 lists interactions with queued work. All
claims were verified against the code on July 16 2026; file:line references are the
evidence trail.

---

## 1. Inventory — every namespace in the system

### 1.1 Material names (scene description)
`SceneDescription.materials: Record<string, MaterialDescription>` — objects
reference materials by string key; `ambientMedium` is a key too (types.ts:28).
Consumers:
- **Identity/artifact path**: the Planner SORTS materials by name
  (`Planner.ts:32`, localeCompare) and assigns ids in sorted order → ids order
  every generated dispatch arm and table (interaction dispatch, media tables,
  material_of/ior_of) → generated GLSL bytes → witness digests → render-cache
  validity. Material NAMES are therefore load-bearing artifact identity.
- **Diagnostics**: every material error/warning speaks in these names
  (propertyValidation.ts labels: "Material 'clay': …").
- **Generated comments**: media/lookup tables emit `// '<name>'`
  (materials.ts generateMediumProperties / generateMediumSample).
- **Reserved namespace**: `__light_<n>` is the desugar's namespace; user materials
  with that prefix are Validator-rejected (Validator.ts ~:147).

### 1.2 Object/node names (scene description)
`ObjectDescription.name?` — provenance ONLY (diagnostics label; `flattenGroups`
stamps authoring-tree paths like `'rig/lamp'`). Collisions explicitly legal
(fable-transforms §7.6). Affects nothing radiometric, no bytes.

### 1.3 Region ids
Structural identity: scene order across BOTH backends assigns globally-unique
region ids (`Planner.ts:63-67`; authoring-order = region-order is a stability pin).
The light desugar appends regions after authored objects. Numeric, never authored,
never named.

### 1.4 Parameter paths (the `{param}` namespace)
Author-owned dotted strings (`'clay.albedo'`, `'rig.boxAngle'`). Facts:
- The compiler NEVER invents param names (pinned, fable-transforms §6) — identity
  survives recompiles because authors own the namespace.
- Shared-by-name is the sharing regime: one path used by several materials = one
  uniform (`materials.ts:218` seen-set, comment "materials may share one driven
  parameter (§2.8)").
- UI metadata is DERIVED from the path: slider name = last segment capitalized,
  group = first segment (`materials.ts:236-241`); driven-placement params get
  group 'Placement' (Planner.ts buildDrivenPlacement).
- Multi-path uniforms exist (driven placement: one uniform ← several paths,
  plan/types.ts PlannedUniform.parameterPaths).

### 1.5 Implicit reserved parameter prefixes (UNDECLARED)
No registry or Validator rule declares these; they are conventions enforced by
collision-luck:
- `engine.*` — engine builtins injected per frame (resolution, sampleCount,
  resetSalt, time, pixelOffset, imageSize).
- `camera.position` / `camera.target` — hardcoded by OrbitControls
  (OrbitControls.ts:125-131,214-215) and KeyboardControls; since July 16 also the
  authored-pose default channel. `camera.fov` is fixture convention, not enforced.
- `camera.frame` — a HIDDEN special case: ParameterStore.restore coerces it to
  Float32Array (ParameterStore.ts:91). Undocumented elsewhere.
- `env.selectProb` (lighting.ts:45), `env.rotation` (environment feature) —
  feature-minted paths.
- `debug.displayMode` / `renderer.displayMode` (App.cycleDisplayMode, App.ts:343).
- Everything else is authored scene vocabulary (`haze.g`, `rig.*`, `mist.*`, …).

### 1.6 Uniform names
- Pin: `u_camelCase` (CLAUDE.md conventions).
- Param-derived uniforms: `paramToUniform(path) = 'u_' + path.replace(/\./g, '_')`
  (glsl-format.ts:38).
- Generated per-object uniforms: `u_object<i>PlacementQ/TS` (index-based, never
  authored).
- Feature-fixed uniforms: `u_cameraPosition`, `u_tanFov`, `u_envSelectProb`, etc.

### 1.7 GLSL symbol contracts per component family (IMPLICIT)
Load-bearing naming conventions between a component's GLSL and the generated
dispatch — enforced only by glslang compile failure, not declared or checked:
- Materials: occupant must define `<id>_eval/_sample/_pdf/_emission`; the dispatch
  emits `${model}_${op}(...)` literally (materials.ts:543-548).
- Phase models: `<id>_eval/_sample/_pdf`.
- Lights: `<kind>_light_sample` (descriptor emitSampleCall by convention).
- Geometry: `sdf_<type>` / `ray_<type>` (intersection.ts arms; formalization is
  part of the geometry-descriptor batch).
- Cameras: occupant provides `camera_generateRay` (fixed seam name).
- Seam names (`scene_intersect`, `material_of`, `lighting_sample`, …): the
  provides/requires interface-header vocabulary — these ARE declared and checked
  (seam-missing/seam-unused), the one healthy instance of this class.

### 1.8 Registry keys
- `MATERIAL_MODELS` keys = model ids. NOTE the pinned lesson: the `MaterialModel`
  union is NOT a registry shadow — it is registry ∪ {'emissive','none'} (+ dead
  'disney'); do not derive it via keyof.
- `PRIMITIVE_PARAMS` uses composite `'backend:type'` keys (geometry/index.ts:97) —
  an artifact of the missing per-primitive descriptor; dies in the geometry batch.
- `PHASE_MODELS`, `CAMERA_MODELS`, `LIGHT_KINDS`: plain id keys.

### 1.9 Renderer / shader / scene ids
- Renderer id = `${strategy.id}-${scene.id}`; shader ids must be prefixed
  `${rendererId}-main` because the ENGINE STORES PROGRAMS IN A FLAT MAP — collisions
  SILENTLY CLOBBER programs (CLAUDE.md critical convention). No runtime collision
  check exists (RendererManager.initialize just Map.sets, RendererManager.ts:78-80).
- Scene ids double as suite-registry keys. The merged view is
  `{...witnessSuite, ...demoSuite}` (pages/registry.ts) — a demo key colliding with
  a witness key SILENTLY wins in the merged view.
- Strategy ids within one entry must be unique (keys 1-9 binding); nothing checks.

### 1.10 Framebuffers, passes, externs
- Framebuffer ids with RESERVED suffixes `_current`/`_previous` (double-buffer
  machinery). Pass roles ('pathtracer', 'display'). Extern resources use the
  `extern:` prefix (`extern:blue_noise`) — executor-owned texture units.

### 1.11 Authoring layer (planned, from fable-authoring-language.md — draft)
- Matter labels (optional; ES-shorthand `label({ stevesClay })` trick).
- Prefab instance names minting param sub-namespaces (`'rig1.angle'`).
- Named shared frames (stage 4b pinned shape: `transform.frame: { param }`) — live
  in the PARAM namespace.
- Node names = flatten provenance paths (§1.2).

---

## 2. Problem ledger (ranked)

**P1 — Material names are accidentally load-bearing.** Identity (ids → dispatch
order → bytes → digests) rides on Record keys via the Planner's name-sort, so
renaming or auto-generating material names churns artifacts, and any authoring
layer must solve "naming determinism" as a hard problem. Object identity is
structural (scene order) with names as provenance; materials deviate from that
model for no stated reason. (`Planner.ts:32`; the sort comment says only "sorted
for deterministic ordering" — note JS string-key insertion order IS deterministic
and JSON-round-trip-stable.)

**P2 — `paramToUniform` collisions are unchecked.** `'a.b_c'` and `'a_b.c'` both
map to `u_a_b_c` (glsl-format.ts:38). Two distinct authored params can silently
share one uniform. No Validator rule.

**P3 — Reserved param prefixes are implicit.** §1.5's list exists nowhere as a
declaration; an authored scene param named `engine.time` or `camera.position`
would collide with builtin/extension behavior with no diagnostic. The
`camera.frame` Float32Array coercion is a hidden special case.

**P4 — GLSL symbol contracts are implicit.** §1.7's `<id>_<op>` conventions fail
at glslang compile (or at GPU link), not at review, and nothing documents them per
family. Evidence of the drift class: `torus`/`capsule` sit in the StandardSDF type
union with no arms anywhere.

**P5 — Silent-clobber id spaces.** Flat engine program map (renderer/shader ids),
witness∪demo registry merge, strategy-id uniqueness per entry: all
collision-silent. Known and documented (CLAUDE.md) but unchecked.

**P6 — Two unrelated "name" concepts share one word.** Node names (provenance,
collision-legal) vs material names (identity, unique) — already confused once in
design discussion; will confuse authoring-language users.

**P7 — Composite registry keys** (`'backend:type'`) — resolved by the geometry
batch; listed for completeness.

**P8 — Renames churn digests via comments** even where identity is not name-coupled
(generated `// '<name>'` comments are hashed). Minor; matters only after P1 is
addressed.

---

## 3. Pins any redesign must respect

1. The compiler never invents parameter names (fable-transforms §6).
2. Authoring order = region order (region-id stability).
3. `__light_` prefix reserved for the desugar.
4. `u_camelCase` uniforms; `dotted.path` parameters (CLAUDE.md).
5. `_current`/`_previous` reserved framebuffer suffixes; `extern:` prefix.
6. SceneDescription stays FLAT; the ParameterStore is the only runtime channel.
7. Reproducibility: stamps embed the description; witness digests hash compiled
   sources + scene/strategy JSON — determinism of whatever scheme replaces P1 is a
   hard requirement, not a preference.
8. Type unions are input vocabulary, not registry shadows (reject-not-remove).
9. Shader-id namespacing convention (`${rendererId}-main`) until the engine map
   grows collision checks.

## 4. Interactions with queued work

- **Geometry-descriptor batch (sequenced FIRST, owner-decided)**: kills P7;
  naturally hosts the P4 fix for geometry (symbol contracts declared on
  descriptors + structure-test enforcement) and sets the template for the other
  families.
- **A P1 change is a compiler batch with byte churn** (ids shift where insertion ≠
  alphabetical): snapshots re-golden + full witness re-render. If undertaken, it
  should land before or alongside the geometry batch so re-goldening happens once.
- **Authoring language (after geometry)**: matter labels/synthesis sit directly on
  P1's outcome; prefab signal namespacing sits on P3's outcome (declared
  prefixes/reservations would give prefab-minted namespaces a collision check).

---

## 5. QUARANTINED: one candidate direction discussed in-session (no authority)

For the record, the direction sketched during the July 16 session — a designer
should evaluate this against §1–§4, not inherit it: (1) demote material names to
provenance by assigning ids from authored/insertion order (drop the Planner sort),
making identity structural and symmetric with regions; (2) declare the reserved
param prefixes and add a paramToUniform-collision Validator check; (3) make the
per-family GLSL symbol contracts explicit on descriptor interfaces and enforce
them with structure tests. Alternatives NOT explored in-session include: keying
materials by array position in the description itself, content-addressed material
identity, and a first-class namespace/scope object for parameters.
