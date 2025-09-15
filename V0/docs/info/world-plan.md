Here’s a draft you can drop in as `docs/world-architecture.md`. It mirrors the “two-tier” approach you liked for the engine: a **Minimal World** you can stand up immediately, plus a **More Filled-Out World** you can graduate into—along with *when/why/how* to upgrade. No code, just contracts, shapes, and responsibilities.

---

# World Architecture (Two-Tier Design)

## Executive summary

The **World** encapsulates the mathematical reality your photography stack observes. It contributes **no WebGL calls**; it contributes **algorithms and data** (GLSL + descriptors) that the **engine** executes. We maintain two levels:

* **Tier 1 — Minimal World**: one compact module (geometry + scene + one BSDF + one light) exposing a tiny ABI so you can trace in days, not weeks.
* **Tier 2 — Expanded World**: split, type-safe submodules (geometry, scene intersector, materials registry, lights registry, optional media), with clear geometry-aware shading interfaces, sampling support for NEE/MIS, and CPU-side acceleration data that the engine uploads.

We start minimal; we upgrade only when specific research pressures appear (comparisons, curved spaces, larger scenes, reproducibility).

---

## Tier 1 — Minimal World

### Purpose

Provide just enough **geometry**, **scene**, **material**, and **lighting** to let a tracer generate correct rays, intersect something, and shade it—without worrying about BVHs, material registries, or curved-space subtleties.

### Responsibilities

* Supply a **single GLSL bundle** with:

    * A **geometry** helper (`geodesic`, trivial in Euclidean).
    * A **scene function** (`sceneSDF` or a tiny `sceneIntersect`).
    * One **material** (Lambertian) with `eval` and a trivial sampler.
    * One **light** (constant environment or emissive sphere) and an `environmentRadiance` call.
* Provide a **tiny ABI** that a tracer can call (see below).
* Optional: a handful of **parameters** (albedo, env color) that the engine binds to uniforms.

### Minimal ABI (fixed names)

GLSL pseudocode—keep signatures stable so tracers stay geometry-agnostic.

```glsl
// Geometry (Euclidean minimal)
vec3 geodesic(vec3 o, vec3 d, float t); // o + t d

// Scene (pick ONE style for Tier 1)
float sceneSDF(vec3 p);                  // if ray marching
// or
struct Hit { bool valid; vec3 p; vec3 n; float t; int materialID; };
Hit sceneIntersect(vec3 o, vec3 d);      // if analytic/SDF hybrid

// Material (Lambertian only in Tier 1)
vec3  bsdf_eval(vec3 n, vec3 wi, vec3 wo, vec3 albedo);   // f
// Optional sampler for path tracing later:
vec3  bsdf_sample(vec3 n, vec3 wo, vec2 u, out float pdf);

// Lighting (pick ONE)
vec3 environmentRadiance(vec3 dir);
```

> Note: In Tier 1, normals and dot products are Euclidean; `cosTheta = max(dot(n, wi), 0.0)`.

### Minimal file tree (World only)

```
world/
  MinimalWorld.ts           # Adapter that returns the concatenated GLSL
  geometry/Euclidean.glsl   # geodesic()
  scene/SDFPrimitives.glsl  # sphere/box ops + sceneSDF()
  materials/Lambert.glsl    # bsdf_eval()/optional sample
  lights/EnvConstant.glsl   # environmentRadiance()
```

### Strengths

* Small surface area; easy to assemble with a minimal engine.
* Fast path to “first pixels” and basic experiments.

### Limitations / risks

* **Euclidean assumptions baked in** (normals, dot products).
* **No material/light registries** → hard to scale beyond one BSDF/light.
* **No sampling contracts** for NEE/MIS (makes fair comparisons difficult).
* **No acceleration** beyond SDF marching → complex scenes get slow quickly.

---

## Tier 2 — Expanded World

### Purpose

Support curved geometries, multiple materials/lights, next-event estimation and MIS, and scalable scenes (SDF + meshes), while **keeping geometry-aware shading correct** and **research modules clean**.

### Submodules & contracts

#### 1) Geometry (metric-aware)

Provides local differential structure and ray transport. **No GL calls.**

**Must provide (fixed signatures):**

```glsl
// Orthonormal frame & metric helpers at point p
void localFrame(in vec3 p, in vec3 n_geom, out mat3 TBN, out float metricDet);
vec3 toLocal(in vec3 w_world,  in mat3 TBN);
vec3 toWorld(in vec3 w_local,  in mat3 TBN);

// Transport along geodesic (choose & document parameterization)
struct Ray { vec3 o; vec3 d; };
Ray geodesicStep(Ray r, float dt); // affine or metric-arc; document choice

// Geometry term abstraction for NEE/MIS (Euclidean: cosθ_i cosθ_o / r^2)
float geometryTerm(in vec3 xi, in vec3 wi, in vec3 xo, in vec3 wo);
```

