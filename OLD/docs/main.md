
# Project Overview

## Purpose & Philosophy

This repository is a **research path tracer / ray marcher lab**: a playground for geometry-driven rendering experiments.

**Guiding principles:**

* **Geometry-first.** Shaders compile *against a geometry platform* (Euclidean now; others later).
* **Modular.** Cameras, integrators, postprocess passes, controls, libraries, and geometry are independent **plugins**.
* **Incremental & testable.** Small components with clear, explicit contracts.
* **Readable.** Code mirrors the math; cleverness never hides intent.

---

## Layering (who does what)

* **`core/`** — Pure TypeScript contracts and light utilities (no WebGL, no GLSL).
  Defines `Plugin`, `GLSLChunk`, `UniformDecl`, roles, `ChunkNames`, geometry contracts, `PipelineContext`, `ParameterDescriptor`, and `ParameterView`.

* **`systems/`** — Compiler-like mechanics:

  * `ShaderAssembler` — Concatenates GLSL, prefixes uniforms, enforces contracts.
  * `DependencyResolver` — Orders chunks by declared deps.
  * `UniformManager` — Namespaced uniform lookup/setters.
  * `ParameterManager` — User-facing parameters: metadata, persistence, validation.
  * `ProgramBuilder` — Builds the final fragment and compiles GPU programs.

* **`rendering/`** — WebGL resource helpers:

  * `ShaderProgram` — Compile/link/use shaders; small uniform helpers.
  * `ProgramCache` — Cache programs by stable key.
  * `FullscreenQuad` — Shared fullscreen geometry for passes.
  * `BufferManager` — Named textures/AOVs, FBOs, ping-pong, clear/resize, blit.
  * `ScreenPresenter` — Final pass: apply postprocess to HDR texture, present to screen.

* **`tracer/`** — High-level orchestration:

  * `Tracer` — Central façade: registers plugins, manages parameters, handles progressive accumulation, runs the frame loop.
  * `VariantManager` — Defines and compiles alternate plugin configurations.

* **`geometry/`** — Geometry platforms (runtime + shader halves).

* **`integrators/`** — Rendering algorithms (one-shot to progressive).

* **`scenes/`** — Scene definitions (SDF demos today; BVH/mesh later).

* **`plugins/`** — Remaining roles (camera, postprocess, controls, libs).

* **`glsl/`** — Shared GLSL snippets.

---

## Roles & Contracts

Exactly **one active plugin per role** at build time (except `"lib"`, which is additive).

* **`"geometry"`** — contributes GLSL types & ops the rest of the pipeline compiles against.

* **`"camera"`** — must provide:

  ```glsl
  Ray generateRay(vec2 filmUV); // filmUV in [0,1]^2
  ```

* **`"integrator"`** — must provide:

  ```glsl
  vec3 integrate(vec2 fragCoord); // fragCoord in pixel coords
  ```

  * **One-shot** integrators (e.g., Normals, Lambert) compute a full image in a single pass.
  * **Progressive** integrators (e.g., PathTracerMinimal) emit HDR samples and accumulate over frames. The engine provides counters/history and handles presentation.

* **`"postprocess"`** — takes HDR to LDR (tone map, color space, denoise, etc.):

  ```glsl
  vec3 postprocess(vec3 hdr);
  ```

* **`"scene"`** — world definition; canonical chunks:

  * `Scene.Intersect` — closest hit (e.g., SDF sphere tracing).
  * `Scene.Normal` — surface normal (analytic or finite difference).
  * `Scene.Material` — returns `Material` for a material id.
  * `Scene.Types` — shared `Hit`/`Material` structs (injected early).

* **`"controls"`** — optional CPU-only interaction (no GLSL contract).

* **`"lib"`** — additive GLSL helpers (multiple allowed).

### Canonical chunk names

```ts
export const ChunkNames = {
  GeometryTypes:       "geometry.types",
  GeometryOps:         "geometry.ops",
  CameraGenerateRay:   "camera.generateRay",
  IntegratorIntegrate: "integrator.integrate",
  DisplayDisplay:      "postprocess.postprocess", // (role renamed to 'postprocess')
  SceneSDF:            "scene.sdf",               // convenience for demo scenes
} as const;
```

> **Note:** The role formerly called `"display"` was renamed to `"postprocess"`.

---

## Geometry Modules

A **geometry module** pairs a shader plugin and a runtime:

* **Shader plugin** (`role: "geometry"`) supplies:

  * `geometry.types` — canonical types (`Point`, `Dir`, `Ray`, `Frame`, …).
  * `geometry.ops` — metric-aware ops (`dot_g`, `normalize_g`, …).

* **Runtime object** drives the camera frame on the CPU:

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

**Euclidean v0** is the first example geometry.

---

## Scene System

Scenes are first-class plugins (`role: "scene"`). Each provides:

* `Scene.Intersect`, `Scene.Normal`, `Scene.Material`, and the shared `Scene.Types`.
* Integrators list these chunks as deps; the assembler topo-sorts so types/helpers are defined before use.
* Any chunk mentioning `Hit`/`Material` also declares a dep on `Scene.Types`.

This gives a stable contract: integrators don’t worry about ordering; scenes can evolve (analytic normals, bounds, BVHs) without breaking integrators.

---

## Integrators

Integrators implement the rendering algorithm:

* **One-shot** (e.g., **Normals**, **Lambert**)

  * Single draw; no history.
  * Typically call `postprocess()` **inside their GLSL**.
  * Write LDR directly to the default framebuffer.

* **Progressive** (e.g., **PathTracerMinimal**)

  * Emit HDR radiance samples per frame.
  * Engine provides:

    * `u_frameIndex` — starts at 0, increments each frame.
    * `u_sampleCount` — number of accumulated samples in history.
    * `u_historyColor` — previous HDR (read-only) from the history ping-pong.
  * Engine accumulates into a **history ping-pong** via `BufferManager`, then uses **`ScreenPresenter`** to apply the active postprocess plugin and blit to screen.
  * Accumulation resets automatically on resize, parameter changes (as flagged), or integrator/variant switch.

> **Design intent:** Keep one-shots as simple as possible while using the **same engine spine** to scale up to complex path tracers (variance buffers, AOVs, reprojection, reservoirs) later.

---

## Parameters

The **parameter system** bridges UI controls and plugin state. Parameters are **not uniforms**; they include ranges, units, validation, persistence, and mapping.

```ts
parameters(): ParameterDescriptor[] { ... }
applyParameters(view: ParameterView, ctx?: PipelineContext): void
```

`Tracer` registers descriptors and applies parameter values each frame.
Progressive integrators should mark history-invalidating params (e.g., camera pose, roughness) so the engine can reset accumulation.

---

## Uniforms

* Plugins declare uniforms in TS via `uniforms()`; the assembler prefixes names by namespace:

  * camera `cam_pos` → `u_cam_pinhole_cam_pos`
* Plugins do **not** declare GLSL `uniform`s directly.
* Binding happens in `Tracer.frame()` via `applyUniforms(view, ctx)`.

**Reserved globals (no prefix):**

* `u_resolution`
* (progressive only) `u_frameIndex`, `u_sampleCount`, `u_historyColor`

---

## Shader Assembly & Program Build

* **ShaderAssembler** collects, dedupes, and topo-sorts chunks.
* Fails if required contracts are missing: `camera.generateRay`, `integrator.integrate` (and normally a `postprocess.postprocess` plugin should be present in the build, even if progressive presents externally).
* The fragment **epilogue** is minimal by design:

  ```glsl
  void main() {
    vec3 color = integrate(gl_FragCoord.xy); // HDR or LDR depending on integrator
    outColor = vec4(color, 1.0);             // One-shots usually already postprocess in-shader
                                             // Progressive is presented via ScreenPresenter
  }
  ```
* **ProgramBuilder** compiles GLSL to a `ShaderProgram`.
* **ProgramCache** avoids stale reuse across role/source changes.

---

## Tracer: Frame Lifecycle

1. **Register plugins**: geometry, camera, scene, integrator, postprocess (and any CPU-only controls).
2. **Build**: assemble + compile base and variant pipelines.
3. **Per frame**:

  * **CPU pre-phase**: apply parameters; run `controls.update(dt)`.
  * **GPU phase**:

    * Use compiled program; set `u_resolution`.
    * If **progressive**:

      * Increment `frameIndex`, `sampleCount`.
      * Bind `history.read` for sampling; draw to `history.write`.
      * Swap ping-pong; present HDR via `ScreenPresenter` (postprocess once).
    * If **one-shot**:

      * Draw directly to the default framebuffer (postprocess is in-shader).

Resets (history clear and counters) happen on **resize**, **integrator/variant switch**, and **parameter changes** flagged as accumulation-invalidating.

---

## Variants

