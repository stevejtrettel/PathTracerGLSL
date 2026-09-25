# Compiler GLSL Contracts

**Status:** Design contract — governs all future compiler work. **Migration largely complete (July 2026):** §10.1 items 1–6 & 8 implemented, item 7 superseded by `trace-loop-contract.md`, item 9 (transport split) deliberately last; the dielectric landed with two-sided hits, `scene_region_at`, and `ior_of`; **homogeneous media landed** (`impl-plan-media.md` + `fable-volumetric-component.md` — null interfaces, `current_medium` + self-heal, the medium_sample/medium_transmittance seams, HG, spectral shadow walker; witnesses GPU-verified); **area lights + MIS landed** (`impl-plan-area-lights.md` — §6.1 samplers, §6.2 registry/`light_of`/w-bookkeeping, §6.4 power heuristic with the generated `lighting_pdf`; pt/pt-nee/pt-mis converge on X-CORNELL/X-GLASS/X-FOG).
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

> **Shape revised by §10.1 item 1 (implemented, owner-approved):** surface samplers take the split
> `(float uc, vec2 u)` — `uc` selects the lobe, `u` samples the direction — instead of a bare
> `vec2 xi`. Same principle (explicit inputs; transport owns the draws); the split serves
> multi-lobe models (the dielectric's `uc < F` branch) and a future fixed QMC dimension layout.
> See [impl-plan-interaction-reshape.md](impl-plan-interaction-reshape.md).

### 2.10 Resource contributions — PINNED (resolved in design discussion, July 2026)

§2.8 pins the *authoring surface* (`Value<T>`: a property is a constant or a `{param}` reference). This section pins the *planning architecture* underneath it — how a feature's uniforms, textures, and parameter metadata reach the `CompiledRenderer` — and extends `Value<T>` to the one thing it doesn't cover: textures. The two are **layered, not merged**: the `{param}` scan is authoring; contributions are planning.

**Each feature planner returns a `FeatureContribution`.** The features are camera, accumulation, display, transport, materials, lighting, environment.

```typescript
interface FeatureContribution {
    blocks:     ShaderBlock[];
    defines:    Record<string, string>;
    uniforms:   PlannedUniform[];     // feature-declared uniforms + their bindings
    parameters: ParameterMetadata[];  // UI/metadata for {param}-driven uniforms
    textures:   PlannedTexture[];     // external resources this feature's shader needs
    // transport & accumulation additionally contribute passes/buffers — see §7.1;
    // TransportContribution is a FeatureContribution with those two fields added.
}
```

**(1) The `{param}` scan runs inside each feature planner, over that feature's own inputs.** The materials planner scans material properties; the camera planner scans `strategy.camera` fields; each emits uniforms/parameters into *its own* contribution. Constants bake (§2.8 — enabling specialization); only `{param}` references become uniforms. The Planner concatenates every contribution and **dedupes by uniform name**: identical duplicates merge (this is how two materials sharing `glass.roughness` → one `u_glass_roughness`, §2.8), conflicting duplicates (same name, different type/path) are a Validator error. Textures dedupe by name the same way. The concatenated list is the **single `PlannedResource` truth** — the Generator emits *every* uniform declaration from it, **including the display pass's**, so no GLSL template declares its own uniform. This closes the "template-owned uniform" hole and makes declared-vs-wired validation structural. *Engine builtins* (`engine.resolution`, `engine.frameIndex`, `engine.pixelOffset`, `engine.imageSize`, `engine.time`, `engine.sampleCount`) are **not** `FeatureContribution` uniforms — they are engine-injected each frame per the existing convention and stand outside this list.

**(2) The executor is the sole texture-unit authority.** Per pass, `RenderExecutor` binds all texture inputs — framebuffer refs and `extern:` refs alike — to units 0, 1, 2… in declaration order, setting the sampler uniform each time. `TextureRegistry`'s fixed-unit reservation and one-shot bind-at-load are **deleted**; it becomes a dumb `name → WebGLTexture` store. `Engine._bindEnvironmentTexturesToRenderer` is **deleted**. Environment scalars (`u_envSize`, `u_envTotalWeight`) become ordinary `UniformBinding`s on parameter paths (`env.size`, `env.totalWeight`) that the app sets when the HDR loads. While touching `_bindTextures`, cache `getUniformLocation` per `(program, name)` — the cheap half of engine #9, free in passing. This single authority is what fixes the latent texture-unit collision (review engine #2).

**(3) External textures: scene declares, engine provisions, both validate their half.** The environment is scene data: `scene.environment: { type: 'hdri' | 'constant' | 'none', … }`. The environment feature planner derives the extern textures its shader needs — an `hdri` environment yields `extern:env_map`, `extern:env_cdf_cond`, `extern:env_cdf_marg`; a `constant` environment yields **no** texture (a uniform env color + a block); `none` yields neither. The **Validator** checks, at compile time, that every `extern:` reference in the planned pipeline traces to a scene declaration. The **engine's** half is runtime-only (loading is async): at bind time an `extern:` key missing from the registry is a hard, *named* engine error, never a silent unit-0 sample. `extern:` is a **reserved prefix** in the buffer-id namespace, alongside `_current`/`_previous`. This fits the *locked* compiler↔engine contract with no type change — `pass.inputs.textures` is already `Record<string,string>`.

**Proving cases, in order.** (a) **fov** — `Value<number>` on `strategy.camera.fov`; the `TAN_FOV` `#define` mechanism dies (a constant bakes to a literal, a `{param}` emits `u_tanFov` with `compute: tan(fov/2)`) — proves strategy-side scalars + computed bindings. (b) **`MaterialProperty` gains `{param}`**, `albedo` first — proves scene-side scalars through the materials contribution. (c) **environment-as-scene-data** with `extern:env_map` (`hdri`) and `constant` as the trivial variant — proves textures end-to-end and retires the hardcoded sky (review C3).

**Ordering.** Do this **before** the transport-generator split (§7.1), not interleaved: `TransportContribution` *is* a `FeatureContribution`, so the split consumes this refactor as its input shape — doing it after means doing it twice. Sequence: **(i)** the contributions refactor as a *pure TS restructure* with **snapshot-identical generated GLSL asserted before/after** (it moves declarations, changes nothing semantic — a golden-file diff makes it cheap to verify); **(ii)** proving cases (a)/(b)/(c) on top; **(iii)** the remaining §10.1 items with the transport split still last. This absorbs §10.1 items 4 (environment) and 8 (`Value<T>`) into one coherent block.

### 2.11 Sample stream — PINNED (resolved in design discussion, July 2026)

The RNG is a **counter-based hash**, not a stateful sequence, **indexed by an explicit dimension** — chosen so the §2.9 stratification/QMC door is a drop-in, not a rewrite (Owen-scrambled Sobol / blue-noise are inherently `sample(index, dimension)` lookups; a stateful generator gives a sequence, not an addressable field). This supersedes the vertical slice's `rng.glsl` (`mix32(seed + counter)` — the shifted-copy construction flagged in review C9) and **eliminates the `frameIndex == sampleCount` coincidence**.

**Generator + seed (normative).** Canonical hash is the Jarzynski–Olano GPU `pcg` family:

```glsl
uvec4 pcg4d(uvec4 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y*v.w; v.y += v.z*v.x; v.z += v.x*v.y; v.w += v.y*v.z;
    v ^= v >> 16u;
    v.x += v.y*v.w; v.y += v.z*v.x; v.z += v.x*v.y; v.w += v.y*v.z;
    return v;
}
uint rng_base;   // per (pixel, sample, reset) seed
uint rng_dim;    // dimension / draw index

void rng_init(uvec2 pixel, uint sampleCount, uint resetSalt) {
    rng_base = pcg4d(uvec4(pixel, sampleCount, resetSalt)).x;
    rng_dim  = 0u;
}
uint  rng_u32() { return pcg4d(uvec4(rng_base, rng_dim++, 0u, 0u)).x; }
float random()  { return float(rng_u32() >> 8) * (1.0 / 16777216.0); }  // [0,1) — the C1 discipline
```

**Two seed axes, two counters (this is the `frameIndex` resolution).** The seed varies along exactly two independent axes, and each is one counter with one job:

- `sampleCount` — decorrelates samples *within* a converging render, and still drives the accumulation weight `1/(N+1)`. It is literally "which sample is this," used consistently for both. Resets to 0 on accumulation reset.
- `resetSalt` — a monotonic counter the engine increments on **every accumulation reset**. It changes the seed exactly when the old construction would have replayed, so re-converging a reset image explores fresh paths and interactive motion (reset each frame → `sampleCount` stuck at 0) gets lively noise instead of a frozen pattern.

The engine **drops the `frameIndex` builtin** (it was `== sampleCount`); `engine.sampleCount` stays and `engine.resetSalt` is added. Tiled rendering seeds on the *global* pixel (review C6), so tiles decorrelate at equal `(sampleCount, resetSalt)`.

**Dimension convention — indexed now, layout deferred.** `rng_dim` is the dimension index, advanced per draw; §2.9's explicit `vec2 xi` means the *transport loop*, not the sampler, owns which draw feeds which decision. Today the layout is sequential (draw order). The QMC swap is then localized: assign a *fixed* dimension layout (camera + early bounces get low, stable dimensions; deep bounces pad with the hash) and replace `pcg4d(base, dim…)` with `sobol(sampleIndex, dim)` + per-dimension Owen scramble. We pin the *indexed* shape now (the expensive-to-retrofit part) and defer the fixed layout to when QMC is actually built — the minimal thing that keeps the §2.9 door open.

**Deferred: fixed-seed reproducibility.** `resetSalt` as a plain reset counter is already deterministic across identical action sequences while never replaying within a session. A pin-the-salt "reproducible render" mode is a trivial future add and is *not* required by the §11 harness — furnace, cross-strategy convergence, and pdf-histogram all check converged quantities that are seed-independent.

### 2.12 Inclusion granularity and exact linkage — PINNED (owner-decided July 2026)

What the July 2026 shader-cleanliness audit resolved: how much of the emitted program must be *exactly* what the (scene, strategy) pair uses.

**Self-authored component files are included wholesale.** A component occupant's `.glsl` file is its complete contract implementation and the unit we optimize by hand — the compiler trusts it as written and never carves inside it. A `pt` program that includes lambert therefore carries `lambert_pdf` (inert, a few lines); a nee program's `sampler_cdf.glsl` carries its pdf half; `raymarch.glsl` carries `sdf_intersect_any` even when no shadow ray exists. This is a **declared cost** (the bias-ledger pattern applied to code size): known, bounded (tens of lines per program), and paid to keep "1 component = 1 folder" and *math is static* — the axes that make authoring cheap. The same applies to the `glsl/core/` spine (the vocabulary every component is written against). Do not split occupant files per-operation to chase these lines.

**Generated code has no such license.** Policy/plumbing the compiler emits (dispatches, tables, wrappers, uniform declarations) must be *exactly linked*: every generated seam has a caller in the assembled program, every declared uniform a reader. The Planner records each seam's existence as an explicit ProgramDescription decision, following the `emitters.lightingPdf` precedent — `materials.surfaceEval`/`surfacePdf`, `media.mediumEval`/`mediumPdf`, `intersection.anyQuery`, `environmentSamplable` (a *decision*, ∧ NEE — not the analyzer's kind-fact), `environmentPdf`, `environmentSelectionLive`. Features gate emission on these fields and mirror them in `provides`.

