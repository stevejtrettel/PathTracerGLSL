# fable-mesh-containment.md — solid meshes (dielectric + interior media)

**STATUS: BUILT & SWEPT Jul 20 2026** — owner's numeric sweep green (mesh-glass-box, mesh-fog, mesh-submerged twins all pass). §1 AMENDED
at approval: the inside test is FIRST-HIT FACING (not parity) — the Validator's winding
proof makes the cheaper query sufficient — plus the root-box early-out. Forks resolved to
the marked picks. Build record §9; the design follows as approved.

**Goal:** meshes with a real INSIDE — glass meshes that refract with the η² discipline,
fog-filled meshes, meshes participating in nesting (a glass mesh submerged in water) — by
letting closed meshes join `scene_region_at`, leaving the v0 thin-surface model available for
genuinely open geometry (the teapot stays thin).

---

## 1. The crux: innermost-wins needs a SIGNED DISTANCE, not a boolean

`scene_region_at(p)` resolves nesting by **least-negative signed distance among containing
regions** (§2.7 — the R-SUBMERGED lesson). A parity/winding test gives a mesh a cheap
inside/outside *boolean*, but a boolean cannot participate in innermost-wins: with a mesh
inside a water volume, both contain p and the ordering IS the answer.

**The design: mesh signed distance = parity sign × BVH closest-triangle distance — computed
lazily.**

```
mesh_region_distance(p):
    if (!mesh_inside(p))  →  mesh does not contain p; contribute nothing   // parity only
    else                  →  d = −mesh_closest_dist(p)                     // full query
```

Two new **point queries** against the existing BLAS (build is shared, query is local — the
accel doctrine; both live in `intersection/mesh/mesh.glsl`):

- **`mesh_inside_bvh`** — FIRST-HIT FACING (amended at approval; supersedes the draft's
  parity): cast a ray from local-p in a FIXED slightly-irrational direction, take the
  NEAREST triangle (a standard tmax-pruned walk — cheaper than counting all crossings),
  and read the hit's geometric side: from inside a closed surface the first crossing is
  always an exit (back-face, `dot(dir, gnorm) > 0`); from outside it is an entry or
  nothing. Valid ONLY because the Validator PROVES watertightness + consistent winding —
  the validation pays for itself at runtime (parity's winding-robustness is unneeded).
  The fixed direction makes vertex/edge grazing a measure-zero authoring coincidence;
  generalized winding number stays the declared robustness upgrade (v2, not built).
- **`mesh_closest_bvh`** — branch-and-bound closest-triangle distance: stack DFS ordered by
  box-distance, pruning nodes farther than the best; exact point-triangle distance at leaves.

**The lazy split is the cost story**, in three tiers:
1. probe OUTSIDE the mesh's local AABB (baked literals — the compiler has the positions):
   ~free — outside the box IS outside the mesh, no traversal;
2. probe inside the box: ONE nearest-hit walk against that mesh's BLAS (the same cost as an
   ordinary ray intersection against that one mesh);
3. probe actually inside: + the closest-distance query — run ONLY here, i.e. only on the
   glass/fog paths the feature exists for (a lone solid mesh in air never strictly needs
   the magnitude; it earns its cost exactly in the NESTED cases).
`scene_region_at` call sites (dispatcher classification probes, the medium walker's
segment starts, the camera-start probe) are unchanged.

## 2. Authoring: `closed: true` — intent, validated as fact

```ts
interface MeshObject {
    ...
    /** This mesh bounds a solid region: it joins scene_region_at (dielectric/media-capable)
     *  and leaves the thin set. Requires watertight, consistently-wound, OUTWARD geometry —
     *  Validator-checked, reject-not-degrade. Absent = v0 thin surface. */
    closed?: boolean;
}
```

The flag is authored INTENT; the Validator makes it fact (never trust-and-render):
- **watertight:** every undirected edge shared by exactly 2 triangles (O(T) hash walk);
- **consistently wound:** each shared edge traversed in opposite directions by its two
  triangles (same walk);
- **outward:** signed volume `Σ det(a,b,c)/6 > 0` (one pass; also gives the volume for free).

A `closed` mesh failing any check errors with the specific defect (boundary-edge count,
flipped-pair count, negative volume → "reverse the winding"). Open meshes stay thin with all
v0 semantics — both kinds coexist in one scene. `loadOBJ` needs no change (closedness rides
`MeshAuthoring`).

## 3. What flips automatically (the facts already route it)

The audit deliberately keyed these on thin-set membership, so closing a mesh flips them
without editing any rule:

- **Dispatcher back-face branch** — closed meshes leave `scene_region_thin`; a back-face hit
  gets `region_from = owner` (solid semantics — the exit hit now classifies the glass
  interior correctly, which is exactly the v0 truncation this batch retires).
- **Transmissive-on-thin warning** — the batch-1 rule keys on the thin set; closed meshes
  stop warning, open meshes keep warning. Zero edits.
- **Interior media** — `material_of(region)` + the medium walker key on regions;
  once the mesh region claims containment, a medium on its material works through the
  existing seams (§4.4 self-heal included). Fog-in-a-bunny is table-driven, not new code.
- **`ior_of`** — `generateIorOf` today spans sdf+analytic; it gains closed-mesh rows (one
  loop extension — the region-table row machinery is model-driven already).

## 4. Epsilon discipline (declared limits, not new machinery)

- The §4.2 classification probes stand `EPS_INTERFACE` (1e-3) off the surface along the
  geometric normal — valid for meshes whose features are larger than that, exactly the
  existing discipline's assumption for SDF/analytic. Declared limit: sub-epsilon mesh
  features can misclassify (same class as the existing marcher epsilons; §10.2 adaptive
  epsilons remain the principled follow-up for all backends at once).