*Why:* Materials call dot/cos via **local frames** not raw Euclidean dot; tracers don’t need to know the metric.

#### 2) Scene Intersector

One façade, multiple backends (marching, BVH, hybrid). **No GL**; declares GPU resources (buffers/textures) via descriptors that the engine uploads.

**Must provide:**

```glsl
struct Hit { bool valid; vec3 p; vec3 n; float t; int materialID; };
Hit sceneIntersect(Ray r);
```

**May also provide (if you keep marching as a path):**

```glsl
float sceneSDF(vec3 p);
```

*CPU side responsibilities:* build acceleration (BVH, instance transforms), produce compact GPU buffers; **engine** owns upload.

#### 3) Materials (BSDF library + registry)

A set of BSDFs with a small registry keyed by `materialID`. Pure GLSL + descriptors for textures/constants.

**Must provide:**

```glsl
struct BsdfEval { vec3 f; };
struct BsdfSample { vec3 wi; vec3 f; float pdf; int type; };

BsdfEval   bsdf_eval(int materialID, vec3 p, mat3 TBN, vec3 wi_world, vec3 wo_world);
BsdfSample bsdf_sample(int materialID, vec3 p, mat3 TBN, vec3 wo_world, vec2 u);
float      bsdf_pdf(int materialID, vec3 p, mat3 TBN, vec3 wi_world, vec3 wo_world);
```

*Note:* Materials must use `toLocal/toWorld` and metric-aware `cosTheta`.

#### 4) Lights (emitters + environment + registry)

Support NEE/MIS: ability to **pick**, **sample**, **evaluate**, and **pdf**.

```glsl
struct LightPick { int id; float pmf; };                 // discrete choice
struct LightSample { vec3 L; vec3 wi; float dist; float pdf; };

LightPick   light_pick(vec3 x, vec2 u);
LightSample light_sample(int lightID, vec3 x, vec2 u);   // sample a point on light
vec3        light_eval(int lightID, vec3 x, vec3 wi);    // evaluate Le from light
float       light_pdf(int lightID, vec3 x, vec3 wi);
vec3        environmentRadiance(vec3 dir);
float       environmentPdf(vec3 dir);
```

*CPU side responsibilities:* maintain a compact light table (emissive primitives, env map params), plus alias tables if needed; **engine** uploads.

#### 5) Media (optional)

Homogeneous/heterogeneous volumes with metric-aware transmittance and phase.

```glsl
struct MediumSample { bool scattered; float t; vec3 p; };
MediumSample medium_sample(Ray r, vec2 u);     // distance + scatter test
float        transmittance(Ray r, float tmax); // Tr
vec3         phase_eval(vec3 w_in, vec3 w_out);
vec3         phase_sample(vec3 w_in, vec2 u, out float pdf);
```

### Expanded file tree (World only)

```
world/
  geometry/
    Geometry.ts             # Declares the geometry ABI & descriptors (no GL)
    Euclidean.ts
    Hyperbolic.ts
    Schwarzschild.ts
    shaders/metric.glsl     # dot, norm, cosTheta via metric
    shaders/frames.glsl     # localFrame/toLocal/toWorld

  scene/
    SceneIntersector.ts     # Facade ABI; declares GPU buffers via descriptors
    SDFScene.ts             # CPU-side SDF composition; marching params
    MeshScene.ts            # CPU-side mesh + BVH build (no GL)
    Accel/
      BVHBuilder.ts         # CPU builder
      Packing.ts            # Packs nodes/prims into GPU-friendly arrays
      traversal.glsl        # GPU traversal code

  materials/
    Material.ts             # BSDF registry contract + descriptors
    Lambert.ts
    MicrofacetGGX.ts
    LayeredCoat.ts
    shaders/bsdf_core.glsl  # eval/sample/pdf helpers (microfacet math)
    tables/
      MaterialTable.ts      # CPU: makes arrays/texture packs for engine upload

  lights/
    Light.ts                # Light registry + descriptors
    Distant.ts
    AreaRect.ts
    EnvMap.ts
    shaders/light_core.glsl # pick/sample/eval/pdf helpers
    tables/
      LightTable.ts         # CPU: alias tables / CDFs

  media/                     # optional
    Medium.ts
    Homogeneous.ts
    HeterogeneousGrid.ts
    shaders/phase_hg.glsl

  WorldDescriptor.ts         # Gathers sub-descriptors; single thing the engine reads
```

### Engine interaction (who uploads what?)

