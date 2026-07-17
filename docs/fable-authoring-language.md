# The Scene Authoring Language

**Status: DRAFT — under active design (July 16 2026 session). Nothing here is
authority yet; this document consolidates the session's decisions so they can be
marked up, argued with, and eventually pinned.**

**Provenance note (owner-demanded correction, July 16):** the first draft was
written from the design conversation BEFORE the deep code read — a process
violation for a `fable-` doc. A full read of the Planner, plan types, materials/
lighting/camera features, descriptors, geometry schemas, property validation,
ParameterStore, purity rules, and flatten followed; every code-referencing claim
was then audited and this document corrected in place (§4 extension-cost caveat,
§10.1b naming determinism, §10.6 lighting nuances). Owner decisions recorded here
(ontology, mutability, single-parent, classes-everywhere) are conversation
artifacts and were not affected by the audit.

**Scope:** the high-level language humans write scenes in. It compiles to a flat
`SceneDescription` + the measurement slice of a strategy; the compiler never changes
to accommodate it (contracts §10.2). Syntax is deliberately the LAST chapter — every
example below is provisional notation, not a proposal.

---

## 1. The boundary (settled)

The language is the **authoring layer** (`src/authoring/`, top of the stack:
Authoring → App → Engine → Compiler → Components). It owns trees, names, reuse, and
(later) live manipulation. Its meaning function is:

```
program  ──build──►  node tree  ──flatten/freeze──►  SceneDescription (+ camera slice)
```

Two programs that flatten identically mean the same integral. The description stays
FLAT forever (fable-transforms §3) — and this is not a concession the language makes:
**three.js itself is flat at the bottom** (`updateMatrixWorld` composes the graph into
per-leaf world matrices; the renderer never sees a parent pointer). Our
`SceneDescription` is the world-matrix snapshot; the mutable graph the author touches
lives entirely up here.

Accepted cost, named: persisting a *tree* (saving your groups, not just the flattened
scene) is the authoring layer's own future serialization job.

## 2. Geometry first (settled)

A scene is declared **in an ambient geometry G** — the first choice, before anything
else, because G indexes the vocabulary itself:

- **Shape_G** — which primitives exist (E³'s box/quad vs H³'s horospheres…).
- **Placement_G** — the structure group. In E³ it is the similarity group (TRS,
  s > 0); in H³ `scale` does not shrink in range — it *ceases to exist*.
- Rays are G-geodesics; the trace loop is already written against this seam.

Cross-geometry sorts (deliberately G-independent): **Matter** (σ per unit arc length,
the `ambient_dot` discipline — the material library ports to curved space untouched),
**Signal**, and **View** as a pure film→ray map.

Consequence to enforce when built: the geometry declaration *scopes* the vocabulary,
so a Euclidean primitive in an H³ scene is a definition-time type error, not a
Validator diagnostic.

## 3. Objects and lights (settled)

**Object = Shape × Matter, named, placeable.** The leaf. Regions, nesting,
innermost-wins are *not* language concepts — containment is spatial, resolved by the
compiler at runtime.

**Light is mostly not a sort.** A luminous thing is an object with emissive matter —
already the compiler's preferred route (area lights desugar to emissive regions;
`sampleAsLight`). The language never surfaces `QuadLight`/`SphereLight`; those stay
compiler input vocabulary.

**IdealLight** is the one honest separate sort: pure illumination that is not matter
— nothing to hit, nothing occluded, invisible to camera and reflections, sampled by
NEE only. The general form is **IdealLight = Shape × emission, with no matter**;
point and directional are the degenerate (delta) shapes. The non-degenerate case is
the *invisible area light* (owner-requested): a quad/sphere **source** giving soft
shadows and area lighting with no visible blob in frame or mirrors — the exact
symmetry `object(shape, glowingMatter)` (visible thing) vs `source(shape, radiance)`
(invisible illumination). IdealLights are **placeable leaves** — under a constant
group, flatten folds them exactly:

- point: `position ↦ g·position`, `intensity ↦ s²·intensity` (forced by E = I/d²).
- directional: `direction ↦ R·direction`, intensity unchanged (irradiance from
  infinity is distance-independent).