- Refraction spawn offsets ride the GEOMETRIC side: the shading-normal orientation fix
  (the Veach silhouette fix) already forces shading-n to the geometric ray side, so
  `ray_spawn`'s sign logic holds. Smooth-normal refraction at silhouettes can produce the
  standard "impossible refraction" rays — the standard renderer behavior, noted not fixed.
- Parity near the surface: the dispatcher probes at ±EPS_INTERFACE, safely off the boundary;
  the medium walker probes segment interiors. No probe lands ON the surface by construction.

## 5. Placement

Constant tiers fold into the local-frame conjugation exactly like the SDF wrapper (probe
p → local, distances scale by s — the world-exact discipline). Driven placement works the
same way (rigid conjugate + s), with one care: `mesh_closest_dist` returns a LOCAL distance —
multiply by s for the world-exact comparison (the §5.2 `s·d` rule, applied to the new query).

## 6. Out of scope (declared)

- **Instanced solid meshes** — batches stay thin (a batch's N interiors would need N-aware
  containment; revisit with per-instance materials/Stage B).
- Generalized winding number (robustness upgrade path); mesh CSG; self-intersecting "closed"
  meshes (the checks catch non-manifold, not self-intersection — declared trust).
- Open-mesh dielectrics (still warned, still η=1 — being open is the honest reason).

## 7. Verification (the twin discipline, sharpest available)

- **`mesh-glass-box ⇄ glass-box-ref`** — a `closed` CUBE mesh with the dielectric material ≡
  the SAME cube as an SDF box with glass (exact-geometry cross-backend twin — faceting
  cancels; the F-ETA-class numbers must reproduce through the mesh region).
- **`mesh-fog`** — an absorbing medium inside a closed cube mesh ≡ the F-BOX-M-style SDF twin
  (the slab numbers through mesh containment + the medium walker).
- **`mesh-submerged`** — a closed mesh inside a larger analytic/SDF region (the R-SUBMERGED
  innermost-wins exercise, now with a mesh as the inner region).
- TS unit tests: watertight/winding/volume checks on known-good/known-broken fixtures;
  a CPU twin of `mesh_closest_dist` cross-checked against brute force over random points.

## 8. Decision forks (owner)

1. **The signed-distance design** (§1: lazy parity + closest-distance) vs alternatives
   considered and rejected: containment bookkeeping on the path (a medium stack — contract-
   forbidden, fable-transport-verification), nesting-priority integers (authoring burden,
   breaks the geometric innermost-wins semantics). My pick: §1 — it makes closed meshes
   first-class citizens of the EXISTING region algebra.
2. **`closed` flag + validated watertightness** (my pick) vs auto-detect (silent behavior
   change when an artist's mesh happens to be watertight — rejected: intent should be
   authored).
3. **Fixed-direction parity** in v1 with winding-number as the declared upgrade (my pick)
   vs winding-number immediately (heavier transcription, likely unneeded). *(Amended at
   approval: first-hit facing supersedes parity; the fixed-direction + winding-number-v2
   reasoning carries over.)*
4. **Sequencing** vs instance-attributes (independent seams — see chat summary).

---

## 9. Build record (BUILT Jul 20 2026 — GPU-render-verified; numeric sweep owner-gated)

Built as designed (+the §1 amendment). tsc clean; vitest 1180 green (incl. glslang static
compile of the containment GLSL through all six new witness pairs); ZERO re-goldens of
existing emitted-GLSL snapshots — scenes without closed meshes are byte-identical.

- **IR/authoring:** `MeshObject.closed` + `MeshAuthoring.closed` (loadOBJ pass-through).
- **Topology proof** — `components/intersection/mesh/topology.ts`: `meshClosedness`
  (POSITION-WELDED edge accounting — split-corner meshes check correctly; watertight /
  consistent / outward via signed volume) + `meshLocalBox`. Unit-tested on good/holed/
  flipped/inward cubes incl. the 24-vert welding case.
- **Validator:** the three-check proof with defect-specific messages; closed prototypes
  rejected (batches surface-only); the transmissive-on-thin warning now keys on `closed`
  (fires for open meshes, silent for solids — the fact flipped, zero rule edits).
- **Planner:** `PlannedMesh.closed` + baked `localBox`.
- **GLSL queries** (mesh.glsl, local space): `mesh_inside_bvh` (first-hit facing — a
  tmax-pruned nearest walk reading the geometric side; fixed irrational direction) +
  `mesh_closest_bvh` (branch-and-bound, Ericson point-triangle distance, near-child-first).
- **Codegen:** closed meshes leave the thin set and join `scene_region_at` via the lazy
  three-tier arm (baked-box early-out → inside test → −s·closest distance, the §5.2
  world-exact correction; `emitMeshPointQuery` handles all placement tiers incl. driven);
  `ior_of` gains closed-mesh rows; the node texture is declared for closed meshes even
  under `brute` (containment reads the BLAS).
- **Witnesses** (all ⇄ SDF-box refs, rmse twin gates, sweep owner-gated): `mesh-glass-box`
  (dielectric interior), `mesh-fog` (interior medium + walker), `mesh-submerged` (scaled
  closed mesh nested in a water sphere — the innermost-wins/R-SUBMERGED exercise).
- **GPU renders:** all three pairs headless — glass cube genuinely refracts (transmission,
  interior floor line, focused shadow), the submerged cube is VISIBLE inside the water
  (the historic wrong-ordering failure mode is absence), fog attenuates; frame means agree
  with the SDF refs to ≤0.06% at ~20 spp. Converged numbers await the owner's sweep.
