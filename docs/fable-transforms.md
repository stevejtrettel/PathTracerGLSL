# Transforms, Groups, and Geometry Placement

**Status:** design authority (owner-approved July 15 2026; stages 1–2 BUILT and
GPU-verified July 15; **§3/§4/§6 revised July 16 2026, owner-decided: SceneDescription
stays FLAT — groups live in the authoring layer only**)
**Scope:** object placement for all geometry backends (SDF, analytic, future mesh),
the authoring-layer scene graph, and uniform-driven transforms
**Supersedes:** `docs/design-scene-graph-transforms.md` (external draft; kept for history,
its affine-matrix representation and staging are replaced by this document)

---

## 1. The two commitments (owner-pinned, one-way doors)

1. **Placement is a Euclidean similarity** `x ↦ s·R·x + t` with `s > 0` strictly.
   - **No reflections.** `s < 0` (or any mirror) is rejected by the Validator, not deferred:
     reflections flip orientation and would silently invert the quad one-sided pin, SDF
     gradient orientation, and frame handedness. Mirror symmetry, if ever wanted, is an
     explicit feature with its own witness — never a sign convention.
   - **No nonuniform scale — unrepresentable.** `scale` is a scalar in the type; an authored
     vector scale fails shape validation with a diagnostic naming the alternative (an
     ellipsoid is a *primitive*, not a transform). This is what makes the whole design
     exact: similarities are closed under composition (shear can never arise), a
     similarity-conjugated exact SDF is exact (× s), normals transform by `R` alone
     (no inverse-transpose machinery exists because nothing needing it is representable),
     and similarities preserve shape *kind* — a transformed sphere light is still a sphere
     light, so every light-kind sampler survives transformation.

2. **Constant transforms compile away; driven transforms become per-object uniforms.**
   The shader never contains group nodes, parent pointers, scene-graph traversal, or
   runtime matrix composition. Math is static; policy/plumbing are generated (the
   transport-GLSL rule applies here too).

### Forward-compatibility (non-Euclidean)

The durable contract is: *a leaf's placement is an element of the ambient space's
structure group*, with `compose / inverse / apply_point / apply_direction /
distance_scale`. The Euclidean occupant is the `Similarity` struct below. H³ has no
similarities beyond isometries — its future occupant is an SO(3,1) element with
`distance_scale ≡ 1`, still a 4×4 matrix acting on the hyperboloid, still closed-form
inverse. We do not build that seam now; we only avoid baking "it's TRS" into names that
cross layer boundaries: the scene language says `transform`, the plan says
`placement: Similarity`, and only the Euclidean lowering knows the anatomy.

---

## 2. The transform type

```ts
/** Euclidean similarity: x ↦ s·R·x + t. Closed under composition; the internal
 *  canonical placement. Authoring sugar (axis-angle, quaternion) lowers to this. */
interface Similarity {
    rotation: Quat;       // unit quaternion [x, y, z, w]
    translation: Vec3;
    scale: number;        // s > 0 (see §1)
}
```

- **Composition** (closed form): `(s₂,R₂,t₂)∘(s₁,R₁,t₁) = (s₂s₁, R₂R₁, s₂R₂t₁ + t₂)`.
- **Inverse** (closed form): `(1/s, Rᵀ, −Rᵀt/s)`. No numerical mat4 inversion anywhere.
- **Normals**: `n_world = R n_local`. Exact; unit in, unit out.
- **Node-local TRS order pinned**: `local→parent = T·R·S` — scale, then rotate, then
  translate (the three.js convention; each field means what a human expects).
- **Authoring**: `rotation` accepts axis-angle `{ axis: Vec3, angle: number /* radians */ }`
  or a raw quaternion. Euler sugar omitted until wanted. `position`, `scale` as today.

Home: `src/components/geometry/similarity.ts` (components are the leaf layer — the
Planner imports from components, per the dependency direction; `canonicalPlane` and
`quadNormal` already live this way).

---

## 3. The three layers — SceneDescription stays FLAT (owner-decided July 16 2026)

