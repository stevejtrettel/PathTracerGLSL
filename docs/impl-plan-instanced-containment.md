# impl-plan-instanced-containment.md — instanced dielectrics

**Goal:** an instanced batch may be GLASS (or hold a medium). Today every batch is
surface-only: batches sit in the `thinRegions` set, are excluded from
`scene_region_at`, so `ior_of` falls to 1.0 and a dielectric instance refracts at
η = 1. This closes that, for all three prototype classes.

Prior art this follows exactly: `fable-mesh-containment.md` (closed meshes left the
thin set the same way) and `impl-plan-sdf-accel` (the scene-TLAS point descent).

## 1. What is actually missing

One fact, three sites:

- `intersection.ts` `thinRegions` — every batch is listed unconditionally.
- `scene_region_at` — no instanced arm (its own comment reserves the hole:
  *"mesh leaves and instance batches fall through: their containment is handled
  outside the descent"*).
- `Validator.ts` — a closed mesh PROTOTYPE is a hard error
  (*"instanced batches are surface-only in v1; solid instances need per-instance
  containment"*). That message is addressed to this batch.

Everything else already exists and is GPU-verified: the per-prototype containment
predicates, the point-walk skeleton, and the record decode.

## 2. The design

**One region per batch — forced, not chosen.** The hit path already writes
`hit.region_owner = b.index`, so a batch IS one region; containment must return the
same id or the two disagree. All instances share the prototype's material and
therefore its ior, so the union of the instances IS the region — which also makes
overlapping instances well-defined instead of ambiguous (`material_of` / `ior_of`
answer identically wherever the point lands).

**The arm is the ray arm with the point walk swapped in.** `bvhPointWalkLines` binds
`off`/`cnt` in leaf scope exactly like the TLAS ray walk, and the placement records are
TLAS-permuted, so `i = off + j` indexes the same instance in both. Per candidate
instance: decode the record → conjugate the point → ask the prototype → produce a
WORLD-exact signed distance → the standard `d < 0 && d > best` innermost-wins compare.

Per prototype class (each mirrors its own leaf item in `instanceLeafItem`):

| tier / backend | decode | containment | world-exact `d` |
|---|---|---|---|
| params (analytic, closed) | `Sphere(rec.xyz, rec.w)` — folded WORLD params | `<type>_sdf(p, shape)` | already world-space; no conjugation at all |
| frame, analytic or marched | `q`, `ts`; `lp = placement_rigid(q, ts, p)`; params absorb `s` | `<type>_sdf(lp, shape)` | rigid frame + s-scaled params ⇒ exact |
| frame, mesh | `lp = placement_rigid(q, ts, p) / s` (mesh data is UNSCALED) | `mesh_inside_bvh(lp)`, gated by the prototype's baked local box | `-s * mesh_closest_bvh(lp)` |

The mesh row is the lazy three-tier query verbatim from the non-instanced case
(local box → first-hit-facing along the fixed local `MESH_INSIDE_DIR` → closest
triangle only when inside). Nothing about it is per-instance: the direction is a
LOCAL constant, so every instance runs the identical test in its own frame.

**Cost, stated honestly.** Analytic and SDF prototypes cost one field evaluation per
candidate instance. A MESH prototype costs a nearest-hit BLAS walk, plus a second
branch-and-bound walk when the point is actually inside — the same work a non-instanced
closed glass mesh already pays, now behind a TLAS descent that normally yields one
candidate. A perf row measures it rather than assuming (§5).

**Exact linkage — who pays.** The arm is emitted ONLY for batches that need an
interior: `batchNeedsInterior` = the prototype material is transmissive ∨ carries a
medium. A 194k-sphere opaque cloud emits no arm and pays nothing, which is the whole
reason to gate rather than to always-emit.

**`instanceAccel` interaction.** `tlas` gets the point descent. `linear` gets the
linear scan (its walk has no TLAS texture) — mirroring, so the A/B baseline still
works. `cwbvh` is Validator-REJECTED for interior-needing batches: its leaf
permutation differs from the binary TLAS's (the same reason it already rejects
light-eligible batches), so its records order cannot be walked by a binary point walk.

## 3. Tasks

- **C1 — the predicate.** `batchNeedsInterior(batch, scene)` in the instancing
  component (the one spelling; Planner + Validator + generator read it).
- **C2 — the plan fact.** Batches carrying an interior leave `thinRegions`; the
  decision rides `PlannedInstanceBatch` (never re-derived in a generator).
- **C3 — the generated arm.** `scene_region_at` gains the instanced block: point walk
  (or linear scan) + the three decode/predicate rows of §2.
- **C4 — the Validator.** Delete the closed-mesh-prototype rejection; the
  transmissive-on-thin warning stops firing for qualifying batches via the fact (no
  edit — the mesh precedent); ADD the cwbvh × interior rejection, itemized.
- **C5 — witnesses.** §5.

## 4. Pins / non-goals

- Per-instance `ior` stays rejected: ior is region-keyed and a batch is one region.
  A batch is ONE glass.
- Open (non-watertight) mesh prototypes stay thin, exactly as un-instanced. Generalized
  winding numbers (Jacobson 2013 / Barill 2018) would lift that; owner-declined as
  uninteresting (meshes here are self-generated and closed by construction).
- SDF instancing already exists; its prototypes come along for free via the same
  `<type>_sdf` row.

## 5. Witnesses

- **instance-glass-twin** ≡ **instance-glass-ref**: a small batch of glass spheres
  against the SAME spheres as individual objects. The sharpest gate — an η = 1 batch
  (today's behaviour) diverges immediately, and it is a cross-arm twin, so the twin
  machinery does the work.
- **instance-mesh-glass** ≡ **instance-mesh-glass-ref**: the mesh prototype row,
  same shape (a closed glass mesh instanced vs placed individually).
- **instance-fog**: a batch whose prototype carries a MEDIUM — proves the interior is a
  real region for `current_medium` tracking, not just for `ior_of`.
- **perf-instance-glass**: `--perf` report-only row, mesh prototype vs analytic
  prototype, so the §2 cost claim is a number.

## Ledger

- C1–C5 — **BUILT** Aug 11 2026. vitest 2178 green, glslang clean (the new witness
  scenes ride the registry-iterating compile test).
- Sweep — owner-gated: `npm run witness -- instance-glass instance-glass-mesh
  instance-fog`, and `npm run witness -- --perf perf-instance-glass
  perf-instance-opaque` for the cost row.

### What the build confirmed

- **Zero snapshot churn on existing scenes.** No program-description and no
  generated-GLSL snapshot moved, which is the exact-linkage claim proven structurally
  rather than argued: every opaque batch emits precisely what it did before.
- **The batch left the thin set as designed.** In the new byte-snapshot case
  (`instance-glass`) `scene_region_thin` returns only the light quad; the batch's region
  is answered by the containment arm.
- **`hasInterior` is omitted when false**, so the plan of an opaque batch is unchanged
  byte-for-byte (the `emissionCones` precedent).

### Two SILENT bugs the bring-up exposed (owner-reported: glass instances invisible)

Both passed every existing gate — scenes compiled, glslang linked, 2178 vitest tests
green — and the glass simply rendered as clear air. Regression pins:
`tests/compiler/instancedContainment.test.ts`.

1. **`bvhPointWalkLines` read the node layout wrong — PRE-EXISTING, in shared code.**
   `buildBVHCore` stores B = `n1.w` = the RIGHT child and leaves the LEFT implicit at
   `nodeIdx + 1`. The ray walk (`bvhWalkLines`) reads that correctly; the POINT walk
   took `n1.w` as the left child and assumed the sibling sat at `l + 1`, so it descended
   the right subtree twice and **never visited the left one**. Invisible until now
   because a missed containment only matters where region IDENTITY is read (`ior_of`,
   `current_medium`), and the point walk's only consumers were opaque tabled scenes.
   Instanced dielectrics were its first real consumer. Fixed to `L = ni + 1, R = n1.w`;
   the pin asserts both walks agree on the layout.
2. **The baked `ior_of` table had no row for batch regions — introduced here.**
   `generateIorOf` iterated `[...objects, ...meshes.filter(closed)]`; batches were never
   in it because they had never had interiors. Containment answered correctly and the
   batch left the thin set, but `ior_of(batchRegion)` returned 1.0 ⇒ **η = 1 ⇒ perfectly
   transparent**. Fixed by giving interior-claiming batches rows by the same rule closed
   meshes use, plus the data-form sibling of the open-mesh exclusion (a batch that wants
   an interior but cannot answer containment must still read 1.0).

The lesson for the gate design: every witness here is a cross-scene twin, which WOULD
have caught this on the first sweep — but the compile-time suite could not, because
"the region exists" and "the region has an index" are different facts and only the
second one shows up in a pixel.

### Termination policy (owner discussion, Aug 11) — and a correction

The bring-up made the bounce budget matter more than anywhere else in the suite (a path
crossing a CLUSTER meets two interfaces per sphere crossed), which surfaced a muddle
worth pinning:

**Roulette does NOT reduce the bias from `maxBounces`.** A killed path's energy is paid
forward into the survivors, so the survivors reaching the cap are fewer but proportionally
heavier and the energy lost at the cap is unchanged. The knobs are independent:
`maxBounces` decides how CORRECT the picture is (uncompensated truncation — one-directional,
never converges away); roulette decides what it COSTS (the converged image is identical).
Lowering the roulette ceiling therefore does not license a lower bounce budget.

Policy: never lower `maxBounces` to save time — take the time out of roulette instead;
find the budget by the doubling test (raise until the image stops changing); and prefer
ABSORPTION, which is the physical terminator and makes the ladder converge.

Landed from that discussion:
- **`estimator.russianRoulette.maxSurvival`** (default 0.95) — the survival CEILING is now
  authored, not a pinned define. It is the only terminator for a LOSSLESS path (clear
  glass transmits at weight exactly 1), so it alone sets path length there: 0.95 ≈ 20
  further bounces, 0.5 ≈ 1. Validator: (0, 1], with a warning at 1 (that hands termination
  back to the bias term). Declared in the taxonomy's §7 table as an estimator field.
  Gated by `instance-glass` key 3 — same scene, ~20× shorter paths, must converge to the
  SAME image, which makes "unbiased" checkable rather than asserted.
- **A bounce ladder on `perf-instance-glass`** (keys 1/2/3 = 12/24/48) instead of a chosen
  number, because the right budget is a fact about the scene. First reading (equal-spp
  linear HDR): 12 → 24 gains 3.87%, 24 → 48 gains 0.76% — the ladder FLATTENS.
- **The witness glass now absorbs faintly** (σ_a [0.22, 0.06, 0.10] — soda-lime green,
  red hardest, green least): barely a tint through one sphere, unmistakable through the
  cluster. Not decoration — it is what ends long internal-reflection chains, so the budget
  a scene needs drops and the ladder converges. Deliberately NOT a Validator rule: the
  right bounce count is a fact about light transport, not one the compiler can derive.

### Incidental

The equiangular χ² twin's documented "flaky under parallel load" was diagnosed and
retired: each case measures ~3.3s alone against a 5s default timeout, so it was a
WALL-CLOCK flake, never an unstable result (deterministic LCG, deterministic bins).
This batch's CPU-heavy twins pushed it over reliably; the fix is a 30s budget on those
six cases. Full suite now green on repeat runs.
