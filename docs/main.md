
# Project Overview

## Purpose & Philosophy

This repository is a **research path tracer / ray marcher lab** designed as a playground for geometry-driven rendering experiments. Its guiding principles are:

* **Geometry-first.** Shaders compile *against a geometry platform* (Euclidean now; others later).
* **Modular.** Cameras, integrators, displays, controls, libraries, and geometry can be swapped independently as **plugins**.
* **Incremental & testable.** Each component is small, self-contained, and exposes obvious contracts.
* **Readable.** Names and code mirror the math. Cleverness is avoided if it hides intent.

---

## Layering (who does what)

* **`core/`** — Pure TypeScript contracts and light utilities (no WebGL, no GLSL).
  Defines `Plugin`, `GLSLChunk`, `UniformDecl`, roles, `ChunkNames`, geometry contracts, `PipelineContext`, `ParameterDescriptor`, and `ParameterView`.

* **`systems/`** — Compiler-like mechanics:

  * `ShaderAssembler` — Concatenates GLSL chunks, prefixes uniforms, enforces contracts.
  * `DependencyResolver` — Orders chunks by dependencies.
  * `UniformManager` — Scoped lookup and setters for prefixed uniforms.
  * `ParameterManager` — Central registry of user-facing parameters (metadata, persistence, validation).
  * `ProgramBuilder` — Assembles GLSL + compiles GPU programs.

* **`rendering/`** — WebGL helpers:

  * `ShaderProgram` — Compile/link/use shaders.
  * `ProgramCache` — Cache compiled programs by stable key.
  * `FullscreenQuad` — Draws a fullscreen quad to run fragment shaders.

* **`tracer/`** — High-level orchestration:

  * `Tracer` — Execution façade: registers plugins, manages parameters, runs the frame loop.
  * `VariantManager` — Defines and manages alternate plugin configurations.

* **`geometry/`** — Runtime geometry modules (CPU side) paired with shader plugins.

* **`plugins/`** — Swappable per-role providers (camera, integrator, display, scene, libs, etc.).

---

## Roles & Contracts

Exactly **one active plugin per role** at build time (except `"lib"`, which is additive).

* `"geometry"` — contributes GLSL types and ops the rest of the pipeline compiles against.
* `"camera"` — must provide `camera.generateRay`:
  `Ray generateRay(vec2 filmUV /* in [0,1]^2 */);`
* `"integrator"` — must provide `integrator.integrate`:
  `vec3 integrate(vec2 fragCoord /* in pixel coords */);`
* `"display"` — must provide `display.display`:
  `vec3 display(vec3 hdr);`
* `"scene"` — defines the world (e.g., SDF).
* `"controls"` — optional CPU-side interaction logic (no GLSL contract).
* `"lib"` — helper code, multiple allowed, provides named GLSL chunks.


* `"scene"` — defines the world. Provides chunks under canonical names:

  * `Scene.Intersect` — computes the closest intersection along a ray  
    (today: sphere tracing over SDFs). Returns a `Hit` struct.

  * `Scene.Normal` — computes the geometric surface normal at a hit  
    (today: finite-difference gradient of the SDF). Optional, but present in demo scenes.

  * `Scene.Material` — maps a material id to a `Material` record  
    (`baseColor`, `roughness`, `metalness`, `emission`).

  * `Scene.Types` — shared struct definitions for `Hit` and `Material`.  
    This chunk is injected once globally, always ordered early alongside  
    `geometry.types`/`geometry.ops`.

  Integrators declare dependencies on these chunks, so the assembler topo-sorts  
  them before `integrate()`. Any chunk that mentions `Hit` or `Material` also  
  declares a dep on `Scene.Types`, ensuring correctness.


### Canonical chunk names

```ts
ChunkNames = {
  GeometryTypes:       "geometry.types",
  GeometryOps:         "geometry.ops",
  CameraGenerateRay:   "camera.generateRay",
  IntegratorIntegrate: "integrator.integrate",
  DisplayDisplay:      "display.display",
  SceneSDF:            "scene.sdf", // convenience name for demo scenes
} as const;
```

---

## Geometry Modules

A **geometry module** is a pair of:

* A **shader plugin** (role `"geometry"`) contributing:

  * `geometry.types` — canonical type definitions.
  * `geometry.ops` — metric-aware operations (`dot_g`, `normalize_g`, etc.).
* A **runtime object** implementing:

  ```ts
  interface GeometryRuntime<F extends GeoFrame> {
    createDefaultFrame(): F;
    moveLocal(frame: F, local: Vec3, speed: number, dt: number): void;
    rotateLocal(frame: F, angular: Vec3, rotSpeed: number, dt: number): void;
    stabilize?(frame: F): void;
  }
  ```

Together:

```ts
interface GeometryModule<F extends GeoFrame> {
  shader: Plugin;              // GLSL half
  runtime: GeometryRuntime<F>; // CPU half
}
```

The first example is **Euclidean v0**.

### GLSL Types & Ops (Euclidean v0)

```glsl
#define Point vec3
#define Dir   vec3

struct Tangent { Point p; Dir v; };
struct Ray     { Point o; Dir d; };
struct Frame   { Point p; Dir f; Dir u; Dir r; };

Tangent at(Point p, Dir v);
Ray     makeRay(Point o, Dir d);
float   dot_g(Point p, Dir a, Dir b);
Dir     normalize_g(Point p, Dir v);
```

In Euclidean, the metric ignores `Point p`; in curved geometries it won’t.

---

## Parameters

The **parameter system** bridges user controls and plugin state.

Parameters are **not uniforms**: they include metadata (ranges, units, UI hints), validation, persistence, and mapping logic. Plugins opt-in via:

