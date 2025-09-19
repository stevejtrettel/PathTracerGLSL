# Current State & Next Steps

## What’s working (end-to-end)
- **Assembler & engine path**
  - Role-based plugin registry (`core/Engine`).
  - `ShaderAssembler` with: uniform prefixing, duplicate chunk detection, geometry-first ordering, required-contract checks.
  - **Fix in place:** assembler now calls `p.chunks()` **once per plugin** and reuses objects for prefixing (prevents missed replacements).
- **Rendering path**
  - `ShaderProgram`, `ProgramCache`, `FullscreenQuad`.
  - `Tracer` with `use → build → frame`, DPR-aware resize, optional `PipelineContext`.
- **Geometry v0**
  - `EuclideanGeometryPlugin` (GLSL chunks: `geometry.types`, `geometry.ops`).
  - `EuclideanRuntime` (CPU frame `{p,f,u,r}` + `moveLocal`, `rotateLocal`, `stabilize`).
  - `EuclideanModule` bundles shader+runtime; app exposes `{ runtime, frame }` via `Tracer.setContext`.
- **Camera**
  - `PinholeCameraPlugin` — uniforms `cam_pos, cam_f, cam_u, cam_r, cam_fovY`; chunk `camera.generateRay`.
- **Scene (demo)**
  - `SceneSDFDemoPlugin` provides `scene.sdf` with a sphere and plane.
- **Integrators**
  - `RayDirDebug` (visualize ray direction).
  - `NormalsIntegrator` (sphere tracing + normal visualization; includes `TMIN` guard).
  - `LambertIntegrator` (Lambert shading with **parameterized light direction**; optional animation in TS).
- **Display**
  - `SRGBDisplay` (simple tonemap + linear→sRGB).
- **Parameter system**
  - `ParameterManager` with hierarchical storage (`namespace → name → entry`).
  - `ParameterDescriptor` type with rich metadata (ranges, units, UI hints).
  - `ParameterView` for scoped access per plugin.
  - Parameter → Plugin State → Uniform data flow.
  - Opt-in via plugin constructor options (`parameters: ['fov']`).
  - Change notifications and validation.
  - Persistence via `saveParameters()`/`loadParameters()`.
- **Parameter integration**
  - `PinholeCameraPlugin` with adjustable FOV parameter.
  - `ThinLensCameraPlugin` with aperture/f-stop and focus distance parameters.
  - Tracer methods: `setParameter()`, `getParameterManager()`.
  - Parameters applied during `frame()` before uniforms.

**Result:** lit sphere & plane visible, with rotating light when enabled.

## What’s intentionally provisional
- **Display pipeline** is a minimal tonemap + sRGB.
- **Materials & scenes** are ad hoc (one demo SDF; no material system yet).
- **Controls** role not implemented (no input → frame updates).
- **Program cache key** currently built from namespaces; a fragment hash should be appended.
- **No global `u_time`/`u_frame` yet** (we used `performance.now()` inside a plugin for light animation).

## Hard-won rules (keep these)
- Chunks **never** declare uniforms; all uniforms come from `Plugin.uniforms()`.
- The assembler must reuse the **same `GLSLChunk` instances** throughout build to ensure uniform prefix replacement applies.
- Camera → Integrator dependency: if an integrator doesn’t call `generateRay`, camera uniforms can be optimized out by the compiler.
- Add a **`TMIN` self-intersection guard** to marchers to avoid immediate `t=0` hits.

## Parameter System Rules
- Parameters are **distinct from uniforms** - they carry user-facing metadata that uniforms don't need.
- Parameters are **opt-in per plugin** - specify via constructor options which values to expose.
- **Three-phase update**: User Input → Parameters → Plugin State → Uniforms.
- Parameter names are **local to plugin** - no prefixing needed (handled by namespace).
- **Validation happens at set-time** - invalid values are rejected, not at apply-time.
- Controls plugins **modify context, not parameters** - frame vectors flow through context.


## Quick code-quality passes (high priority, small)
1. **Program cache key hashing.**  
   Add a stable hash of `(vertexSrc + fragmentSrc)` to the `ProgramCache` key to prevent stale program reuse when source changes but namespaces don't.
