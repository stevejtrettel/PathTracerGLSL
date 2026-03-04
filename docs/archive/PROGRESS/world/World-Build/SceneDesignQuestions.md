Here’s a first-pass “problem description” doc you can hand to Future You / other LLMs.

---

# Scene Geometry & Compilation – Problem Description

## 1. Context and High-Level Goal

The path tracer architecture is split into modules; the **Scene module** is responsible for all geometric queries and material information. Its contract is:

```glsl
// Primary intersection
bool scene_intersect(Ray ray, out Hit hit);

// Shadow queries
bool scene_intersect_any(Ray ray, float max_t);

// Material queries
MaterialProperties scene_material_properties(int mat_id, Point p);
int scene_material_at(Point p);

// Scene information
float scene_bounding_radius();
```

with:

```glsl
struct Hit {
  Point p;
  Normal n;
  vec2 uv;
  float t;

  // Material interface (no object_id!)
  int material_from;
  int material_to;

  Frame frame;
}; :contentReference[oaicite:1]{index=1}
```

and a `MaterialProperties` struct whose fields are packed into uniform arrays (albedo, roughness, metallic, ior, emission, emission_strength, light_id, flags).

The Scene module **does not expose objects directly**; there is no `object_id` in `Hit`. Material IDs (and `light_id` inside material properties) are how the rest of the system interacts with geometry.

On the other side, the **author-facing world description** (TypeScript) is meant to be:

* A **single, flexible list of objects** in the scene.
* Expressed in terms of:

    * simple SDF shapes,
    * complex SDFs / CSG / fractals,
    * triangle meshes,
    * isosurfaces (f(x,y,z)=0),
    * multi-region multi-material shapes,
    * instanced geometry (hundreds or thousands of copies),
    * potentially algebraic varieties and other mathematically described sets.

The **Scene compiler** takes this “big list of objects” and must:

* Sort objects into appropriate categories (analytic, SDF, mesh, instances, etc.).
* Generate the GLSL code and data structures that implement the Scene module contract above.
* Hide all of this complexity from:

    * the **path tracer** (which only sees `scene_intersect`, `scene_intersect_any`, etc.), and
    * the **scene author** (who only sees a simple, uniform way to describe objects).

This document describes the **problem space**, the **requirements** that any solution must satisfy, and important **gotchas** to keep in mind.

It does **not** describe a particular architecture; it’s meant as neutral scaffolding for designing and comparing alternative solutions.

---

## 2. Geometry Types the System Must Support

We care about a broad family of geometric representations:

### 2.1. Simple primitives

* Spheres, planes, boxes, cylinders, etc.
* These often have:

    * **analytic intersection** (closed-form ray–shape solution),
    * and/or a simple **SDF** (d(p)) usable in marching and CSG.

### 2.2. Procedural / SDF-based shapes

* Arbitrary signed distance fields:

    * fractals,
    * smooth-union / CSG composites,
    * shapes defined by iterative procedures or PDE-style fields.
* Only intersectable via **marching**, possibly with scene-dependent step heuristics.
* Often expensive; we want to:

    * evaluate expensive base fields once per step,
    * derive multiple cheap region predicates from them.

### 2.3. Multi-region, multi-material objects

* A single “object” with several **internal regions**, e.g.:

    * glass shell + ceramic base + water + figurine + air bubble.

* Regions are identified by integer region IDs and mapped to material IDs.

* We need:

    * A function that returns distance + region at a point:

      [
      d(p),\ \text{region_id}(p)
      ]

    * A classifier ( \text{region_at}(p) ) for interface resolution (sampling just before/after a hit along the ray direction).

### 2.4. Triangle meshes (with BVH)

* Imported triangle models:

    * potentially millions of triangles,
    * per-vertex attributes (normals, UVs, etc.),
    * hierarchical acceleration structures (BVHs or similar).

* We need to support:

    * one or many mesh assets,
    * multiple instances of each mesh with different transforms/materials,
    * a BVH layout compatible with GLSL/WebGL/WebGPU limits.

### 2.5. Isosurfaces / algebraic varieties

* Surfaces defined as:

  [
  f(x,y,z) = 0
  ]

  where (f) might be a low-degree polynomial or a more complex function.

* Intersection options:

    * Marching (treat as SDF-like, if we can approximate a distance),
    * Root-finding in the ray parameter (t) (e.g. solving (f(r(t)) = 0)).

### 2.6. Instanced geometry

Two main flavors:

1. **Scene-level instancing**:

    * Many copies of a base object, each with its own transform/material.
    * Expressed as a large list of author-level objects that share common geometry.

