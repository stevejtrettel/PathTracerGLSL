# PathTracerGLSL — What This Project Is and How It's Built

**Author:** Fable (July 2026)
**Purpose:** a self-contained description of this repository — its goals, architecture,
design decisions, and the reasoning behind them — written so a reader with no access to
the code or its design documents gets an accurate picture of what was built and why it
has the shape it has.

## 0. The project

A WebGL2 **research path tracer**: pure WebGL2 / GLSL 300 es, TypeScript strict, Vite,
zero frameworks. The owner is a mathematician; the long-term goals are volumetric media,
swappable material/transport models, complex multi-material objects, difficult lighting,
and eventually non-Euclidean spaces (H³, Nil geometry, black-hole metrics) — beautiful
path-traced mathematical imagery. It is not a product renderer; it is an instrument.
Nearly every structural decision follows from that: the swappable physics IS the research
output, so the architecture optimizes for *making the next experiment cheap* and for
*knowing the numbers are right*.

Everything renders as one fragment shader per pixel with ping-pong accumulation. That
constraint shaped several boundaries; §10 notes which.

---

## 1. The central idea: the renderer is a compiler

There is no hand-written "the shader." There is a **compiler** that takes two declarative
input documents and emits a purpose-built program:

```
compile(SceneDescription, RenderStrategy) → CompiledRenderer
```

- **SceneDescription** — the world: objects (geometry + material + media + transforms),
  lights, environment. Pure data, no behavior.
- **RenderStrategy** — the experiment: what to measure and how to compute it (see §2).
- **CompiledRenderer** — shaders + a render pipeline description + uniform bindings +
  parameter metadata. A closed artifact the engine executes *blindly*.

