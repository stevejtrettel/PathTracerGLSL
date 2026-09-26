# fable-light-bvh.md — spatially-aware many-lights selection (the light tree)

**STATUS: owner-approved design (Aug 9 2026). Supersedes `fable-light-bvh-starter.md`
(kept as the session record). Owner decisions: NO orientation cones in v1 (declared
deviation, §3.2), TWO stages (authored lights first, instance clouds second, §7).**

Literature basis (fetched and transcribed this session): Conty Estevez & Kulla 2018
(HPG) — SAOH + cluster importance + splitting; pbrt-v4 §12.6 `BVHLightSampler` —
cosSubClamped numerics, bit-trail PMF; Ray Tracing Gems ch. 18 (Moreau & Clarberg) —
GPU walk, ablation, fp32 entropy warning; Moreau–Pharr–Clarberg HPG 2019 — two-level
trees + instancing; Lin & Yuksel I3D 2020 — cones dropped on GPU, near-field min/max
rule. Full brief with formulas: the session transcript; key results restated inline.

## 1. The problem

NEE selection is the power CDF: compile-time, area-aware, POSITION-BLIND, and emitted
as an unrolled per-light `if` chain. Two independent O(N) walls:

- **Selection variance**: with hundreds of emitters, a shading point samples lights in
  proportion to power alone — variance grows ~linearly in light count even though each
  point is lit by a handful.
- **Storage**: `light_get_<id>()` accessors + three unrolled dispatch chains (sampler,
  `lighting_pdf`, `lighting_query_delta`) are O(N) GLSL text AND O(N) warp-divergent
  branching. Hundreds of authored lights are unshippable regardless of selection.

The fix is one design with two parts: **lights become table-resident** (records-channel
rows, per-kind loaders — the Stage-B treatment) and **selection becomes a stochastic
tree descent** (importance from the shading point, O(log n), unbiased because every
light keeps positive probability). This is an ESTIMATOR change (selection pmf),
bias-free by contract — equality witnesses are the gate.

## 2. The axis

`estimator.lightSelection: 'power' | 'uniform' | 'bvh'` — the existing field, carved
into a registry (`LIGHT_SELECTIONS`, `components/lights/index.ts`), Validator
membership derived from `Object.keys`, default `'power'` unchanged. `power` and
`uniform` keep the baked-CDF emission path byte-identical (the carve gate).

## 3. The bvh occupant

### 3.1 Tree shape

Binary tree, **leaf = exactly 1 light** (pbrt's choice: no leaf CDF, trails address
lights directly), exactly `2n−1` nodes. Built by a SIBLING builder in
`accel/light_tree/` (build shared-in-family, query with lights — the family rule),
NOT the shared `buildBVHNodesFlat` core, for three reasons the build session settled:
(a) the split cost is **energy-weighted binned SAH** (`Φ_L·A_L + Φ_R·A_R`) — exactly
the no-cones degenerate of the SAOH cost, which the count-based core cannot express;
(b) the builder enforces the **48-level trail cap** with a balanced-split fallback
(when `depth + ⌈log₂ count⌉` would exceed the cap, split at the median instead of the
SAH plane — bounded depth by construction, never a thrown pack); (c) **coincident
lights** (identical centroids, where SAH has no plane) median-split into a chain of
identical-box internal nodes whose Φ sums make the descent power-proportional among
them — the correct limit, with no multi-light leaf format needed. A full SAOH splitter
(cones) is a later occupant if a witness shows the gap (RTG 18: SAOH vs SAH render
quality is scene-dependent either way on GPU).

**Node format — 2 RGBA32F texels, mirroring the ray-BVH layout:**

```
texel 2i    .xyz = bounds.min   .w = Φ (subtree power, > 0)
texel 2i+1  .xyz = bounds.max   .w = link:  link >= 0 → INTERNAL, rightChild = link
                                             link <  0 → LEAF, lightIndex = -link-1
left child = i + 1 (implicit, never stored)
```

The ray-BVH's axis field is deliberately absent: the light walk computes both
children's importance every step — there is no near-child ordering to encode.

### 3.2 Importance (v1.5 — the horizon upgrade over the LightQuery context)

