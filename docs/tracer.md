
# Tracer System Documentation

## Overview

The **Tracer** is the main orchestrator of the path tracing / ray marching pipeline.  
It manages everything from plugin registration and shader compilation to per-frame updates, including CPU-side controls.

---

## Data Flow

```

Plugin Registration → Shader Assembly → Program Compilation → Frame Rendering
↓
Parameter System
↓
Controls Update + Uniform Binding

````

---

## Responsibilities

- Register and manage **plugins** (camera, integrator, display, geometry, scene, lib).
- Treat **controls** plugins as first-class citizens (CPU-only, not compiled into shaders).
- Manage **parameters** across all plugins via the `ParameterManager`.
- Delegate shader building to **ProgramBuilder**.
- Manage **variants** (alternate plugin combinations) with the `VariantManager`.
- Drive the **frame loop**:
  1. Update controls (mutate geometry frame)
  2. Apply parameters
  3. Bind uniforms
  4. Draw

---

## Key Collaborators

- **Engine** — Stores active base plugins by role (excluding controls).
- **ProgramBuilder** — Assembles and compiles the GPU program from plugins.
- **VariantManager** — Manages named overrides of base configuration and compiles them.
- **ParameterManager** — Central registry of parameters (metadata, persistence, UI).
- **UniformManager** — Scoped uniform setter (per-namespace).
- **FullscreenQuad** — Helper to render a fullscreen quad.

---

## Plugin Roles

- **geometry** — Provides GLSL types + operations (required).
- **camera** — Provides `generateRay()`.
- **integrator** — Provides `integrate()`.
- **display** — Provides `display()`.
- **scene** — Provides scene definition (e.g., SDF).
- **lib** — Reusable GLSL helpers (multiple allowed).
- **controls** — CPU-only input/update logic:
  - `update(ctx, dt)` modifies the geometry frame
  - Optional: `attach(el)`, `detach()` to manage event listeners

All non-control roles are active **exactly once** at build time.  
Controls can be swapped or disabled dynamically via parameters.

---

## Variants

Variants allow you to pre-compile multiple pipelines (e.g. *production* vs *fast*).

- Define with `tracer.addVariant("name", { role: plugin, ... })`
- Variants may override **any subset of roles**
- Parameters persist across variants if namespaces match
- All variants share the same runtime geometry context
- Build base + variants with `tracer.buildAll()`
- Switch at runtime with `tracer.useVariant("name")`, or back to base with `null`

### Example

```ts
tracer
  .use(new PinholeCamera({ fovYDeg: 60 }))
  .use(new SceneSDFDemo())
  .use(new LambertIntegrator())
  .use(new SRGBDisplayPlugin());

tracer.addVariant("fast", {
  integrator: new NormalsIntegrator()
});

tracer.buildAll();

tracer.useVariant("fast");
````

---

## Tracer API

```ts
// Construction
new Tracer({ canvas, vertexSrc })

// Plugin management
tracer.use(plugin)             // add plugin to base config
tracer.clear(role)             // remove plugin from base config
tracer.addVariant(name, overrides) // define variant

// Build
tracer.build()                 // build base only
tracer.buildAll()              // build base + all variants

// Variants
tracer.useVariant(name|null)   // switch between base and variants
tracer.listVariants()          // list defined variants

// Context
tracer.setContext(ctx)         // set runtime context (geometry frame)

// Parameters
tracer.setParameter(ns, name, value)
tracer.getParameterManager()
tracer.saveParameters()
tracer.loadParameters(data)

// Frame/render
tracer.setSize(width, height)
tracer.frame()
tracer.dispose()
```

---

## Controls Plugins

Controls are CPU-side plugins with no GLSL.
They implement `update(ctx, dt)` and may expose parameters.

Examples:

* **KeyboardControl** — keyboard pilot controls (yaw/pitch/roll, translation).
* **FPSControls** — pointer-lock mouse look + WASD/Space/C for translation.
* **OrbitControls** — orbit around a target with pan/zoom.

Enable/disable via:

```ts
tracer.setParameter("ctrl.keyboard", "enabled", true);
```

---

## VariantManager

Lives alongside `Tracer`.

### Responsibilities

* Store all variant definitions (`name → overrides`)
* Compile variants against the current base plugins
* Track active variant name
* Resolve active compiled pipeline
* Manage program disposal

### API

```ts
variants.addVariant(name, { role: plugin, ... })
variants.buildAllVariants(basePlugins, buildFn)
variants.useVariant(name|null)

variants.getActiveCompiled(baseCompiled?)
variants.listVariantNames()
variants.disposeAllPrograms()
```

---

## Next Steps

* **Accumulation system**: add history textures, counters (`u_frame`, `u_sampleCount`), reset on resize/variant/param change.
* **Multipass pipelines**: render-to-texture, MRT, post-processing.
* **Control ergonomics**: unify attach/detach patterns, maybe add helpers for switching active controls.
* **Better diagnostics**: shader error reporting, profiling hooks.


