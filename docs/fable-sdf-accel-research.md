# fable-sdf-accel-research.md — boxed-SDF acceleration: the research record

**STATUS: info doc (Aug 9 2026) — NOT a plan, NOT a design authority.** This is the
research record behind the boxed-SDF-leaves question: the verified codebase facts, the
literature survey, the cost analysis, and a recommendation *sketch*. The design session
(`docs/fable-sdf-accel-starter.md` is still the session-top brief) makes the decisions;
this doc exists so that session does not redo the research. Everything in §5 is a
proposal until the owner pins it.

---

## 1. The question

SDF objects are the only geometry class with no spatial index: the marcher's step bound
is a min over EVERY SDF object at EVERY step. Should SDF objects instead be traced
individually — slab-test their bounding boxes, then run the marcher only inside the
box, against only that object's field? And if so, does the compiler emit a bespoke
marcher per object?

## 2. Verified codebase facts (Aug 9 2026 audit; file:line checked)

**The marcher today** (`src/components/intersection/raymarch/raymarch.glsl`, whole-file
inclusion):
- `sdf_intersect` marches the **unsigned global min** `scene_march_bound(p, out region)`
  (arg-min owner tracking), bounded by the shared running nearest `hit.t`, near bound a
  constant `EPSILON` (self-intersection handled by `ray_spawn`'s origin offset).
- Two acceptance paths share one body (`raymarch_commit`): the in-loop accept
  (`bound < march_epsilon(t) && t < hit.t`) and the stall-commit at exhaustion
  (`bound < 16·march_epsilon(t)` after 512 steps — the black-edge fix). The shadow arm
  `sdf_intersect_any` checks `t > maxDist` BEFORE the occluder test and returns
  conservatively-occluded on stalled exhaustion.
- `march_epsilon(t) = min(5e-4, 1e-4·(1+t))` — capped at half of `EPS_INTERFACE` so the
  §4.2 classification probes always clear the accepted residual.
- The `abs()` in `scene_march_bound` is load-bearing: the unsigned min is what makes
  marching valid from inside a region (dielectric interiors, nested geometry).

**Every generated SDF construct is O(N) code AND O(N) per evaluation**
(`src/compiler/generate/features/intersection.ts:363-453`): `scene_march_bound` (per
march step), `scene_object_sdf` (per-owner signed field, ×6 per normal),
`scene_object_uv` (×1/hit), `scene_region_at`'s SDF arm (per classification probe, no
early-out — the closed-mesh arm has a root-box early-out precedent; the SDF arm has
none).

**Who reaches the marcher**: `resolveBackend` sends a type to the marcher only when
`provides.analytic` is false or a `backend:'sdf'` pin is authored. Today that means
**box and cylinder** (the only analytic:false primitives) plus pinned sphere/plane in
exactly two files (`minimal`, `submerged`). Scene census: max SDF count in the suite is
**8** (`mist`); `cylinders` 3, `submerged` 3, everything else ≤ 2. GRIN scenes are
almost entirely analytic. The cost problem is real but *prospective* — the trigger is
future scenes composing many SDF objects (custom distance fields, the
GRIN/embedded-geometry direction).

**What exists to build on**:
- The scene TLAS (Stage B, `objectDispatch:'table'`): stack-DFS walk with `hit.t`
  pruning and axis-sign child ordering, leaf kinds `LEAF_ANALYTIC/LEAF_MESH/LEAF_BATCH`,
  a residual unrolled arm, strategy-independent packing. SDF objects are excluded by
  one line in `dataTenantsOf` (`dataTenants.ts:149` — `resolveBackend !== 'analytic'`).
- `bvh_aabb_hit` has no entry-distance out-param — its own comment says "until a walk
  consumes one." A restricted-march leaf arm is that walk.
- Placement-fold (Aug 9): constant box/cylinder placements fold T and s into params and
  keep a **pure-rotation quat residual** (`classifyPlacement`); closed shapes fold
  totally. So an SDF leaf record is: folded params (+ quat when non-closed). Box =
  6 + 4 = 10 floats, cylinder 9, pinned sphere 4 — all inside the existing 5-texel
  record stride.
