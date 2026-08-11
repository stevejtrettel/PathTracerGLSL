# impl-plan-sdf-as-shape.md — an SDF is a shape with a slow intersect

**STATUS: owner-approved plan (Aug 10 2026). The owner asked the architecture question,
the measurement answered it, and the owner ordered the rebuild. This plan AMENDS
`docs/fable-sdf-accel.md` (whose LEAF_SDF plan-side survives intact — records,
eligibility, the leaf-1 scene TLAS, the packing) and RETIRES the global min-march
described there and in `fable-geometry-materials-target.md`. Build record for the
superseded GLSL half: `docs/impl-plan-sdf-accel.md` (keep it — the compile-stall
incident record is the standing law about generated code).**

## 0. The decision and the evidence

**An SDF object is not a second way to trace the scene. It is a primitive whose
intersect routine happens to iterate.** There is no combined SDF scene, no global
minimum over every object, no "SDF backend".

Measured Aug 10 2026 (M1 Pro / ANGLE Metal, 512², `npm run witness -- --perf`;
bracketed = raw minus the 8.33 ms/frame N=0 floor):

| fixture | global min-march | per-object bounded march |
|---|---|---|
| spread N=8 / 32 / 128 | 8.5 (0.2) / 38.6 (30.3) / 529 (521) | 8.4 (0.02) / 8.4 (0.04) / 15.8 (7.5) |
| clustered N=8 / 32 / 128 | 9.4 (1.1) / 54.3 (46.0) / 550 (542) | 8.6 (0.3) / 13.0 (4.7) / 21.2 (12.9) |
| blob N=6 (adversarial) | 10.0 (1.7) | 8.5 (0.14) |

`sdf-table-twin` passed the same day (Δmean 0.01%, rmse 0.28%), so the arms render one
image and the timings compare like for like. Per-object never lost — including the
blob, built specifically to be its worst case (six interpenetrating shapes filling the
frame at grazing incidence, N small enough that the global march's per-step ×N is
nearly free). At N=8 spread apart both arms sit at the frame floor: a tie, not a win.

**Why the feared overlap cost is not real**: re-walking a stretch once per overlapping
bound is trivial beside what the global march does — N field evaluations at every step
of every ray, empty space included, with nothing skippable.

## 1. The end state

**In each SDF-capable shape's own file**, beside its `<type>_sdf`, two static functions
(~15 lines each, the same accepted repetition as each shape's closed-form intersect):

```glsl
bool <type>_sdf_intersect(Ray lray, <Struct> s, float t0, float t1, out float t);
vec3 <type>_sdf_normal(vec3 lp, <Struct> s);
```

The march loop, the acceptance epsilon and the grazing stall-commit live there — math,
static, testable, documented in the occupant's `.md`, per the pinned doctrine (math is
static; policy and plumbing are generated).

**In the compiler**, ONE object arm serves every primitive object:

```
move the ray into the shape's frame
intersect the shape's BOUND → the interval [t0, t1]     (skipped when unbounded)
call <type>_intersect(lray, shape, t)                   — closed form
  or <type>_sdf_intersect(lray, shape, t0, t1, t)       — marching
fill the hit (point, normal, uv, owner) exactly as the analytic arm does today
```

The only per-object difference is which intersect line is emitted. The scene-table leaf
arm calls the same static functions with the same interval; so will SDF instancing when
that door opens.

## 2. Pinned decisions

1. **Merge all the way** (owner, decision 1). One planned-object list, one dispatch
   generator, with "how is this intersected" a per-object fact. `PlannedSDFObject` /
   `PlannedAnalyticObject` become one type; `ProgramDescription.intersection.backends`
   loses its sdf/analytic split. Staged so the emitted GLSL does not change at that
   step (T5) — the byte gate proves it.
2. **The bound is an explicit ANALYTIC OBJECT, not a box** (owner, decision 3). Each
   SDF-marchable shape declares a bounding primitive — sphere, box, cylinder, whatever
   fits — **whose parameters are a function of the shape's own moduli**. A torus
   bounds with a box or a sphere derived from (R, r); a box bounds with itself. The
   ray-vs-bound test is the bounding primitive's own interval routine, so bounding
   reuses the analytic library instead of a private slab path.
   - **CORRECTED at T2 (the plan was wrong here).** The first draft said the world AABB
     would be DERIVED from the bound, leaving one bounding fact per shape. It cannot be:
     sphere/box/cylinder bound with THEMSELVES, so their AABB is the base case and has
     nothing to derive from. `bounds()` stays as authored and `marchBound` is a second,
     separate declaration — one added line per shape rather than three deletions. The
     derivation only ever applies to a shape bounded by a DIFFERENT primitive.
   - **A sphere bound is rotation-invariant**, so rotated objects with a sphere bound
     need no refitting anywhere in the chain. Free tightness for blobby fields.