**Enforcement is structural, not audit-based:** merge's `seam-unused` warning (the dual of `seam-missing`) fires when a provided seam has no requirer. Provides that ride inside wholesale component files are declared `componentScoped` and exempted. Features whose *generated* bodies call their own provided seams (or another feature's) list them in `requires` — self-requires are legitimate and keep the ledger honest.

The path tracer's central abstraction is the **scattering event**, with exactly two implementations: surface (BSDF) and medium (phase function). Both produce the same sample type.

### 3.1 The sample struct

> **Revised by §10.1 item 1 (implemented):** `LOBE_NULL` was **dropped** — null-interface status is
> a compile-time *boundary classification* (a generated `is_null_interface(hit)` predicate from
> region/material data), not a scattering lobe; §3.6's transport behavior is unchanged. Flags are
> bitmask bits, so re-adding one later would be non-breaking.

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

> **Sample signature revised by §10.1 item 1 (implemented):**
> `<model>_sample(Direction wo, Hit hit, MaterialProperties mp, float uc, vec2 u)` — the `vec2 xi`
> below is the original pin; see the §2.9 note. The §3.3 dispatchers carry the same change.

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
- **no** NEE, **no** emission logic, **no** bounce consumed — null crossings have their own budget, the declared truncation `measurement.maxNullCrossings`, counted along the whole path including its shadow rays (they are bookkeeping, not scattering).

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