Every (scene, strategy) pair gets exactly the code it needs and nothing else: a scene
with no volumetric media contains zero medium-tracking code; a `pt` estimator with no
light sampling contains no NEE machinery. There are **no structural `#ifdef`s anywhere**
— the compiler decides what exists, and conditional inclusion of whole blocks replaced
preprocessor gating (only numeric knobs like `MAX_MARCH_STEPS` remain defines). Reaching
this took deliberate effort and paid off: dead branches in a megashader are both a perf
tax and — worse for a research instrument — a correctness ambiguity ("is this code path
even active?").

The compiler runs in four stages: **Analyze → Validate → Plan → Generate.**

- **Analyze** inventories what the scene+strategy imply (which material models appear,
  whether media exist, whether any emitter is samplable, …).
- **Validate** rejects ill-formed inputs with real diagnostics (unknown material model,
  driven parameter nobody reads; unbuilt-but-reserved enum values are *rejected, not
  silently removed*).
- **Plan** makes **every** decision and records it in a `ProgramDescription` — the
  complete link map of the program to be emitted: which seams exist, which dispatch
  tables get generated, which uniforms are live, plus data tables (light CDFs, folded
  transform parameters). This rule was hard-won (the "decision-hoist" batch): **code
  generators read the plan and data tables ONLY; they are forbidden from re-deriving
  decisions.** Before it, feature generators each re-inferred "does this program have
  media?" from the scene, and the inferences drifted apart. All decisions live at one
  altitude; generation is mechanical.
- **Generate** assembles GLSL from blocks through a small IR (`ShaderIR`) so every line
  of the emitted program carries **provenance** (which component or generator emitted
  it). Source maps run GPU compile errors back through assembly to the originating file.
  A shader-dump tool exports fully annotated emitted programs, used for reviewing what
  the compiler actually built.

Two structural mechanisms arrived late but became load-bearing:

- **provides/requires seams.** Every generated or included block declares what symbols it
  provides and requires. The compiler emits a generated interface header per program (its
  contract surface as a table of contents) and diagnoses **seam-missing** (something
  requires a symbol nothing provides) and **seam-unused** (something provides a symbol
  nothing consumes — the dead-code detector). Declaration order stopped being
  load-bearing the day this landed.
- **Exact linkage policy.** Self-authored component files are included *wholesale* (never
  carved inside an occupant — a declared, accepted cost). Everything *generated* is
  exactly linked: a seam exists iff the ProgramDescription says so. An audit before this
  policy found 27% dead code in the worst program; after it, zero.

### The compiler ↔ engine boundary

The **Engine** executes `CompiledRenderer` objects and knows *nothing* about scenes,
materials, or algorithms — it owns GL state, framebuffers, ping-pong swaps, uniform
upload, and per-frame builtins (`resolution`, `sampleCount`, `resetSalt`, `time`). The
pipeline description is explicit data: passes, framebuffer configs (with `_current`/
`_previous` reserved suffixes for double-buffering), swap instructions. This boundary was
formally locked early and never regretted: the compiler was rebuilt twice without
touching execution, and the engine cannot smuggle in policy.

One practical wrinkle from this design: the engine stores programs in a flat map, so
shader IDs are namespaced by renderer ID (`${strategy.id}-${scene.id}-main`) — an
un-namespaced collision silently clobbers programs, which bit once before the convention
was pinned.

---

## 2. The second central idea: the strategy taxonomy (measurement / estimator / view)

The project's most valuable *conceptual* asset, and deliberately independent of any
graphics API.

A pixel's value is a pairing of a measurement functional with the equilibrium light
field: `I_j = ⟨W_j, L⟩` where `L = E + TE + T²E + …`. Every input field modifies exactly
one of: the world (T, E), the question (W), the computation (the Monte Carlo scheme), or
the presentation. So the inputs decompose:

```
Scene                  defines (T, E) — the world, exactly. Nothing else.
Strategy
 ├─ measurement        defines the integral: camera + response + truncations.
 │                     Scene + measurement together define the NUMBER being computed.
 ├─ estimator          defines the computation: sampling scheme. Bias-free BY CONTRACT.
 └─ view               defines the presentation: tonemap/exposure on converged linear HDR.
```

**The measurement/estimator boundary is the bias/variance line.** A measurement field
changes what the render converges *to*; an estimator field changes only how fast and how
noisily it converges. The classification follows the math, never the intent. The
canonical pair: Russian roulette and `maxBounces` both terminate paths — RR terminates
randomly *with compensation* (unbiased → estimator), `maxBounces` deterministically
*without* (biased → measurement). Same mechanism, opposite sides, decided unambiguously.

Consequences that turned from conventions into theorems:

1. **Cross-strategy convergence has a definition.** Fix scene + measurement, vary
   estimator → converged images MUST agree. This became the renderer's most powerful
   test family (it catches MIS bugs, pdf mismatches, double-counting — see §8).
2. **Reset discipline is derived, not chosen.** Measurement changes mid-accumulation mix
   samples of different integrals → reset mandatory (this is why orbiting resets).
   Estimator changes → reset optional.
3. **Live-tunability is derivable.** Estimator knobs are provably safe as runtime
   uniforms; measurement knobs may be live only with mandatory reset.
4. **Testing obligations attach to sections.** Measurement field → a witness with a
   derived expected value. Estimator field → membership in a cross-convergence pair.
   View field → snapshots. *Every new field declares its section; the section IS its
   test contract.*

**The truncation ledger.** There is no "approximations" section — an approximated problem
is just a different, well-defined measurement. What distinguishes a *truncation* is
documentation: it names the exact limit in which it vanishes (`maxBounces: N`, limit
N→∞; `shadows: 'opaque-dielectrics'`, limit transparent-shadow refinement; `color:
'rgb'`, limit spectral). The measurement section is therefore the render's complete
**bias ledger** — one place listing every way the image differs from ground truth. A
related owner decision: things that are *model bias with unknown sign and no limit*
(e.g. "transparent shadows" via primary-ray transmittance hacks) are refused outright
rather than shipped as options. Renderer bias = declared truncations only.

The camera lives in **measurement** (it IS W_j), but binds at frame time: the compiled
program is a *family* of measurements parameterized by pose, so orbiting is motion
through measurement-space, not a recompile. Camera pose is also *authored* on the
strategy (`measurement.camera.{position,target}`) as the defaults of always-live
parameters — so (scene, strategy) alone determines the converged image, with no loose
parameter state. This closed a real reproducibility gap in the project's history.

The taxonomy also cleanly classifies exotic renderers (a check it passed): one-shot
direct lighting = `maxBounces: 1`; Whitted = a measurement-side path-class restriction;
AO / normal-view / pdf-histogram debug views = alternative measurements of the same
scene, first-class rather than hacks; toon shading = non-physical T (scene-side — the
interaction contract never required reciprocity) + view-side posterization.

---

## 3. The layer stack

Five layers, dependency arrows pointing strictly downward:

```
Authoring   scene-building conveniences: groups/trees, prefabs, the future DSL.
            Compiles to flat SceneDescription at definition time (pure functions).
   ↓
App         facade + managers: renderer lifecycle, render coordination, parameter
            store (the ONLY runtime channel), event bus, UI, production/export.
   ↓
Engine      executes CompiledRenderer blindly. No scene/material/algorithm concepts.
   ↓
Compiler    Analyze → Validate → Plan → Generate. Pure TS, zero shader files.
   ↓
Components  the LEAF library of swappable research code (see §4) + a small fixed
            GLSL core (the contract spine: structs, interaction interface, math,
            ray — the vocabulary every component is written against).
```

Two rules make this work:

- **Components are a leaf.** They import *nothing* from app/engine/compiler except
  contract *types* (`import type` only — enforced by an automated purity test that greps
  imports). Everyone imports from components. The research code sits at the bottom as a
  visible library, not buried inside the compiler as an implementation detail.
- **The scene description stays FLAT, forever** (owner-pinned). Groups, trees, prefabs,
  reuse — all of it lives in the authoring layer and compiles away before the compiler
  ever sees the scene. This works because placements are mathematically closed under
  composition (§7), so any authored tree re-expresses as per-object transforms. The
  compiler never walks a graph; the parameter store is the only runtime channel.

---

## 4. The component system (slots, occupants, families)

The project's working vocabulary:

- **Slot** — an extension point with a pinned shader-side contract (a seam:
  `<model>_sample`, `lighting_sample`, `medium_sample`, `camera_generateRay`,
  `ambient_geodesic`, …).
- **Occupant / component** — one implementation of a slot: shader code + a TS
  descriptor of declared facts (+ optional `.md` with the occupant's mathematics —
  derivation, sampling scheme, invariants; fillable post hoc).
- **Family** — the slot's kind: **mix-many** (several occupants coexist per program,
  selected per-hit → the compiler generates dispatch/union/CDF machinery: materials,
  lights, phase functions, geometry backends) or **pick-one** (one occupant per program,
  the planner selects: transport integrator, camera, sampler, ambient space, tonemap,
  accumulation, volume sampling, env chart).