3. **Unbounded is declared, never inferred** (owner, earlier). A shape either declares
   a bound or declares itself unbounded; a shape that declares neither is a compile
   error naming the shape. Unbounded objects are always visited and march
   `[near, running nearest]` — the pinned SDF planes in `minimal` / `submerged` are
   the standing coverage.
4. **The bound must contain the surface, and we test that.** A loose bound only costs
   march steps; a bound that is too small silently clips geometry. Gate: `marchBound.test.ts`
   samples each shape's field over a grid and asserts every negative-distance point lies
   inside the declared bound. Every bound today is `'self'`, which makes that check
   trivially true, so the test ALSO exercises the checker on synthetic cross-type bounds
   (a cylinder inside a sphere: once honest, once shrunk 10% and required to fail) — a
   gate that cannot fail is worse than no gate. This is what future custom fields inherit.
5. **`backend: 'sdf'` stays exactly as authored** (owner, decision 4). Its meaning
   shifts from "use the other engine" to "intersect this one by marching"; no rename,
   no authoring change, and the existing pins stay as research coverage.
6. **Stage C is committed first, then refactored** (owner, decision 2 — commit
   `2634822`). Its plan-side is what this design needs; only the generated GLSL half
   is replaced.

## 3. Stages

Cheap gates (`npx tsc --noEmit`, targeted vitest, glslang inside vitest) between steps;
snapshots re-goldened with the diff audited to a named class; the witness sweep is
owner-run at the end.

### T1 — the march, in the shape files

`<type>_sdf_intersect` + `<type>_sdf_normal` for sphere, box, cylinder (transcribed
from the verified generated leaf marcher — the epsilon dilation at the interval end and
the stall-commit-only-strictly-inside rule come across verbatim, `fable-sdf-accel` §3).
`march_epsilon` and the step/normal knobs move to one small static file that both the
old and new paths can include during the transition.
Gate: glslang; no behaviour change yet (nothing calls them).

### T2 — the bound, as a declared analytic object

Descriptor gains the bound fact: a bounding primitive type + a function from this
shape's values to that primitive's values, or the explicit unbounded declaration.
`sphere`/`box`/`cylinder` bound with themselves; their hand-written `bounds()` AABBs
are deleted and derived from the bound instead. Interval routines
(`<type>_interval(ray, shape, out t0, out t1)`) are added beside the existing
`<type>_intersect` for the bounding types — the arithmetic already exists inside those
functions; `_intersect` itself is left byte-untouched so the analytic arm cannot move.
Gate: the containment vitest (§2.4), the derived-AABB equality test against today's
values, structure/contract tests.

### T3 — the unrolled arm becomes per-object

SDF objects emit the §1 arm: bound interval, march, local normal, local uv — in the
same generator that emits analytic objects. **Deleted here**: `scene_march_bound`,
`sdf_intersect`, `sdf_intersect_any`, `scene_normal`, `scene_object_sdf`,
`scene_object_uv`, and the per-object `sdf_<id>` wrappers except the single-line
containment arms `scene_region_at` still needs. This is the behaviour change.
Gate: glslang + snapshot audit; witnesses at the end.

### T4 — the table arm calls the same functions

The `LEAF_SDF` leaf arm calls `<type>_sdf_intersect` with the node-box interval, and
the six generated-per-type functions from Stage C (field, uv, commit, march, march_any,
plus the prototype block) are deleted. The record layout, eligibility, packing and the
leaf-1 TLAS are untouched.
Gate: glslang; `sdf-table-twin` at the sweep.

### T5 — the merge (no emitted-GLSL change)

One planned primitive-object type, one dispatch generator, one region-classification
loop; the sdf/analytic split leaves `ProgramDescription`. Arranged to emit
byte-identical GLSL to T4's output.
Gate: **byte equality across every registry pair** — the strongest gate the repo has.

### T6 — measure and sweep

Re-run the perf ladders: "unrolled" now means per-object linear testing, so the
crossover against the tree is a fresh question and the old numbers do not carry.
Re-check whether the leaf-1 scene TLAS still earns its unconditional setting
(`fable-sdf-accel` rider 1). Then the owner's full `npm run witness` sweep.

## 4. Risks, named