- `bounds()` is declared on sphere/quad/disk only. Box (`center ± halfSize`) and
  cylinder (`center ± (r, h, r)`) are trivially rows-derived — the one real
  prerequisite. World leaf boxes = `bounds(foldedParams)` through the residual rotation
  via the existing 8-corner `transformAABB`.
- `keepsLocalFrame` can only fire on sphere among SDF-capable types (box/cylinder have
  no `uvChart`), so the frame-retained exclusion is nearly vacuous on this arm.
- **GRIN is untouched**: the walker never evaluates the SDF field — its only geometry
  query is `scene_region_at` as a membership test (1 probe/step + 8 bisection probes on
  crossing), plus `ior_at`. Interior per-owner marching already restricts to one field
  (`scene_object_sdf`).

## 3. The mathematical core

**Step-dominance lemma.** For a hard union, `d_union(p) = min_j d_j(p) ≤ d_i(p)` for
every i at every p. A march driven by one object's field therefore takes steps at least
as large as the global-min march at every point — never smaller. The global march has
NO step-size advantage, ever. Its one structural advantage is *screening*: it
terminates at the first surface in a single pass, never visiting space behind it.

**Screening is recovered by the standard nearest-hit walk.** Process leaves with
`hit.t` pruning and clamp every leaf's march interval to `[t_enter, min(t_exit, hit.t)]`.
An interval behind a committed hit is truncated before it is marched. What is genuinely
lost: in an overlap region visited *before* any commit, k overlapping leaves each march
their own field across the shared range (Σₖ Sᵢ per-object steps) where the global march
covers it once (S_union steps × N evaluations each). Restricted still wins unless
objects interleave so tightly that per-object step counts degenerate to the union's.

**Correctness of per-leaf restriction** (the starter's item 1, now argued): marching
inside leaf L's interval needs only a lower bound on the distance to **L's own
surfaces** to find L's nearest hit there — other objects' hits come from their own
intervals, and a conservative box proves L's surface cannot be hit outside L's
interval. The min-over-all-objects march was never required for correctness, only for
the historical single-arm structure.

**Three correctness pins:**
1. **Hard unions only.** Restriction distributes over `min` exactly. A future `smin`
   blend creates surface where no single field is small — a blended cluster must be ONE
   leaf marching the blended field, box dilated by the blend radius. No blends exist
   today; the door should be built with this constraint declared.
2. **Epsilon at interval boundaries.** Dilate each leaf interval by the acceptance
   epsilon at its far end (`march_epsilon(t_exit)`) plus the Ize 2-ulp slab guard
   (already shipped). Tight boxes otherwise clip surfaces at box faces (known artifact:
   straight cut lines / dotted silhouettes). Stall-commit applies per leaf and only
   within the dilated interval — never commit a stall at a box boundary. A per-leaf
   exhaustion "miss" resumes traversal (strictly better-behaved than a global-march
   abort).
3. **Interior rays.** Per-leaf `abs()` marching preserves the unsigned semantics: a ray
   inside a solid enters its own leaf's interval with `t_enter = 0` and marches `|sdf|`
   to the exit; nested inner objects are their own leaves. Cleaner than the global
   entanglement, not merely equivalent.

**Where the wins come from, ranked:** (a) empty space between objects costs zero field
evaluations (slab tests skip it analytically; the global march pays N evaluations per
distance-bounded hop); (b) per-step cost drops from N evaluations to 1; (c) silhouette
stalls confine to the leaf that owns the silhouette — the grazing worst case stops
scaling with scene size; (d) generated code drops from O(N objects) to O(types present)
— the compile-stall wall (grand-bazaar precedent) disappears for SDF scenes.

## 4. Literature (primary sources fetched and read; full citations at end)

- **BVH-restricted marching is production-proven, unnamed.** No canonical paper; the
  pattern is assembled across: Quilez's *Bounding Volumes for SDFs* (per-object
  bounding proxies inside the min-tree: **~8× on a character**; full fragment-shader
  BVH over an SDF: Bunny + soft shadows at full framerate, GTX 1070; warning that
  per-object *branching* is expensive on WebGL-class hardware — grids amortize the
  branch per cell); **Unreal's distance-field pipeline** (Wright, SIGGRAPH 2015:
  per-light/per-tile object lists, then each object marched independently in its own
  range, min-combined; 30–50% faster than shadow maps; uniform-scale-only instancing —
  the same closure fact `similarityClosed` pins); **JCGT 2022** (Söderlund, Evans,
  Akenine-Möller: hardware BVH over SDF-grid bricks, per-leaf restricted intersection —
  **1.6–5×** vs whole-field hierarchical marching, widest on incoherent path-traced
  scenes; explicitly the closest analogue to this workload).
