# Tracer System Documentation

## Overview

The Tracer is the main orchestrator for the path tracing/ray marching system. It manages the complete rendering pipeline from plugin registration through shader compilation to frame rendering.

## Architecture

### Data Flow

```
Plugin Registration → Shader Assembly → Program Compilation → Frame Rendering
                           ↓
                    Parameter System
                           ↓
                    Uniform Binding
```
---

## Architecture

### Main Responsibilities
- Register and manage **plugins** (camera, integrator, display, geometry, scene, etc.).
- Track **controls** plugins (CPU-side, not part of shaders).
- Manage **parameters** across plugins via `ParameterManager`.
- Delegate shader building to **ProgramBuilder**.
- Manage **variants** (alternate plugin combinations) via `VariantManager`.
- Drive the **frame loop**: controls update → parameter apply → uniforms → draw.

### Key Collaborators
- `Engine`: Stores active base plugins by role.
- `ProgramBuilder`: Assembles and compiles a GPU program from plugins.
- `VariantManager`: Holds named overrides of base configuration and compiles them.
- `ParameterManager`: Central registry of parameters (metadata, persistence, UI).
- `UniformManager`: Scoped uniform setter (per-namespace).
- `FullscreenQuad`: Helper to render a fullscreen quad.

---

## Plugin Roles

- **geometry**: Provides GLSL types + operations (required).
- **camera**: Provides `generateRay()`.
- **integrator**: Provides `integrate()`.
- **display**: Provides `display()`.
- **scene**: Provides scene definition (e.g., SDF).
- **lib**: Reusable GLSL helpers (multiple allowed).
- **controls**: CPU-only input/update logic (not part of shader assembly).

Each non-controls role is active **exactly once** at build time.

---

## Variants

Variants allow you to pre-compile multiple pipelines (e.g., *production* vs *fast*).

- Defined by calling `tracer.addVariant("name", { role: plugin, ... })`.
- Variants may override **any subset of roles**.
- Parameters persist across variants if the same plugin namespace is used.
- All variants share the same runtime geometry context.
- Build everything at once with `tracer.buildAll()`.
- Switch at runtime with `tracer.useVariant("name")` or back to base with `null`.

### Example
```ts
tracer
  .use(new PinholeCamera({ fovYDeg: 60 }))
  .use(new SceneSDFDemoPlugin())
  .use(new LambertIntegrator())
  .use(new SRGBDisplayPlugin());

// Define a fast preview variant
tracer.addVariant("fast", {
  integrator: new NormalsIntegrator()
});

// Compile both base + fast
tracer.buildAll();

// Switch at runtime
tracer.useVariant("fast");
```

---

## Tracer API

```ts
// Construction
new Tracer({ canvas, vertexSrc })

// Plugin management
tracer.use(plugin)          // add plugin to base config
tracer.clear(role)          // remove plugin from base config
tracer.addVariant(name, overrides) // define a named variant

// Build
tracer.build()              // build base only
tracer.buildAll()           // build base + all variants

// Variants
tracer.useVariant(name|null) // switch between base and variants
tracer.listVariants()        // list defined variants

// Context
tracer.setContext(ctx)      // set runtime context (geometry frame)

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

## VariantManager

Lives alongside `Tracer` in the same folder.

### Responsibilities
- Store all variant definitions (`name → overrides`).
- Compile variants against the current base plugins.
- Track active variant name.
- Resolve active pipeline + controls plugin.
- Encapsulate program disposal.

### API
```ts
variants.addVariant(name, { role: plugin, ... })
variants.buildAllVariants(basePlugins, buildFn)
variants.useVariant(name|null)

variants.getActiveCompiled(baseCompiled?)
variants.getActiveControls(baseControls?)

variants.listVariantNames()
variants.disposeAllPrograms()
```

---

## Next Steps (future work)

- **Accumulation system**: add history textures, counters (`u_frame`, `u_sampleCount`).
   - Trigger reset on: canvas resize, variant switch, parameter change with `resetAccumulation`.
- **Multipass pipelines**: support render-to-texture, MRT, post-processing passes.
- **Better ergonomics**: unify controls into `Engine` (optional), add a `getActiveState()` helper.
