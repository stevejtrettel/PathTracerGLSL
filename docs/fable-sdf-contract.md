# fable-sdf-contract.md — the SDF object contract

**STATUS: owner-directed DESIGN (Aug 10 2026, chat session — "the compiler should
obviously write all boilerplate"; "step back and really think about how SDFs should
work"; "update the design"). This AMENDS `impl-plan-sdf-as-shape.md` §1: the T1
decision that the march loop and gradient normal are static hand-written functions
in each shape file is REVERSED — they are boilerplate over the field and become
GENERATED (§4). Untouched: the measured per-object architecture (sdf-as-shape §0),
the LEAF_SDF table plan-side (`fable-sdf-accel.md`), placement (`fable-transforms.md`).
Composition stays deliberately absent (owner, Aug 10); §7 records what this contract
prepares for it.**

**BUILD RECORD (same day, owner-ordered "uniformize all current sdfs to this style";
B4 built the following session — the contract is now FULLY BUILT):
B1–B3 + B5 — vitest 1997 + glslang (all 268 registry pairs) green; B4 (`defineSDF`,
§5.2 as amended below) — vitest 2013, demo `custom-fields` compiled + headless-GPU
render-checked (gyroid lattice + solid glass tangle). The witness sweep is
OWNER-GATED as always. One declared
deviation from the plan text: `thickness` stays IN the field (apollonian's
`size·d − thickness` line) rather than becoming a generated subtraction — the
invariant chosen at build is that **`<type>_sdf` is the exact signed field of the
object as declared**, which keeps every consumer (containment, classification,
normals, composition later) reading one truth with zero plumbing; the §3 table row
below is amended to match. Build notes folded into the sections; snapshot churn =
the named classes (deleted hand copies → one generated block; 6-tap → 4-tap;
canonical structs losing `center`).**

## 1. The principle

**An SDF object is ONE authored field plus a sheet of declared facts.**

- Everything derivable from the field is DERIVED by the compiler.
- Everything underivable is DECLARED — and every declaration gets a GATE that tests
  it by sampling. Declared-but-untested is how geometry silently clips.
- The pinned doctrine ("math is static; policy and plumbing are generated") applied
  correctly: **the field is the math. The march loop and the gradient are POLICY
  over the field**, not math — the opposite classification in sdf-as-shape §1 is
  what produced nine byte-identical hand copies of each, with nothing checking they
  stayed in sync. A fix to the stall rule or the epsilon dilation must be a
  one-site change forever.

## 2. The authored surface

One function, **canonical** — origin-centered, standard orientation, no placement
awareness:

```glsl
float torus_sdf(vec3 p, Torus t) {
    vec2 c = vec2(length(p.xz) - t.ringRadius, p.y);
    return length(c) - t.tubeRadius;
}
```

- **No `center` row, no `p - t.center` line.** Position, rotation, scale are
  placement (`transform.*`), entirely the compiler's. This kills the two-spellings
  problem (`parameters.center` vs `transform.position`) for marched shapes. The
  cost is one generated `p - t` line for a constant-translated marched object
  (previously folded into the center row) — noise beside a march loop of dozens of
  field evaluations.
  - **Scope pin**: canonicalization applies to MARCHED-ONLY shapes now
    (torus/bottle/knob/menger/apollonian). Analytic shapes' position-carrying rows
    (sphere `center`, plane `point`, quad `corner`/edges) are the FOLD AND RECORD
    CARRIERS — the params-tier instancing record IS `Sphere(center, radius)` — and
    stay. Whether their *authored* spelling should also become transform-only is a
    separate discussion (§9).
- Optional real math beside the field: `<type>_uv` (a chart, opt-in as today);
  FUTURE `<type>_data` (orbit traps and other field-interior data — §9).
- File-private prefixed helpers stay allowed (bottle's combinators, knob's vendored
  ops). The struct is never written — the author writes against the generated
  struct's field names, which are the descriptor rows.

That is ALL the GLSL an SDF shape author writes.

## 3. The declaration sheet (the descriptor)

Each fact is genuinely underivable from an opaque field; each has a gate.

| fact | meaning | default | gate |
|---|---|---|---|
| `params` rows + kinds | the moduli; kinds (`length`/`scalar`/…) drive scaling + folds | — (existing) | contract tests (existing) |
| `marchBound` | a bounding PRIMITIVE as a function of the rows (`'self'` / `{type, values}` / `'unbounded'`) | required for marched shapes (existing) | **containment sampling**: the field twin's negative points must lie inside the declared bound; the synthetic must-fail arm stays |
| `bounds()` AABB | world box for TLAS/instancing | **DERIVED from `marchBound`** for cross-type bounds — the bound primitive's own `bounds()` at the mapped values. Hand-written only in the self-bounded base case. Menger/apollonian restating their `marchBound` numbers verbatim, and bottle sharing them by hand, is exactly the drift hazard bottle.ts already names | derived-equals-current test at migration |
| `lipschitz` | ~~a global step divisor~~ **DELETED (Aug 11 hygiene, owner-ordered)**: zero occupants ever declared it — real fields bake their safety factor IN-FIELD, where it can depend on the parameters (the gyroid's `2.5k`), and the value/gradient authoring form needs no global divisor at all. `refine` (§4) is the estimate-quality fact that earned its place | — | — |
| `refine` | hit-refinement conservatism factor (§4): worst-case ratio of true surface distance to the estimate near the surface. Declared ⇒ accepted hits are sign-bracketed to the true crossing; absent ⇒ no polish, no cost | none | the ring-banding class it exists for is eye-checked (the field-glass witness gates its estimator consequences) |
| `thickness` | a ROW, applied IN the field (amended at build — see the header): the ε-shell of a measure-zero set is part of the shape's definition, and `<type>_sdf` is pinned to be the exact field of the object AS DECLARED, so the subtraction is shape math, not boilerplate. Apollonian is the standing instance | none | covered by the bound gate (the shell must stay inside the bound) |
| `stepBudget` | NEW. Per-shape max march steps — a fractal wants 512, a torus wants 64. `MAX_MARCH_STEPS` becomes the default, not the law | global | perf witness rows |
| `uvChart` | opt-in chart (existing) | off | existing |

**CONTRACT PIN — declaration functions receive RESOLVED values.** This is already
documented at `descriptors.ts` §"resolved values" and is VIOLATED today: the
generator calls `marchBound.values(obj.parameters)` raw
(`intersection.ts` sdfObjectArm), and the Planner's driven and retained-frame paths
only canonicalize, never resolve. A driven bottle with `thickness`/`smoothJoin`/
`rounded` left to defaults gets NaN through `bottleExtent` → `cylinder_interval`
returns false → **the object silently disappears**. The constant path escapes only
because folding resolves as a side effect; torus/menger/knob escape only via
defensive `?? [0,0,0]` lines that paper over the violation. Fix: resolve ONCE in
the Planner so `PlannedObject.parameters` are always resolved; delete the
defensive defaults; make `marchBound.test.ts` feed UNRESOLVED input (today it
resolves first, so it structurally cannot catch this).

## 4. The derived surface (generated, never authored)

- Struct + ctor from rows (existing).
- **`<type>_sdf_intersect` — generated** per present type: interval clamp, the
  interval-end epsilon dilation, the grazing stall-commit, `abs()` so one loop
  marches interiors, the shape's `stepBudget`. One emitter = the single truth for
  every marching rule.
- **`<type>_sdf_refine` — generated, NEED-DECLARED via the `refine` fact**
  (owner-ordered Aug 11 after the glass tangle's ring banding; scoped to a
  declaration the same day after an always-on version taxed the fractals for
  nothing): acceptance tests the ESTIMATE, so a conservative field's accepted TRUE
  residual can reach ~C× march_epsilon (C = the estimate's conservatism) — past
  EPS_INTERFACE, breaking the §4.2 classification band (contour rings + wrong-side
  speckle in interiors). A shape declaring `refine: C` gets a sign-only polish
  (the sign is exact under any conservatism): doubling steps sized from C bracket
  the crossing — NEVER wider, so a fine-featured field cannot be overshot into a
  farther surface — then 8 bisections, committed on the STARTING side (the
  landing-offset lesson). No bracket = graze = the stall behavior. Undeclared =
  no polish, no cost: a true distance OR a value/gradient estimate lands within
  ~2 acceptance radii already.
- **The authoring guidance that falls out** (and the variety-port shape): prefer
  VALUE/GRADIENT estimates (`d ≈ ½·f/max(|∇f|, floor)` — the old tracer's DE;
  gradient hand-derived for simple polynomials, autodiff's job when the
  expression machinery lands). First-order accurate near the surface ⇒ fast
  marching AND a small honest `refine` (~4). A global-gradient-bound divide
  (÷L for large L) is the crude fallback for gradient-less fields — it marches
  slowly and needs `refine: L`. The demo tangle is the worked example of the
  good form.
- **`<type>_sdf_normal` — generated 4-tap tetrahedral gradient** (replaces the
  hand-written 6-tap: four field evaluations, same order of accuracy, and the tap
  pattern becomes a one-site choice). Numbers move at epsilon scale → the witness
  sweep re-gates (owner-run).
- Containment (`scene_region_at` + TLAS point descent), interiors, placement
  conjugation, table records, instancing arms — existing, unchanged.
- **The derived-coupling rule** (imported from the old tracer's AT_THRESH lesson):
  any tolerance that must CONTAIN another is COMPUTED from it, never restated.
  `EPS_INTERFACE = 10× MARCH_EPSILON` holds today by a comment; the moment
  per-shape budgets or epsilons exist, the classification band must be derived
  from the worst accepted march residual, or we inherit the old tracer's "silent
  intermittent wrong-material" bug class it built that derivation to kill.

## 5. Two front doors, one contract

Scenes will carry 1–10 *bespoke* complex fields (a new variety, a knot, a fractal)
next to simple analytic furniture. Both doors serve the same contract:

1. **Registry shapes** (torus, bottle, …): the folder ceremony — `{name.glsl,
   name.ts}` + one registry line. For reusable, parameterized shapes.
2. **Scene-local fields — BUILT as `defineSDF`** (`components/geometry/custom.ts`):
   a field written next to the scene it serves, ONE call — the GLSL field, its TS
   twin, and the declaration sheet — no folder, no registry line. The compiler
   generates the identical boilerplate (the descriptor registers `local: true`;
   folder/structure/contract tests cover folder occupants only).
   - **The gate mechanism, decided at build**: the TWIN IS PART OF THE DEFINITION
     (a required spec field), and the containment check runs in TWO places —
     definition time rejects malformed specs (name/rows/symbols/bound
     resolvability; point rows rejected: local fields are canonical), and the
     VALIDATOR samples the twin against the declared bound over each authored
     object's RESOLVED values, so a clipping bound is a compile error naming the
     object, at the exact parameter values the scene uses. The checker core is
     shared (`geometry/boundCheck.ts`) with `marchBound.test.ts`'s registry gate.
   - Standing coverage: demo `custom-fields` (gyroid + solid quartic tangle — real
     dielectric interior through the twin-checked field) rides glsl-compile via the
     demo suite AND the kitchen-sink registry scene picks local fields up
     automatically (constant + driven arms); its link map is snapshot-covered.
   - The demo's build also recorded the honest failure mode the gates canNOT catch:
     a degenerate-but-bounded shape (the first gyroid render was a solid ball — the
     conservative divisor crushed the field below its own shell thickness). The eye
     owns that class; the card's `expected` text is the check.

## 6. The gates, collected

- Bound containment (per §3) — the gate that catches silent clipping.
- Lipschitz sampling — the gate that catches overshooting estimates.
- Resolved-values (per §3's pin) — the gate that catches NaN extents.
- The 9-copy sync-drift class is STRUCTURALLY DEAD once §4 lands — no gate needed
  where there is one author.
- The TS field twin stays the measuring instrument (it is also how bounds with no
  closed form get MEASURED — knob, apollonian). It remains a hand transcription;
  that risk stays on the ledger honestly (§9) rather than pretending it is checked.

## 7. Composition-readiness (why the facts are data, not comments)

Composition is deliberately absent (owner, Aug 10 — single SDFs first; the trigger
for the discussion is a second consumer of any operator). But the declaration sheet
is designed to be what operators CLOSE OVER, because every operator is a computable
function on it:

- smooth union: bound = union of bounds inflated by the blend radius; lipschitz = max.
- displacement: lipschitz ×= `1 + amp · gradBound` (the field declares its
  gradient bound — the old tracer's fold, `1 + amp·gradBound`, is the reference).
- shell/onion: bound inflated by the thickness; thickness is already a fact.
- a blend is ONE object with one derived sheet (pinned in fable-sdf-accel) — so
  composition never needs a scene-level combined field.

If the facts are structured data, operators fold them mechanically. If they are
prose and hand-typed numbers, composition is manual forever. That is the deep
reason §3 is a schema and not a README.

## 8. Build stages

Cheap gates between stages (tsc, targeted vitest, glslang); snapshots re-goldened
with the diff audited to a named class; the witness sweep is owner-run at the end.

- **B1 — the resolve bug.** Planner resolves once; defensive `??`s deleted;
  `marchBound.test.ts` hardened to unresolved input. First because it is silent
  geometry loss and everything after rebuilds on trustworthy parameters.
- **B2 — generation.** `<type>_sdf_intersect` + `<type>_sdf_normal` generated
  (4-tap); the 18 hand copies deleted; `lipschitz`/`stepBudget`/`thickness` facts
  live in the generated loop; cross-type `bounds()` derived from `marchBound`.
- **B3 — canonical marched shapes.** `center` rows deleted from the five marched
  shapes; scene/witness migration sweep to `transform.position`.
- **B4 — the scene-local door.**
- **B5 — hygiene.** Stale text: geometry/intersection READMEs still document the
  deleted `scene_march_bound`/`scene_object_sdf`; sdf-as-shape prose says
  threshold 16 where the constant is 9; `marchBound.test.ts`'s "every bound is
  'self'" comment is false since the library landed; knob.glsl's `shared:
  ['fields']` fossil. Plus: trim the `presentTypes` closure for tabled scenes
  (the bound type's whole file is dragged in where `<bt>_interval` is never
  called) and add the two-step bound-chain test the fixpoint promises.

## 9. Deferred ledger

- **Data outputs** (`<type>_data` — orbit traps; `Hit.uv` is a surface chart, not
  this). The thing that makes fractals beautiful; needs a Hit/PathState seam
  discussion.
- **Analytic shapes' authored-position spelling** (transform-only authoring for
  sphere/plane/quad/disk) — separate from §2's scope pin.
- **Twin generation or a GPU-sampled gate** replacing the hand transcription.
- **Equation/expression fields** — the dual-number autodiff transpiler + JS
  finite-difference cross-check in the old tracer (`equations.js`) is the working
  ancestor; `fable-expression-machinery.md` is the plan of record. Autodiff feeds
  the distance estimate; the shading normal stays the numerical gradient of the
  final field (the two coexist, deliberately — verified in the old tracer).
- **Composition operators** (§7's trigger).
- **Per-shape march EPSILON** (only the budget now; epsilon needs §4's
  derived-coupling rule built first).
- **SDF instancing** (unchanged from sdf-as-shape: the frame wrapper with the
  generated intersect as leaf body).
- **`material_of` O(N) decomposition** (sdf-as-shape §6.2) — orthogonal, its own
  batch.