- **The counter-design** is Claybook (Aaltonen, GDC 2018): bake ALL objects into one
  world SDF so cost is brush-count-independent, then accelerate with mips + cone
  prepass. Only coherent because the field is *baked* — a sampled field is biased as a
  hit-finder for analytic surfaces (the trilinear interpolant's zero set is not the
  surface). Baked structures remain usable bias-free ONLY as conservative skip oracles
  (`min_cell(d) − cell_radius`, analytic field takes the final hit) — a possible far
  future, not this batch.
- **Segment tracing / relaxation buys nothing here.** Galin et al. 2020 (local
  Lipschitz bounds) and Keinert et al. 2014 (over-relaxation with overlap-fallback)
  accelerate fields whose global Lipschitz bound badly overestimates local slope. Every
  registered primitive SDF is **exact (λ = 1 everywhere)** — segment tracing
  degenerates to sphere tracing on them. Becomes relevant with custom
  `GlslExpression`-style distance fields (declared per-occupant Lipschitz/K capability;
  ties to expression-machinery cap D for derived bounds). Custom fields need DECLARED
  bounds regardless (the plane precedent: no bounds → residual). Claybook measured
  relaxation as a LOSS on fetch-bound baked fields; it is ALU-cheap and safe (guarded)
  on analytic fields — a later knob, not a dependency.
- **Shadow rays**: restriction drops commit ordering entirely — visit leaves in any
  order, terminate the whole query on the first accepted hit; clamp intervals to
  `[0, t_light]` (the Jul 13 `maxDist` lesson generalizes per leaf); guarded relaxation
  cannot leak through thin occluders (a skip implies disjoint unbounding spheres →
  rollback). JCGT's interval-overlap shortcut (accept occlusion from an unrefined
  sign-change interval) measured 4–14%.
- **No published head-to-head step-count analysis of per-object vs global-min marching
  exists.** §3's lemma + the crossover guidance below is our own synthesis; the
  measured brackets are JCGT's 1.6–5× and Quilez's 8×/branch-cost warning.

## 5. Recommendation sketch (PROPOSAL — the design session decides)

**Interval-restricted per-leaf marching as a fourth scene-TLAS leaf kind (`LEAF_SDF`)
— not a new tree, not a restructure of the global marcher.** Bespoke marchers are
emitted **per TYPE, not per object**: one generated `march_leaf_<type>(Ray, a, b,
record, inout Hit)` per SDF primitive type present, `<type>_sdf` inlined, the record's
quat applied outside the distance call, the type switch outside the loop. Object
identity is data (the record), exactly the "code is per-type, scale is data" character
of the rest of the renderer.

