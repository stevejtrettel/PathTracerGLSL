
# Scene System (v0 Spec)

This document describes the current **scene contract** in the tracer.  
It explains what a scene plugin must provide, how those pieces are stitched into the shader, and what future extensions are planned.

---

## Purpose

Scenes define the **contents of the world** for the tracer.  
They answer questions like:

- Does a given ray hit anything?
- If so, what material is at that hit point?
- What is the surface normal there (for shading)?

---

## Current Scene Contract (v0)

A scene is a plugin with `role: "scene"`. It contributes GLSL chunks under canonical names. The integrators then rely on these functions.

### Mandatory chunks (today)

- **`Scene.Intersect`**
  ```glsl
  Hit scene_intersect(Ray r, float tMin, float tMax);
````

* Takes a `Ray` and returns the closest intersection in `[tMin, tMax]`.

* Returns a `Hit` struct (`bool hit; float t; int mat;`).

* Implementation is free: today it’s **sphere tracing** over SDFs.

* Scenes define their own helper `sceneLocal_map()` that combines SDF primitives.

* **`Scene.Material`**

  ```glsl
  Material scene_material(int matId);
  ```

    * Maps an integer `matId` to a `Material` record.
    * `Material` is defined in `scene.types` and includes:

      ```glsl
      struct Material {
        vec3  baseColor;
        float roughness;
        float metalness;
        vec3  emission;
      };
      ```
    * Roughness is clamped into `[0.001, 1.0]`, metalness into `[0,1]`.

### Optional chunk (but provided in demo scenes)

* **`Scene.Normal`**

  ```glsl
  Dir scene_normal(Point p, Hit h);
  ```

    * Computes the geometric normal at a hit point.
    * Current demo scenes use a **finite-difference gradient of the SDF** (tetrahedron stencil).
    * Integrators like Lambert shading or Normal debug view call this.

### Shared chunk

* **`Scene.Types`**

  ```glsl
  struct Hit {
    bool  hit;
    float t;
    int   mat;
  };
  struct Material { ... };
  ```

    * Injected once, globally.
    * Required for any chunk that mentions `Hit` or `Material`.

---

## How inclusion works

1. **Scene plugin defines chunks** with `name = ChunkNames.SceneIntersect` etc.
2. **Each chunk lists dependencies**:

    * Any chunk using `Hit`/`Material` depends on `Scene.Types`.
    * Any chunk using the scene’s `_map` depends on `Scene.Intersect`.
    * All geometry-aware chunks depend on `GeometryTypes`.
3. **ShaderAssembler** collects, topologically sorts, and concatenates chunks:

    * `geometry.types` → `geometry.ops` → `scene.types` → `scene.intersect` → `scene.normal` → `scene.material` → …
    * Integrators list `Scene.*` deps, so those functions are guaranteed present before `integrate()` is emitted.

---

## Current Example Scenes

* **SceneSDFDemo**: sphere above a ground plane.
* **SceneThreeSpheres**: three spheres of different materials + ground.

Both scenes:

* Implement ray marching over their SDFs.
* Provide `scene_normal` via tetrahedral gradient.
* Return clamped `Material` records.

---

## Future Directions

The current contract is intentionally **minimal**. Extensions may include:

* **Optional capabilities** (indicated by preprocessor defines):

    * `SCENE_HAS_NORMAL`
    * `SCENE_HAS_SIGNED_DISTANCE`
    * `SCENE_HAS_BOUNDS`
* **`Scene.SignedDistance`**
  A raw SDF function `float scene_sdf(Point p)`
  → allows the engine to inject a default marcher when `Scene.Intersect` is absent.
* **`Scene.Bounds`**
  Provides scene bounding box or max range, so integrators don’t guess a `tMax`.
* **`Scene.AnyHit` / `Scene.Occluded`**
  Specialized for shadow rays: return a boolean if anything blocks a ray.
* **Analytic normals**
  If a primitive has a closed-form normal, provide a chunk `Scene.Normal` override; otherwise fall back to numeric gradient.
* **Non-SDF scenes**
  Mesh BVHs, ray-traced primitives, or hybrids where some parts are ray marched, some ray traced.
* **Scene parameters**
  Expose properties (e.g. sphere radius, colors) via the Parameter system.

---

## Design Philosophy

* **Keep the integrators clean.** They should just say:

  ```glsl
  Hit h = scene_intersect(ray, tMin, tMax);
  if (h.hit) {
    Point p = ray.o + ray.d * h.t;
    Dir n   = scene_normal(p, h);
    Material m = scene_material(h.mat);
  }
  ```
* **Scene owns geometry complexity.**
* **Assembler enforces order and contracts.**
* **Extensibility**: new chunks can be additive without breaking existing scenes.

---

````

---

# 📄 about.md — Scene section snippet

Here’s what to paste into your **main documentation file** (`about.md`):

```markdown
## Scene System (current status)

Scenes are now first-class plugins (`role: "scene"`) instead of ad hoc libs.  
Each scene provides GLSL chunks under canonical names:

- `Scene.Intersect` — computes the closest hit along a ray (today: SDF sphere tracing).
- `Scene.Normal` — computes a surface normal (today: finite-difference gradient of the SDF).
- `Scene.Material` — returns a `Material` record given a material id.
- `Scene.Types` — injected once globally, defines `Hit` and `Material` structs.

Integrators (`Lambert`, `Normals`) declare dependencies on these chunks.  
The `ShaderAssembler` topo-sorts and concatenates everything so that types and helpers are defined before use.

**Where we injected `scene.types`:**
- Added as a **built-in chunk** (`SceneTypesChunk`).
- Always inserted into the fragment if missing.
- Also explicitly ordered early in `geometryFirst()` (alongside `geometry.types/ops`).
- Any chunk that mentions `Hit` or `Material` also declares a dependency on it.

This guarantees a stable, extensible foundation: integrators never worry about ordering, and scenes can evolve (e.g. analytic normals, signed distances, BVHs) without breaking the contract.
````