- extended source: shape params fold like the corresponding object shape (radiance-
  based emission is scale-invariant).

Delta folding needs zero compiler changes — flatten emits ordinary flat lights.
(Frame-*driven* light placement remains the deferred `Value<T>`-light-params batch,
rigid-only; that is a binding-time restriction, not ontology.)

Signed-up-for consequences of extended sources: they define a *different integral*
whose pure-pt arms see nothing (already the documented delta-light situation — the
haze witness's "keys diverge by exactly the point-light term"); their MIS treatment
is the delta treatment (BSDF sampling can never generate the connection → NEE scores
at weight 1, the `lighting_query_delta` discipline, no `lighting_pdf` arm).

## 4. Matter and shape: authoring and linking (settled shape, open details)

Both are **first-class values**, never strings:

- **Matter** unifies interface + bulk + glow in one value (the compiler's
  `MaterialDescription` already does; it is load-bearing physics — dielectric with
  absorbing interior, model-'none' fog). Constructors come from the material/phase
  registries, so a new material model gets a constructor for free.
- **Shape** is local geometry: primitive + local params. Backend (sdf vs analytic) is
  an *attribute* of a shape, not a sort — same sphere either way, witnesses prove it.
  Defaults: analytic where exact intersectors exist (sphere/plane/quad — samplable
  lamps just work), sdf otherwise. CSG, when wanted, is closure of this sort under
  operators; nothing else moves.

**Linking** is object construction: an object takes a shape value and a matter value.
The scene-level `materials: Record<string, …>` becomes *compiler output*: the flatten
collects distinct matter values by reference, names them (author label or generated),
and emits the record. `ambientMedium`-by-name follows the same lowering.

**Identity regimes** (settled): matter shares by **reference** (one value on fifty
objects = one entry — safe because matter never sits in the tree); nodes by **unique
tree position** (§5); signals by **name** (§7).

**Extension cost (settled in direction, with an honest caveat from the code).** The
authoring classes (`Lambert`, `Ggx`, `Sphere`, …) are DERIVED from the same
descriptors/schemas the compiler reads — and the schema is already a real
multi-consumer truth: `PropertySchema[]` drives the GLSL struct union
(`unionFields`, materials.ts:52), the material-lookup codegen (materials.ts:255),
the `{param}`→uniform scan (materials.ts:127), and authored-value validation
(propertyValidation.ts:21). Deriving classes adds a fifth consumer, and it buys
something the Validator can only warn about: **per-model field sets become
unrepresentable mistakes** — `new Ggx({ albedo })` is a TYPE error because ggx's
schema deliberately omits albedo (ggx.ts:11 — "a conductor's color IS its f0"), and
`Ggx` has no emission field because `capabilities.emissive: false`. The C5
silent-inert class dies at the editor.

The caveat: the TS property CARRIER is not schema-generic today. Three sites
hardcode the field list — `MaterialDescription` (compiler/types.ts),
`PlannedMaterial` (plan/types.ts:231), and the Planner's per-field resolve block
(Planner.ts:38–45) — so a model introducing a NEW field name (as ggx's f0/roughness
did) touches those three files; only models reusing existing names are one-line
additions. propertyValidation.ts's own header names the endgame ("as descriptors
gain all authored defaults/domains, this function becomes a mechanical descriptor
traversal"). The authoring-class derivation should ride that same migration —
deriving classes does not by itself fix the carrier. Real authoring-layer work
remains reserved for ONTOLOGY growth (a new geometry G, a new node sort like
`Source`), not library growth.

**Authoring-layer import rule** (mirror of the components purity test): authoring
imports compiler TYPES and components VALUES (`flatten.ts` already does exactly
this — `similarityFromTransform` shared with the Planner), never app/engine —
scenes must stay headless-compilable descriptions.

## 5. Groups and hierarchy (settled)

A **group** is Placement_G acting on a collection of leaves and groups. Arbitrary
nesting. Closure of the placement group is the theorem that makes this exact: any
chain — including scaling a composite that already contains rotations — lands on one
clean TRS per leaf at flatten time.

**Groups are the only *structural* hierarchy.** Nothing else is tree-shaped: matter is
flat values, containment is spatial, background/view are scene fields. (Reuse has its
own composition — functions, §8 — deliberately *not* a node kind.)

**Single parent, loud failure** (settled): a node has at most one parent. Attaching an
already-parented node is an immediate error naming the fix (`.clone()`, or a prefab
function returning fresh nodes). This is three.js's identity rule without its silent
reparenting — with mutable handles, an alias under two parents would make
`s.position = …` move both occurrences, which is an hour of debugging waiting to
happen. The underlying `flattenGroups` keeps its documented alias tolerance for
raw-literal users; the language layer simply never produces an alias.

## 6. The ambient world (settled)

**Background** = the matter of everywhere-that-isn't-an-object: the ambient medium
(region −1's bulk) + the environment (the radiance of its boundary at infinity), one
sort. A foggy world under an HDRI sky is one background value. (The geometry G is NOT
part of Background — it is the §2 context everything is interpreted in.)

**View** = projection × pose, one value, authorable since the July 16 camera-pose
cleanup (`CameraPose` on `measurement.camera`). The scene carries its default view as
human bundling; lowering puts it in the strategy's measurement section (`withPose` —
already built). Estimator/view strategy sections stay literals + shared presets;
they need reuse, not grammar.

## 7. The build phase: mutable until frozen (settled)

The line that matters is **before-snapshot vs after-compile**, not
declarative-vs-imperative:

- **While building**: full three.js-style mutation — make a sphere, move it; make a
  cylinder, move it; group them; orient the group; group *that* with something else;
  scale the combo. All of it is just constructing the description incrementally.
- **`scene(…)` flattens and FREEZES.** Post-compile mutation is an immediate error
  ("scene already compiled — recompile, or use a driven param"), never silence.
- **Signals** (`{param}` / `Value<>`) are the frame-time channel: fields that admit
  them (transforms, matter properties, fov) move live through the ParameterStore with
  zero recompiles — already fully built (stage 4).
- **The future runtime graph makes the SAME mutation surface live post-compile**:
  `pair.rotation = …` then means "recompose affected leaves, push TRS through the
  ParameterStore" (fable-transforms §4's dynamic binding). One API, two binding times;
  code written today is the code that becomes live later.

## 8. Prefabs: composing scenes from prebuilt, parameterized assemblies (settled shape)

A **prefab is a function** — host-language composition, not a new node kind:

```ts
// provisional notation
function studio(opts: { width: number; wallMatter?: Matter }): Group { … }
function tableInField(opts: { height: Value<number> }): Group { … }
```

- Returns a group of ordinary leaves. Because IdealLights are placeable leaves (§3),
  a prefab can contain its **lighting rig** — a studio ships its walls AND its
  softboxes as one value. (Background and View are scene fields, not leaves; a prefab
  that wants to suggest an environment exposes it as a separate return or the scene
  author sets it — v1 keeps prefabs = node-valued.)
- Each call returns **fresh nodes** (no aliasing possible, §5), then the instance is
  placed like anything else: `group(studio({width: 6}), …)` — or moved, rotated,
  scaled after construction (§7).
- **Two parameter kinds, two binding times**:
  - *definition-time* — ordinary function arguments (table height, wall matter),
    baked by flatten;
  - *frame-time* — the prefab threads **signals** into driven fields, namespaced by
    an instance name it takes as an argument (`turntable('rig1', …)` mints
    `rig1.angle`), so two instances get independent sliders and identity survives
    recompiles (the compiler never invents names — pinned).
- "Loading" a prefab = importing a module. A library of them is a folder.

## 9. Lowering (settled)

`scene(…)` performs, in order: freeze → flatten (compose constant chains, stamp name
paths, emit leaves + folded ideal lights in document order — region-id stability) →
collect matter values into the named record → attach background fields → hand the
camera slice to strategy assembly. Then the compiler's own pinned ordering
(fold → desugar) takes over. Signals pass through untouched as `Value<>`.

## 10. Open (the live list)

1. **Identity ergonomics**: exact `.clone()` semantics (deep? matter shared?);
   whether freeze is per-tree or per-node.
1b. **Matter naming determinism (load-bearing, from the code)**: the Planner sorts
   materials BY NAME and the sort order assigns ids (Planner.ts:32) — ids appear in
   every generated dispatch/table, so minted names determine generated GLSL bytes,
   witness digests, and render-cache validity. Auto-minted names must be
   deterministic and stable under trivial edits; `__light_` is reserved
   (Validator); `ambientMedium` references by name. Labels (`new Lambert({...},
   'clay')`?) vs stable synthesis — decide with clone semantics.
2. **Signal namespacing**: instance-name argument vs a context/scope mechanism;
   collision diagnostics.
3. **Prefab environment/view contributions**: does a prefab ever get to *suggest*
   scene-level fields, or stay strictly node-valued? (v1: strictly node-valued.)
4. **Light folding in flatten**: build the point/directional fold (§3) + the
   conjugation-with-a-point-light witness it enables.
5. **Ideal-light sort in the DSL vs `scene.lights`**: pure lowering detail.
6. **Extended invisible sources (compiler ledger item — audited against
   lighting.ts)**: quad/sphere `source` = a `PlannedLight` WITHOUT `regionId`.
   Verified against the real machinery: sampling and the power CDF need no changes
   (`generateLightSampling` dispatches every light by kind regardless of region,
   lighting.ts:202; `computeSelectPdf` uses the kind descriptors' area-aware power,
   :195); `lighting_pdf` already skips region-less lights (:304). Two precise
   nuances the code adds: (a) an invisible source is NOT pdf-delta — it carries a
   real area pdf — but takes the delta WEIGHTING (NEE weight 1), and that is the
   honest meaning of the LIGHT_DELTA flag: "the paired technique cannot sample
   this." Verify the light-technique weight reads the flag with that semantics
   before reusing it. (b) Interaction pin: equiangular medium NEE v1 requires ALL
   lights delta (Validator; lighting.ts:82) and `lighting_query_delta` assumes a
   point position (:152) — an invisible AREA source in fog under 'equiangular' is
   rejected until the area-arm ledger item lands. Witness in the delta-light
   equality style (nee ≡ mis; pt arm documented dark by the source term).
7. ~~**Syntax.**~~ Drafted (§11) after the ground levels settled; remaining surface
   details (clone ergonomics, exact chainer set) ride on the §10 items above.

## 11. Syntax (draft — owner-directed three.js idiom, July 16 session)

Make-and-add, mutable until compile:

```ts
const clay  = new Lambert({ albedo: [0.8, 0.4, 0.2] });
const glass = new Dielectric({ ior: 1.5 });

const ball = new Obj(new Sphere({ radius: 0.5 }), glass);
ball.position = [0, 0.35, 0];

const table = new Group('table');
table.add(new Obj(new Box({ halfSize: [1, 0.05, 0.6] }), clay), ball);
table.position = [0, -1, 0];
table.rotation = { axis: [0, 1, 0], angle: param('turntable.angle', 0, { min: 0, max: 6.3 }) };

const still = new Scene('still-life');
still.add(new Obj(new Plane({ normal: [0, 1, 0], offset: 1 }), clay));
still.add(table);
still.add(new Source(new Sphere({ radius: 0.3 }), [4, 4, 4]));   // invisible area light — a leaf
still.add(new PointLight({ position: [2, 3, 1], intensity: 20 }));
still.background = { medium: new Medium({ sigma_a: [0.02, 0.02, 0.02] }), sky: new Sky({ url: '/hdri/studio.hdr' }) };
still.camera = new Pinhole({ fov: 0.8, position: [0, 1, 4], target: [0, 1, 0] });
export default still;    // registry calls still.compile() → flatten + freeze
```

Decided:
- **Classes everywhere, `new` everywhere** (owner-settled after the factory/hybrid
  detour). The honest finding that decided it: matter is NOT inert data — it has the
  same mutable-until-frozen lifecycle as nodes (`clay.albedo = …` pre-compile updates
  every user; that action-at-a-distance is the FEATURE of material sharing). The only
  real matter/node difference is the sharing regime (matter: share freely; node:
  single parent), and that is taught by the loud error at the mistake, not by a
  spelling convention. One construction rule, maximal three.js fidelity. Registry-
  generated material models emit classes. Prefabs remain plain functions returning
  nodes (natural in a class world — the three.js community's own pattern).
- **`new Scene(…)` = root group + non-tree fields.** `.add()` takes anything placeable
  (objects, groups, ideal lights, sources — lights-as-leaves makes this uniform);
  `background`/`camera` are properties, not children.
- **`Obj(shape, matter)`** is the leaf constructor (three.js's `Mesh(geometry,
  material)` shape; final name open — Mesh is wrong for us). A bare shape instance
  (`new Sphere({…})`) is a shape VALUE — used by `Source(shape, radiance)`, later CSG.
- **`add(...nodes)` returns the container** (`this`) — variadic add makes
  return-the-node ambiguous, and return-this unlocks inline nested construction
  (`scene.add(new Group('rig').add(a, b).at([0.2, 0, 0]))`). Matches three.js.
- **Placement by property assignment** (`node.position = [x,y,z]`), each field
  accepting a constant or a signal — one field, two binding times, visually identical.
  Chainable synonyms `.at()/.rotated()/.scaled()` are sugar over the same fields for
  expression-position use, not a second system.
- **Plain tuples, no Vector3 class** — description data must serialize and pass
  through `Value<>`; a shared mutable vector object is the aliasing trap in miniature.
- **`sphere(params, matter)` = object; `sphere(params)` = shape value** (used by
  `source(shape, radiance)`, later CSG). Matter-presence is the §3 predicate made
  syntactic.
- **Deviations from three.js, deliberate**: add-of-parented-node throws (no silent
  reparent); no post-compile mutation until the runtime graph (errors, never
  silence); rotation is axis-angle/quaternion only (no Euler until asked for).
- **Quality bar**: the design leans on freeze/double-parent/driven-composition errors
  being excellent — diagnostics that name the fix, per house culture.
- **Structural-extension pin (code-derived, post-read)**: node classes carry the
  DESCRIPTION's own fields (`kind`, `sdf`/`shape`, `transform` holding raw `Value<>`
  payloads, `name`) — TS is structural, and the whole substrate (`flattenGroups`,
  `isDrivenTransform` "authored JS can hand us anything", Validator,
  propertyValidation) consumes description-shaped data as-is. Exactly ONE rewrite at
  compile: matter reference → minted `material: string`. No parallel representation,
  no adapters.
- **JSON-safety pin (code-derived)**: the witness digest `JSON.stringify`s the scene
  (scene-lab.ts __witnessDigest) and stamps serialize it — so parent tracking must be
  out-of-band (WeakMap / non-enumerable), and `compile()` emits pure plain data. An
  enumerable parent pointer = a cycle = a crashed witness runner.

## 12. Staging (post-read re-derivation, July 16) — and the road not taken

**Stage A — the typed VALUE layer**: schema-derived matter constructors + per-
primitive shape params + the matter-naming determinism scheme (§10.1b — names →
sorted ids → generated bytes → digests, Planner.ts:32). Ships alone; kills the C5
error class at the editor; settles the hard naming problem under witness gates
before any tree lands on it. Rides (and should push) the carrier migration §4 names.

**Stage B — the node tree**: Scene/Group/Obj classes per §11, thin by the
structural-extension pin (substrate already built and witnessed). Freeze, single
parent, clone.

**Stage C — the runtime graph** (already on the transforms deferred ledger): the
same mutation surface goes live post-compile via ParameterStore recompose.

Alternatives examined and REJECTED on the record (post-read re-derivation, owner-
prompted): *plain-data-only* (no classes — extend the literal+flattenGroups interim)
fails the make/move/group ergonomic requirement while keeping alias hazards
unenforceable; its insight survives as the structural-extension pin.
*Runtime-graph-first* (design the tree as the live graph, static = bake) pulls the
deliberately-deferred recompose machinery into v1 against fable-transforms §4's
staging; the one-API-two-binding-times design keeps its benefit without the scope.

## 13. What this document supersedes when pinned

Nothing yet — it composes with `docs/fable-transforms.md` (placement + flatten
authority) and the pinned taxonomy. The interim authoring syntax (TS object literals,
`flattenGroups` called by hand) remains fully supported underneath; the language is
sugar above it, never a replacement for the compiler's input format.
