# Transforms, Groups, and Geometry Placement

**Status:** design authority (owner-approved July 15 2026); stages 1–2 in build
**Scope:** object placement for all geometry backends (SDF, analytic, future mesh),
scene-graph groups, and uniform-driven transforms
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

## 3. Scene language: leaves and groups

```ts
type SceneNode = ObjectDescription | GroupNode;   // leaves = today's objects, unchanged

interface GroupNode {
    kind: 'group';
    name?: string;                    // diagnostics/provenance only, never identity
    transform?: TransformDescription;
    children: SceneNode[];
}
```

- Existing flat scenes are already valid trees (all leaves at depth 0) — no fixture churn.
- **Lights join the tree** as children (desugar makes them objects anyway; §5 ordering
  makes this nearly free). **Camera stays out** — it is a pure film→ray map with its own
  live-driven placement (`u_cameraPosition` is already the "driven placement" pattern).
- Strictly a tree in the type. A JS-aliased node appearing twice flattens to two
  independent leaves (two regions, two lights) — legal, documented, *not* instancing.
  Real instancing arrives with meshes and shared BVHs.
- Every `TransformDescription` scalar field is a `Value<>` — constant or `{param}` (§6).

---

## 4. Flattening — a front pass

A compiler front pass (before Analyze) walks the tree and produces the flat scene the
rest of the pipeline already speaks, with per leaf:

```ts
interface PlacedLeaf {
    object: ObjectDescription;      // untouched authored leaf
    factors: TransformFactor[];     // root→leaf chain; each field constant or {param}
    path: string;                   // 'outer/inner/sphere' — diagnostics + provenance
}
```

- **All factors constant** (the common case): fold immediately to one `Similarity`;
  the factor list is discarded.
- **Any factor driven**: keep the chain; constant segments around each driven factor
  still precompose (a driven angle between two constant groups compiles to
  `C₂ · R(θ) · C₁`).
- **Region-id stability pin**: flatten order = document order, so region ids and
  snapshots stay deterministic.

Analyzer/Validator/Planner see flat objects carrying `placement: Similarity | FactorChain`;
the tree never reaches them.

---

## 5. Lowering, per backend

**Ordering pin (load-bearing): flatten → fold → light desugar.** The desugar and the
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

## 6. Driven transforms (the uniform-controlled axis)

- A leaf whose factor chain contains any `{param}` lowers to per-object uniforms —
  `u_object<i>_w2l` (mat4) + `u_object<i>_scale` (float) — consumed by the §5.2/§5.3
  general tiers. GLSL never composes matrices; per-frame CPU cost is a handful of
  quaternion multiplies for the driven subtree only.
- The Planner emits one `PlannedUniform` per driven object with
  `parameters: [every {param} path in the chain]` and a `compute` that evaluates the
  chain (constant segments precomposed at plan time). The engine plumbing already
  supports this shape (`ParameterManager` loops `binding.parameters` and hands the
  whole value map to `compute`); the only extension is multi-path `PlannedUniform` in
  `PipelineBuilder.buildUniforms`. **Engine untouched; boundary intact.**
- ParameterMetadata (sliders, ranges, `triggersReset: true` — moving an object
  invalidates accumulation) comes from the `ValueParam` ranges as everywhere else.
- **Pin: driven transforms exclude emitters in v1** — samplable lights, `sampleAsLight`
  objects, and delta lights. Light geometry is baked as literals into
  `emitSampleCall` / `emitPdfArm` / `lighting_query_delta` / the compile-time power CDF;
  making those uniform-driven is the already-deferred **`Value<T>` light params** item
  on the area-lights ledger. Validator enforces; the diagnostic names the deferred item.
- When that later batch lands, it must carry this constraint: **driven light transforms
  must be rigid** (translation + rotation only). Power is area-dependent; a driven
  scale would silently stale the baked power CDF — the one place a driven similarity
  can create bias rather than mere wrong geometry.

---

## 7. Validation (all compile-time)

1. `position` finite vec3; `scale` finite and **strictly positive** (§1).
2. `rotation`: normalize if within tolerance of unit, error near zero; axis-angle
   rejects a zero axis.
3. Nonuniform scale: unrepresentable (scalar type); authored vector scale → shape
   diagnostic naming the ellipsoid-as-primitive alternative.
4. Driven factor above an emitter → error naming the deferred ledger item (§6).
5. Extreme composed scale: `|log₁₀ s| > 2` warns, citing the fixed world-space epsilons
   (`EPSILON = 1e-3` spawn offset vs. an object scaled to size 1e-2 is scene-scale
   hygiene, not bias).
6. Group `name` collisions allowed (names are provenance); flatten disambiguates paths.

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
| **light-under-group** | cornell-area with the emitter inside a transformed group vs. the pre-transformed twin: desugar ordering, power CDF, `lighting_pdf` byte-match discipline. (Stage 3) |
| **driven-equals-baked** | a `{param}`-driven rotation pinned at θ, equality-gated against the constant twin at θ; re-check at θ′ after a parameter set (exercises reset-on-change). (Stage 4) |

---

## 9. Staging

1. **Similarity contract** — the TS type + algebra + tests. Pure; no compiler changes.
2. **Constant similarities end-to-end** — flat scenes, per-leaf `transform` with
   rotation + scale now accepted: per-primitive analytic fold replacing
   `resolveAnalyticPositioning`, SDF wrapper tiers, Validator §7, byte gate, witnesses
   (conjugation, twin-bake, cross-backend, regions-under-transform).
3. **Groups** — `SceneNode` tree + flatten front pass + provenance paths +
   light-under-group witness.
4. **Driven transforms** — multi-path `PlannedUniform`, factor-chain compute,
   per-object uniform tier, no-driven-emitters pin, driven-equals-baked witness.
5. **Deferred ledger** (named, not built): driven/`Value<T>` light geometry (rigid-only
   constraint documented in §6), mesh backend + true instancing via §5.3, reflections,
   nonuniform scale as an analytic/mesh-only extension if ever, curved-space placement
   groups behind the structure-group contract (§1).

Each stage is independently shippable; none mixes refactor with feature. Stage 2
changes zero rendered pixels for zero authored transforms.
