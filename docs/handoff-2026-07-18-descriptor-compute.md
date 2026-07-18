# Handoff — the "descriptors compute" abstraction (design, not yet built)

**Written:** Jul 18 2026, end of the precompute-split session. **For:** a fresh instance to
think through the CORRECT abstraction WITH THE OWNER, from first principles, then plan + build.

**Read first:** `CLAUDE.md`, `src/compiler/generate/values.ts` (its header = the decision
procedure), memory `precompute-split-taxonomy.md`. This doc assumes that taxonomy.

---

## 0. The one instruction

**Do NOT reverse-engineer the design from Draine (or fisheye, or cylindrical).** Those are
three *validation cases* — the abstraction must handle them, but it must be derived from the
WHOLE landscape of "a value the shader needs is computed from authored inputs," not shaped to
one occupant's accidents. The owner explicitly wants the correct general cut, then check it
against the cases — not a per-family bolt-on. Think hard; open with the general question.

## 1. What just happened (so you know where the base is)

This session ran a precompute/constant-vs-uniform audit and locked a **decision procedure**
(6 categories: STRUCTURAL / FRAME_PLACEMENT / INSTRUMENT / ENGINE_BUILTIN / DERIVED / SCENE_VALUE
— see `values.ts` header). A cleanup batch then closed the real gaps and the main offenders:
ior_of leak → `emitValue`; the light-CDF prefix-sum unified (+ a latent equiangular bug fixed);
env color → SCENE_VALUE; env rotation `sin/cos` → shipped `u_envRotCS`; camera aspect → `u_aspect`;
a taxonomy header + enforcement test (`tests/compiler/valuesSplitPoint.test.ts`).

**Tree state:** all of the above is DONE, green (992 vitest + glslang), GPU-verified on ANGLE,
and UNCOMMITTED (the owner commits after a witness sweep). Start from this green base.

**Three offenders were DEFERRED** because fixing them cleanly needs the abstraction this doc is
about: fisheye projection trig, cylindrical focal length, Draine lobe params. They are DERIVED
quantities currently recomputed per-thread on the GPU. They are the validation cases, not the
design.

## 2. The problem, stated generally

A recurring need: **the shader wants a value that is a function of authored inputs** — not the
raw authored value. `tan(fov/2)`, not `fov`. The look-at basis, not `position`/`target`. The
selection CDF, not per-light powers. A quad's normal+area, not its corners. Draine's four lobe
params, not the droplet diameter.

The **engine-level machinery to ship such values already exists and is general** — do NOT
rebuild it:
- `PlannedUniform.compute: (params) => number|number[]` + `parameterPaths` — a CPU closure
  shipped as a uniform (recomputed on any input change; `default` = the plan-time bake). The
  engine runs it blind. `plan/types.ts`.
- `derivedCtorFields` — per-instance struct fields computed from authored values, baked as
  literals into a generated struct ctor. `components/descriptors.ts`.

**The gap is one layer up: WHO may declare a derived value, and HOW.** Today:
- **Features** (hand-written TS: camera.ts, environment.ts, lighting.ts, Planner.ts) freely
  mint `compute` closures. That's why basis/tanFov/aspect/CDF/env-rotation were easy.
- **Registry descriptors** (camera models, phase models, light kinds, primitives) can only
  declare *pass-through* facts — "this authored param becomes this uniform/field, unchanged" —
  EXCEPT the two families that already grew `derivedCtorFields` (lights, geometry). A camera or
  phase descriptor cannot say "u_x = f(my inputs)."

The tell that this is a real wart, not a missing feature: **`tan(fov/2)` is a hardcoded
special-case in `camera.ts`** precisely because the camera descriptor couldn't declare it. Any
correct abstraction should let that special-case be DELETED (fov declared like any other derived
value). "Retiring the fov hack" is the litmus test for the right cut.

## 3. The full landscape of derived-value sites (survey before you design)

Do not design against Draine. Design against ALL of these, then check the cut handles each.

**Global derived → uniform (`compute:` closures today):**
- `camera.ts`: `u_cameraForward/Right/Up` (cameraBasis), `u_tanFov` (tan, SPECIAL-CASED),
  `u_aspect` (imageSize divide).
