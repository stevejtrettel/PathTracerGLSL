# Tracer System

## Overview

`Tracer` is the **orchestration layer** that coordinates plugins, manages builds, and runs the frame loop. It delegates specialized concerns to focused subsystems:

* **FrameRenderer** - Handles all GPU rendering logic (one-shot vs progressive)
* **ProgressiveRenderer** - Manages accumulation, history buffers, and HDR presentation
* **VariantManager** - Precompiles and hot-switches alternate configurations
* **ProgramBuilder** - Assembles and compiles GLSL programs

---

## Architecture

```
Tracer (orchestration)
  ├── Engine (shader plugin registry)
  ├── ParameterManager (parameter state)
  ├── VariantManager (variant configurations)
  ├── ProgramBuilder (GLSL compilation)
  └── FrameRenderer (rendering execution)
       └── ProgressiveRenderer (accumulation, if needed)
```

---

## Data Flow

### One-shot Integrators

```
Controls.update → Parameters.apply → Program.use → FrameRenderer.render() → screen
                                                    └─ integrator.integrate() (with postprocess in-shader)
```

### Progressive Integrators

```
Controls.update → Parameters.apply → Program.use → FrameRenderer.render()
                                                    └─ ProgressiveRenderer.render()
                                                        ├─ bind history.read
                                                        ├─ draw to history.write (HDR)
                                                        ├─ present via ScreenPresenter
                                                        └─ swap buffers, increment counters
```

---

## Core Classes

### Tracer

**Responsibilities:**
* Plugin registration and management
* Build coordination (base + variants)
* Parameter management
* Frame orchestration
* Context management

**Does NOT handle:**
* Rendering logic (delegated to FrameRenderer)
* Progressive accumulation (delegated to ProgressiveRenderer)
* Shader compilation (delegated to ProgramBuilder)

### FrameRenderer

**Responsibilities:**
* Program activation and uniform binding
* Render path selection (one-shot vs progressive)
* Viewport management
* Progressive resource initialization

**Key methods:**
* `render(compiled, ctx, canvas)` - Execute frame rendering
* `ensureProgressiveResources(compiled, canvas)` - Initialize progressive renderer if needed
* `resize(width, height)` - Handle canvas resize

### ProgressiveRenderer

**Responsibilities:**
* History buffer management (ping-pong)
* Frame/sample counting
* HDR accumulation
* Presentation through postprocess

**Key methods:**
* `render(quad, uniformManager)` - Execute progressive accumulation
* `ensureHistory(width, height)` - Allocate history buffers
* `ensurePresenter(vertexSrc, postprocess)` - Configure presentation pipeline
* `resetAccumulation()` - Clear history and reset counters

---

## Plugin Roles

* **`geometry`** — GLSL types & metric ops (required for compile)
* **`camera`** — `Ray generateRay(vec2 filmUV)`
* **`scene`** — `Scene.Intersect`, `Scene.Normal`, `Scene.Material`, `Scene.Types`
* **`integrator`** — `vec3 integrate(vec2 fragCoord)`
  * Set `progressive = true` to enable accumulation
* **`postprocess`** — `vec3 postprocess(vec3 hdr)`
* **`controls`** — CPU-only: `update(ctx, dt)`
* **`lib`** — Additive GLSL helpers

---

## Progressive Integrator Support

When `integrator.progressive === true`, the system automatically:

1. Creates a ProgressiveRenderer instance
2. Allocates HDR history buffers (rgba16f)
3. Provides engine uniforms:
  * `uniform int u_frameIndex;`
  * `uniform int u_sampleCount;`
  * `uniform sampler2D u_historyColor;`
4. Manages accumulation and presentation

One-shot integrators render directly to the framebuffer and typically call `postprocess()` in-shader.

---

## Variants

Define alternative pipelines, precompile them, and hot-switch at runtime:

```ts
tracer.addVariant("fast", { integrator: new NormalsIntegrator() });
tracer.buildAll();
tracer.useVariant("fast");
```

* Variants override any subset of roles
* Parameter values persist across variants (by namespace)
* Switching variants resets progressive accumulation

---

## Tracer API

```ts
// Construction
new Tracer({ canvas, vertexSrc });

// Plugin registration
tracer.use(plugin);                     // register plugin for its role
tracer.clear(role);                     // remove role from base config

// Variants
tracer.addVariant(name, overrides);     // define alternate role set
tracer.useVariant(name | null);         // switch active pipeline
tracer.listVariants();                  // list available variants

// Building
tracer.build();                         // build base only
tracer.buildAll();                      // build base + all variants

// Runtime
tracer.setContext(ctx);                 // e.g., geometry runtime + frame
tracer.setParameter(ns, key, value);    // programmatic parameter updates
tracer.setSize(width, height);          // viewport size
tracer.frame();                         // render one frame

// Persistence
tracer.saveParameters();                // serialize parameter state
tracer.loadParameters(data);            // restore parameter state

// Cleanup
tracer.dispose();                       // free all resources
```

---

## Frame Lifecycle

```ts
// Simplified Tracer.frame() implementation:
frame() {
    const compiled = variants.getActiveCompiled(baseCompiled);
    if (!compiled) return;
    
    // 1. UPDATE PHASE - CPU controls
    for (const updatable of updatables) {
        updatable.applyParameters?.(paramView);
        updatable.update?.(ctx, dt);
    }
    
    // 2. PARAMETER PHASE - Apply to shader participants
    for (const plugin of compiled.plugins) {
        plugin.applyParameters?.(paramView);
    }
    
    // 3. RENDER PHASE - Delegate to FrameRenderer
    renderer.render(compiled, ctx, canvas);
}
```

The FrameRenderer then:
1. Activates the compiled program
2. Sets global uniforms (`u_resolution`)
3. Applies per-plugin uniforms
4. Executes appropriate render path (one-shot or progressive)

---

## Reset Policy

Progressive accumulation resets (history cleared, counters zeroed) on:
* Canvas resize
* Variant switch
* Parameter changes flagged as accumulation-invalidating

---

## Build/Execute Example

```ts
const tracer = new Tracer({ canvas, vertexSrc });
const { module: geo, frame } = createEuclideanModule();

// Register plugins
tracer.use(geo.shader);
tracer.setContext({ geometry: { runtime: geo.runtime, frame } });

tracer
  .use(new PinholeCamera({ fovYDeg: 60 }))
  .use(new SDFDemo())
  .use(new PathTracerMinimal())      // progressive integrator
  .use(new TonemapSRGB());          // postprocess

// Define variant
tracer.addVariant("fast", { integrator: new NormalsIntegrator() });

// Build and run
tracer.buildAll();
tracer.setSize(canvas.width, canvas.height);

function loop() { 
  tracer.frame(); 
  requestAnimationFrame(loop); 
}
loop();
```

---

## Design Benefits

The refactored architecture provides:

* **Clear separation of concerns** - Each class has a single, well-defined responsibility
* **Minimal coupling** - Tracer knows nothing about rendering details
* **Easy testing** - Each subsystem can be tested independently
* **Future flexibility** - New rendering strategies become new FrameRenderer implementations
* **Readable code** - ~200 lines per class instead of one 400-line monolith

For research code, this means you can focus on algorithms and geometries while the infrastructure remains stable and out of the way.