2. **Buffer/UBO-based instancing**:

    * Large numbers of simple primitives (spheres, boxes, etc.) or mesh instances whose parameters are stored in GPU buffers/UBOs.
    * Intersection is done via:

        * per-instance BVHs,
        * or a global BVH over all instances,
        * or structured loops over instance data (for smaller counts).

The long-term design must cover **both** styles (and allow migrating from one to the other).

---

## 3. Constraints from the Scene Module Contract

Whatever internal geometry machinery we build, the resulting Scene module must:

1. **Implement the public GLSL interface exactly**:

    * `scene_intersect(Ray, out Hit)`,
    * `scene_intersect_any(Ray, max_t)`,
    * `scene_material_properties(mat_id, p)`,
    * `scene_material_at(p)`,
    * `scene_bounding_radius()`.

2. **Fill the `Hit` struct correctly**:

    * geometric data (p, n, uv, t, frame),
    * **material interface**: `material_from` and `material_to`, with no object IDs.

3. **Use material IDs and `light_id` consistently**:

    * `scene_material_properties` returns a packed `MaterialProperties` struct, with `light_id` pointing into the global light array managed by the Lighting module and World compiler.

4. **Respect the special material conventions**:

    * `MATERIAL_AIR = 0` reserved for empty space.
    * Light materials occupy a specific range of IDs above regular materials.

5. **Work with volume transport**:

    * `scene_material_at(p)` is used for volume tracking, so its behavior must be well-defined both:

        * inside multi-region objects,
        * and in “empty” regions between objects.

6. **Provide a correct bounding radius**:

    * `scene_bounding_radius()` must contain all geometry; Lighting uses it for environment sampling.

This implies that any internal geometry scheme has to:

* Support **interface resolution via epsilon sampling** (sampling just outside/inside a surface along the ray direction, then mapping classification to material IDs).
* Provide a notion of **“material at point”** for surfaces and volumes.

---

## 4. Pipeline Layers and Separation of Concerns

We have (at least) three conceptual layers:

1. **Author-level scene description (TypeScript)**

    * Simple, composable description of the world:

        * list of objects,
        * each with geometry, material references, and parameters.

    * Intended to be **independent** of:

        * the exact intersection method,
        * BVH layout,
        * SDF vs analytic vs mesh details.

2. **Scene compilation / world compilation**

    * Takes the author-level description and:

        * groups objects by representation type (SDF, analytic, mesh, instance, etc.),
        * builds the data structures (BVHs, uniform arrays, textures/buffers),
        * generates specialized GLSL code implementing scene functions.

    * Coordinates material and light information with the Lighting module via World compiler, ensuring consistent `light_id` use.

3. **Scene module (GLSL)**

    * The compiled GLSL module that exposes the public contract, used by Transport and other modules.

The **problem** is to design the middle layer (scene/world compilation) so that:

* the author-facing layer remains simple and stable,
* the Scene module contract is satisfied,
* and future complexity (meshes, instancing, isosurfaces, etc.) can be accommodated without rewriting everything.

---

## 5. Design Axes and Tradeoffs

Any architecture will be making tradeoffs along several axes:

### 5.1. Geometry representation vs tracing strategy

We essentially have at least two tracing modes:

1. **One-shot traces (analytic + meshes)**:

    * primitives with closed-form intersection,
    * triangle meshes with BVH traversal.

2. **Marching traces (SDFs + isosurfaces)**:

    * shapes requiring iterative stepping along the ray,
    * possibly sharing a common marching loop over combined SDFs/isosurfaces.

Open questions / axes:

* Do we implement **one unified intersection kernel** that handles everything, or **separate kernels** (e.g. `trace_analytic_objects`, `march_objects`, pick nearest)?
* How do we coordinate **multi-region SDF objects** with analytic primitives and meshes so that `material_from/material_to` is always correct?

### 5.2. Code generation vs shared kernels

Options span from:

* **Fully per-object specialized code**:

    * Each object has its own SDF/intersect function,
    * dispatch unrolled for small object counts,
    * simple loops for larger ones.

* **Shared generic kernels**:

    * A single “sphere-intersect” function used for many spheres,
    * sphere data stored in arrays/UBOs, accessed by index,
    * heavy use of loops and indirection.

Tradeoffs:

* Specialized code can be easier to reason about (and often faster for tiny scenes), but:

    * increases shader size,
    * can be difficult to scale to thousands of objects.

* Shared kernels require more indirection but scale better for large instanced scenes.

### 5.3. Parameter system integration