Groups are **not** part of SceneDescription. The decisive test is the pinned taxonomy:
scene + measurement = *the integral*, and groups are not part of the integral — two
trees that flatten to the same leaves define the same integral. Keeping the description
flat keeps it quasi-canonical, keeps every consumer (Analyzer/Validator/Planner, stamps,
tooling) tree-free, and keeps the authoring-language boundary sharp instead of letting
SceneDescription become a de-facto authoring surface.

The argument that once pointed the other way — "driven transforms need the root→leaf
factor chains to reach the Planner" — is FALSE, and the reason is the §1 similarity
commitment itself: **similarities are closed under composition, so any composed chain,
however deep and however driven, re-expresses as a single TRS**. The compiler only ever
needs to know, per leaf: constant (fold it away) or live (uniform tier). Composition is
the job of whoever owns the graph — which should exist exactly once, in the authoring
layer, never echoed as a ghost chain inside the compiled artifact.

| Layer | Owns | Never contains |
|---|---|---|
| **Authoring language** (future; seeded by `flattenGroups`, §4) | trees, groups, names, live manipulation, the `updateMatrixWorld` equivalent | radiometry decisions |
| **SceneDescription** | flat leaves: local primitive params + material + one `Transform` whose fields are `Value<>` (§6) | trees, parents, chains |
| **Exported GLSL** | folded constants or per-object uniforms | traversal, runtime composition |

The runtime channel between the authoring layer and the running renderer is the
**ParameterStore and nothing else** — the boundary that already carries the camera's
live placement.

Notes carried over from the tree design:
- **Camera stays out** of placement entirely — it is a pure film→ray map with its own
  live-driven parameters.
- `scene.lights` entries have no transform fields; the transformable emitter route is
  an emissive **object** (`sampleAsLight`), constant-placed until the `Value<T>`
  light-params batch (§6).
- Optional provenance: `ObjectDescription.name?: string` — stamped by `flattenGroups`
  with the node path (`'outer/inner/sphere'`), read only by diagnostics.

---

## 4. The authoring-layer seed: `flattenGroups`

The authoring language starts life as one pure function (outside the compiler — the
compiler never sees trees):

```ts
flattenGroups(tree: SceneNode[]): ObjectDescription[]
// composes each leaf's root→leaf similarity chain into ONE Transform,
// stamps `name` with the node path, emits leaves in document order
// (region-id stability), and leaves primitive params LOCAL (untouched).
```

- All-constant chains (the common case) compose via the §2 algebra at build time; the
  output is an ordinary flat scene — stage-2 machinery handles everything from there.