```ts
parameters(): ParameterDescriptor[] { ... }
applyParameters(view: ParameterView, ctx?: PipelineContext): void
```

`Tracer` automatically registers and applies parameters each frame.

---

## Uniforms

* Plugins declare uniforms in TS via `uniforms()`.
* At link time, **ShaderAssembler** prefixes names by namespace:

  * camera `cam_pos` → GPU name `u_cam_pinhole_cam_pos`.
* Plugins never declare GLSL `uniform`s directly.
* Binding happens in `Tracer.frame()`:
  `applyUniforms(view, ctx)` called on each plugin.

Reserved globals (no prefix):
`u_resolution` (present now), later `u_time`, `u_frame`, `u_sampleCount`, `u_history`.

---

## Shader Assembly & Program Build

* **ShaderAssembler** collects, deduplicates, and topo-sorts chunks.

* Geometry types/ops are placed first.

* Fails if required contracts (`generateRay`, `integrate`, `display`) are missing.

* Assembler produces a full fragment shader with a stable `main()`.

* **ProgramBuilder** wraps this: it builds the fragment, hashes sources, caches/reuses `ShaderProgram`, and returns a `CompiledPipeline` with scoped `UniformManager`s.

---

## Variants

* `Tracer.addVariant(name, overrides)` defines an alternate configuration.
* Variants override any subset of roles.
* `Tracer.buildAll()` compiles base + all variants.
* `Tracer.useVariant(name)` switches at runtime.
* Parameters persist across variants if the same plugin namespace is used.
* All variants share the same geometry runtime.

---

## Program Caching

`ProgramCache` stores `ShaderProgram`s by a composite key:

* active plugin namespaces + hash of GLSL sources.
  This avoids stale reuse when two different fragments share the same role list.

---

## File & Directory Layout

```
src/
  core/                 // contracts & types
  systems/              // ShaderAssembler, DependencyResolver, UniformManager, ParameterManager
  rendering/            // ShaderProgram, ProgramCache, FullscreenQuad
  tracer/               // Tracer, ProgramBuilder, VariantManager
  geometry/             // runtime + shader halves (euclidean/, hyperbolic/, …)
  plugins/              // swappable role implementations
  glsl/                 // raw GLSL snippets
  main.ts               // example entrypoint
```

---

## Build/Execute Lifecycle

```ts
const tracer = new Tracer({ canvas, vertexSrc });
const { module: geo, frame } = createEuclideanModule();

tracer.use(geo.shader);
tracer.setContext({ geometry: { runtime: geo.runtime, frame } });

tracer
  .use(new PinholeCamera({ fovYDeg: 60, parameters: ["fov"] }))
  .use(new SceneSDFDemoPlugin())
  .use(new LambertIntegrator())
  .use(new SRGBDisplayPlugin());

// Define a fast variant
tracer.addVariant("fast", { integrator: new NormalsIntegrator() });

tracer.buildAll();

function resize() { tracer.setSize(canvas.width, canvas.height); }
function loop() { tracer.frame(); requestAnimationFrame(loop); }
```

---

## Conventions & Guardrails

* **Uniforms**: declare in TS, never inside GLSL chunks.
* **Chunk names**: always use `ChunkNames` constants.
* **Stable chunks**: call `p.chunks()` once per plugin and reuse.
* **Namespaces**: stable and descriptive — they determine uniform prefixes and cache keys.
* **Parameters**: opt-in; keep metadata accurate; use `resetAccumulation` flag when progressive rendering is added.
* **Readable GLSL**: short struct fields, clear function names.
* **Geometry first**: always define `geometry.types` and `geometry.ops` before others.
* **Scenes**:
  - Always provide `Scene.Intersect` and `Scene.Material`.
  - Provide `Scene.Normal` if possible (integrators can fallback if absent).
  - Declare deps correctly: anything that uses `Hit`/`Material` must list `Scene.Types`;  
    anything that calls a local map function must list `Scene.Intersect`.
  - `Scene.Types` is also injected globally and explicitly ordered early in `geometryFirst()`,  
    so types are guaranteed to exist before use.
---

## Next Steps

* **Accumulation system**: add history textures and counters, reset on variant switch/resize/parameter change.
* **Multipass pipelines**: render-to-texture, MRT, post-processing stages.
* **Controls unification**: possibly fold controls into `Engine` for consistency.
* **Developer ergonomics**: shader hot-reload, clearer error reporting, profiling hooks.



### Future Scene Directions

The scene contract is deliberately minimal (Intersect, Normal, Material, Types), but
is designed to extend cleanly. Planned additions include:

* **Optional capabilities** signaled by defines:  
  `SCENE_HAS_NORMAL`, `SCENE_HAS_SIGNED_DISTANCE`, `SCENE_HAS_BOUNDS`.

* **`Scene.SignedDistance`** — raw SDF evaluation. If present, the engine could inject a
  default marcher when `Scene.Intersect` is missing.

* **`Scene.Bounds`** — returns bounding information (e.g. max t) so integrators don’t guess.

* **`Scene.AnyHit` / `Scene.Occluded`** — fast boolean shadow queries for lighting.

* **Analytic normals** — let primitives supply exact normals; fall back to numeric gradient.

* **Non-SDF scenes** — future support for meshes with BVHs or hybrid scenes mixing tracing and marching.

* **Scene parameters** — expose adjustable properties (e.g. sphere radius, color) via the parameter system.

These extensions can be added without breaking the current contract: integrators only
ever depend on the canonical `scene_*` functions, and the assembler enforces ordering.


---

Would you like me to also prepare a **changelog-style summary** (`docs/overview.md`) that highlights *what changed* in this refactor (Tracer slimmed, ProgramBuilder/VariantManager added), alongside this new authoritative `about.md`?