- `environment.ts`: `u_envRotCS` (cos/sin of the rotation angle), spectrum broadcast.
- `lighting.ts`: `u_light_selpdf[]` / `u_light_cdf[]` (computeSelectPdf + prefix-sum).
- `Planner.ts`: `u_object<i>PlacementQ/TS` (rigid-frame inverse, evalQ/evalTS).

**Per-instance derived → struct field (`derivedCtorFields` today — ALREADY a shared pattern):**
- lights: `components/lights/quad/quad.ts` — normal + area from corners/edges.
- geometry/primitives: `components/geometry/quad/quad.ts` — same mechanism, second family.

**Plan-time derivations that aren't quite either (note them; decide if they belong):**
- `foldAnalyticParameters` (Planner) — a constant transform folded INTO primitive params.
- `computeSelectPdf` / `lightPower` — the CDF values.
- `effectiveMajorant` (materials) — auto-derived σ̄.
- `defaultExpr` (schema) — struct-field defaults from row defaults.

**The offenders (DERIVED leaked to the GPU — the validation cases):**
- fisheye: `sin/tan` of `u_fisheyeFov` per ray, projection-specific (`fisheye.glsl`, `fisheye.ts`).
- cylindrical: `imageSize.x / radians(u_cylHfov)` per ray (`cylindrical.glsl`).
- Draine: four lobe params from `mp.draine_d` per phase-eval (`draine.glsl`, `draine.ts`).
  NOTE: phase params are provably NEVER spatially-varying (the Validator rejects expression phase
  params — only σ_a/σ_s/emission may vary), so the lobe params are ALWAYS frame-constant. There is
  no homogeneous-only caveat; do not encode one.

## 4. The design questions to resolve from first principles

These are the questions — answer them generally, WITH the owner, before proposing types.

1. **Is there ONE abstraction, or two?** Every derived value has a *landing spot*: a global
   **uniform** or a per-instance **struct field**. Is "derived value" one concept that the
   compiler ROUTES to a landing (by the shared-vs-per-instance cardinality axis the taxonomy
   already uses), or are uniform-derived and field-derived legitimately separate mechanisms that
   merely rhyme? (`derivedCtorFields` already spans two families — is `compute`-uniform its global
   twin, and should they share a declaration vocabulary?)

2. **Control surface vs shader surface.** A candidate frame from this session: separate what the
   USER drives (sliders / authored params) from what the SHADER reads (uniforms/fields), where a
   shader value is pass-through OR a function of controls (+ engine builtins). Is that the right
   decomposition? It cleanly explains fov (control `camera.fov` → shader `u_tanFov=tan/2`) and
   would delete the special-case. Does it generalize to struct fields (control `draine_d` → shader
   lobe fields) without strain? Is "control vs shader surface" the RIGHT primitive, or a symptom of
   something deeper?

3. **Where does the compute live, and who owns purity?** Descriptors are in `components/` (leaf
   layer; may import only contract TYPES from the compiler — enforced by
   `tests/components/purity.test.ts`). A `compute` closure is a pure JS function (no compiler
   types), so a descriptor CAN carry one. But should the *derivation math* live in the descriptor
   (co-located with the occupant, like `cameraBasis`/`similarityFromTransform` are shared TS), or
   be declared and computed elsewhere? What keeps bake≡ship (the plan-time default and the
   live closure must call ONE function — see `resolveLightValues`, `cameraBasis`, the
   evalQ/evalTS precedent) when the descriptor owns the math?

4. **Driven inputs.** A derived value can depend on a `{param}`-driven input (a driven `fov`, a
   driven `draine_d`). Then the derived value is itself live (a compute closure), not baked. The
   uniform case handles this already (compute closures re-run). The struct-field case does NOT —
   `derivedCtorFields` bakes literals only (lights/geometry are constant). Does the correct
   abstraction unify "baked derived field" and "live derived field," or is the struct-field path
   constant-only by contract with driven-input derived values forced to the uniform landing?

