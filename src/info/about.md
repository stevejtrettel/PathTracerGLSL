# Modular Path Tracer — Project Overview

## Philosophy
This project is a **rendering laboratory** designed for mathematical clarity and modularity.  
Core principles:

- **Geometry-first**: shaders compile *for a geometry platform* (Euclidean, hyperbolic, spherical).
- **Plugin model**: cameras, integrators, displays, controls are modular, swappable units.
- **Textbook readability**: code mirrors mathematics; each component has a single responsibility.
- **Clean layering**: 
  - `core` = declarative engine (no GPU, no strings).  
  - `systems` = mechanics (shader assembly, uniform binding).  
  - `rendering` = WebGL helpers (ProgramCache, FullscreenQuad).  
  - `tracer` = ergonomic façade (`Tracer`) for building/running pipelines.

---

## Plugin Contracts
Every plugin declares:
- **namespace**: unique prefix for uniforms/functions.
- **role**: integrator, camera, display, geometry, controls, etc.
- **chunks()**: GLSL code contributions with names + dependencies.
- **uniforms()**: declarations + default values (auto-namespaced).
- **applyUniforms(view)**: set live values per frame.

### Roles
- **Geometry**: defines `Point`, `Ray`, `Frame`, metric ops.
- **Camera**: `generateRay(uv)` from film space to geometry ray.
- **Integrator**: `integrate(fragCoord)` — evaluates estimator, sampling pattern, accumulation.
- **Display**: `display(hdr)` — tone map HDR radiance to LDR.
- **Controls**: update camera/parameters from input.
- *(Scene, materials, lights are data — not plugins.)*

---

## Shader Assembly
- Each plugin contributes GLSL chunks with explicit dependencies.
- `systems/ShaderAssembler` does:
  1. Collect chunks from engine.plugins.
  2. Topologically order by dependencies.
  3. Inject **engine globals** (only `u_resolution`).
  4. Concatenate into final fragment.
- Result = `fragmentSrc` + namespace -> prefix map.

---

## Future File Tree (Goal)

```
src/
├── tracer/
│   └── Tracer.ts              # Ergonomic façade for building/running
│
├── core/
│   ├── Engine.ts              # Pure plugin registry (no GPU)
│   └── types.ts               # Core interfaces (Plugin, Chunk, Uniform, Role)
│
├── systems/
│   ├── ShaderAssembler.ts     # GLSL assembly (pure string logic)
│   ├── DependencyResolver.ts  # Topo sort for chunk deps
│   ├── UniformManager.ts      # Uniform binding helper
│   └── ParameterSystem.ts     # (later) plugin parameter tracking
│
├── rendering/
│   ├── ShaderProgram.ts       # WebGL program wrapper
│   ├── ProgramCache.ts        # Compile/link caching
│   └── FullscreenQuad.ts      # Screen-space rendering primitive
│
├── geometry/
│   ├── EuclideanGeometryPlugin.ts   # Provides geometry.types/ops
│   ├── HyperbolicGeometryPlugin.ts  # Future extension
│   └── ...                          # Other geometries
│
├── camera/
│   ├── PinholeCameraPlugin.ts       # Minimal pinhole camera
│   ├── ThinLensCameraPlugin.ts      # Depth of field
│   └── ...                          # Future optical models
│
├── integration/
│   ├── TestIntegratorPlugin.ts      # Trivial constant-color
│   ├── NormalsIntegrator.ts         # Raymarch normals
│   ├── DirectLighting.ts            # One-bounce diffuse
│   ├── PathTracer.ts                # Multi-bounce path tracing
│   └── ...
│
├── display/
│   ├── SRGBDisplayPlugin.ts         # Simple sRGB tonemap
│   ├── ReinhardDisplayPlugin.ts     # Reinhard tone mapping
│   └── ACESDisplayPlugin.ts         # ACES curve
│
├── controls/
│   ├── OrbitControls.ts             # Mouse orbit
│   ├── FPSControls.ts               # Keyboard fly
│   └── ...
│
├── scene/
│   ├── SceneLib.glsl                # SDF primitives
│   ├── Material.glsl                # BSDFs
│   └── ...
│
├── glsl/
│   └── fullscreen.vert              # Common fullscreen vertex shader
│
└── main.ts                          # Example entrypoint / hotkeys
```

---

## Big-Picture Workflow
1. **Configure**  
   `tracer.use(geometry).use(camera).use(integrator).use(display)`
2. **Assemble**  
   `assembler.buildFragment(engine.list())`
3. **Materialize**  
   `program = programCache.get(vertex, fragment, key)`
4. **Render**  
   - Set engine globals (`u_resolution`).  
   - Each plugin sets its own uniforms via prefixed `UniformManager`.  
   - `fullscreenQuad.draw()`.

