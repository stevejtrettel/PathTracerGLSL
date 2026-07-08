# Compiler GLSL Contracts

**Status:** Design contract — governs all future compiler work. The current vertical slice does *not* yet conform; §10 lists the migration gaps.
**Date:** July 2026
**Companion:** [compiler-engine-contract.md](compiler-engine-contract.md) governs the compiler↔engine boundary (CompiledRenderer, RenderPipeline). This document governs the boundaries *inside* the generated GLSL: the interfaces between geometry, materials, media, lights, and transport.
**Verification:** §2.7, §3.6, §4.4, and the §7.2 accounting pins were revised/added by adversarial walkthrough — traces and findings in [fable-transport-verification.md](fable-transport-verification.md).

---

## 0. Purpose and design rationale

This project's own history (four architectural eras in `docs/archive/`) shows a clear asymmetry: **GLSL-level contracts aged well across every rewrite; TypeScript-side orchestration churned every time.** The things that survived from era to era were function signatures and struct shapes — `LightSample`, epsilon interface resolution, batched material queries, `Value<T>`. The things that died were module descriptors, compilation orderings, and orchestrator structures.

This document therefore pins the GLSL contracts as the durable layer. The TypeScript side (Analyzer, Planner, Generator, feature contributions) is expected to evolve freely *around* these contracts. A contract here is a promise between generated/library GLSL blocks — the Planner may specialize, inline, or dead-code-eliminate anything, but the *semantics* of these interfaces hold.

Everything marked **PINNED** is decided. Everything marked **OPEN** is deliberately deferred, with the constraint that nothing pinned may foreclose it.

---

## 1. Target feature set and non-goals

The contracts below are designed to survive this feature set (priority order):

1. **Volumetric media** — absorption, scattering, emissive media; homogeneous first, heterogeneous (procedural density) designed-for.
2. **Swappable material models** — Lambert, GGX/conductor, dielectric, and arbitrary future BSDFs as plugins; multiple models per scene.
3. **Swappable transport models** — unidirectional PT with `none | NEE | MIS` direct lighting; volume integrators `raymarch | delta-tracking | ratio-tracking`; future single- and multi-pass integrators.
4. **Complex multi-material objects** — multi-region objects (shared expensive base SDFs + cheap region predicates), nested media, shared materials across regions.
5. **Difficult lighting** — area lights, emissive geometry, HDRI environments, MIS throughout.
6. **Spectral readiness** — RGB now; hero-wavelength spectral rendering later as a strategy axis (§8). Required eventually for dispersion and gravitational redshift.
7. **Curved-space readiness** — Euclidean/H³/S³ near-term; black-hole spacetimes, Nil, wormhole metrics long-term. Contracts must not assume closed-form geodesics (§5).
8. **Scale** — unrolled specialization for research scenes (dozens of objects); homogeneous batches for hundreds+ of same-primitive objects (sphere clouds).

**Explicit non-goals for this tracer** (reserved for a future WebGPU tracer): photon mapping, BDPT-style light-path storage, reservoir-heavy ReSTIR, mesh/BVH geometry (the `mesh` object kind exists in types but no contract work here depends on it).

### 1.1 v1 Constraints — deferred features, NOT exclusions

The following five constraints define the v1 implementation scope. **They are scheduling decisions, not architecture decisions.** Each is enforced as a *Validator rejection with a clear error message*, each names its relaxation path, and — the invariant that makes this safe — **none of them changes any contract in §§2–7**. Lifting a constraint means deleting a Validator check and writing an implementation against the already-pinned signatures; it never means retrofitting a contract. If future work on any of these ever appears to require a contract change, that is a design bug in this document and must be resolved *before* v1 code bakes the conflict in.

**V1-C1. Media are homogeneous** (constant `sigma_s`/`sigma_a`/phase params per medium; procedural density rejected).
*Simplifies:* distance sampling is closed-form (`t = −ln ξ / σ_t` — no delta tracking, no rejection loops), transmittance is analytic Beer–Lambert *per segment* (no stochastic transmittance estimation; shadow rays still find their segments via boundary intersections — a few intersections, not a marching loop, per verification F4), the volume-integrator axis collapses to one exact implementation, and the majorant requirement (§3.5) is trivially satisfied (`majorant = σ_t`).
*Not ruled out because:* `scene_medium_properties(int mat, vec3 p)` keeps its `p` parameter unused-but-present, `MediumProperties` keeps its shape, and the `volumeIntegrator` strategy axis (§7.3) keeps its `delta-tracking`/`ratio-tracking` values as rejected-not-removed options.
*Relaxation:* implement majorant declaration/validation (§3.5) + a delta-tracking loop generator. Contracts untouched.

