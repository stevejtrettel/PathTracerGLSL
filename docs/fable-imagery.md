# fable-imagery.md — the imagery/polish pass

**STATUS: owner-commissioned Jul 21 2026 — plan approved at menu level. P1 BUILT & GPU-verified
Jul 21 (recorded design below — §7 forks 1–2 RESOLVED; the menu bullets became the concrete
interface). P2–P5 pending.** Unlike the substrate batches, this pass is a MENU of small-to-medium
items that compound into "images worth framing" — each its own gated mini-batch, one owner sweep
at the end.

**Order: P1 → P2 → P3 → P4 → P5** (charts feed expressions: `uv` must exist before
formulas can use it).

---

## P1 — Real per-primitive UV charts (Hit.uv stops being a placeholder) — BUILT Jul 21 2026

Before P1 every non-mesh `Hit.uv` writer emitted the planar x/z chart (`UV_PLANAR_SCALE`,
structs.glsl). P1 makes `Hit.uv` a real per-primitive parameterization. The build split into
**P1a** (charts exist) and **P1b** (charts track rotation), recorded here as the design of
record.

### P1a — the chart occupants + emission

- **Occupant symbol.** Each charting primitive's `.glsl` gains `vec2 <type>_uv(vec3 p,
  <Type> shape)` (type-first convention). The descriptor declares `uvChart: true`
  (`PrimitiveDescriptor`), and `geometryContract.test` pins the symbol both directions
  (`<type>_uv` exists **iff** `uvChart`). Built occupants: **sphere** (θ,φ equirect from
  the outward direction), **quad** (natural [0,1]² via the same 2×2 Gram solve as
  `quad_intersect` — orientation rides in the folded edges, free), **disk** (polar r/R,
  θ/2π; the in-plane θ reference comes from `build_basis(normal)`). Box/cylinder charts are
  a later add (SDF-side, face-planar/cylindrical) — the dispatch is already in place.
- **The scene-level emission gate.** Charts are behind `ProgramDescription.materials.
  materialsReadUv` (Planner decides = "some present material reads Hit.uv" via the
  `readsUv` MaterialModelDescriptor capability; Generator reads — the `environmentSamplable`
  precedent). When **false** (the common case — no scene material reads uv), every hit-fill
  keeps the planar placeholder, so a scene with no uv materials pays **zero** chart cost
  (pre-P1 runtime, byte-verified: veach-mis emits 0 chart calls). This is **not** a linkage
  seam — `hit.uv` is core Hit state, always written — it is purely the "don't derive what
  nothing consumes" gate. (The `<type>_uv` function still emits as §2.12 wholesale occupant
  residue, uncalled, like `sdf_intersect_any` inside raymarch.glsl.)
- **Dispatch.** Two shapes, mirroring the SDF backend: analytic hit-fill sites (unrolled
  arms, driven arm, instance leaf, table leaf) call `<type>_uv` inline via the `uvFill`
  emitter (gated on `uvChart && materialsReadUv`, planar otherwise); the SDF marcher's
  `raymarch_commit` calls generated **`scene_object_uv(p, region)`** — the `scene_object_sdf`
  sibling, always emitted, per-owner dispatch to `uv_<id>(p)` (which applies the SAME
  placement wrapper as `sdf_<id>`, so an SDF-backed chart inherits the placement rotation
  for free). Mesh uv was already real (barycentric).

### P1b — patterned + rotated analytic shapes track rotation

The constant analytic fold dissolves a shape's rotation into its canonical params (correct
for geometry — the primitive set is similarity-closed), but a UV chart is orientation-bearing
structure the fold throws away. **The rule (fork §7.2, RESOLVED):** *a patterned shape is
emitted like a movable (driven) shape, but with constant numbers instead of sliders.*

- A **patterned + rotated** analytic object (`keepsLocalFrame` = its material reads uv **and**
  the primitive charts **and** the placement carries a rotation) is **not folded**: it keeps
  canonical params + a retained constant `Similarity`, and flows through the driven wrapper
  arm — the ray is conjugated into the shape's own frame via `placement_rigid(vec4(const
  inverse-quat), …)`, so hit-finding AND the chart both run in canonical space. The chart
  tracks rotation exactly; **one representation** (no dual folded/canonical copies), no
  per-primitive special-case, no struct fields, no baked-`Rᵀ` side-channel. Cost: a per-ray
  un-rotate paid ONLY by patterned shapes.
- **Mechanism.** `placementRefs(placement)` unifies the driven and constant-wrapper arms
  across all three sites (nearest / any / containment): driven → its two uniform names;
  constant → `formatVec4(rigidInverse(g))` compile-time literals. `PlannedAnalyticObject.
  placement` widened to `PlannedPlacement`; the placement-helper block gate broadened to any
  placed analytic object. **`keepsLocalFrame` (dataTenants.ts) is THE ONE predicate** read by
  both the Planner (retain) and the object-table adapter (exclude — a retained shape is never
  tabled, since records assume folded params); they cannot drift (guarded by a truth-table
  test). SDF-backed and driven-rotation charts were already correct (wrapper carries rotation).
- **Rejected alternatives** (both hacky): a struct-field chart frame (two `direction` params
  or a `mat3`) — bloats every sphere's record even unread, worst for the 250-sphere object
  table; a baked-`Rᵀ`-at-callsite — sphere-clean but leaves the disk's in-plane θ asymmetric.
  The wrapper-arm reuse dissolves both, and killed the disk θ residual (canonical-frame eval).

### Residual limits (declared)

- **Tabled** patterned+rotated shapes stay in the residual/unrolled arm (never tabled) —
  correct, just not table-accelerated. Bounded case (hand-placed textured shapes are few).
- A **constant in-plane rotation of a textured disk that is ALSO tabled** would fall back to
  the folded axis-aligned chart — but such a shape is excluded from tabling, so it takes the
  wrapper arm instead. No live gap.

### Witnesses

Demo card **`charts`** (demos/uvChartsScene.ts): ONE `checker` material on a sphere/quad/disk,
spun in place (canonical center + `transform.position` + rotation) — three distinct charts,
the sphere's poles visibly tilt with its rotation. `geometryContract` pins the `<type>_uv`
symbols; `plannerHelpers.test` pins the `keepsLocalFrame` truth table. A chart-continuity
vitest is overkill — the equality witnesses already guard that charts don't perturb transport
(uv is read only by uv-reading materials, and no witness scene reads uv).

## P2 — Expression-driven materials (domain coloring on path-traced surfaces)

The heterogeneous-media idiom — `GlslExpression` with declared `params` sliders —
pointed at MATERIAL rows: **albedo (and friends) as a formula over `p` and `uv`**.
Iteration counts, complex arguments, distance fields — colored by math, sliders live,
zero recompiles. Most plumbing exists (`SpectrumProperty` already admits expressions;
the fill site has `p` in scope; `mintValueUniform` mints expression params):

- **Scope extension**: the material fill exposes `uv`… which requires the fill to see
  the hit's uv — `scene_material_properties(id, p, element)` grows a `vec2 uv` arg
  (both call sites pass `hit.uv`; the same signature-extension shape as `element`).
- **Row policy (fork §7.1)**: every Spectrum/scalar FIELD row accepts expressions
  (albedo, roughness, f0, emission); `ior` stays constant/driven-only (region-indexed,
  no shading point — already Validator-enforced). Expression EMISSION is automatically
  path-found-only (the light registry admits constant emission only — no new rule
  needed, but a Validator NOTE-level warning when sampleAsLight is explicitly true on
  an expression emitter).
- Validator: expression rows get the same declared-params checks media expressions get;
  the C5 no-reader warning extends.
- Witness: `expr-const-twin` — an expression that evaluates to a constant ≡ the
  constant material (identical-stream equality).

## P3 — Pixel reconstruction filters (tent, gaussian)

The `pixel/` family (the reconstruction kernel h_j(u), carved in the camera batch) has
one occupant: `box`. Add **tent** and **gaussian** — importance-sampled kernels
(`pixel_sample(coord, xi)` returns the offset; sampling the kernel exactly makes the
weight 1, no splatting). Gaussian: σ ≈ 0.5px, truncated at 2σ with renormalized
inverse-CDF sampling (the truncation is the standard declared choice). One folder + one
registry line each — the door test, again. Witness: filters are measurement-side
(they change the pixel integral slightly) — a visual card + the furnace mean (flat
fields are filter-invariant: furnace 0.4 must hold under every filter, a real gate).

## P4 — Fix PNG export (the dead `ldr` target)

`exportPNG` requests an export target `'ldr'` that `buildExportTargets` never defines —
dead since the measurement bench. The E5 `ldrRecipe` machinery (the display re-run as
data) is the intended route: define the target, run the recipe into it, read back, keep
the reproducibility stamps (PNG tEXt). Wiring, not design. Test: an export smoke in the
verify harness (render → exportPNG → decode → nonzero + stamp present).

## P5 — Showcase scenes (the actual deliverable)

- **`math-garden`** — the composed hero: expression-colored surfaces (P2) over a
  checkered ground (P1), thin-lens DoF, a mesh light, gaussian filter (P3).
- **Composition pass on `grand-bazaar`** (currently numerous, not composed) and a
  camera/tonemap polish over `cacti`.
- Export each as PNG (P4) — the pass ends with pictures, not just green tests.

## 6. Deliberately out (veto-able, each ledgered)

- **Image textures** (photo albedo): image-shaped data vs the texture budget — its own
  design, not polish.
- **Bloom/vignette**: view-layer sugar, dilutes the pass.
- **Firefly clamping**: BIAS dressed as polish — if ever, it enters as a declared
  measurement truncation through the front door.
- **Normal/bump mapping**: needs tangent frames from UVs — the natural SEQUEL to P1.

## 7. Decision forks (owner)

1. **Expression row policy — RESOLVED (owner Jul 21):** all Spectrum/scalar field rows incl.
   path-found emission; `ior` excluded (region-indexed, no shading point). Governs P2.
2. **Sphere chart under rotation — RESOLVED (owner Jul 21), superseded by P1b above.** NOT
   axis-aligned: patterned+rotated analytic shapes take the wrapper arm (emitted like a movable
   shape with constant numbers), so the chart tracks rotation exactly — sphere AND disk. The
   axis-aligned "limit" the fork weighed collapsed once the wrapper reuse was found; see P1b.
3. **Gaussian truncation at 2σ, σ = 0.5px** (my pick — pbrt-ish defaults; both become
   registry knobs only if wanted). Still open — governs P3.
4. Anything promoted from §6.