> **Mechanism revised in implementation (dielectric phase 1, July 2026):** probes run along the
> **geometric normal**, not the ray, and the owner side skips its probe — entering ⇒
> `region_to = owner`, exiting ⇒ `region_from = owner`, one `+n`-probe classifies the outside.
> Reason: the marcher stops `MARCH_EPSILON` short of the surface, so ray-direction probes fail at
> grazing incidence (probe depth `ε·cosθ` vs the residual); normal probes clear the residual at
> every angle. `EPS_INTERFACE = 1e-3` (10× `MARCH_EPSILON`). Semantics unchanged; this is §4.3's
> owner hint made exact. See `docs/impl-plan-dielectric.md` phase 1.

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

## 5. Contract 3 — Curved-space geometry (geodesic advancement)

> Revised by `docs/trace-loop-contract.md` (owner decision). Ray advancement is
> `ambient_geodesic(origin, dir, t)`; there is **no `GeodesicState`/stepper** (an earlier draft's
> stepper conflated an implementation optimization with the abstraction — retired). The `Ray` is a
> pure `{origin, direction}` seed, never mutated by intersection.

### 5.1 The interface

Ray advancement and all curved-space geometry go through per-ambient-space functions, hand-written
per space (`euclidean.glsl`, `hyperbolic.glsl`, …):