**Two regimes, mirroring the analytic Stage B split:**
- `objectDispatch:'unrolled'` — today's global min-march, byte-untouched. Genuinely the
  right tool below ~10 objects (branch/stack/divergence overhead exceeds the saved
  evaluations — Quilez's WebGL finding + the CWBVH ANGLE lesson). Every current scene
  stays here; every existing witness stays green; it remains the reference twin.
- `objectDispatch:'table'` — constant ∧ `bounds()` ∧ ¬`keepsLocalFrame` SDF objects
  become TLAS leaves. Driven/unbounded/frame-retained stay in the residual global
  marcher (exactly the analytic rule). No new estimator axis; bias-free by contract;
  equality witnesses the gate.

**Seams** (all existing): eligibility opens at `dataTenants.ts:149`; records ride the
5-texel stride (folded params + quat + a CPU-precomputed world AABB for the leaf's own
slab interval — boxes are data, never derived in-shader); `scene_table_leaf` gains the
`LEAF_SDF` arm; `bvh_aabb_hit` grows its anticipated entry-distance out-param; the
`_any` twin gets the unordered first-hit arm; tabled SDF solids join the containment
record loop behind a point-in-box early-out (mesh precedent).

**Scale picture**: 1–8 objects — unrolled, nothing changes. ~30 — crossover zone, table
starts winning (a ray marches the 2–4 fields whose boxes it enters). 100 — table is the
only regime (unrolled hits the compile wall). 1000 — inexpressible today, just data
after: TLAS ~10 deep, per-ray work unchanged in kind. (SDF *clouds* — N copies of one
prototype — are the instancing door with an SDF prototype, a separate deferred batch;
`LEAF_SDF` covers N *distinct* objects.)

## 6. Experiment ladder (measure before committing — the CWBVH discipline)

1. **`perf-sdf`** fixture through `npm run witness -- --perf`: procedural mixed
   box/cylinder/pinned-sphere scene, N ∈ {8, 32, 128}, arms unrolled vs table.
   Deliverable: the crossover N and the scaling slope. Report-only; the go/no-go
   referee.
2. **Leaf-granularity sweep** (SDF leaf size 1 vs 2) on the same fixture — the
   starter's open question 1, answered like the TLAS leaf sweep (expectation: 1 wins;
   a march is more expensive than a sphere test).
3. **Twin gate**: ~30-object rotated mixed-SDF scene, table ≡ unrolled
   identical-stream equality (bazaar pattern); re-gate `regions-transformed`,
   `submerged`, `cylinders`, `mist`; a grazing-silhouette stress arm for the per-leaf
   stall discipline.

## 7. Open questions for the design session

1. Record layout: where the quat and the world-AABB texels sit in (or beside) the
   5-texel analytic stride — one stride decision.
2. Leaf granularity: 1 object/leaf vs SAH-grouped 2–3 (measured, expectation 1).
3. Containment: does the point-in-box early-out ship in this batch or stay linear
   (count-driven)?
4. Default policy: should table ever be the default for SDF-bearing scenes, or stay
   authored per-strategy until the crossover is measured?
5. The declared-bounds contract for future custom/expression SDFs (ties to
   expression-machinery cap D; blends-share-a-leaf constraint declared now).

## 8. Citations

Hart 1996 (sphere tracing, *The Visual Computer* 12); Keinert, Schäfer, Korndörfer,
Ganse, Stamminger, *Enhanced Sphere Tracing*, STAG 2014; Bálint & Valasek, EG Short
2018; Bán & Valasek, EG Short 2023; Galin, Guérin, Paris, Peytavie, *Segment Tracing
Using Local Lipschitz Bounds*, CGF 39(2) 2020 (+ reference code
github.com/aparis69/Segment-Tracing); Hansson Söderlund, Evans, Akenine-Möller, *Ray
Tracing of Signed Distance Function Grids*, JCGT 11(3) 2022; Aaltonen, *GPU-based clay
simulation and ray-tracing tech in Claybook*, GDC 2018; Wright, *Dynamic Occlusion with
Signed Distance Fields*, SIGGRAPH 2015 Advances; Epic, Mesh Distance Fields docs;
Evans, *Learning from Failure* (Dreams), SIGGRAPH 2015 Advances; Quilez,
*Bounding Volumes for SDFs* + *Soft shadows in raymarched SDFs* (iquilezles.org);
Zanni, *Synchronized tracing of implicit surfaces*, arXiv:2304.09673 2023; Marmitt et
al., VMV 2004; Kalra & Barr, SIGGRAPH 1989; Mitchell, GI 1990; Ize, *Robust BVH Ray
Traversal*, JCGT 2(2) 2013; Moinet et al., CGF 2025; Crassin et al. I3D 2009; Laine &
Karras, NVIDIA 2010.