**V1-C2. Samplable lights are analytic only** (point, quad, sphere, environment). Emissive materials on SDF geometry are always path-only (`sampleAsLight: true` on a non-analytic shape is a Validator error).
*Simplifies:* defers the three-way material/scene/lighting coordination problem (sampling emissive geometry requires the light system to query scene shape data — the archive's unsolved open question #10). Emissive fractals still glow; they converge slower (BSDF-found only, MIS weight 1).
*Not ruled out because:* the registry (§6.2) already models path-only vs samplable per light; the flag exists and the transport logic is identical either way.
*Relaxation:* per-shape samplers that read compiled geometry data; flip the Validator check per supported shape.

**V1-C3. Intersection is SDF-marching only** (no analytic intersection fast paths, no mixed kernels).
*Simplifies:* one Hit-production path, one classification mechanism; deletes the mixed-kernel coordination problem (nearest-hit merging across marching/analytic/BVH backends).
*Not ruled out because:* `scene_intersect` is a contract, not an implementation — analytic fast paths per object type are a later *optimization inside* the generated function, invisible to every caller.
*Relaxation:* Planner marks analytically-intersectable objects; Generator emits closed-form tests merged with the march. Contracts untouched.

**V1-C4. No image textures in materials; procedural properties only.** (HDRI *environments* excepted — that machinery exists.)
*Simplifies:* no UV-mapping strategy for SDFs, no atlasing, no sampler-unit budgeting inside the material system (WebGL2 texture units are scarce and already contended — see the engine review).
*Not ruled out because:* material properties already admit multiple value kinds (`constant | {param} | GLSL expression`); a `{texture: ...}` kind is an additive variant, and `Hit.uv` already exists in the contract for its benefit.
*Relaxation:* add the texture value kind + a triplanar/UV policy per object; texture units allocated through the same external-texture mechanism as environments.

**V1-C5. Partially-overlapping separate solid objects draw a Validator warning** (revised by verification T2). **Full containment is allowed and correct**: a glass sphere submerged in a water pool classifies properly under innermost-wins (§2.7) with no extra machinery — rejecting it would have made a fish tank unbuildable. What gets warned is *partial* overlap (bounds intersect, neither contains the other): inside the lens-shaped intersection, classification is deterministic but physically arbitrary. Multi-region objects (§4.6) remain the sanctioned way to make materials *touch* — exact shared boundaries via common `bases`.
*Simplifies:* defers dielectric priority systems honestly; keeps classification ambiguity a flagged authoring choice instead of a silent guess.
*Not ruled out because:* §2.7 innermost-wins remains the pinned semantics for whatever the Validator lets through; warned scenes still render deterministically.
*Relaxation:* implement a priority system (§10.2) for intentional partial overlaps; the warning then points at the priority field instead.

**Also staged (not constraints, just ordering):** direct lighting ships NEE-first, MIS second — the flags and pdf functions in Contracts 1/4 sit unused until MIS lands, costing nothing. Homogeneous batches (§4.7) ship with uniform-array storage first; the float-texture path arrives when someone exceeds uniform limits.

---

## 2. Pinned global conventions

Each pin states what it resolves. Several resolve documented contradictions between archive eras.

### 2.1 Sample-returns-weight — PINNED

Direction samplers return the full path-throughput factor, not `(direction, pdf)` for the caller to divide:

```glsl
throughput *= sample.weight;   // NOT: throughput *= eval(...) / pdf;
```

For surface samples, `weight = f · |cos θᵢ| / pdf`, computed *inside* the sampler where cancellations are exact (Lambert: `weight = albedo`, precisely). For delta lobes (mirror, smooth dielectric), `weight` is the Fresnel-weighted reflectance/transmittance and `pdf = 0.0` with the `LOBE_DELTA` flag set — the `f/pdf` form is 0/0 for these and cannot express them. This single convention is what makes specular materials possible.

### 2.2 Cosine placement — PINNED

`*_eval()` returns **bare f** (BSDF value, no cosine). Transport multiplies `|cos θᵢ|` at *surface* vertices only.

Rationale: phase functions have no cosine factor — the cosine is the surface-area-measure Jacobian, a property of surfaces, not of scattering. Baking it into eval breaks the surface/medium symmetry that Contract 1 depends on. (Resolves the archive's three-way drift: the env-sampling doc and Lambert reference baked cos into shade; the transport contract multiplied it separately.)

Corollary: `sample.weight` *does* include the cosine for surface samples (it's a throughput factor, per §2.1); `eval` does not (it's a density for MIS).

### 2.3 Region identity is primary — PINNED

Every geometric region gets a globally unique compile-time `region_id` (a simple sphere is one region; a snow globe contributes several). Materials are **derived**, never stored ambiguously:

```glsl
int   material_of(int region_id);   // generated constant table; O(1)
int   light_of   (int region_id);   // §6.2 — samplable-light identity, -1 otherwise
float ior_of     (int region_id);   // §3 helper — region's IOR; ior_of(-1) = ambient's or 1.0
                                    // (added by reference-implementation pass: dielectrics need the
                                    //  far side's IOR without a full material-properties fetch)
```

Regions may freely share materials (two glass objects, two smoke clouds). Region disambiguation via material ID — the archive's Solution A shortcut — is forbidden; it was already flagged as broken for shared materials (`sdf-compilation.md` §8.2). Sentinel: `region_id == -1` is the exterior/ambient region.

The old purity principle "no object IDs in Hit" is hereby revised: **region identity is not an abstraction leak; it is physical state.** The medium a path is inside is real, and transport must track it. What remains forbidden is *object* identity for shading decisions — shading sees only materials.

### 2.4 Ambient medium — PINNED

No reserved material IDs (resolves the archive's `MATERIAL_AIR = 0` vs `= -1` vs no-reserved conflict). The scene optionally declares:

```typescript
scene.ambientMedium?: string   // material name; absent = vacuum
```

`material_of(-1)` returns that material's ID, or `-1` for vacuum. The ambient region is what `current_medium` (§4.4) refers to when the path is inside no object. A foggy world is just `ambientMedium: 'fog'`.

### 2.5 Spectral discipline — PINNED

`Spectrum` and `Radiance` are **opaque typedefs** (currently `vec3`). Library and template GLSL must:

- never construct radiometric values with raw `vec3(...)` literals — scene constants are emitted by the Generator through a Planner-controlled formatter (RGB mode: `vec3(r,g,b)`; spectral mode: upsampling-coefficient evaluation);
- perform reductions only through named helpers: `spectrum_average(s)`, `spectrum_max(s)`, `spectrum_is_black(s)` (replaces ad-hoc `luminance()` for throughput decisions);
- never mix Spectrum values with geometric `vec3`s.

Component-wise `* + - /` on Spectrum values remains legal (identical in both modes). Under this discipline, spectral rendering later is a strategy axis touching only the constant formatter, the film/display blocks, and transport's λ state (§8) — not a codebase audit.

### 2.6 `scene_sdf` returns a conservative safe-step bound — PINNED

The scene distance function's contract is: *"you may advance the ray by this amount without crossing a surface"* — not "this is the exact distance." True for exact SDFs in Euclidean space; also the only definition that survives fractals with Lipschitz correction, deformed/non-exact SDFs, and curved spaces (where "distance along a geodesic" and "SDF value in coordinates" diverge). Marchers must not assume exactness.

### 2.7 Containment semantics: innermost-inside wins — PINNED (revised by verification)

Point classification (`scene_region_at`, §4.2) resolves points contained by multiple solids in favor of the **innermost** region: among regions with `sdf(p) < 0`, the **least negative** wins. Within a single multi-region object, region predicates resolve in declaration order (first match wins), as in the archive design.

This *replaces* an earlier deepest-wins (most-negative) pin, which verification trace T2 ([fable-transport-verification.md](fable-transport-verification.md)) proved wrong for the common case: a glass sphere submerged in a pool classifies as *water inside the sphere* under deepest-wins (the huge pool's SDF is more negative everywhere), yielding η = 1 (no refraction) and wrong absorption lengths. Innermost-wins is provably correct for strict nesting at any depth: for A ⊂ B and p ∈ A, every path from p to ∂B crosses ∂A first, so `dist(p,∂A) ≤ dist(p,∂B)` — the inner SDF is always less negative. For *partial* overlap (lens-shaped intersections, neither region containing the other) innermost-wins is deterministic but physically arbitrary — the Validator warns (§1.1 V1-C5) and a future priority system is the real answer (§10.2).

### 2.8 `Value<T>` for uniform-drivable properties — PINNED (carried forward)

```typescript
type Value<T> = T | { param: string; default?: T; min?: number; max?: number }
```

Any numeric property anywhere in the scene/strategy (material fields, light intensity, SDF parameters, medium coefficients) may be a constant *or* a parameter reference. The compiler scans for `{param}` references, generates uniforms named from the **parameter path** (`glass.roughness` → `u_glass_roughness`, so multiple materials can share a driven parameter), and emits `UniformBinding[]` + `ParameterMetadata`. Constants are baked; no mode flags. This is the archive's most-settled pattern, adopted verbatim, and it supersedes the current slice's constant-only baking.

### 2.9 Explicit sample inputs — PINNED

Samplers take their primary random numbers as explicit arguments (`vec2 xi`), matching the archive optics contract. Models needing additional dimensions may draw from the global RNG stream, documented per model. This keeps the door open for stratification/QMC control at the transport level without forcing it now.

---

## 3. Contract 1 — Interaction (surface and medium unified)

The path tracer's central abstraction is the **scattering event**, with exactly two implementations: surface (BSDF) and medium (phase function). Both produce the same sample type.

### 3.1 The sample struct

```glsl
// Lobe / event flags
const uint LOBE_REFLECTION   = 1u;
const uint LOBE_TRANSMISSION = 2u;   // wi on the far side of the surface
const uint LOBE_DELTA        = 4u;   // pdf is a Dirac delta; pdf field is 0
const uint LOBE_MEDIUM       = 8u;   // phase-function event (no surface)
const uint LOBE_NULL         = 16u;  // null interface: passthrough, no optical event (§3.6)

struct InteractionSample {
    Direction wi;        // sampled direction, world space
    Spectrum  weight;    // full throughput factor: f·|cosθᵢ|/pdf (surface), phase/pdf (medium)
    float     pdf;       // solid-angle pdf; 0.0 for delta lobes
    uint      flags;
};
```

`weight` is what transport multiplies into throughput (§2.1). `pdf` and the eval/pdf functions exist for MIS (§6.4); they describe only the *non-delta* part of the material.

### 3.2 Surface interface (per material model)

Each material model is a GLSL library file providing four functions (names prefixed by model):

```glsl
Spectrum          <model>_eval    (Direction wi, Direction wo, Hit hit, MaterialProperties mp); // bare f (§2.2); 0 for pure-delta models
InteractionSample <model>_sample  (Direction wo, Hit hit, MaterialProperties mp, vec2 xi);
float             <model>_pdf     (Direction wi, Direction wo, Hit hit, MaterialProperties mp); // solid-angle; excludes delta lobes
Spectrum          <model>_emission(Direction wo, Hit hit, MaterialProperties mp);               // emitted radiance toward wo
```

**Direction conventions:** `wo` points *away* from the surface toward the previous path vertex (`wo = -ray.direction`); `wi` is the next direction. Both world-space; `hit.frame` provides the local frame. **Transmission is legal:** `dot(wi, n) < 0` with `LOBE_TRANSMISSION` set. The current slice's `max(0, dot)` clamp convention is retired — evaluators use `abs()` or side-aware logic per model. Models must handle being hit from either side (the geometric normal orients toward `region_from`; models flip into their own canonical frame as needed).

### 3.3 Generated dispatch

The compiler emits one dispatcher per operation, switching on material ID over **only the models present in the scene** (Option B from [compiler-next-architecture.md](compiler-next-architecture.md) §4):

```glsl
// Generated — scene has lambert (mats 0,2) and dielectric (mat 1)
InteractionSample interaction_surface_sample(int mat, Direction wo, Hit hit, MaterialProperties mp, vec2 xi) {
    if (mat == 1) return dielectric_sample(wo, hit, mp, xi);
    return lambert_sample(wo, hit, mp, xi);
}
// ...likewise interaction_surface_eval / _pdf / _emission
```

No Disney code in the shader if no material uses Disney. A material model plugin is therefore: **one GLSL file + one TS descriptor** declaring (a) which `MaterialProperties` fields it reads, (b) which parameters/uniforms it can contribute, (c) capability flags (has delta lobes, has transmission, is emissive-capable). That descriptor is the entire extension surface for new BSDFs.

### 3.4 `MaterialProperties` is generated per scene — PINNED

The archive tried three times to stabilize a universal `MaterialProperties` struct (fields drifted: `light_id`, `sigma_*`, `flags` in and out). We end the churn structurally: **the struct is emitted by the Generator as the union of fields declared by the material models actually present**. A Lambert-only scene gets `{albedo, emission}`; adding one dielectric object adds `{ior, transmittance}` for that scene only. (Note: unlike the archive design, `light_id` is *not* a material field — light identity is geometric and lives on regions via `light_of(region_id)`, §6.2. Two objects sharing one emissive material are two distinct lights.) The property-resolution machinery (constants baked, `Value<T>` → uniforms, procedural GLSL expressions inlined into `scene_material_properties(int mat, vec3 p)`) is unchanged from the current design.

### 3.5 Medium interface

Mirrors the surface interface; media are "materials of the interior":

```glsl
struct MediumProperties {   // generated per scene, like MaterialProperties
    Spectrum sigma_s;       // scattering coefficient
    Spectrum sigma_a;       // absorption coefficient
    Spectrum emission;      // volumetric emission (0 usually)
    float    phase_g;       // + fields declared by phase models present
};
MediumProperties scene_medium_properties(int mat, vec3 p);   // heterogeneous media vary with p

Spectrum          <phase>_eval  (Direction wi, Direction wo, MediumProperties mp);  // integrates to 1 over sphere
InteractionSample <phase>_sample(Direction wo, MediumProperties mp, vec2 xi);        // flags include LOBE_MEDIUM
float             <phase>_pdf   (Direction wi, Direction wo, MediumProperties mp);
```

A material is *volumetric* iff its declared medium block has nonzero `sigma_s` or `sigma_a` (classification inferred from properties, per the archive's settled principle). Whether a region is a medium is compile-time knowledge — the Planner uses it to decide which per-region functions to generate (§4.5) and whether transport needs a volume integrator at all.

### 3.6 Null interfaces — PINNED (added by verification)

A material may declare **`surface: none`** — it has a medium block but its boundary is not an optical interface (a bounded fog cube, a smoke plume region). Verification trace T5 found that without this, every bounded volume would receive a spurious BSDF shell (fog with a Fresnel coating). The compiler classifies such regions' boundaries as **null interfaces**; transport handles a null hit as:

- `current_medium = hit.region_to` (§4.4), continue in the *same direction* (conceptually a sample with `wi` unchanged, `weight = 1`, flags `LOBE_TRANSMISSION | LOBE_DELTA | LOBE_NULL`);
- **no** NEE, **no** emission logic, **no** bounce consumed — null crossings have their own `MAX_NULL_CROSSINGS` safety counter (they are bookkeeping, not scattering).

This is the standard "interface material" concept (PBRT's null BSDF). A material with *both* a surface model and a medium block (tinted glass) is not null — its boundary runs the surface BSDF and its interior absorbs/scatters.

**Majorants — PINNED (required by the delta-tracking axis).** Every medium carries a scalar `majorant`: an upper bound on `spectrum_max(sigma_s + sigma_a)` over the medium's region. Null-collision volume integrators (delta/ratio tracking) are impossible without it. Provisioning rule: for constant coefficients the compiler derives it (`majorant = σ_t` exactly — trivially satisfied under V1-C1); for `Value<T>`-driven coefficients it derives the bound from the declared parameter `max`; for *procedural* density the bound is not computable from arbitrary GLSL, so the scene author must declare `majorant` explicitly and the Validator rejects procedural media without one. A declared majorant that is violated at runtime produces bias, not a crash — the §11 harness is the guard.

---

## 4. Contract 2 — Hit, regions, and media tracking

### 4.1 The Hit struct

```glsl
struct Hit {
    float t;
    Point p;
    Frame frame;        // shading frame at p; n oriented toward region_from side;
                        // in curved space, built from parallel-transported tangents (§5)
    int   region_from;  // region on the incoming side (-1 = ambient)
    int   region_to;    // region on the far side
    vec2  uv;
};
```

Materials never appear in Hit — always derived via `material_of()` (§2.3). Note the payoff at internal interfaces: a glass→water boundary is **one hit that knows both sides** (`region_from = glass`, `region_to = water`), so the correct IOR ratio `ior(material_of(to)) / ior(material_of(from))` is available directly — no exit-then-reenter double event.

**Which material shades the surface — PINNED: the boundary owner's.** The *surface* material (whose BSDF runs) is `material_of(owner)` where `owner` is the region whose distance function produced the hit — information the marcher has for free (§4.3). It is **not** always `material_of(region_to)`: at a dielectric *exit* (glass→ambient), `region_to = -1` and shading with the ambient's material would be wrong — the exit boundary is still the glass interface, same BSDF with η inverted. `region_from`/`region_to` supply the two *media* for the IOR ratio; `owner` supplies the *surface*. (At a shared boundary between two regions of one multi-region object, owner ambiguity is harmless: the dielectric interface BSDF is parameterized by both sides.)

### 4.2 Point classification and interface resolution

One generated, generic scene-level routine (archive-settled mechanism, adopted):

```glsl
int scene_region_at(vec3 p);   // innermost-inside-wins across objects (§2.7);
                               // predicate order within multi-region objects; -1 if in no region
```

Interface resolution at a hit is epsilon classification along the ray:

```glsl
hit.region_from = scene_region_at(p - EPS_INTERFACE * ray.direction);
hit.region_to   = scene_region_at(p + EPS_INTERFACE * ray.direction);
```

`EPS_INTERFACE` defaults to `1e-4`, overridable per object for thin shells (archive guidance adopted). Classification runs **once per hit**, never per march step — marching uses only the cheap step-bound function.

### 4.3 What the marcher reports

The march loop tracks which object's bound was active at the hit (free — it's the arg-min of the step computation) and uses it as a *hint* to shortcut classification: single-region objects resolve `region_to` immediately; only multi-region objects and overlap cases pay for full `scene_region_at`. This resolves the archive's "marching kernel challenge" (classification cost) without putting region logic in the march loop.

### 4.4 Medium tracking — PINNED: a single variable, ground-truthed by the scene (revised by verification)

An earlier draft pinned an explicit medium *stack* (push/pop at transmission events). Verification trace T3 ([fable-transport-verification.md](fable-transport-verification.md)) showed the stack is the wrong tool here: stacks exist in **mesh**-based renderers because meshes are boundaries-only and nesting must be reconstructed from traversal history — a history that a single missed boundary event corrupts for the rest of the path. **SDF scenes have a containment oracle** (`scene_region_at`), so history is unnecessary:

```glsl
int current_medium;   // region id of the medium the path is traveling in; -1 = ambient
```

Rules:

- at every `LOBE_TRANSMISSION` event: `current_medium = hit.region_to`;
- at every `LOBE_NULL` crossing (§3.6): `current_medium = hit.region_to`;
- at reflection/TIR events: unchanged;
- **self-healing invariant (free):** epsilon classification at each hit already computes `hit.region_from`, which must equal `current_medium`. On mismatch (a boundary event missed by the marcher — thin-shell tunneling), resync `current_medium = hit.region_from` and increment a debug counter (§11.4). A missed event thus mistracks exactly one segment and repairs at the next hit, instead of corrupting the remainder of the path.

Medium properties for the current segment come from `medium_of(current_medium)` (via `material_of`). Absorption (Beer–Lambert via `sigma_a`) applies along every segment whose current medium is non-vacuum — this is how tinted glass works even with zero scattering.

Nested dielectrics need no history either: the η ratio at any interface comes from `region_from`/`region_to` of *that hit*, both supplied by classification (with innermost-wins, §2.7, handling submerged nesting correctly).

**Future note — meshes also define regions (no stack, ever):** when mesh geometry arrives, a mesh that bounds a medium or dielectric interior must be **watertight** (Validator-enforced) and supplies a containment query — BVH ray-parity test (one ray cast per query; fine at per-hit frequency) or a baked SDF proxy (which also provides the march step bound). The region model then stays universal: `scene_region_at` remains total over mesh regions, `current_medium` and the self-healing invariant work unchanged, and history tracking never returns. Open/non-watertight meshes simply may not bound media. **OPEN:** dielectric priority systems (à la Schlick) for physically-intentional partial overlaps (§2.7, §10.2).

### 4.5 Per-region generated queries

For each region the Planner marks as *interesting to transport* (volumetric media, dielectric interiors), the Generator emits specialized, inline-able functions — **no dispatch inside stepping loops** (the archive's key volumetric performance insight, kept):

```glsl
bool  region_<N>_contains(vec3 p);
float region_<N>_boundary(vec3 p);   // conservative step bound to this region's boundary (signed: <0 inside)
```

This is the synthesis of the archive's two volumetric solutions: Solution A's identity model (region IDs in Hit + transport-driven walk) with its shared-material hole fixed by §2.3, plus Solution B's codegen strategy (specialized per-region functions). Volume integrators are generated *referencing region functions by name* — `region_3_contains(p)` compiles to a direct inlined SDF evaluation.

### 4.6 Multi-region objects — adopted from archive

The archive's multi-region design (`SCENE/multi-material.md`) is adopted as an `ObjectDescription` variant:

```typescript
{
  kind: 'multi_region',
  bases:   Record<string, SDFExpr>,          // expensive fields, evaluated once per step
  regions: Array<{ name; condition: string;  // cheap predicate over $base values and p
                   material: string }>,       // predicate order = priority (§2.7)
}
```

The Generator emits: one distance function evaluating bases once and min-ing region SDFs, a classifier for `scene_region_at`, and per-region functions per §4.5. Each region gets its own global `region_id`; the region→material table handles sharing.

### 4.7 Homogeneous batches — the hundreds-of-spheres path

When N same-type primitives share one material (sphere clouds, scattered instances), the Planner may select **batch codegen** instead of unrolling:

```glsl
uniform vec4 u_batch0_data[256];               // sphere: xyz = center, w = radius
float batch0_sdf(vec3 p) {                     // looped min over the array
    float d = 1e20;
    for (int i = 0; i < BATCH0_COUNT; i++)
        d = min(d, length(p - u_batch0_data[i].xyz) - u_batch0_data[i].w);
    return d;
}
```

Pins: a batch is **one region** (one `region_id`, one material) — per-instance identity is not tracked, which is also physically right: a 500-sphere cloud sharing one medium *is* one medium, and `region_N_contains` = inside-any-instance. Data lives in uniform arrays (float textures beyond uniform limits, ~1k instances). Side benefit: batch data is uniform-driven, so instance positions can animate without recompiling.

**The contract point:** `scene_sdf`/`scene_region_at` signatures are identical whether the Planner unrolled, batched, or mixed. Dispatch strategy is a Planner decision (guideline: unroll ≤ ~24 heterogeneous objects; batch homogeneous groups above that), not a contract change.

---

## 5. Contract 3 — Geodesic stepper

### 5.1 The interface

Ray advancement is written against a **stepper**, not a closed-form point query:

```glsl
struct GeodesicState { Point p; Direction v; };
// (future spacetimes may add generated fields: conserved quantities, affine parameter)

void      geodesic_step     (inout GeodesicState s, float dt);            // advance along the geodesic
float     geodesic_max_step (GeodesicState s);                            // curvature-limited safe dt (Euclidean: 1e20)
Direction geodesic_transport(GeodesicState s_from, GeodesicState s_to, Direction u);  // parallel transport
```

The march loop becomes:

```glsl
float dt = min(scene_sdf(s.p), geodesic_max_step(s));
geodesic_step(s, dt);
```

The current `ambient_geodesic(origin, dir, t)` point form works only for spaces with closed-form geodesics (Euclidean, H³, S³) and is **structurally impossible** for Schwarzschild/wormhole metrics, where geodesics exist only as ODE solutions. Writing the loop against the stepper means generalizing later is *one new GLSL file* (an RK4 step in the metric), not a loop rewrite.

### 5.2 Zero cost today

For Euclidean, `geodesic_step` is `s.p += s.v * dt` and `geodesic_transport` is identity — the compiler inlines these and the loop collapses to exactly the current code. For H³/S³ the compiler may specialize back to closed-form point evaluation as an optimization. Paying for generality only when the scene needs it is precisely this compiler's philosophy.

### 5.3 What curved space needs from the *other* contracts (readiness check)

- `Point`/`Direction` are typedefs and may become `vec4` per space (archive ambient contract, kept).
- `Hit.frame` is built per-hit from transported tangents — no contract assumes a globally consistent frame. ✓
- `scene_sdf` as safe-step bound (§2.6) is the only distance semantics that survives coordinates-vs-metric divergence. ✓
- NEE/MIS in general spacetimes is analytically hopeless — and that's fine **because direct lighting is a strategy axis**: curved scenes select BSDF-sampling + emissive/environment strategies. No contract hardwires NEE. ✓
- Gravitational redshift requires spectral transport (§8).
- **OPEN:** what an "SDF" means in strongly curved coordinates (Lipschitz bounds under the metric); camera ray generation as geodesic initial conditions; step-size control near horizons.

---

## 6. Contract 4 — Lights and direct lighting

### 6.1 LightSample

```glsl
const uint LIGHT_DELTA = 1u;   // point/directional: not hittable by BSDF rays, excluded from BSDF-side MIS

struct LightSample {
    Direction wi;         // toward the light, world space (unit)
    float     distance;   // to the sampled point (1e20 for environment/directional)
    Spectrum  radiance;   // incident radiance from the sample, *without* visibility
    float     pdf;        // total pdf: selection × per-light, in SOLID ANGLE measure
    uint      flags;
    int       light_id;
};

LightSample lighting_sample(Point p, vec2 xi);   // generated: selection + per-kind sampling

// MIS pdf query: the density with which lighting_sample(p, ·) would have produced
// direction wi *toward the specific light that was hit*. Transport already knows the
// light (mp.light_id at the emitter hit) and the hit geometry — passing them avoids
// re-intersecting every light to discover which one wi reaches.
float lighting_pdf(Point p, Direction wi, int light_id, Hit light_hit);
// = selection_pdf(light_id) × per-light solid-angle pdf from the hit geometry
```

**Measure conventions (adopted from the archive's verified MULTI_LIGHT_SAMPLING work):** area lights convert to solid-angle pdf (`pdf_A · d²/cosθ_light`), radiance carries no distance falloff; delta lights set `LIGHT_DELTA`, fold falloff (`intensity/d²`) into `radiance`, and carry only the selection probability in `pdf`. Light selection uses a compile-time power-weighted CDF. The `lighting_get_light(id)` accessor abstraction (samplers agnostic to const-vs-uniform storage) is carried forward for `Value<T>`-driven light parameters.

### 6.2 The unified light registry — adopted from archive

Lights = explicit lights ∪ emissive materials. Each is **samplable** or **path-only**:

- Emissive materials opt in via `sampleAsLight: true` (default `true` for analytic emitter shapes the compiler can sample — quads, spheres, points; default `false` for emissive custom/fractal SDFs, which remain path-only and are found by BSDF rays).
- **Light identity lives on regions, not materials** — a generated table parallel to `material_of()`:

```glsl
int light_of(int region_id);   // -1 = not a samplable light (path-only emitters, non-emitters)
```

Rationale: two objects sharing one emissive material (two ceiling panels using `'glow'`) are two distinct samplable lights with different geometry and pdfs; a material-borne ID cannot distinguish them, and `lighting_pdf` becomes ambiguous → wrong MIS weights. Materials carry the *radiometric* fact (emission); regions carry the *identity* fact. (Deliberate deviation from the archive design, which predates region-primary identity. The rescue for material-keying — auto-duplicating shared emissive materials per object — is the archive's rejected Option C.)

Two rules that make region-keying complete:

- **Explicit area lights desugar to regions.** An explicit `quad`/`sphere` light in `scene.lights` must be visible in renders and reflections, i.e. hittable — the compiler synthesizes an emissive region for it (plus its samplable registry entry). Explicit `point`/`directional` lights are delta: no geometry, never hit by BSDF rays, no hit-time identity needed. Invariant: *every hittable light is a region; every non-region light is delta.* (The environment is reached on miss, not hit, and has its own `environment_pdf` path — it never consults `light_of`.)
- **Side convention: emission and light identity key on `region_to`** — you receive emission from the region the ray is about to enter. This is correct for the universal case (opaque emitter hit from outside), one-sided at exits (leaving an emissive region contributes nothing from behind), and naturally two-sided for thin synthesized quad emitters (no interior, so `region_to` is the quad from either side). Transmissive emitters seen from inside: OPEN (§10.2).
- Batch regions (§4.7) that are emissive+samplable form **one composite light entry** (two-level sampling: pick instance from the batch data, then point on instance) — the standard many-lights granularity, not one entry per instance.

- The hit-time emission decision — needed by plain NEE for double-counting bookkeeping, not just by MIS:

```glsl
Spectrum Le = interaction_surface_emission(mat, wo, hit, mp);
if (!spectrum_is_black(Le)) {
    int lid = light_of(hit.region_to);
    float w;
    if (lid < 0 || prev_bounce_was_delta || bounce == 0) w = 1.0;  // path-only, or NEE couldn't compete
    else if (MIS_ENABLED) w = power_heuristic(prev_bsdf_pdf,
                              lighting_pdf(prev_p, ray.direction, lid, hit));
    else w = 0.0;                                                  // NEE-only: already counted at prev vertex
    radiance += throughput * w * Le;
}
```

The **environment** is a light kind in this registry (samplable via the existing HDRI CDF machinery from the archive/reference implementation; `environment_radiance(dir)` / `environment_sample` / `environment_pdf`). The hardcoded sky in the current `path_trace.glsl` is retired: environments are scene data.

### 6.3 The shadow query returns transmittance — PINNED

```glsl
Spectrum shadow_transmittance(Point p, Direction wi, float dist);
// 0 or 1 when scene has no media/dielectrics along shadow rays — compiler emits the boolean
// fast path (current scene_intersect_any) in that case, spectral attenuation otherwise.
```

A boolean visibility contract cannot express shadows through fog or tinted glass. Making the *contract* spectral and letting the compiler specialize to the cheap boolean version when features are absent gives correctness and speed without a contract change later. (Policy for shadow rays through refractive interfaces: opaque by default — the standard compromise — with transmittance-through-media handled; **OPEN:** transparent-shadow refinements.)

### 6.4 MIS

Power heuristic (β=2), matching the archive's environment-sampling implementation. NEE side: `weight = power_heuristic(light.pdf, interaction_surface_pdf(...))` for non-delta lights, `1` for delta lights. BSDF side: as in §6.2; samples flagged `LOBE_DELTA` skip MIS weighting (weight 1 on emitter hit, since NEE cannot compete through a delta lobe).

---

## 7. Contract 5 — Transport models as generators

### 7.1 A transport model contributes, it isn't configured

Each transport model is a TypeScript generator, not a `#ifdef` branch in one template:

```typescript
interface TransportContribution {
    passes:  PlannedPass[];              // usually exactly one (the integrator pass)
    buffers: FramebufferRequirement[];   // usually none beyond the accumulation archetype's
    blocks:  ShaderBlock[];              // the integrator loop + helpers, assembled per plan
    uniforms: PlannedUniform[];
}
```

**The easy path is single-pass:** the first several integrators (PT, PT+NEE, PT+MIS, all volume variants) each contribute one pass and reuse the progressive-accumulation pipeline archetype. **The door stays open:** the contribution shape natively expresses multi-pass integrators (typed intermediate buffers, `rotate` history, MRT are already executable by the Engine per the pipeline contract). Heavy multi-pass techniques are out of scope (§1), but nothing here forecloses a two-pass experiment.

### 7.2 Transport state and the event loop

The generated loop owns this state and this shape:

```glsl
// state: Spectrum throughput; Spectrum radiance; int current_medium; GeodesicState s;
//        (spectral mode adds: vec4 lambda, float lambda_pdf — §8)
for (bounce = 0; bounce < MAX_BOUNCES; bounce++) {
    // 1. advance through current_medium: either a MEDIUM EVENT (volume integrator:
    //    distance sampling vs sigma_t) or a BOUNDARY EVENT (scene_intersect via stepper).
    //    Non-scattering media (sigma_s = 0, e.g. tinted glass): no distance sampling —
    //    deterministic transmittance *= exp(-sigma_a * t_hit) on the segment (compiler specializes).
    // 2. medium event  → throughput *= sigma_s/sigma_t (single-scatter albedo);
    //                    NEE from the medium point (§6.3); phase sample (Contract 1 medium); continue
    // 3. miss          → environment radiance (MIS-weighted), break
    // 4. boundary, null interface (§3.6) → current_medium = region_to; continue
    //                    (no bounce consumed; MAX_NULL_CROSSINGS safety counter)
    // 5. boundary, surface → verify/heal current_medium against region_from (§4.4);
    //                    emission (registry logic §6.2); NEE (non-delta materials);
    //                    surface sample (Contract 1); if TRANSMISSION: current_medium = region_to;
    //                    throughput *= sample.weight; RR; continue
}
```

**Accounting pins (added by verification — two integrators must not be free to disagree on these):**

- **Bounce budget:** surface scattering events and medium scattering events both count toward `maxBounces`; null crossings do not (own safety counter). Rationale: medium events do the same work and carry the same variance as surface bounces; null crossings are bookkeeping.
- **Russian roulette:** applied once per loop iteration, *after* `throughput *= sample.weight`, using `spectrum_average(throughput)` (§2.5), starting after `russianRoulette.startDepth` *counted* events (nulls excluded).

Steps 1–2 exist only when the scene has media (Planner knows); their implementation is the `volumeIntegrator` axis. The loop is *generated* — a scene with no volumes, no NEE, and one Lambert material compiles to something as small as today's template.

### 7.3 The strategy axis

```typescript
transport: {
    integrator: 'pt',                                   // loop generator id
    directLighting: 'none' | 'nee' | 'mis',
    volumeIntegrator: 'none' | 'raymarch' | 'delta-tracking' | 'ratio-tracking',
    maxBounces, russianRoulette, samplesPerFrame, ...
}
```

Scene = specimen; strategy = experiment. The existing multi-renderer infrastructure (instant switching, per-pass GPU timing) is the A/B harness for integrator research.

---

## 8. Spectral appendix — what changes when we flip the switch

Design: **hero-wavelength sampling** (PBRT-v4 style), fully compatible with a WebGL2 megakernel. Each path samples one hero wavelength + 3 stratified companions; `Spectrum` becomes a `vec4` of spectral samples; the film integrates to CIE XYZ via color-matching functions; display converts XYZ→sRGB.

What changes (and *only* this, given the §2.5 discipline):

1. **Planner constant resolution** — RGB material/light constants are upsampled to spectral reflectance via CPU-side sigmoid-polynomial fits (Jakob–Hanika); the constant formatter emits coefficient evaluation instead of `vec3` literals. This is a Planner mode, invisible to scene authors.
2. **Film + display blocks** — accumulate XYZ; convert in display. Two swapped GLSL blocks under the same pipeline.
3. **Transport λ state** — the loop carries `lambda`; chromatic events (dispersive refraction, wavelength-dependent `sigma_t`) collapse to the hero wavelength (companions zeroed) — standard technique, a few lines in the relevant samplers.
4. **Redshift** (the black-hole payoff) — frequency shift along geodesics is a transform of `lambda` plus a throughput factor; only spectral transport makes this *correct* rather than a fake color tint.

What does **not** change: every struct and signature in Contracts 1–5 (all typedef'd), the scene format, the pipeline, the Engine. Estimated scope when the time comes: the formatter mode, two film blocks, λ plumbing in the transport generator, spectral MIS for chromatic media. Plausibly lands in *this* tracer.

---

## 9. Paper stress tests

Each scenario traced through the contracts, naming exactly what it exercises.

### 9.1 Glass of water

Camera ray in ambient (`current_medium = -1`) hits the glass cup: one hit, `region_from = -1`, `region_to = R_glass`. `dielectric_sample` returns `LOBE_TRANSMISSION|LOBE_DELTA`, `weight` = Fresnel-weighted transmittance, `pdf = 0` (§3.1); `current_medium = R_glass` (§4.4). Inside glass, Beer–Lambert from `medium_of(R_glass).sigma_a` even with zero scattering. Next hit is the glass→water interface: **one event knowing both sides** — `η = ior(material_of(R_water)) / ior(material_of(R_glass))` (§4.1); `current_medium = R_water`. The exit path retraces symmetrically, each transmission setting `current_medium = region_to`. The old contract fails this three ways: no transmission lobe, 0/0 on delta pdf, no `material_from` tracking. (Full trace including the water-line and TIR variants: verification T1/T6.)

### 9.2 Snow globe (+ a separate glass sphere elsewhere)

Multi-region object (§4.6): bases `{sphere, base, figurine, bubble}`, regions glass-shell / water / bubble / base — four global region IDs. The shell shares material `'glass'` with the standalone sphere: two distinct `region_id`s, one material ID — `material_of()` handles sharing with zero ambiguity, and volume containment uses `region_<shell>_contains`, never material lookup (§2.3 — this is exactly the case that broke the archive's Solution A). Interface water→bubble inside the object: epsilon classification (§4.2) yields both regions directly; `current_medium` moves water → bubble on transmission.

### 9.3 Mirror

`mirror_sample` returns `wi = reflect(-wo, n)`, `weight = F`, `pdf = 0`, `LOBE_REFLECTION|LOBE_DELTA`. NEE at this vertex: `mirror_eval` returns 0 → NEE contributes nothing (correct — a delta lobe can't be light-sampled). If the reflected ray hits an area light: MIS weight is 1 because the sampled lobe was delta (§6.4). Under the old `throughput *= shade/pdf` contract this material is unrepresentable.

### 9.4 Foggy Cornell box

`scene.ambientMedium = 'fog'` (§2.4) — `current_medium = -1` resolves to the fog material; no geometry changed. Strategy: `volumeIntegrator: 'raymarch'` (or delta-tracking; both consume the same Contracts 1/2/4 surface). Each segment: sample scatter distance against `sigma_t`; on a **medium event**, `hg_sample` (phase, §3.5) + NEE from the medium point. All NEE — from surfaces *and* medium points — goes through `shadow_transmittance` (§6.3), which the compiler emits in its spectral-attenuation form because the scene has media: light shafts and volumetric shadows fall out. The area light at the ceiling participates via the registry with solid-angle pdfs (§6.1).

### 9.5 500-sphere cloud

One material (`'cloud'`, volumetric), 500 sphere instances → Planner selects batch codegen (§4.7): centers/radii in a float texture, looped `batch0_sdf`, **one region ID**. `region_<batch>_contains` = inside-any-instance — correct because the instances share one medium. Transport sees nothing unusual: the same `scene_sdf` and region contracts, different codegen underneath. Instance data being uniform/texture-driven means positions can animate without recompile.

### 9.6 Schwarzschild sanity check

Does anything above assume closed-form geodesics? Audit: marching goes through `geodesic_step`/`geodesic_max_step` (§5.1 — an RK4 stepper in the metric slots in); `Hit.frame` is built from `geodesic_transport`ed tangents (§5.3); `Point` may widen to vec4 (typedef); direct lighting is a strategy axis, so the scene runs `directLighting: 'none'` with an environment + emissive accretion-disk material (path-only emitter, §6.2) — no contract hardwires NEE; `scene_sdf` as safe-step bound (§2.6) tolerates coordinate/metric divergence; redshift is a λ transform (§8, spectral). **Nothing in Contracts 1–4 needs to change.** Remaining open items are implementation physics (step control near the horizon, SDF Lipschitz bounds under the metric), not contract shape. ✓

---

## 10. Migration notes and open questions

### 10.1 Gaps between the current vertical slice and these contracts

Priority-ordered; overlaps with [fable-review.md](fable-review.md) noted.

1. **Interaction interface** — `lambert.glsl`'s `interaction_surface_shade/scatter/pdf/emit` → the §3.2 shape: sample-returns-weight, bare-f eval, explicit `xi`, flags. Mechanical for Lambert (`sample.weight = albedo`).
2. **Hit struct** — `material_to/material_from` ints → `region_from/region_to` + `material_of()` table. The current per-object material tracking in `scene_sdf` becomes region tracking (trivial while every object is one region).
3. **LightSample semantics** — current folded-1/d², pdf=1 point lights → §6.1 conventions with `LIGHT_DELTA`; `random()·N` selection → CDF selection (also fixes the uninitialized-sample edge case flagged in the review).
4. **Environment** — delete the hardcoded sky in `path_trace.glsl` (review C3); `environment` becomes scene data + a registry light.
5. **Shadow query** — `scene_intersect_any` remains as the compiled fast path behind the `shadow_transmittance` contract.
6. **Spectral discipline** — sweep library GLSL for raw radiometric `vec3` literals; introduce `spectrum_*` helpers; route generated constants through the formatter. (Replaces `luminance()` for RR per review note on Rec.601.)
7. **Stepper** — introduce `GeodesicState` + Euclidean stepper; rewrite `raymarch.glsl`'s loop against it (compiler may specialize back).
8. **`Value<T>`** — extend `MaterialProperty` and light/SDF parameters with the `{param}` variant; Planner emits uniforms/bindings/metadata (also resolves the fov-as-#define and baked-light-intensity issues from the review).
9. **Transport generator** — split `path_trace.glsl` into generator-assembled blocks; `#ifdef`s become plan-driven block selection. Do this *last*, once 1–5 give it clean inputs.

### 10.2 Deliberately open

- Mesh/BVH geometry and mixed-kernel intersection (future tracer or late addition; the `kind: 'mesh'` type slot exists).
- Dielectric priority systems for intentional partial overlaps (§2.7, §4.4; V1-C5 warns until then).
- Procedural-property context signatures — the archive's `const-param-glsl.md` Phase-1 recommendation (function syntax, required `compute` name, materials/media contexts only) is the presumptive answer; ratify when implementing procedural media.
- Parameter packing at scale (uniform arrays → textures → per-instance parameterization beyond batches).
- Hot-reload / incremental recompilation granularity.
- Transparent shadow rays through dielectrics; adaptive interface epsilon.
- QMC/stratified sample streams beyond the explicit-`xi` hook (§2.9).
- Transmissive emitters observed from inside (emission side convention beyond the §6.2 `region_to` rule); one-sided/two-sided emission flags.
- **Scene authoring language.** `SceneDescription` is the *compiler's input format*, deliberately not necessarily the *human authoring surface* — a builder API / DSL / CSG-combinator layer can sit above it and compile down. Design separately; nothing in these contracts constrains it beyond the SceneDescription shape.

---

## 11. Validation harness — how we know the math is right

Paper stress tests (§9) validate contract *shape*; nothing above validates contract *implementations*. The classic silent failure in a research tracer is an eval/sample/pdf triple drifting out of consistency — producing plausible-looking, subtly biased images that no unit test of TypeScript code will ever catch. These harnesses are cheap on this codebase because the multi-strategy infrastructure (instant switching, HDR export, per-pass profiling) already exists.

### 11.1 Furnace tests (energy conservation)

A closed scene with uniform albedo ρ under uniform illumination L converges to the analytic value `L / (1 − ρ)` at every pixel. Run per material model as it lands: any BSDF whose `sample.weight` / `eval` / `pdf` disagree, or that loses/gains energy, fails visibly. Automatable: render N samples headless, `readExport('hdr')`, assert mean/variance against the closed form. The homogeneous-slab single-scatter case has a closed form too — the same harness covers V1 media.

### 11.2 Cross-strategy convergence (the MIS bug detector)

`pt`, `pt-nee`, and `pt-mis` on the same scene are different estimators of the *same integral* — their converged images must match. Any static discrepancy is a bug in NEE weighting, MIS weights, pdf measures, or double-counted emission. This is the single highest-yield correctness test for the light/interaction contracts, and it is nearly free here: compile the same scene under all three strategies (the system's core feature), render to convergence, diff the HDR exports. Should run in CI for every scene in `src/compiler/scenes/`.

### 11.3 pdf–histogram consistency (per model)

For each material model: sample many directions via `<model>_sample`, histogram them over the hemisphere/sphere, and compare against `<model>_pdf` evaluated on the same bins. Catches sampler/pdf mismatches that furnace tests can miss when errors cancel. Runs as a special debug *strategy* (the compiler generates a shader that does exactly this and writes the histogram to a buffer) — dogfooding the strategy axis as test infrastructure.

### 11.4 Medium-tracking repair counter

§4.4's self-healing invariant repairs `current_medium` whenever it disagrees with `hit.region_from` — silently, by design. This harness makes the repairs *visible*: a debug strategy renders the per-pixel repair count as false color. Missed boundary events (grazing angles, thin shells) show up as speckle in a dedicated view instead of as one mistracked segment quietly absorbed into a beauty render — a regression in march epsilons or shell thickness becomes measurable. Also the tool for tuning `EPS_INTERFACE` per scene.

### 11.5 Spectral-mode compile check (once §8 lands, even in skeleton form)

Compile every library GLSL block under both RGB and spectral modes in CI. This is the enforcement mechanism for the §2.5 discipline — until it exists, the discipline is convention-only and should be treated as the doc's least-protected pin during review.