2. **Assembler dev warnings.**  
   Warn if any chunk source contains a `uniform` declaration (catches accidental redeclarations early).
3. **UniformManager dev mode.**  
   Keep `logMissing` toggleable; default `false`, but easy to enable during bring-up.
4. **`Stage` usage sanity.**  
   All current chunks are `"frag"`; keep it explicit in each plugin to avoid inference errors.
5. **Parameter UI generation.**  
   Build auto-UI from parameter descriptors (sliders, dropdowns based on metadata).
6. **Parameter persistence.**  
   Hook up localStorage save/restore for parameter values across sessions.


## Stability tests to run next (no shading complexity yet)
- **Multiple plugins declare uniforms.** Confirm assembler declares all, and `UniformManager` resolves each, no collisions.  
  *Already Lambert (`light_dir`) + Camera uniforms; expand with a scene color parameter for another check.*
- **Controls** (CPU only).  
  A `controls` plugin that calls `geo.runtime.moveLocal/rotateLocal` each frame from WASD/mouse; no shader changes.  
  *Exercises the `PipelineContext` path thoroughly.*
- **Thin-lens camera** (new camera plugin).  
  Add `cam_aperture`, `cam_focusDist`, `cam_fovY`. Generate rays with lens sampling (deterministic first).  
  *Works with current integrator; no new engine plumbing.*
- **Accumulation renderer (architecture only).**  
  Add engine globals you already reserved: `u_history` (sampler2D), `u_sampleCount` (int), optionally `u_frame`.  
  Render-to-texture and running average; verify stability and reset behavior.  
  *Tests multi-pass state and uniform lifetimes without complex BRDFs.*
- **Scene library expansion.**  
  Add `albedo(Point p)` alongside `map(Point p)`; Lambert uses it.  
  Include more primitives (boxes, torus, CSG) to stress deps/uniforms.

## Geometry roadmap (next incremental geometry)
- **Hyperbolic (shader-only first):**
  - Provide `geometry.types` identical to Euclidean.
  - Implement `geometry.ops` with position-dependent metric `dot_g(p, a, b)` in your preferred model (upper-half-space or ball).
  - Keep Euclidean geodesic stepping initially; add `geodesicStep` later if desired.
- **Runtime later:** mirror Euclidean’s runtime with the same `{p,f,u,r}` frame; add helpers for model transforms when needed.

## Concrete next options (pick 1–2; each is self-contained)
1) **Controls plugin (WASD + mouse)**
- Role `"controls"`, no GLSL. Reads/updates `ctx.geometry.frame`.
- Can expose its own parameters (move speed, mouse sensitivity).
- **Accept:** camera moves smoothly; no shader edits.
2) **Parameter UI system**
- Auto-generate controls from parameter descriptors.
- Group parameters by plugin and parameter group.
- Support sliders, dropdowns, color pickers based on type/hint.
3) **More parameterized plugins**
- Add parameters to `LambertIntegrator` (light direction, animation speed).
- Scene objects with parameterized material properties.
- Display plugin with exposure/gamma parameters.
4) **Thin-lens camera** (✓ DONE)
- ~~Uniforms: `cam_aperture`, `cam_focusDist`, `cam_fovY`.~~
- ~~Deterministic sampling first; later tie into accumulation.~~
5) **Accumulation scaffold**
- Add globals: `u_time`, `u_frame` in header.
- Add history texture + sample count, and a running-average path.
- Hook into parameter `resetAccumulation` flag.


## What (if anything) should be reworked
- **Cache key hashing** (as above) — prevents subtle “stale program” bugs.
- **Assembler guard** for `uniform` lines in chunks — catches class of errors early.
- **Optionally**: add a `u_time` global as part of the engine header to avoid per-plugin `performance.now()` usage.


## Summary
We have a stable core, a clean geometry abstraction, a working camera contract, 
a demonstrable rendering path (scene → integrator → display), 
and **a flexible parameter system for runtime control**. 
The next steps focus on **robustness** (cache key, dev guards), 
**interactivity** (controls, UI generation), and **extensibility** 
(extra cameras ✓, accumulation, and additional geometries). 
The parameter system provides the foundation for user interaction without 
complicating the core architecture. 
This keeps the system steady while opening doors for deeper research work.