* **World submodules** produce **descriptors** (no GL): buffer/texture specs, constants, and GLSL fragments.
* The **engine** allocates textures/buffers via its pools, uploads CPU-built arrays (BVH, tables), and binds everything with a consistent prefix.
* The **assembler** pulls the world’s GLSL entrypoints and wires them to the tracer’s calls.

### Strengths

* Geometry-agnostic BSDFs through `localFrame` + metric ops.
* Ready for NEE/MIS and light importance sampling.
* Scales to larger scenes (BVH) and multiple materials/lights.
* CPU/GL separation preserved.

### Costs

* A few more files and clear contracts to uphold.
* Some CPU-side build steps (BVH, tables) to maintain.

---

## Minimal vs Expanded — decision matrix

| Concern               | Minimal World           | Expanded World                 | Notes                                 |
| --------------------- | ----------------------- | ------------------------------ | ------------------------------------- |
| First pixels          | **Fastest**             | Slightly slower                | More descriptors to gather.           |
| Curved spaces         | Fragile (Euclidean ops) | **Correct** (metric-aware ABI) | Critical for your research.           |
| Multiple BSDFs/lights | Awkward                 | **Natural (registries)**       | Enables fair algorithm comparisons.   |
| NEE/MIS               | Hard                    | **Built-in**                   | Tracer plugs into pick/sample/pdf.    |
| Large scenes          | Slow (march)            | **BVH / hybrid**               | Required for meshes/instances.        |
| Reproducibility       | OK                      | **Good**                       | Tables/registries produce stable IDs. |

---

## When to upgrade (objective triggers)

Upgrade Minimal → Expanded World if/when you hit **any** of:

1. **You need non-Euclidean correctness** (hyperbolic/GR): normals, cosines, and geometry terms must respect the metric.
2. **You want NEE/MIS** or to compare sampling strategies fairly.
3. **You need more than one material/light** concurrently.
4. **Scenes exceed SDF-toy size** (meshes, instances); you need a BVH.
5. **You care about reproducibility** (stable material/light IDs and tables).

If you’re in “toy SDFs in Euclidean space” with a single BSDF and env light, stay Minimal.

---

## How to upgrade (incremental, low-risk)

**Stage A — Geometry ABI**
Add `localFrame`, `toLocal/toWorld`, and (documented) `geodesicStep`. Keep Euclidean implementations initially.
*Why:* Materials and tracers stop assuming Euclidean dot; future geometries drop in.

**Stage B — Materials registry**
Introduce `materialID` and table-driven parameters; route `bsdf_eval/sample/pdf` by ID.
*Why:* Multiple materials without shader spaghetti.

**Stage C — Light registry + NEE hooks**
Add `light_pick/sample/eval/pdf` and an env pdf; create a compact CPU `LightTable`.
*Why:* Unlocks NEE/MIS and fair comparisons.

**Stage D — Scene intersector façade**
Hide “how you hit things” behind `sceneIntersect`. Keep marching internally; later add a BVH path for meshes.
*Why:* Tracer stays stable while scenes evolve.

**Stage E — Acceleration (BVH)**
Add CPU BVH builder + GPU traversal code.
*Why:* Real scenes at interactive speeds.

**Optional — Media**
If/when volumetrics matter; start with homogeneous, then add grids.

Each stage preserves the previous ABI surface to avoid rewrites in photography/engine.

---

## Conventions to lock early (one page in `docs/Conventions.md`)

* **Metric & parameterization**: is `geodesicStep` affine or metric arc length? (Pick one; materials need consistent `cosTheta` semantics.)
* **Normal direction**: outward convention and how SDF gradients are **metric-normalized**.
* **Coordinate frames**: handedness and what `TBN` encodes (columns vs rows).
* **IDs**: stable `materialID`/`lightID` assignment and tables’ packing layout.
* **Color spaces**: material albedos in linear scene-referred units.

---

## Testing strategy (World)

* **Furnace test** (closed diffuse box): measured exitance ≈ albedo.
* **BSDF sanity**: energy conservation, reciprocity (numeric integration).
* **Geometry invariants**: geodesic step preserves metric length as specified; local frames orthonormal under metric.
* **Light sampling**: MIS balance heuristic sanity (power heuristic vs balance).
* **BVH**: randomized triangle clouds vs brute-force reference.

---

## TL;DR

* **Minimal World**: one GLSL bundle; Euclidean; single BSDF/light; quick results.
* **Expanded World**: geometry-aware ABI, scene façade, registries, (optional) media; ready for NEE/MIS, curved spaces, and larger scenes.
* **Upgrade when** you need geometric correctness, multiple materials/lights, NEE/MIS, or performance on bigger scenes.
* **Upgrade how**: add Geometry ABI → Material registry → Light registry → Scene façade → BVH, keeping the tracer/engine surfaces stable the whole way.