```glsl
Point     ambient_geodesic (Point origin, Direction dir, float t);   // the point at arc-length t along the geodesic seeded by (origin, dir)
float     ambient_dot      (Direction a, Direction b, Point p);      // Riemannian metric at p (§2.5 metric rule)
Frame     ambient_frame    (Point p, Direction n);                   // local shading frame, metric-orthonormal
Direction ambient_transport(Direction u, Point from, Point to);      // parallel transport
```

The marcher samples points along the ray's geodesic: `p = ambient_geodesic(ray.origin, ray.direction, t)`.

**This signature holds in *every* space, including black holes.** A closed-form space (Euclidean,
H³, S³) evaluates it directly; a metric with no closed-form geodesic (Schwarzschild, wormhole)
**integrates the geodesic ODE internally** to reach arc-length `t` — a performance/implementation
concern *private to the ambient-space module*, never a type in the trace loop.

### 5.2 Zero cost today

For Euclidean, `ambient_geodesic(o, d, t)` is `o + d*t` and `ambient_dot`/`ambient_transport` are the
standard dot / identity — the compiler inlines them and the loop is exactly the flat marcher. A
curved space swaps in *one new GLSL file* (its closed-form or ODE-integrated `ambient_*`), with no
change to the march loop, the transport loop, or any other contract. Paying for generality only
when the scene needs it is precisely this compiler's philosophy.

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
    float     distance;   // to the sampled point (MAX_DIST, the far clip, for environment and directional)
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
- **Side convention: emission and light identity key on `region_to`** — you receive emission from the region the ray is about to enter. This is correct for the universal case (opaque emitter hit from outside), one-sided at exits (leaving an emissive region contributes nothing from behind). ~~and naturally two-sided for thin synthesized quad emitters~~ **Revised in implementation (area lights, July 2026): synthesized quads are ONE-SIDED.** The entering/exiting classifier keys a back-face hit's `region_to` to the region *behind* the zero-thickness quad, and the §6.1 sampler returns `pdf = 0` behind the emitter — hit side and sample side agree, which is what correctness requires (and matches pbrt/Mitsuba's one-sided default). A `twoSided` flag is deferred (impl-plan-area-lights). Transmissive emitters seen from inside: OPEN (§10.2).
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

