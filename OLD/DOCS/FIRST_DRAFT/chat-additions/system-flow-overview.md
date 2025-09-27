# System Flow Overview (End-to-End Pixel Trace)

This document walks a single pixel from **Recipe selection** to **displayed color**, tying together the four pillars (World, Photography, Engine, App) and the **Core Principles**. It is expository and concrete, with pseudo‑code fragments and contract cues.

---

## 0) Cast of Components (at a glance)

- **App**: orchestrates via **Recipe**, **ParameterStore**, **RenderCoordinator**, and optional **Extensions/Services**.  
- **Engine**: compiles modules, binds uniforms, manages GPU memory, executes the draw.  
- **Photography**: Camera → Estimator → Film → Developer define *how we measure*.  
- **World**: Geometry, Materials, Lights, Scene define *what exists*.  

> See Core Principles for invariants: separation of concerns, determinism, ownership, contract discipline, analysis separation, error policy, performance, lifecycle flow, extension discipline, best practices.

---

## 1) App loads a Recipe

A **Recipe** lists module choices (World + Photography) and initial parameters. App validates and resolves the recipe before GPU work.

```ts
const recipe = {
  world: {
    geometry: {kind:"Geometry", name:"Euclidean"},
    material: {kind:"Material", name:"Lambert"},
    scene: {kind:"Scene", name:"SimpleSDFScene"},
    lights: {kind:"Lights", name:"EnvironmentMap"}
  },
  photography: {
    camera:   {kind:"Camera",   name:"Pinhole"},
    estimator:{kind:"Estimator",name:"PathTracer"},
    film:     {kind:"Film",     name:"SimpleAverage"},
    developer:{kind:"Developer",name:"ACES"}
  },
  parameters: {
    "camera.position": [0,2,5],
    "camera.target":   [0,0,0],
    "estimator.max_bounces": 5
  }
};
```

App hydrates **ParameterStore** with `recipe.parameters` and wires observers so later changes update GPU and reset accumulation when appropriate.

---

## 2) App chooses a Render Mode

The **RenderCoordinator** runs in one of three modes:

- **interactive**: real-time preview, no accumulation.  
- **progressive**: continuous accumulation (target samples or convergence threshold).  
- **production**: tiled, checkpointed high‑res renders.

This controls frame cadence, sample counting, and accumulation reset policy.

---

## 3) Engine compiles a program for the Recipe

The **ShaderCompiler** pipeline:

1. **Collect modules** (Geometry, *single* Material, Scene, Lights, Camera, Estimator, Film, Developer).  
2. **Validate dependencies** (required/provided function sets, cycle checks).  
3. **Sort & prefix** functions by kind (`g_*, m_*, sc_*, l_*, c_*, e_*, f_*, d_*`).  
4. **Generate** a `main()` selected by Film/Developer template needs.  
5. **Extract uniforms** → build a `UniformMap`.  
6. **Compile & link** GLSL → `CompiledProgram` with source metadata & line maps.

---

## 4) Engine allocates Film buffers & GPU resources

From **Film** resources, the **ResourceManager** builds/reuses a **Film Manifest** (attachments, persistence, HDR/LDR), validates GPU capabilities, allocates textures/FBOs, and establishes ping‑pong if accumulating.

---

## 5) Engine maps parameters → uniforms

The **UniformBinder** maps parameter paths (e.g., `camera.fov`) to prefixed GLSL uniforms (e.g., `u_c_pinhole_fov`) and flushes batched updates once per frame alongside engine uniforms (`u_resolution`, `u_frame_index`, `u_sample_count`, `u_time`). Missing-but-unused bindings are tolerated with helpful logs.

---

## 6) Coordinator kicks off the run loop

`start()` drives frames per mode. In **progressive**: reset accumulator; for each pass call Engine to render one sample; increment counters; report progress; yield to browser; stop on convergence or user action. Coordinator decides when parameter changes require **accumulation reset** (e.g., camera/material/scene/light/estimator vs developer/film).

---

## 7) Engine renders a frame

The **RenderExecutor**:

- Sets render target (screen or Film FBO), configures viewport (or tile).  
- Binds a **full‑screen triangle** VAO and issues one draw call.  
- Optionally **swaps Film buffers** for accumulation.  
- Provides sync/async **pixel readback** for export/checkpoints.  
- Records **FrameStats** and checks GL errors per phase.

---

## 8) Inside the fragment shader: one pixel’s life

Generated `main()` (conceptual):

```glsl
void main() {
  vec2 pixel = gl_FragCoord.xy;
  vec2 xi = next_2d();

  Ray ray = c_generate_ray(pixel, xi);        // Camera
  vec3 L  = e_estimate(ray);                   // Estimator (transport)
  vec3 A  = f_accumulate(L, pixel);            // Film (persistent buffers)
  vec3 C  = d_develop(A);                      // Developer (tone map)

  gl_FragColor = vec4(C, 1.0);
}
```

- **Camera** uses engine‑provided uniforms (frame, position, tan(fov/2)) for minimal per‑pixel math.  
- **Estimator** implements transport (path tracing / direct‑only / MIS), calling into World: Scene intersect, Materials eval/sample/pdf, Lights sample/eval/pdf, Geometry math.  
- **Film** uses numerically stable incremental formulas (mean/variance).  
- **Developer** maps linear HDR to display (ACES/Reinhard/Filmic) and encodes to output space.

---

## 9) Parameter changes during the run

1. **ParameterStore** validates & emits a batch `onChange`.  
2. **Engine/UniformBinder** enqueues uniform updates; flushed next frame.  
3. **Coordinator** inspects paths → **resets accumulation** if needed.

This preserves the separation of App *state*, Engine *GPU updates*, and Coordinator *accumulation policy*.

---

## 10) Tiled production, checkpoints, export

In **production**: Coordinator computes tiles, sets Engine viewport per tile, resets accumulation per tile, renders to sample quota, reads pixels for each tile, saves checkpoints if requested, and stitches tiles into a final image.

---

## 11) Extensions & services: workflows without pollution

**Extensions** register as **services**. They read/write parameters, observe events, and add UI via the App event bus, without modifying App or Engine APIs. Example: a “screenshot” service calls `engine.readPixelsAsync()`, packages the result, and triggers a download.

---

## 12) Error & fallback surface

- **Compiler**: stage-aware compile/link failures; validated before use.  
- **ResourceManager**: capability checks; LDR/HDR fallbacks; manifest reuse.  
- **RenderExecutor**: GL error reporting & stats.  
- **Coordinator/App**: surface errors via callbacks/events; production runs can indicate resume‑ability from checkpoints.

---

## Appendix A — Progressive Session (pseudo‑code)

```ts
// App wiring
store.restore(recipe.parameters);
coordinator.setMode('progressive');

// Compile & allocate
const program = engine.shaderCompiler.compile(recipe);
engine.uniformBinder.buildBindings(program);
engine.resourceManager.setupForProgram(program);

// Run
await coordinator.start();
//  • binder.frameUpdate(engineState)
//  • executor.drawFullScreenTriangle()
//  • fragment: camera → estimator → film → developer
//  • accumulator++ ; onProgress(...)
```

---

## Checklist: Why each boundary matters

- **Recipe → Registry → Compiler**: only valid, compatible module sets render.  
- **ParameterStore ↔ UniformBinder ↔ Coordinator**: clean split between *state*, *GPU updates*, *accumulation policy*.  
- **Executor ↔ ResourceManager**: draw/state vs memory/film attachments.  
- **Extensions (services)**: added power, zero core API pollution.