**History**: v1 shipped normal-free (`Φ/d̂²` only). The CPU probe (replaying the real
trees with the TS twins over embers/glow-shell surface points) then measured **54–59%
of selection mass wasted on below-horizon lights** (p90 86% on rock surfaces) —
witness-justified, so the horizon term landed the same day as **v1.5**, carried by
the context redesign below.

**`LightQuery` — the selection context (pbrt's `LightSampleContext` transcribed as
DESIGN, owner-approved):** a pinned core struct `{ Point p; Direction n; }`
(`glsl/core/structs.glsl`); `n = 0` means "no orientation information". Static
technique files NEVER construct it — they pass everything they have through the
GENERATED constructors `light_query_surface(int mat, Hit hit)` /
`light_query_medium(Point p)` (transport-emitted policy; `mat` is in the signature
ahead of need). The seams are `lighting_sample(LightQuery q, vec2 xi)` and
`lighting_pdf(LightQuery q, …)` — total across ALL programs (the argument is unused
under power/uniform; unused args cost nothing). **Stored-query replay**: `PathState`
carries `prev_query` (replacing `prev_p`, mis-gated), written by the single-emitter
`kernel_record(s, pdf, LightQuery q, is_delta)` with the SAME constructor call the
NEE site used — the pmf replays byte-identical context to the sampler, whatever the
context grows to contain. Future context (spectral, curved frames) extends the
struct + constructors; seams and techniques never churn again.

**The importance** (`accel/light_tree/light_tree.glsl` + the TS twin — one math,
two readers):

```
q.n = 0 :  I = Φ / d̂²                                    (media; no orientation)
q.n ≠ 0 :  h = n·(far_corner − p) ≤ 0  →  0               (EXACT corner cull)
           else I = Φ · min(1, max(cos_center, h/dmax)) / d̂²
```

with `d̂² = max(d², (diag/2)², ε)`, `far_corner` the per-axis sign-selected corner
(`h` is the exact max of `n·(x−p)` over the box), `cos_center` the cosine to the box
center, `dmax` the exact farthest-corner distance. Every quantity is a corner/center
computation — **no bounding sphere anywhere**, which matters twice:

- **The cull is exact and hereditary** (boxes are exact child unions), a declared
  improvement over pbrt's sphere cone, found by the half-space vitest: sphere-based
  culling let loose all-below clusters survive and then die mid-descent (52% dead
  mass); with the box test a descent can never go dead while any above-horizon light
  exists — above-horizon mass sums to exactly 1.
- **The shaping is composed of two direction-exact estimates** (the v1.5.1
  refinement, driven by the owner's "diamond" observation + the CPU anisotropy
  probe): the sphere-based `cos(θi−θu)` saturated at 1 for every large straddling
  box, so under a DIAGONAL surface normal — where every axis-aligned box straddles
  the tilted horizon — early descent couldn't discriminate at all (axis-facing
  receivers measured 2–3× better selection than diagonal-facing: the diamond).
  `cos_center` goes negative for mostly-below boxes (the discrimination the
  saturating bound cannot see) and `h/dmax` (> 0 whenever the cull passes — the best
  light in the box is at least this frontal) floors it, so survivors stay reachable
  with no defensive constant. Probe verdict: noise proxy 2–4× below normal-free at
  ALL azimuths (limb: axis 0.36–0.44, diagonal 0.71–0.87, vs 1.45–1.96 normal-free);
  the residual ~2× limb anisotropy is the inherent AABB effect, now second-order.

**Bias safety of the one-sided cull**: at an opaque receiver a below-horizon light
contributes exactly 0, so culling it is variance-only. Transmissive receivers would
break this under nee-only — but every transmissive model today is PURE DELTA: NEE
never runs there and `prev_was_delta` short-circuits the MIS weight. The
**lightQuery policy contract test** pins `transmission ⇒ ¬nonDeltaLobes`; the day a
rough-transmissive model registers, the test fails pointing at the constructor
policy (give that model `n = 0`, or the AbsDot form under mis).

Why the orientation-CONE term (θ_o/θ_e) stays absent: a sphere emitter has θ_o = π
(normals everywhere), so every cluster cone saturates and the term is identically
1 — **provably zero-value for sphere/point emitters**, our target class. For
oriented kinds omitting it is conservative (wasted samples, never bias; ablation
rank: last). It returns as an additive third node texel behind the same occupant if
an oriented-emitter witness shows the gap.