The full census as of July 2026: materials (lambert, dielectric, GGX), lights (point,
quad, sphere), phase (Henyey–Greenstein), geometry backends (SDF marching, closed-form
analytic), ambient space (euclidean; H³/Schwarzschild are the intended future occupants),
transport integrators (pt, with pt/pt-nee/pt-mis as combiner configs), volume sampling
(analytic; delta-tracking future), env sampling charts (equirect, equal-area octahedral),
sub-pixel sampler (pcg4d; Owen–Sobol was built and reverted once), camera (pinhole,
thin-lens, orthographic, equirect 360, fisheye ×4 sub-projections, cylindrical panorama),
pixel reconstruction filter (box), film accumulation (average, oneshot, variance-tracking
Welford), tonemap (reinhard, ACES, none).

The mechanics that made "adding an occupant" genuinely one-folder-plus-one-registry-line:

- **1 component = 1 folder** — `{name.glsl, name.ts, name.md?, tests}` — uniformly, with
  the rule enforced by a structure test. Every family root carries a `README.md` contract
  doc: taxonomy section, kind, what occupants supply, how the compiler consumes them,
  the add-a-component recipe.
- **Registries are dumb lookup tables** at each family's `index.ts`. Descriptor fields
  may be functions (a pdf arm is a fact-as-code) but may never reference other
  components, ordering, or the plan. Registry order = dispatch order.
- **Property schemas are declared by occupants and the carrier structs are GENERATED per
  scene.** `MaterialProperties` has no `roughness` field unless GGX's schema declares it
  and GGX appears in the scene. A driven parameter with no reader is a validator
  warning. This is what keeps mix-many families open-ended without a universal
  übermaterial struct.
- **THE GUARDRAIL** (learned from a dead predecessor architecture — see §9): descriptors
  declare facts about ONE component — never composition, ordering, passes, or pipeline
  structure. All structural decisions live in compiler feature planners. A component
  tree that implies orchestration is how the previous system died.

A proof point that the axis works: bringing up GGX (the first material through the
finished front door) touched one folder + one registry line — and exposed exactly one
compiler bug, a hardcoded if-chain where a registry walk belonged. Bringing up
equiangular medium sampling (a new sampling *technique*) was likewise one file + one
registry line, by design (§5).

---

## 5. Transport anatomy: techniques, combiner, integrators