- **Static-composition rule**: `flattenGroups` composes CONSTANT transforms. A
  `{param}`-driven field under a non-identity ancestor is a build-time ERROR in v1
  (`C₂·R(θ)·C₁` is not a fixed TRS over the raw param — composing it per change is
  exactly the runtime graph's job, and the error says so); a driven field under
  all-identity ancestors passes through unchanged. The static flatten and the future
  live graph are the SAME operation at two binding times — static composes once and
  emits a scene description; dynamic mints param paths for driven-influenced leaves at
  description time, then re-composes and pushes TRS values through the ParameterStore
  on every change.
- A JS-aliased node appearing under two parents flattens to two independent leaves
  (two regions, two lights) — legal, documented, *not* instancing. Real instancing
  arrives with meshes and shared BVHs.
- **Driven groups are the authoring RUNTIME's job** (the future live graph / DSL): on a
  parameter change it recomposes the affected leaves' similarities, decomposes each
  back to TRS (always possible — closure), and pushes the leaf's placement params
  through the ParameterStore. That is the three.js `updateMatrixWorld` loop, host-side,
  touching only the driven subtree. The compiler and the scene description never know
  the graph existed.

---

## 5. Lowering, per backend

**Ordering pin (load-bearing): compose (authoring layer, §4) → fold (plan) → light
desugar.** Inside the compiler this is simply fold-before-desugar. The desugar and the
`sampleAsLight` registry read **post-fold** parameters, exactly as they read
post-`resolveAnalyticPositioning` parameters today. Every downstream consumer — power
CDF, `emitSampleCall`, `emitPdfArm`, `lighting_query_delta`, `analyticSignedDistance`,
`light_of` regions — inherits correctness from this single ordering rule (the
Planner's "sampler cannot drift from hittable geometry" invariant, generalized).

### 5.1 Analytic, constant transform → parameter fold (plan time)

The current analytic primitive set is **closed under similarities**:

| primitive | fold of `g = (s, R, t)` |
|---|---|
| sphere `(center, radius)` | `(g·center, s·radius)` |
| quad `(corner, e₁, e₂)` | `(g·corner, sR·e₁, sR·e₂)` |
| plane `(n̂, d)` | `(R·n̂, s·d − ⟨t, R·n̂⟩)` (canonical unit-normal form) |

Per-primitive `foldSimilarity(params, g)` lives beside `PRIMITIVE_PARAMS` in the
geometry component. This **replaces** `resolveAnalyticPositioning`. Identity fold
reproduces today's output byte-for-byte. No wrapper, no GLSL churn; the five baking
sites stay coherent because they all read the same folded parameters.

### 5.2 SDF, constant transform → wrapper tiers

The existing `sdf_object_i(p)` wrapper generalizes; emission is classified so a scene
pays only for what it authored:

```glsl
// identity:     (no transform lines — today's output, byte-identical)
// translation:  p = p - t;                       (today's output for translated objects)
// rigid:        p = M_INV * (p - t);             (folded mat3 constant = Rᵀ)
// similarity:   p = M_INV * (p - t) * (1.0/s);   →  return s * sdf_prim(p, ...);
```

The `s·d_local` correction keeps the wrapper a **world-space** distance field, which is
what keeps the entire epsilon discipline valid unchanged: `march_epsilon(t)`, the
`EPS_INTERFACE` classification probe, `ray_spawn`'s `EPSILON`, and the stall-commit
threshold are all world-space lengths compared against a world-space field
(`raymarch.glsl` documents the coupling). Exactness: the gradient of
`s·f(Rᵀ(p−t)/s)` is `R∇f` — unit, world-space, automatic for finite-difference normals.

Where a primitive's params are similarity-closed (sphere: fully; box:
translation+scale but **not** rotation; plane: fully), the fold tier may absorb factors
and shrink the wrapper — a pure lowering optimization, per-primitive, never semantic.

### 5.3 Analytic, general case → local-frame conjugation

For driven transforms (and future primitives that are not similarity-closed, and
meshes): transform the ray, not the object — with the similarity-specific refinement
that **the direction is rotated but not scaled**, so it stays unit and every existing
intersector's normalized-direction assumption holds:

```glsl
o_local = qrot_inv(q, o_world - t) / s;   // full inverse similarity on the origin
d_local = qrot_inv(q, d_world);           // rotation only — stays unit
// intersect local primitive → t_local;   t_world = s * t_local;
// n_world = qrot(q, n_local);
```

`t_world` stays comparable across objects in the shared nearest-hit `hit.t`.
`analyticSignedDistance` for `scene_region_at` takes the same `s·d_local` treatment as
SDF. Meshes use this identical recipe against a BVH (one acceleration structure, many
instances).

---

## 6. Driven placement: per-field `Value<>` (the uniform-controlled axis)

**One mechanism** — transform fields take `Value<>` exactly like every other numeric
property in the language (§2.8):

```ts
transform: {
    position: { param: 'crane.tip' },                                 // Value<Vec3>
    rotation: { axis: [0,1,0], angle: { param: 'turntable.angle' } }, // angle: Value<number>
    scale: 2,                                                          // constants mix freely
}
// rotation also accepts Value<Quaternion> — the graph runtime's port (§4):
// decomposed similarities arrive as quat params, not axis-angle.
```

No factor chains, no whole-placement value kind: per-field params are UNIVERSAL because
closure means every composed placement decomposes back to TRS (§3).

- **Lowering**: any driven field ⇒ the leaf takes the §5.2/§5.3 general tier —
  per-object uniforms `u_object<i>_w2l` (mat4) + `u_object<i>_scale` (float). GLSL
  never composes matrices; the same uniform pair feeds the SDF wrapper, the analytic
  conjugation, AND `analyticSignedDistance` in `scene_region_at`, so regions, interior
  marching, and `current_medium` stay coherent automatically.
- **Plumbing**: the Planner emits one `PlannedUniform` per driven object with
  `parameters: [every {param} path in its TRS]` and a `compute` that assembles
  TRS → (w2l, scale), constants baked into the closure. The engine already supports
  this shape (`ParameterManager` loops `binding.parameters` and hands the whole value
  map to `compute`); the only extension is multi-path `PlannedUniform` in
  `PipelineBuilder.buildUniforms`. **Engine untouched; boundary intact.**
- **Standalone ergonomics for free**: a raw scene file with a driven angle gets a
  working slider (ParameterMetadata from the `ValueParam` range,
  `triggersReset: true`) with zero DSL involved. Param names are the AUTHOR's (or the
  graph runtime's, from node paths) — the compiler never invents names from object
  indices, so identity survives recompiles.
- **Pin: driven fields exclude emitter leaves in v1** — explicit-light desugar targets,
  `sampleAsLight` objects, delta lights. Light geometry is baked as literals into
  `emitSampleCall` / `emitPdfArm` / `lighting_query_delta` / the compile-time power CDF;
  making those uniform-driven is the already-deferred **`Value<T>` light params** item
  on the area-lights ledger. Validator enforces; the diagnostic names the deferred item.
  Driven *occluders* need nothing — shadow rays go through `scene_intersect`, which
  reads the same uniforms.
- When that later batch lands, it must carry this constraint: **driven light transforms
  must be rigid** (translation + rotation only). Power is area-dependent; a driven
  scale would silently stale the baked power CDF — the one place a driven similarity
  can create bias rather than mere wrong geometry. The sampler/pdf/intersection arms
  must then read the SAME uniforms (the byte-match discipline, live).
- **Media under driven scale**: σ is per world unit, so a growing object gets optically
  thicker — correct by definition, no bias.
- **Scale hygiene**: the compile-time extreme-scale warning cannot see runtime values;
  the param's `min`/`max` metadata is the clamp point.

### §6.1 Stage-4 design pins (decided July 16 2026, before build)

1. **The Placement contract (refined July 16 2026 — derived from what each backend
   consumes, not from a matrix habit).** GLSL-side, placement is an opaque 2-vec4
   payload behind FOUR static core helpers — backends never touch its anatomy:

   *Refined at build time (stage 4): the RIGID-frame form — strictly better numerics,
   zero reciprocals.* Queries run in the placement's rigid frame (rotation +
   translation only, an isometry of world space), and the similarity-closed
   primitive PARAMETERS absorb s in-shader (s·center, s·radius, s·halfSize,
   s·offset — directions never scale):

   ```glsl
   // glsl/core/placement.glsl — payload: q = inverse quat; ts = (t_rigid = −Rᵀt, s)
   vec3  placement_rigid (vec4 q, vec4 ts, vec3 p); // world → rigid frame (isometric)
   vec3  placement_dir   (vec4 q, vec3 d);          // world → rigid, stays unit
   vec3  placement_normal(vec4 q, vec3 n);          // rigid → world (conj is free)
   float placement_scale (vec4 ts);                 // s — scales PARAMS in-shader
   ```

   Consequences, all exact: distances and ray-t are WORLD values (no rescaling, no
   rcp anywhere — the earlier "one rcp per wrapper call" cost is GONE); every
   EPSILON guard inside the primitives stays world-correct under driven scale
   (the pre-refinement local-frame form silently rescaled the primitives' internal
   near-hit guards by s); SDF marching sees an exact world-distance field. SDF
   consumes {rigid, scale} (finite-difference normals are world-space
   automatically); analytic and mesh consume all four (ray conjugated ONCE at
   entry; BVHs live in local space forever; TLAS world-AABBs are host-computed, so
   no GPU forward point map exists). A future non-similarity-closed primitive
   (custom SDF) reintroduces a true local-frame `placement_point` + s·d correction
   — one helper + one rcp, added when needed, never before. The payload is
   precomposed host-side in fp64. Slot cost 2.25 vec4/object vs a mat4's 5 (cliff
   ~40 → ~90 driven objects); instance TABLES store the same 8-float record
   (2 RGBA32F texels vs a mat4's 4). The 2-vec4 footprint does not privilege
   Euclid: H³'s compact isometry representation (SL(2,ℂ)) is also 8 reals — a
   curved-space occupant swaps payload semantics + helper bodies, keeping the ABI
   footprint, plumbing, factor lists, and table format.
2. **The wrapper emitter takes a placement EXPRESSION** — a short factor list, each
   factor a `Placement` from a constant literal, a uniform pair, or (later) a table
   fetch; lowering = successive helper applications, NEVER materialized products
   ("GLSL never composes matrices", literally). Stage 4 emits length-1 lists; shared
   frames (4b), mesh instancing, and the batch-codegen UBO/texture tables are then
   mechanical retrofits.
3. **Shared frames (stage 4b, shape pinned now)**: `transform.frame: { param }` — a
   leaf references a NAMED live frame composed outside its constant local TRS
   (`world = frame ∘ TRS(local)`); local constants fold to literals, the frame is ONE
   uniform shared by every leaf naming it. Sharing without hierarchy — the "N
   consumers, one named param" pattern materials already use; it does not crack the
   flat-forever door. This is the runtime graph's port for compound objects: 50
   leaves on a rig = 1 uniform, not 50.
4. **Compute-closure guard rails**: renormalize the quat, clamp scale away from zero
   (param range as policy), warn-once — the Validator cannot see runtime values and a
   singular upload is a silently black object. And a prohibition: **transform fields
   never accept `GlslExpression`** — a spatially-varying transform is DEFORMATION
   (breaks the similarity contract and the SDF distance bound), a different feature
   with different math; Validator-rejected, not deferred.

Explicitly NOT designed now: UBO/texture transform tables (the many-objects pressure
valve — belongs to the batch-codegen batch; pin 2 keeps the door open), per-field
specialized driven tiers (optimization; measure first), time-driven animation (an
App-side extension driving params — no compiler surface), camera rigs (camera params
are already live), large-world fp32 precision (orthogonal; camera-relative rendering
someday if needed).

---

## 7. Validation (all compile-time)

1. `position` finite vec3; `scale` finite and **strictly positive** (§1).
2. `rotation`: normalize if within tolerance of unit, error near zero; axis-angle
   rejects a zero axis.
3. Nonuniform scale: unrepresentable (scalar type); authored vector scale → shape
   diagnostic naming the ellipsoid-as-primitive alternative.
4. Driven transform field on an emitter leaf → error naming the deferred ledger item
   (§6) — enforced at the SceneDescription level, so it binds no matter who produced
   the params (human or graph runtime).
5. Extreme composed scale: `|log₁₀ s| > 2` warns, citing the fixed world-space epsilons
   (`EPSILON = 1e-3` spawn offset vs. an object scaled to size 1e-2 is scene-scale
   hygiene, not bias).
6. `name` collisions allowed (names are provenance, never identity); `flattenGroups`
   disambiguates paths on the authoring side.

---

## 8. Proof regime

**Vitest (structural):**
- Similarity algebra: compose/inverse round-trips, TRS order pin, quaternion
  normalization, axis-angle lowering.
- Per-primitive `foldSimilarity` vs. direct point-mapping (map sample points through
  `g`, check they satisfy the folded primitive's equation).
- Flatten provenance + region-id stability.
- Validator rules (§7).
- glslang static compile of transformed-scene fixtures.
- H6-style invariant: `lightPower` of a uniformly scaled quad light scales by `s²`.

**Byte gate:** the restructuring stage ships with **byte-identical generated GLSL
across all existing fixtures** (none author `transform`, so identity lowering must
reproduce today's output exactly — the transport-split proof style).
*Build record (stage 2):* the gate held with ONE understood deviation class, accepted
as a strict improvement — fixtures authoring an explicit `center: [0,0,0]` used to emit
a no-op `p = p - vec3(0.0, 0.0, 0.0)` (the old fold produced a defined-but-zero
translation); the classifier now elides it as identity. 3 snapshots re-goldened;
their diffs are exactly the removed no-op lines + shifted source-map line numbers.

**GPU witnesses (`tests/witnesses/`):**

| witness | checks |
|---|---|
| **conjugation** | apply one global similarity `g` to everything (objects, lights, camera position/target); equality-gate against the untransformed render. Path tracing `g·scene` from `g·camera` is the same integral — one number tests fold, desugar, CDF, sampler/pdf agreement, and regions at once. |
| **twin-bake** | one object authored via `center` vs. via `transform.position`; twin gate (different GLSL, same image). |
| **cross-backend** | SDF sphere vs. analytic sphere under the same rotated, scaled group; twin gate. |
| **regions-under-transform** | the R-SUBMERGED nesting scene inside a rotated + scaled group: innermost-wins, `s·d` signed distances, interface epsilons under load. |
| **flatten-equivalence** (vitest, no GPU) | `flattenGroups(tree)` leaves match hand-composed similarities + provenance paths + document order; aliased-node duplication semantics. (Stage 3) |
| **light-under-flatten** | cornell-area authored as a tree (emitter inside a transformed group), flattened, vs. the pre-transformed twin: composition → desugar ordering, power CDF, `lighting_pdf` byte-match discipline. (Stage 3) |
| **driven-equals-baked** | a `{param}`-driven rotation pinned at θ, equality-gated against the constant twin at θ; re-check at θ′ after a parameter set (exercises reset-on-change). (Stage 4) |

---

## 9. Staging

1. **Similarity contract** — the TS type + algebra + tests. Pure; no compiler changes.
2. **Constant similarities end-to-end** — flat scenes, per-leaf `transform` with
   rotation + scale now accepted: per-primitive analytic fold replacing
   `resolveAnalyticPositioning`, SDF wrapper tiers, Validator §7, byte gate, witnesses
   (conjugation, twin-bake, cross-backend, regions-under-transform).
3. **`flattenGroups` + provenance** — the pure authoring-layer utility (§4) +
   `ObjectDescription.name` + the flatten-equivalence vitest + the light-under-flatten
   witness. No compiler changes beyond the optional `name` field.
   *BUILT July 16 2026*: `src/authoring/flatten.ts` (the authoring layer's first file —
   Authoring → App → Engine → Compiler → Components is now the full stack); the
   TRS lowering moved beside the algebra as `similarityFromTransform` (Planner's
   `placementOf` is an alias — one lowering, two binding sites); static-composition
   rule enforced with the doc'd errors; `flatten-tree` witness bit-exact
   (0.00%/0.00%) against `transform-bake-ref`, including the lamp-in-a-transformed-
   group chain (composition → desugar → power CDF → sampler).
4. **Driven placement** — per-field `Value<>` on `Transform`, multi-path
   `PlannedUniform` + TRS compute, the §5.2/§5.3 general uniform tiers, the
   no-driven-emitters Validator pin, driven-equals-baked witness.
   *BUILT July 16 2026*: `glsl/core/placement.glsl` (the §6.1 rigid-frame contract);
   `buildDrivenPlacement` in the Planner (fp64 closures, §6.1 guard rails: quat
   renormalize, scale floor from the param's `min`, warn-once); `parameterPaths` on
   `PlannedUniform` (the only plumbing change — engine untouched); driven tiers in
   the intersection generator (SDF rigid wrapper; analytic conjugation arms for
   nearest-hit, any-hit, and `scene_region_at` — regions/media stay coherent through
   the same uniforms); Validator rules incl. the samplable-emitter pin and the
   GlslExpression prohibition. Proof: 698 vitest green (snapshot churn = the new
   `drivenPlacement` decision field only), glslang on the driven programs, and the
   **driven ≡ baked twins at BOTH parameter points** — θ from ValueParam defaults
   and θ′ set through the ParameterStore post-init — each 0.00%/≤0.01% vs the
   constant-authored reference. Sliders move objects live with zero recompiles.
5. **Deferred ledger** (named, not built): the live graph runtime / authoring DSL
   (grows around `flattenGroups`; drives leaf placement params per §4), driven/
   `Value<T>` light geometry (rigid-only constraint documented in §6), mesh backend +
   true instancing via §5.3, reflections, nonuniform scale as an analytic/mesh-only
   extension if ever, curved-space placement groups behind the structure-group
   contract (§1).

Each stage is independently shippable; none mixes refactor with feature. Stage 2
changes zero rendered pixels for zero authored transforms.