**The d² clamp is emitted in the SQUARED form.** pbrt's book text literally compares
d² against a *length* (`max(d2, len(diag)/2)`) — dimensionally inconsistent; the
intent per Conty–Kulla §6 is "clamp the distance to about half the cluster radius."
We write `(len/2)²` and pin it with the witnesses; this is transcribe-the-MATH.

Near-field: the clamp is the v1 answer. The recorded fallback if the inside-the-cloud
witness (stage 2) is noisy: Yuksel 2019's rule — drop the distance term entirely when
`d_min < α·diagonal` for both children (selection goes energy-proportional near-field,
which for a locally uniform cloud is nearly correct). Not built until the witness asks.

### 3.3 The walk pair (born adjacent — the byte-match discipline)

One generated section emits BOTH functions; the importance call is ONE shared
function. This is the CDF-era `selectionExprs` discipline transported to the tree:
pt-nee and pt-mis diverge iff these two ever compute different products.

```glsl
// selection: stochastic descent. Fresh RNG draw per level (see §3.4).
int  light_tree_pick(Point p, float xi0, out float pmf);
// MIS pmf: re-walk root→leaf(light) consuming the light's stored bit trail.
float light_tree_pmf(Point p, int light_index);
```

Descent: at node i fetch both children, `IL`, `IR`; if both 0 → return −1 (no light
sampled this event; the estimator adds nothing — unbiased, matches pbrt's `return {}`;
the caller's `ls.pdf = 0` guard already handles it). Else compute `p_l = IL/(IL+IR)`
and descend, `pmf *= (left ? p_l : 1.0 − p_l)`. The pmf walk reproduces the identical
product by reading trail bits instead of drawing randoms — same node fetches, same
importance function, and the SAME `p_l` / `1.0 − p_l` expressions (never `IR/sum`,
which is not bit-equal to `1 − IL/sum`), so the product is bit-equal.

**Bit trails**: per light, ONE records texel: the root→leaf left/right decisions,
LSB-first (Laine 2010 restart-trail encoding, as in pbrt/Falcor), split into two
f32-exact 24-bit integers — `.x` = levels 0–23, `.y` = levels 24–47. The builder
enforces `maxDepth ≤ 48` via the §3.1 balanced fallback (a balanced tree of 16M
lights is depth 24; 48 is deep margin for SAH skew at cloud scale). Delta lights get
trails too (they're in the tree) but the pmf walk is only ever queried for hittable
lights.

### 3.4 RNG (declared deviation from single-ξ rescaling)

The papers rescale one ξ down the tree to preserve stratification; RTG 18 warns the
fp32 mantissa is exhausted by ~24 levels of rescaling. Our sampler is pcg4d —
counter-based, unstratified across dimensions — so the stratification argument does
not apply and per-level FRESH draws (`random()`) are strictly more robust, at zero
state cost. Level 0 consumes the `xi.x` the technique already passes (keeping the
`lighting_sample(p, xi)` seam signature); levels ≥ 1 draw fresh; the kind sampler's
2D point is `vec2(random(), xi.y)`. RNG is ambient in the program (the techniques
call `random2()` without a seam declaration), so the generated walk forward-declares
`float random();` for order-independence. If Owen–Sobol ever lands, revisit (the
rescale becomes valuable) — noted in that registry's ledger.

## 4. Table-resident lights

Under `bvh`, ALL registry lights move to a `records` table; the unrolled accessor/
dispatch chains are not emitted. (Under `power`/`uniform` nothing changes — the carve
gate.)

- **Row layout** (`lightTableLayout` in `components/lights/table.ts` — the ONE layout
  truth, read by the App packer AND the Generator's loaders): per-scene stride = max
  over present kinds of (1 header texel + ceil(rowFloats/4) payload texels). Header =
  `(kindCode, 0, 0, 0)`; kind codes assigned in registry order over PRESENT kinds
  (the scene-table precedent). Payload = the kind's schema rows in declared order
  followed by its derived ctor fields — exactly the generated struct's ctor order, so
  the generated loader `<kind>_light_row(int li) → <Kind>Light` fills fields by
  positional float reads (a vec3 may span texels; the generator emits the gather).
  One loader per present kind; dispatch = small chain over KINDS, not lights.
- **Who packs**: the App (like mesh lights), from the scene-side light ROSTER (§5) —
  values are constants by the v1 pins (driven emission rejected under bvh). The
  ledger allocates from the roster count and stride alone.
- **`light_of` / regions**: unchanged — region→lightId mapping is already generated;
  lightId IS the table row index (insertion order, the pinned id discipline).

## 5. Rail tenants (the ledger stanza)

New tenant `lightTree`, allocated whenever the scene's light roster is non-empty AND
every roster kind declares the `treeBounds` fact, and some renderer on the scene reads it
(`lightSelection: 'bvh'` — `DataReads.lightTree`). It is one of the optional stanzas that
`planDataLayout` places after every always-built region, so adding it never moves an
always-built base:

```
records: tableBase   = r;  r += n · rowStride        // §4 rows (stride from the layout truth)
         trailsBase  = r;  r += n                    // 1 texel/light (two u24 halves)
nodes:   treeBase    = n_; n_ += 2·(2n−1)            // exact: leaf = 1 light → 2n−1 nodes
```

Census one-truth: `lightRosterOf(scene)` (compiler/plan/dataTenants.ts) — the
scene-side mirror of the Planner's three desugar routes (authored lights →
sampleAsLight analytics → mesh emitters), returning each light's kind + RESOLVED
registry values in planned order. `dataTenantsOf` (counts/stride) and the App packer
(rows/bounds/Φ) consume it; the Planner ASSERTS its own `plan.lights` matches the
roster kind-for-kind (drift = loud error, plus a vitest invariant across the suite).
New descriptor fact **`treeBounds(values) → AABB`** (point/spot: degenerate box at
position; sphere/disk: center ± r; quad: the four corners) — kinds without it
(directional/beam/softbeam/mesh) are tree-ineligible, which the §6 pins mirror. Env
stays outside the tree (`u_envSelectProb` is pbrt's `pInfinite` stage, unchanged,
both arms already mirror it). The lighting feature declares `u_data_nodes`/
`u_data_records` itself (merge-deduped, the mesh-light precedent) and the
intersection feature's `needDataRail` learns the bvh-selection condition so
`data_texel1d`/`DATA_TEX_WIDTH` exist in rail-free scenes.

## 6. v1 pins (Validator, itemized errors)

- `bvh` × **driven emission** → rejected (Φ payload + importance would need refit;
  the trigger for a refit batch is real driven-light demand).
- `bvh` × **equiangular** → rejected (`lighting_query_delta` keeps the CDF path;
  the medium-vertex pick entry lands with the mis/tally batch — §8).
- `bvh` × **mesh / directional / beam** lights → rejected v1 (mesh = table row needs
  the sampler's texture bases baked as row floats — mechanical, stage 3 ledger;
  directional/beam = unbounded position, pbrt keeps infinite lights outside the tree —
  they'd need their own outside stage like env).
- point / spot / quad / sphere / disk are IN (spot's anisotropy costs only wasted
  samples without cones — conservative).

## 7. Staging (owner-approved)

- **Stage 1 (this batch)**: axis carve (byte gate) → builder + trails + vitest
  twins → rail stanza → table + loaders → walk pair under pt-nee → pt-mis.
  Witnesses: existing multi-light scenes bvh ≡ power (equality); `hundred-spheres`
  fixture — pt-nee-bvh ≡ pt-nee-power (equality), σ/µ(bvh) < σ/µ(power) at equal spp
  (the win metric), pt-mis-bvh ≡ pt-mis-power (**the sharpest gate** — trail pmf).
- **Stage 2 (BUILT in the same session — the design pins)**: per-instance light
  identity for clouds — one batch = N lights.
  - **Eligibility is ONE predicate** (`batchLightEligible`, dataTenants — shared by
    tenant counts, Planner decisions, Validator warnings, and the App pack): analytic
    **sphere** prototype ∧ **params-tier** record ∧ constant nonzero emission ∧
    `sampleAsLight ≠ false`. The params record `(center.xyz, radius)` IS the light
    row — no second table; the batch material's Le is a baked literal in the
    generated arm; per-instance Φ = π·4π·r²·L̄e from the packed radii (CPU, pack time).
  - **§7.1 — PER-INSTANCE EMISSION (built with the clebsch-glow card)**: an
    `attributes.emission` column on a light-eligible batch makes every instance an
    individually-COLORED light. The old hard exclusion ("per-instance emission needs
    per-instance power-CDF rows — deferred") is lifted exactly where its blocker
    died: the tree's per-instance Φ IS that structure. One storage truth: the minted
    `AttributeValue` row is read by the hit-side fill (chance-hit emission), the
    sampler arm, AND the pdf arm (same records texels, `element`-indexed); pack-time
    Φ reads the same packed rows (color × πr²·4π per instance). The emission gate
    (`material_is_emissive`) treats an attribute row as may-emit. Exclusion remains
    for non-eligible shapes (mesh prototypes, frame tier — the tree cannot sample
    them; Validator message names the reason). `.inst` colors columns (LINEAR by the
    format contract) drive it directly via a scaled copy at scene build — no
    re-conversion (clebsch: white rationals + orange quadratics as lights).
  - **The global light-index space**: `[0, R)` = registry lights (the stage-1 table);
    `[R + base_b, R + base_b + N_b)` = batch b's instances in RECORD order (= TLAS-leaf
    order = `Hit.element` — the attrs precedent). Tree leaves are exactly that
    concatenation; trails cover all of it; table rows exist only for the first R.
  - **Batch lights are samplable ONLY under `lightSelection: 'bvh'`** — under
    'power' they stay path-found (the pre-stage-2 behavior). This is estimator-only:
    NEE-with-bookkeeping and pure path-found emission converge to the SAME image
    (§11.2), so the taxonomy is clean and the power CDF never meets a 100k-entry
    bake. The tenant is packed only when some renderer reads the tree.
  - **The `light_of` seam becomes `int light_of(int region, int element)`** globally
    (one seam, no per-selection signatures; individual-light arms ignore `element`;
    the batch arm returns `R + base_b + element`). The emitter-hit call site passes
    `hit.region_to, hit.element`. Snapshot churn = this signature alone, re-goldened.
  - The tree builds AFTER the batch packs resolve (it needs the leaf-order params
    records), OFF-THREAD at cloud scale (`app/utils/lightTreePack.ts` — the
    packWorker pattern; inputs transferred, not cloned — they exist solely for this
    call; sync below 4096 leaves where worker spin-up would cost more; loud sync
    fallback). Built when clebsch-glow's 194k-leaf tree fired the ledgered trigger.
  - Witnesses: **instance-lights-twin** (K emissive spheres as ONE batch under bvh ≡
    the SAME spheres as individual sampleAsLight objects under bvh; nee + mis arms —
    the mis arm is the element-trail gate) and **glow-shell** (camera inside an
    emitter shell — the §3.2 near-field regime; power ≡ bvh equality + σ/µ report,
    calibration before any assert; the Yuksel Λ fallback stays ledgered).
- **Stage 3+ (ledgered, unscheduled)**: mesh-light rows; directional/beam outside
  stage; orientation-cone texel behind a witness; SAOH sibling builder behind a
  witness; medium-vertex selection with the mis/tally batch; refit for driven
  emission; Yuksel near-field rule behind the stage-2 witness.

## 8. Interactions

- **Env**: composes unchanged (two-stage above finite selection; three existing
  readers of `u_envSelectProb` untouched).
- **mis/tally batch (deferred)**: the tree pmf enters medium-event MIS weights when
  that batch lands; `light_tree_pmf`'s `has_n = false` arm is already the medium
  form — the seam is ready, the wiring is that batch's.
- **Equiangular**: composes downstream of selection by design; blocked only by the
  v1 pin, unblocked when `lighting_query_delta` grows a bvh arm (same walk, delta
  rows only).

## 9. Proof regime

- vitest: builder twins (node count 2n−1 exact; per-node Φ = subtree sum; every
  trail replays to its leaf; TS-twin descent: Σ_lights pmf(light | p, n) = 1 at
  random query points, sampler-vs-pmf agreement light-by-light), glslang compile of
  bvh-selecting pairs, snapshot for one bvh scene, structure/purity conformance.
- witnesses (owner-gated sweep): §7 stage-1 list. All existing light witnesses stay
  green under the untouched `power` default.