The path-tracing loop itself is **generated**, and its source of truth is factored at
mathematical joints rather than code-historical ones. The estimator theory behind the
factoring:

At each path vertex, the direct-lighting term can be estimated by two *sampling
techniques* over the same integral: **T1, kernel sampling** (draw the continuation from
the BSDF/phase; if it lands on an emitter, that IS a direct-light sample) and **T2,
light sampling / NEE** (draw a point on an emitter, shadow-test, evaluate the kernel
toward it). Run both at full weight and every samplable emitter is double-counted. The
classic strategies are just *weightings*: `pt` = T1 only; `pt-nee` = T2 at weight 1, T1
zeroed for samplable emitters; `pt-mis` = power-heuristic weights on both.

The structural subtlety: **T2 samples and scores at the same vertex; T1 cannot** — when
you draw the continuation at vertex k you don't yet know it will find an emitter; you
discover that at vertex k+1 or at the miss. So T1's sampling record (`prev_pdf`,
`prev_was_delta`, …) is carried one iteration forward and its score is settled where the
sample lands. This deferred scoring is why naive transcriptions smear the estimator
across the loop; naming it made the factoring obvious:

```
transport/
  techniques/   kernel (T1: continuation draw + BOTH deferred scoring sites + the
                carried record), light (T2: sample-and-score locally, surface & medium
                sites), equiangular (a T2 placement variant) …
                → A NEW TECHNIQUE IS ONE FILE + ONE REGISTRY LINE.
  combiner      EVERY weighting line in one place; pt/pt-nee/pt-mis are configs of it.
                (Single-emitter rule: MIS state writes and RR have exactly one owner.)
  integrators/  pt — the ~40-line walk skeleton: advance, state, self-heal, RR, spawn;
                composes techniques at its event sites. One-shot/Whitted/debug
                measurements = new walks composing the SAME techniques.
```

The emitted shader mirrors this anatomy under one governing rule: **math is static;
policy and plumbing are generated.** Static technique files contain the sampling math
and touch only the path state's pinned core (ray/throughput/radiance); every
program-dependent field is behind a generated accessor; the combiner weights, the state
struct, and roulette are generated per program.

---

## 6. The shader-side contracts

These are language-independent and encode most of the project's design effort:

- **The loop's five abstractions:** `Ray → scene_intersect → Hit → interaction →
  make_ray → repeat`.
- **`Ray` is a pure geodesic seed** — `{origin, unit direction}`, a point of the unit
  tangent bundle, NO search interval. Bounds were tried on the ray and it conflated
  three roles (identity / query far-bound / running-nearest). Their real homes: the
  running nearest lives on `hit.t` (each backend reads it as its far bound and shrinks
  it); the occlusion far-bound is an explicit argument to the any-hit query.
  Intersection never mutates the ray.
- **The non-Euclidean seam is two functions, priced at zero today:**
  `ambient_geodesic(origin, dir, t) → Point` (straight line in Euclidean space; the
  hyperbolic geodesic in H³; integrates the ODE internally for Schwarzschild — an
  implementation detail of the space, never a stepper type in the loop) and
  `ambient_dot(a, b, p)` (the metric). The mechanical rule: any inner product of two
  world-space physical directions goes through `ambient_dot`; dots between vectors
  already in local-frame components use raw `dot` (the frame is metric-orthonormal by
  construction — the metric is paid exactly once, at the world↔frame crossing).
  Self-intersection escape is an origin offset *via the geodesic* (an exp-map step),
  which is also the robust grazing-angle answer in flat space. An earlier design had a
  `GeodesicState` stepper threaded through the loop; it was deleted.
- **Semantic typedefs:** `Point`, `Direction`, `Spectrum`, `Radiance` (all `vec3` today;
  `Point` may become `vec4` for curved spaces). All contract code is written against the
  typedefs.
- **Spectral discipline:** no raw `vec3(...)` literals for radiometric quantities in
  library/generated code; reductions via `spectrum_*` helpers; radiometric constants
  emitted by the generator's formatter. This keeps "flip to spectral" a compiler axis
  instead of a rewrite. (Spectral itself: hoped-for, deliberately deferred.)
- **Sample-returns-weight:** every `*_sample` returns the full estimator weight
  (`f·cos/pdf` or its medium analog), with pdf available separately for MIS.
- **Explicit sample inputs:** samplers receive their random numbers as arguments
  (`(uc, u)` split per pbrt) — no hidden RNG state in the math. RNG is counter-based
  (pcg4d over pixel/sampleIndex/resetSalt), which makes every witness reproducible and
  made swapping the sampler family trivial.
- **Region identity is primary; two-sided hits.** A `Hit` reports the regions flanking
  the boundary (`region_from`/`region_to`/owner); containment is resolved by generated
  innermost-wins queries; media tracking is a single `current_medium` variable
  ground-truthed by the scene with a self-heal re-query (no medium *stack* — a stack
  desynchronizes and cannot recover; the scene-query design heals). Null interfaces
  (`material: none`) make multi-material objects and nested dielectrics compose.
- **`Value<T>` for every uniform-drivable property:** any authored field can be a
  constant (baked/folded) or `{param: "name"}` (a live uniform). One mechanism covers
  material albedo, medium density, transform fields, camera pose. Constants fold at
  plan time; params never recompile.

---

## 7. Transforms and the flat scene

Object placement is a **Euclidean similarity** (rotation + translation + uniform scale
s>0; reflections rejected, nonuniform scale *unrepresentable by construction* — it
doesn't commute with the SDF distance property or with normals, so the type refuses it).
Similarities are closed under composition, which yields the whole design:

- **Authoring:** `transform: {position, rotation, scale}` on any object; groups/trees
  compose at definition time via a pure `flattenGroups` and the compiler sees a flat
  list. Provenance paths are stamped into object names.
- **Constant transforms compile away.** The analytic primitive set is similarity-closed,
  so constant placements fold entirely into canonical primitive parameters at plan time
  (light sampling, CDFs, and pdfs all read folded params). SDF objects get classified
  wrapper tiers (identity / translation / rigid / similarity, with the `s·d` world-space
  distance correction that keeps the epsilon discipline valid).
- **Driven placement:** any transform field can be `{param}` → per-object uniforms under
  a rigid-frame contract (quaternion inverse + translation + scale; primitives absorb s
  in-shader so distances and epsilons stay world-exact). Sliders move objects with zero
  recompiles.
- The signature test: **conjugation** — one global similarity applied to every object AND
  the camera must reproduce the untransformed image exactly. One witness checks the
  entire chain in one number.

---

## 8. Verification culture — arguably the real product

A research instrument is worthless if you can't trust its numbers. The verification
stack, in layers:

1. **Static, in vitest (seconds):** compiler structure tests, source maps, validation
   diagnostics; component purity (leaf-layer imports) and structure (folder rule,
   READMEs); **glslang static compile of every registry pair's emitted shaders** —
   with a caveat learned the hard way: glslang accepts what ANGLE rejects (e.g.
   ternaries over structs), so static compile never replaced GPU checks.
2. **`npm run witness` — the numeric GPU gate (minutes, headless SwiftShader via
   Playwright).** A registry of ~40 witness scenes, each asserting *derived* expected
   values, not golden images. Check kinds:
   - **mean** — analytically derived numbers: the furnace test (albedo 0.4 sphere in a
     unit environment → pixel value exactly 0.4000, i.e. the L/(1−ρ) closed form),
     Fresnel integrals for the dielectric (0.5541), analytic slab transmittance for
     media, per-channel furnace variants.
   - **equality / twin** — the taxonomy's cross-strategy convergence pairs (pt vs pt-nee
     vs pt-mis on the same measurement; transform-authored vs hand-folded twins,
     bit-exact), gated on Δ frame-mean in linear HDR (bias) plus a noise-normalized χ²
     against measured per-pixel variance (structure; ≈1 for same-integrand arms at any
     spp — fireflies self-normalize).
   - **noise** — equal-spp σ/µ comparisons that pin variance-reduction claims as
     numbers (equiangular sampling's halo improvement reproduces as 18.05% vs 21.24%;
     veach asserts MIS < pt < NEE in the right order).
   The per-pixel variance itself comes from a **variance accumulation occupant**
   (Welford, MRT so mean+moment swap in lockstep), verified to leave the mean
   bit-untouched.
3. **Refactor gates:** any re-carve of verified generation code is proven by **byte- or
   token-identity of every emitted program** before/after (hash all registry pairs).
   Where byte-identity was impossible by design (the function-shaped loop rewrite), the
   regime was witness sweep + static compile + re-goldened snapshots + a perf wash.
4. **Reproducibility stamps:** every HDR/PNG export embeds scene JSON, strategy JSON,
   parameters, spp, resolution, RNG salt, and git hash, plus a pinned-salt mode. Any
   image can be reproduced from its own header.

The meta-rule from the taxonomy organizes all of this: *every new input field declares
its section, and the section is its test obligation.*

Process rules that paired with the gates: design docs are written and **pinned** before
building (they are the authority; code conforms to them); refactors never mix with
feature work; "modular-first" — build the swappable axis with the first implementation,
and ship one occupant through witnesses before adding the second.

---

## 9. History and lessons (including the failures)

- **A previous architecture died and its corpse taught the guardrail.** The pre-compiler
  "module system" let modules declare composition, recipes, and pipeline structure.
  Emergent orchestration from distributed declarations became undebuggable. The fix was
  the descriptor guardrail (§4) plus decision-hoisting (§1): facts live in components,
  ALL structure lives in the planner, generators re-derive nothing.
- **Structural `#ifdef`s were a long-lived mistake**; conditional inclusion + generated
  seams replaced them fully.