You already have a **parameter system** that supports:

* constants,
* uniform-backed parameters,
* GLSL snippets (procedural).

Any geometry design must:

* Integrate with this system for:

    * positions, radii, transforms,
    * region thresholds,
    * SDF parameters,
    * mesh transforms and instance transforms.

* Respect GPU limits on:

    * uniform count,
    * buffer sizes,
    * texture lookups.

### 5.4. Object identity vs material-only interface

Given that `Hit` does **not** track object identity, we must:

* Resolve all questions about:

    * which materials we are entering/exiting,
    * which lights are associated with materials,

  using only:

    * `material_from`, `material_to`,
    * `scene_material_properties`,
    * `scene_material_at`.

For multi-region objects this suggests:

* Region logic must be expressible as:

    * “region at point” functions,
    * plus a mapping from region IDs to material IDs, used by a generic interface-resolution procedure.

The geometry layer cannot rely on object-level special cases at shading time.

---

## 6. Checklist of Requirements for Any Geometry/Scene Compilation Design

This is a concrete checklist to evaluate candidate designs against.

### 6.1. Authoring / API Requirements

* **Single scene description**:

    * Scene author sees a single list/collection of objects,
    * Each object has a clear notion of:

        * geometry type or description,
        * attached material(s),
        * parameters (possibly nested, e.g. `geom.sphere.radius`).

* **Support for all geometry families**:

    * simple primitives,
    * arbitrary SDFs,
    * multi-region shapes,
    * triangle meshes,
    * isosurfaces,
    * instanced geometry.

* **Parameter-system compatibility**:

    * Geometry properties can be constant, param-based (uniform), or procedural GLSL, using the same mechanisms already used for materials.

* **Extensibility**:

    * Adding a new geometry type should not require touching dozens of unrelated files.
    * Scene authors should be able to define “custom geometry” without understanding internal accelerations.

### 6.2. Scene Module Interface & Correctness

* Implements `scene_intersect` / `scene_intersect_any` with:

    * correct closest-hit logic across **all** geometry types,
    * correct handling of shadow rays (early exit, cheaper marching where possible).

* Implements `scene_material_properties` and `scene_material_at` consistently:

    * multi-region objects assign correct materials to regions,
    * nested dielectrics and volumes behave correctly at interfaces.

* Ensures `scene_bounding_radius()` encloses all geometry (including meshes and instances).

* Correctly integrates with the Lighting module via material `light_id`:

    * emissive materials have valid light IDs,
    * non-emissive materials have `light_id = -1`, verified at world compile time.

### 6.3. Geometry & Tracing Requirements

* **Mixed tracing strategies**:

    * Support at least:

        * direct analytic intersection (primitives, meshes),
        * marching-based intersection (SDFs, isosurfaces).

    * Provide a clear scheme for:

        * how these results are combined,
        * which representations share marching loops,
        * how order is chosen (e.g. “analytic first, then marching”).

* **Multi-region behavior**:

    * Multi-region objects provide:

        * distance + region at a point,
        * region classification function over space.

    * Interface resolution is performed in a **generic** scene-level procedure using epsilon sampling and `scene_material_at`, not per-object hacks.

* **Instancing**:

    * Support both:

        * many separate objects sharing geometry (small/medium counts),
        * buffer/UBO-driven instance clouds (large counts).

    * Ensure instance transforms and materials cooperate with:

        * BVH layouts,
        * parameter system, if instance properties are parameterized.

* **Meshes**:

    * World compiler can build BVHs for mesh triangles,
    * Intersections integrate with `scene_intersect` in a way that remains consistent with SDF/marching hits (including normals, UVs, and materials).

### 6.4. Performance & Practical Constraints

* **Shader size / instruction count**:

    * Avoid exponential code growth for large scenes (e.g. thousands of objects),
    * Carefully choose when to unroll vs loop.

* **Uniform and buffer limits**:

    * Keep within WebGL/WebGPU uniform limits,
    * Use textures/SSBOs/buffers for large tables (triangle data, instance params, etc.).

* **Distance field cost vs branching cost**:

    * In marching code, cost is dominated by SDF evaluation rather than branching, so designs that improve SDF sharing and specialization usually win over micro-optimizing branches.

* **Acceleration structures**:

    * BVH building happens in the world compiler (or host CPU) rather than in GLSL,
    * Scene module only traverses a pre-baked layout.

### 6.5. Debugging & Tooling