- **T3 moves every SDF scene's numbers slightly.** Per-object marching produces a
  different step sequence, so accepted hit distances differ at the epsilon scale:
  `minimal`, `submerged`, `mist`, `cylinders`, `solids-sdf`, `regions-transformed`,
  the driven twins and the imagery charts all re-gate, and a tolerance review is
  expected. This is the batch's main risk; everything else is deletion.
- **Nesting is the sharp case.** The global march's unsigned minimum is what made
  marching from inside a region find the nested inner surface (`R-SUBMERGED`). Per
  object the semantics are cleaner — each object marches `|its own field|` inside its
  own bound — but `submerged` is the witness that proves it, and it is the one to read
  first if the sweep goes red.
- **A wrong bound clips geometry silently.** Mitigated by §2.4's containment test; the
  risk lands for real only when custom fields arrive.
- **Compile size stops scaling with the scene**, which retires the whole class the
  Stage C incident belonged to. The standing law (no O(N)-body call reachable from
  inside a per-item loop) still holds and should be checked at review.

## 6. T6 — what the scale run exposed (Aug 10 2026)

Built with the 3000-object knot demo, and the findings that came with it.

### 6.1 Landed

- **Containment DESCENDS** (`bvhPointWalkLines` beside `bvhWalkLines`): scene_region_at
  was a scan over every solid, run once per hit — O(objects) on the hot path. Now it
  walks the scene TLAS and tests only leaves whose box contains p, which is exactly the
  candidate set (a point outside a leaf's box cannot be inside the object that box
  bounds). Gates: sdf-table-twin 0.02%/0.23%, bazaar 0.00%/0.00%.
- **The dispatch default is scene-dependent**: >= `MARCHED_TABLE_THRESHOLD` (the
  constant in `components/intersection/index.ts` — 9 as built) marched objects
  defaults to 'table'. An explicit strategy always wins.
- **The hang became a sentence**: an explicit 'unrolled' past the threshold is a
  Validator warning quoting the measurements.
- **The default cannot be inherited silently** (`dispatchDefaults.test.ts`): any registry
  scene at or over the threshold must state `objectDispatch` on every strategy. This
  fired for real — sdf-table-twin's "unrolled" arm became a second TABLE arm and the twin
  passed at 0.00%/0.00% comparing the table with itself.

### 6.2 The remaining O(N): region-keyed tables are a FUSED lookup

`material_of` is 3002 of the knot program's 4515 lines — one arm per region, and the last
construct that grows with the object count. The symptom is material_of; the cause is that
every region-keyed table bakes *region → value* directly, when the value is a property of
the MATERIAL, not the region. Regions are thousands; materials are four.

**The fix is the decomposition, not a texture**:

    region → material     per-object DATA (rail tenant under table dispatch)
    material → value      GENERATED, sized by the material count

- `material_of(region)` becomes one fetch: a `regionMaterials` tenant, ids packed four to
  a texel, base baked as usual; a 4-way component select rather than a dynamic vector
  index (glslang accepts what ANGLE rejects — the standing dialect rule).
- `ior_of(region, p)` becomes `ior_of_material(material_of(region), p)`. This is why the
  decomposition matters: a material's index may be a FORMULA (GRIN) or a driven uniform,
  so `material → ior` must stay generated. Fusing it to regions is what made it O(N).
- `scene_region_thin` is a disjunction over THIN regions — sized by quads, not objects.
  Leave it; the same fix applies if a scene ever ships thousands of thin regions.
- `light_of` is already sized by the emitter roster, not the object count. Untouched.
- UNROLLED dispatch keeps the baked arms: small scenes, and the constants fold. Which
  form a program uses is a link-map decision (`ProgramDescription`), never re-derived.

### 6.3 We cannot see compile cost, and that is how both failures hid

Two wrong readings in one day: the dev server's first-time module transform, and the
driver's shader cache, both masquerade as compile time. Every measurement after the first
load is cached, so the cost a user actually pays — the first open — is the one number the
bench never reports. The 128-object compile hang survived a full perf run for exactly
this reason.

Proposal: a `compile` check kind in the witness runner — fresh browser per row,
`--disable-gpu-shader-disk-cache`, report time-to-ready. Report-only, like `perf`. Until
it exists, treat any compile-time claim as unmeasured.

## 5. Out of scope

SDF instancing (the door this opens: the frame-tier wrapper with
`<type>_sdf_intersect` as the leaf body); custom/expression distance fields (they
inherit §2.2's bound contract and §2.4's gate when they land); blended shapes (a blend
is ONE object with one field and one bound — owner-decided, and the reason cross-object
blending is not a loss); baked/sampled fields; relaxation and segment tracing (vacuous
on exact primitive fields).