* `Tracer.addVariant(name, overrides)` defines alternates (e.g., a fast Normals variant).
* `Tracer.buildAll()` precompiles base + variants for hot-switching.
* `Tracer.useVariant(name)` swaps active configuration at runtime.
* Parameters persist across variants when namespaces match.

---

## File & Directory Layout

```txt
src/
  core/                        // Core contracts, roles, and shared type definitions
    types.ts                  // Plugin, GLSLChunk, UniformDecl, ChunkNames, ...
    Engine.ts                 //the main engine

  systems/                    // CPU-side orchestration utilities
    ProgramBuilder.ts         // Assembles GLSL into a ShaderProgram
    DependencyResolver.ts     // Orders chunks by declared deps
    UniformManager.ts         // Namespaced uniform setters
    ParameterManager.ts       // Parameter registry + views
    ShaderAssembler.ts        // building shader files from all the components

  rendering/                  // Low-level WebGL resources
    ShaderProgram.ts          // WebGLProgram wrapper (compilation + uniform helpers)
    ProgramCache.ts           // Cache keyed by sources + config
    FullscreenQuad.ts         // Fullscreen geometry for passes
    BufferManager.ts          // Named textures/FBOs, ping-pong, clear/resize, blit
    ScreenPresenter.ts        // Takes HDR texture + postprocess plugin, blits to screen

  tracer/                     // Engine spine
    Tracer.ts                 // Plugin orchestration, frame loop, progressive vs one-shot
    VariantManager.ts         // Prebuilds and hot-switches variants
    types.ts                  // Internal types for compiled pipelines, etc.
    FrameRenderer.ts          // Rendering a frame to a buffer
    ProgressiveRenderer.ts    // Managing the details of an accumulation loop
    

  geometry/                   // Geometry platforms (runtime + shader halves)
    euclidean/                // Example Euclidean implementation
    hyperbolic/               // (planned) Hyperbolic geometry

  integrators/                // Rendering algorithms (top-level)
    NormalsIntegrator.ts      // One-shot: normal visualization
    LambertIntegrator.ts      // One-shot: Lambert + simple spec
    PathTracerMinimal.ts      // Progressive: cosine path tracer with accumulation

  scenes/                     // Scene definitions (top-level)
    SDFDemo.ts                // Demo scene using signed distance fields

  plugins/                    // Remaining role implementations
    camera/
      PinholeCamera.ts
    postprocess/
      TonemapSRGB.ts          // Reinhard + sRGB
    controls/
      KeyboardControls.ts
      FPSControls.ts
    lib/                      // Optional GLSL helpers (additive)

  glsl/                       // Shared GLSL snippets
    fullscreen.vert           // Basic vertex shader for fullscreen passes

  main.ts                     // Example entrypoint wiring camera, scene, integrator, postprocess
```

---

## Build/Execute Example

```ts
const tracer = new Tracer({ canvas, vertexSrc });
const { module: geo, frame } = createEuclideanModule();

tracer.use(geo.shader);
tracer.setContext({ geometry: { runtime: geo.runtime, frame } });

tracer
  .use(new PinholeCamera({ fovYDeg: 60 }))
  .use(new SDFDemo())                // from top-level scenes/
  .use(new PathTracerMinimal())      // progressive integrator (HDR + accumulation)
  .use(new TonemapSRGB());           // postprocess plugin used by ScreenPresenter

// “Fast” variant for quick interaction
tracer.addVariant("fast", { integrator: new NormalsIntegrator() });

tracer.buildAll();

function resize() { tracer.setSize(canvas.width, canvas.height); }
function loop()   { tracer.frame(); requestAnimationFrame(loop); }
resize();
loop();
```

---

## Conventions & Guardrails

* **Uniforms**: declare in TS, never inline GLSL. Let the assembler prefix them.
* **Chunk names**: always use `ChunkNames`.
* **Namespaces**: stable, descriptive. They define uniform prefixes and cache keys.
* **Parameters**: keep metadata accurate; flag those that require accumulation reset.
* **Readable GLSL**: short fields, clear names.
* **Geometry first**: define `geometry.types` and `geometry.ops` before others.
* **Scenes**: always provide `Scene.Intersect` and `Scene.Material`; normals are optional but recommended.

---

## Next Steps

* Progressive extensions: variance/AOVs, reprojection, temporal reservoirs.
* Compositional submodules: samplers, accumulators, estimators (mix & match).
* Multi-pass pipelines and MRT when needed.
* Postprocess growth: ACES/filmic curves, denoise, screenshots/recording.
* Dev ergonomics: shader hot-reload, profiling hooks.

---