> **Signature revised by `docs/trace-loop-contract.md`:** now `shadow_transmittance(Ray shadow_ray,
> Point light_p, int crossings_left)` (the `Ray` is a pure seed; the destination is a point; the
> path's remaining null-crossing budget is an argument). The *semantics* below — spectral return,
> boolean fast path when no media, spectral attenuation otherwise — are unchanged.

```glsl
Spectrum shadow_transmittance(Ray shadow_ray, float maxDist);   // was (Point p, Direction wi, float dist)
// 0 or 1 when scene has no media/dielectrics along shadow rays — compiler emits the boolean
// fast path (scene_intersect_any(ray, maxDist)) in that case, spectral attenuation otherwise.
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

This is a `FeatureContribution` (§2.10) with `passes`/`buffers` added — transport is one of the seven feature planners, and its uniforms/textures/parameters flow through the same concatenate-and-dedupe planning path. Per §2.10's ordering pin, the contributions refactor lands *before* the transport-generator split, so this interface is the split's input shape, not a parallel invention.

**The easy path is single-pass:** the first several integrators (PT, PT+NEE, PT+MIS, all volume variants) each contribute one pass and reuse the progressive-accumulation pipeline archetype. **The door stays open:** the contribution shape natively expresses multi-pass integrators (typed intermediate buffers, `rotate` history, MRT are already executable by the Engine per the pipeline contract). Heavy multi-pass techniques are out of scope (§1), but nothing here forecloses a two-pass experiment.

### 7.2 Transport state and the event loop

The generated loop owns this state and this shape:

```glsl
// state: Spectrum throughput; Spectrum radiance; int current_medium; Ray ray;  (pure seed, §5)
//        (spectral mode adds: vec4 lambda, float lambda_pdf — §8)
for (bounce = 0; bounce <= N; bounce++) {          // N = measurement.maxBounces: N + 1 intersections
    // 1. advance through current_medium: either a MEDIUM EVENT (volume integrator:
    //    distance sampling vs sigma_t) or a BOUNDARY EVENT (scene_intersect via stepper).
    //    Non-scattering media (sigma_s = 0, e.g. tinted glass): no distance sampling —
    //    deterministic transmittance *= exp(-sigma_a * t_hit) on the segment (compiler specializes).
    // 2. medium event  → throughput *= sigma_s/sigma_t (single-scatter albedo);
    //                    if bounce == N: break (an event past the budget);
    //                    NEE from the medium point (§6.3); phase sample (Contract 1 medium); continue
    // 3. miss          → environment radiance (MIS-weighted), break
    // 4. boundary, null interface (§3.6) → current_medium = region_to; continue
    //                    (no bounce consumed; counts against measurement.maxNullCrossings)
    // 5. boundary, surface → verify/heal current_medium against region_from (§4.4);
    //                    emission (registry logic §6.2); if bounce == N: break;
    //                    NEE (non-delta materials);
    //                    surface sample (Contract 1); if TRANSMISSION: current_medium = region_to;
    //                    throughput *= sample.weight; RR; continue
}
```

**Accounting pins (added by verification — two integrators must not be free to disagree on these):**

- **Bounce budget:** surface scattering events and medium scattering events both count toward `maxBounces`; null crossings do not — they count against `measurement.maxNullCrossings`, a separate declared budget shared by the path and its shadow rays. Rationale: medium events do the same work and carry the same variance as surface bounces; null crossings are bookkeeping.
  **What N counts:** `maxBounces: N` is the partial sum Σ_{n≤N} TⁿE — paths with at most N events — for EVERY estimator. The walk therefore does N + 1 intersections: emission found at the end of segment N is scored, but NEE and the continuation (each of which adds an event) run only while `bounce < N`. With N intersections and NEE at each, pt would count n ≤ N−1, pt-nee n ≤ N for samplable lights, and pt-mis only the NEE share of the n = N term: the truncation would depend on the estimator.
- **Russian roulette:** applied once per loop iteration, *after* `throughput *= sample.weight`, using `spectrum_max(throughput)` (**revised from `spectrum_average` by §10.1 item 6, owner-approved** — PBRT's MaxComponentValue). The survival metric is one generated expression; it can become a strategy knob later if a reader appears — `spectrum_max` is the pinned default. The survival probability is capped at `estimator.russianRoulette.maxSurvival` (default 0.95; the only terminator for a lossless path). Starts after `russianRoulette.startDepth` *counted* events (nulls excluded). When transmissive materials exist the metric carries PBRT's `etaScale` correction (transmission compresses radiance by η², restored on exit, so raw-throughput RR would over-kill inside dense media). Medium collisions in weighted-absorption arms use a separate interior rule (`roulette_interior`, docs/fable-subsurface.md §6).

Steps 1–2 exist only when the scene has media (Planner knows); how they sample is the estimator's `volumeSampling` axis, and whether scattering is computed at all is the measurement's `scattering` field (the former `volumeIntegrator` split, fable-strategy-taxonomy.md §8). The loop is *generated* — a scene with no volumes, no NEE, and one Lambert material compiles to something as small as today's template.

### 7.3 The strategy axis

> **Shape superseded by [fable-strategy-taxonomy.md](fable-strategy-taxonomy.md) (owner-decided
> July 2026, implemented in the decision-hoist batch):** the flat `transport:` sketch below became
> the three-sectioned `measurement / estimator / view` schema — scene+measurement define the
> integral, estimator is bias-free by contract, view is display-only. The `volumeIntegrator`
> field split into `measurement.scattering` (truncation) + `estimator.volumeSampling` (method).
> The *semantics* below (scene = specimen, strategy = experiment, integrators as loop
> generators) are unchanged.

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

Does anything above assume closed-form geodesics? Audit: marching goes through `ambient_geodesic` (§5 — a metric with no closed form integrates the ODE inside its body); `Hit.frame` is built from `ambient_transport`ed tangents (§5.3); `Point` may widen to vec4 (typedef); direct lighting is a strategy axis, so the scene runs `directLighting: 'none'` with an environment + emissive accretion-disk material (path-only emitter, §6.2) — no contract hardwires NEE; `scene_sdf` as safe-step bound (§2.6) tolerates coordinate/metric divergence; redshift is a λ transform (§8, spectral). **Nothing in Contracts 1–4 needs to change.** Remaining open items are implementation physics (step control near the horizon, SDF Lipschitz bounds under the metric), not contract shape. ✓

---

## 10. Migration notes and open questions

### 10.1 Gaps between the current vertical slice and these contracts

Priority-ordered; overlaps with [fable-review.md](fable-review.md) noted.

> **Status (July 2026): items 1–6 & 8 are DONE** (one `impl-plan-*.md` per item records scope +
> verification); item 7 was done differently (owner decision, note below); **item 9 remains,
> deliberately last.** The first post-migration feature (the dielectric,
> `impl-plan-dielectric.md`) additionally delivered §4.1/§4.2 two-sided hits, `scene_region_at`,
> and `ior_of`.

1. **Interaction interface** — `lambert.glsl`'s `interaction_surface_shade/scatter/pdf/emit` → the §3.2 shape: sample-returns-weight, bare-f eval, explicit `xi`, flags. Mechanical for Lambert (`sample.weight = albedo`).
2. **Hit struct** — `material_to/material_from` ints → `region_from/region_to` + `material_of()` table. The current per-object material tracking in `scene_sdf` becomes region tracking (trivial while every object is one region).
3. **LightSample semantics** — current folded-1/d², pdf=1 point lights → §6.1 conventions with `LIGHT_DELTA`; `random()·N` selection → CDF selection (also fixes the uninitialized-sample edge case flagged in the review).
4. **Environment** — delete the hardcoded sky in `path_trace.glsl` (review C3); `environment` becomes scene data + a registry light. **(Absorbed into the §2.10 resource-contributions block — see ordering below.)**
5. **Shadow query** — `scene_intersect_any` remains as the compiled fast path behind the `shadow_transmittance` contract.
6. **Spectral discipline** — sweep library GLSL for raw radiometric `vec3` literals; introduce `spectrum_*` helpers; route generated constants through the formatter. (Replaces `luminance()` for RR per review note on Rec.601.)
7. **Curved-space geometry** — ~~introduce `GeodesicState` + stepper~~ **DONE differently (owner decision — no stepper):** the `Ray` is a pure `{origin, direction}` seed advanced by `ambient_geodesic(origin, dir, t)`; the metric is `ambient_dot`. See `docs/trace-loop-contract.md` §5. Euclidean is live; H³/Schwarzschild are new `ambient_*` GLSL files (unbuilt).
8. **`Value<T>`** — extend `MaterialProperty` and light/SDF parameters with the `{param}` variant; Planner emits uniforms/bindings/metadata (also resolves the fov-as-#define and baked-light-intensity issues from the review). **(Absorbed into the §2.10 resource-contributions block — see ordering below.)**
9. **Transport generator** — split `path_trace.glsl` into generator-assembled blocks; `#ifdef`s become plan-driven block selection. Do this *last*, once 1–5 give it clean inputs. **DONE (July 2026, `impl-plan-transport-split.md`):** the loop is emitted by `transport.ts` segment generators (proof: token-equivalence across all registry pairs); the template and every structural define are deleted — the only remaining preprocessor use is numeric knobs. §10.1 is COMPLETE.

**Ordering refinement (§2.10 resource-contributions block).** Items 4 and 8 are absorbed into one coherent block that lands as a unit: (i) the pure contributions refactor (feature planners return `FeatureContribution`s; snapshot-identical generated GLSL asserted before/after), (ii) proving cases fov / `MaterialProperty` `{param}` / environment-as-scene-data, then the remaining items. Because `TransportContribution` (§7.1) *is* a `FeatureContribution`, this block precedes the item-9 transport split, which consumes it as its input shape.

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