5. **Relationship to the taxonomy and the fold path.** DERIVED is one of the 6 categories.
   FRAME_PLACEMENT (fold vs rigid-frame) is arguably ALSO a derived value with two landings
   (folded-into-params vs uniform-pair). Should placement unify under the same abstraction, or is
   it correctly separate (it was excluded from the value-split for good reasons — see the taxonomy
   memo; the constant FOLD *eliminates* work rather than shipping a value)? Don't force it; but
   ask whether the derived abstraction and the placement mechanism are the same shape wearing
   different clothes.

6. **Does the fov special-case die?** Whatever you propose, verify it lets `camera.ts` delete the
   fov `if`-block and declare `u_tanFov` the same way every other derived value is declared. If it
   doesn't, the cut is probably wrong.

## 5. Invariants / constraints (don't violate)

- **Don't rebuild the engine mechanism.** `PlannedUniform.compute` + `derivedCtorFields` are the
  right foundations. This is a DECLARATION-layer design.
- **Components purity** (`import type` only from the compiler; `tests/components/purity.test.ts`).
- **bake ≡ ship**: the plan-time `default` and the live `compute` MUST route through one shared
  function — never two copies of the math (the drift class this session's CDF fix closed).
- **The taxonomy** (`values.ts` header) is the settled frame; the derived abstraction must slot
  into the DERIVED category, not reopen SCENE_VALUE / INSTRUMENT / etc.
- **Byte-identity discipline**: a refactor that moves fov/basis into descriptors should emit
  IDENTICAL GLSL for the existing cameras (proven by re-goldened snapshots + the witness sweep).
- **The owner reviews interfaces before implementation** and dislikes plans shaped around one
  occupant. Present the general cut + one worked example, STOP, then build.

## 6. Validation cases (the abstraction must make these clean, ~5-line, no special-casing)

- Camera fov → `u_tanFov` (and the `camera.ts` special-case DELETED).
- fisheye → `u_fisheyeK` (projection-specific constant, computed once).
- cylindrical → `u_cylFocal` (from `cylHfov` + `engine.imageSize`).
- Draine → 4 lobe struct fields (from `draine_d`), baked when constant, live when driven.
- (Sanity) the existing quad normal/area (`derivedCtorFields`) should re-express under the new
  abstraction without churn, OR the abstraction should explicitly subsume it.

## 7. Out of scope for THIS design

- `DISPLAY_EXPOSURE` (a `#define` carrying a continuous value) is a VIEW-layer thing (the display
  pass), not a descriptor — a separate small "live view uniforms" fix. Don't fold it in.
- Don't touch the committed taxonomy/cleanup work; build on the green base.

## 8. File pointers

- `src/compiler/generate/values.ts` — the taxonomy header + the SCENE_VALUE split.
- `src/compiler/generate/features/camera.ts` — the fov special-case (to be retired); the shared
  camera plumbing; the `model.params()` / `model.defines()` loops.
- `src/components/camera/index.ts` — `CameraModelDescriptor` / `CameraParam` (the control/uniform-
  fused shape to redesign); the 6 descriptors alongside.
- `src/components/descriptors.ts` — `PhaseModelDescriptor`, `LightKindDescriptor.derivedCtorFields`,
  `PrimitiveDescriptor.derivedCtorFields`, `DerivedFieldSpec`.
- `src/compiler/plan/types.ts` — `PlannedUniform.compute` / `parameterPaths` / `arrayLength`.
- `src/compiler/generate/features/materials.ts` — `generateMediumProperties` (where phase struct
  fields are assigned per-medium); `unionFields` of phase properties.
- `src/components/volume_scattering/draine/{draine.ts,draine.glsl}` — the Draine occupant.
- `src/engine/ParameterManager.ts:78-120` — where `compute(params)` runs each frame (engine-blind).

## 9. Suggested opening move for the fresh instance

Don't propose types first. Start by asking the owner question 1 and question 2 (§4) — is derived
one concept with two landings, and is control-vs-shader-surface the right primitive? Get those
settled, THEN write the interface for ONE family as a worked example, STOP for review, then build
camera (retiring the fov hack), then phase. The offenders fall out; they were never the point.