* Ability to:

    * visualize contribution per object/group,
    * bypass certain geometry classes (e.g. “disable meshes”),
    * debug SDFs and region classifiers (e.g. coloring by region ID),
    * validate consistency (e.g. materials that emit have valid light IDs, samplable lights in range).

* Clear mapping from author-level objects to compiled GLSL pieces, for debugging and performance analysis.

---

## 7. Gotchas and Failure Modes to Watch For

Some specific pitfalls a design should avoid:

### 7.1. Leaking object identity back into the public interface

* Temptation: “Just add `object_id` to `Hit` and be done.”

* Problem: This breaks the clean material-based architecture:

    * Transport and Lighting would start depending on object-level information,
    * Multi-region objects and CSG-based shapes become awkward,
    * Volume interactions get confused if “object = material” is assumed.

* Requirement: keep object identity as an **internal detail** of the Scene module and compilation, not part of the public contract.

### 7.2. Mixing interface resolution into geometry primitives

* It might look convenient to let each multi-region object do its own interface resolution, but:

    * This duplicates “epsilon sampling + classification” logic,
    * Makes it hard to reason about volumes and nested dielectrics consistently.

* Better: multi-region geometries only provide:

    * distance,
    * region ID / classifier,

  and a **single generic** interface-resolution routine uses these to fill `material_from/material_to`.

### 7.3. Parameter explosion

* If every small geometric property becomes a separate uniform:

    * uniform limits can be exceeded,
    * binding logic becomes unmanageable.

* Designs need to consider:

    * struct-like packing in uniform arrays,
    * textures/buffers for large parameter tables,
    * per-object vs per-type parameter granularity.

### 7.4. Over-specialization vs data-driven kernels

* Full per-object specialization makes scenes with many objects unwieldy:

    * huge shader code,
    * slow compilation,
    * difficulty fitting in driver/compiler limits.

* Fully generic data-driven kernels might:

    * obscure what’s happening,
    * introduce subtle performance issues,
    * complicate debuggability.

The design needs a **clear strategy** for:

* when to specialize,
* when to share code and use data structures instead.

### 7.5. Instancing corner cases

* Multiple instances of a base geometry with different materials:

    * need a robust material ID mapping strategy,
    * must play nicely with multi-region materials (e.g. one mesh, many material assignments).

* Instances may have:

    * non-uniform transforms (scales, shears),
    * per-instance variation in procedural parameters,
    * different texture coordinates or UV transforms.

All of these should still be describable in the author-level scene without exposing the full complexity of how instance data is packed on the GPU.

### 7.6. Mesh/SDF interaction

* Combining:

    * SDF-based marching for some objects,
    * mesh/BVH-based analytic intersection for others,

  introduces subtle questions:

    * Are we tracing them in separate kernels then comparing distances?
    * Are we marching in a medium that also contains meshes?
    * How is `scene_material_at(p)` defined if we’re inside a mesh volume and near an SDF region?

Any design must consider these interactions and ensure that:

* the final `scene_intersect` is well-defined,
* `scene_material_at(p)` is consistent, even in mixed representations.

---

## 8. Open Questions for Architecture Exploration

When comparing concrete solutions, it will be helpful to explicitly ask:

1. **Where is knowledge about “what geometry types exist” centralized?**

    * Is there a central registry?
    * Are types discovered via imports?
    * How costly is it to add/remove a geometry kind?

2. **How are geometry capabilities expressed?**

    * Does each object specify its tracing mode (SDF, analytic, mesh, instance)?
    * Can a single object support multiple modes (e.g. both SDF and analytic)?

3. **How does the Scene compiler group and order geometry?**

    * Does it explicitly build:

        * “analytic group”,
        * “marching group”,
        * “mesh group”,
        * “instance group”?

    * How are these groups combined into a single `scene_intersect` implementation?

4. **How much source inspection is assumed?**

    * Are SDFs/isosurfaces treated as opaque GLSL black boxes?
    * Or is the compiler allowed to parse/transform them?

5. **What story do we adopt for large-scale instancing?**

    * Is there a standard pattern for:

        * sphere clouds,
        * instanced meshes,
        * or procedural instance generation?

6. **How does the design interact with hot-reload and live editing?**

    * If the scene description changes (e.g. new object added, parameter schemes altered), what needs recompilation?
    * Can we preserve stable uniforms/locations across recompiles?

---

This is the problem landscape: a simple author-level scene description on one side, a strict Scene module contract on the other, and a complex middle layer that must support many geometry types, mixed tracing strategies, and multi-region materials while staying debuggable and evolvable.

Any candidate architecture should be evaluated against the checklist in §6 and the pitfalls in §7.