- **Feature generators re-deriving decisions** caused subtle drift until
  `ProgramDescription` became the complete link map.
- **Silent dead code accumulates fast** in generated programs; the seam-unused
  diagnostic became the immune system — it found a program that was 27% dead.
- **Byte-identity proved to be a superpower for refactors** of generation code: emitted
  output is hashable per (scene, strategy) pair, so a pure re-carve can be *proven*
  behavior-free.
- **The bias ledger prevents "helpful" hacks.** Several tempting features (transparent
  shadows via transmittance hacks, firefly clamping as a default) were classified as
  model bias or declared truncations rather than silently shipped.
- **Owner process preferences that shaped quality:** discuss loop/interface structure
  before implementing; commit to one position rather than presenting A/B/C hedges;
  audit real files before making claims about them; never dress an approximation as a
  real technique.
- **Dialect trivia bites regardless of tooling:** driver/translator quirks (ANGLE
  rejecting struct ternaries that glslang accepts) meant the static-compile harness
  never fully substituted for executing on the real stack.
- **Deferred, with seams already in place:** meshes + BVH (the geometry-backend
  capability seam anticipates them), heterogeneous media + majorant tracking, spectral
  transport, many-lights structures, curved ambient spaces (the `ambient_*` seam is
  ready; H³/Schwarzschild occupants unbuilt), shared/instanced frames.

---

## 10. What was shaped by the WebGL2 substrate

For completeness, the parts of this design that are facts about the platform rather than
about path tracing:

- **"One fragment shader per pixel" drew the scope boundary.** The declared non-goals —
  photon mapping, BDPT, radiosity, ReSTIR-style reuse, anything where pixel j's estimate
  depends on cross-pixel or cross-frame state beyond accumulation — all coincide with
  what a per-pixel fragment-shader estimator can't express. The taxonomy's boundary
  (per-pixel independent MC estimates of path-class integrals) and the platform's
  boundary are the same line, which is part of why the taxonomy fit so cleanly.
- **Texture-unit assignment needed a single authority.** After an audit, all texture
  unit allocation was centralized in one executor; features contribute resources through
  a declared `extern:` chain rather than binding anything themselves.
- **Data tables are baked into GLSL.** Light CDFs, folded transform parameters, and
  material property tables are emitted as shader constants/uniforms at compile time —
  there are no storage buffers in WebGL2, so "runtime-sized scene data" isn't a concept
  here; scene edits that change tables are compile events, and the `Value<T>` mechanism
  (§6) is the sole fold-vs-live line.
- **Ping-pong accumulation with `_current`/`_previous` framebuffer suffixes** is the
  engine's double-buffering idiom; MRT is used where two buffers must swap in lockstep
  (the mean+moment pair of the variance occupant). HDR export reads the *previous*
  accumulation buffer — post-frame-swap semantics, documented at the read site.
- **The environment bake** (procedural environments rendered once to a texture + CDF by
  a fixed-size headless renderer) exists because a fragment-shader path tracer can't
  cheaply evaluate a procedural environment inside NEE sampling; it's an app-orchestrated
  one-shot GPU pass.

The one-sentence summary of the whole system: **scene + measurement define a number; the
estimator computes it without changing it; the view displays it; components make every
piece of physics a library entry; the compiler is the only thing that knows how they fit
together; and a witness with a derived expected value guards every claim.**
