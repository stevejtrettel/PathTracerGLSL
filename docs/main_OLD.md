# Project Overview

## Purpose & philosophy
This repository is a **research path tracer / ray marcher lab** built to be:
- **Geometry-first.** Shaders compile *against a geometry platform* (Euclidean now; others later).
- **Modular.** Cameras, integrators, displays, controls, and libraries are swappable **plugins**.
- **Incremental & testable.** Small, self-contained units with obvious contracts.
- **Readable.** Names and code mirror the math. No cleverness that hides intent.

## Layering (who does what)
- **`core/`** — Pure TypeScript contracts & light utilities; *no WebGL* and no GLSL strings.  
  Defines `Plugin`, `GLSLChunk`, `UniformDecl`, roles, `ChunkNames`, geometry contracts, `PipelineContext`, `ParameterDescriptor`, `ParameterView` (parameter system types).
- **`systems/`** — “Compiler” mechanics: shader assembly, dependency resolution, uniform binding.
    - `ShaderAssembler` (concatenate GLSL chunks, prefix uniforms, enforce contracts)
    - `UniformManager` (lookup + set uniforms with an optional namespace prefix)
    - `DependencyResolver` (toposort chunks by `deps`)
    - `ParameterManager` (register, validate, and manage user-facing parameters)

- **`rendering/`** — WebGL helpers: `ShaderProgram`, `ProgramCache`, `FullscreenQuad`.
- **`tracer/`** — Execution façade: `Tracer` wraps the engine + systems into `use → build → frame`.
- **`plugins/`** — Actual swappable pieces per role (camera, integrator, display, lib, geometry shader).
- **`geometry/`** — Runtime geometry modules (CPU-side) that pair with a shader plugin.



## Roles & contracts
Exactly **one active plugin per role** (except `"lib"` which is additive). Canonical roles today:
- `"geometry"` — contributes **GLSL types + ops** the rest of the pipeline compiles against.
- `"camera"` — must provide `camera.generateRay`:  
  `Ray generateRay(vec2 filmUV /* in [0,1]^2 */);`
- `"integrator"` — must provide `integrator.integrate`:  
  `vec3 integrate(vec2 fragCoord /* in pixel coords */);`
- `"display"` — must provide `display.display`:  
  `vec3 display(vec3 hdr);` (tone map / gamut map to LDR)
- `"controls"` — optional CPU-side interaction (no GLSL contract).
- `"lib"` — helper code with no required function; provides named chunks (`scene.sdf`, utilities, etc).

### Canonical chunk names
Engine expects exactly one of each at link time:
```ts
ChunkNames = {
  GeometryTypes:       "geometry.types",
  GeometryOps:         "geometry.ops",
  CameraGenerateRay:   "camera.generateRay",
  IntegratorIntegrate: "integrator.integrate",
  DisplayDisplay:      "display.display",
  SceneSDF:            "scene.sdf",           // convenience name for demo scenes
} as const;
```

## Geometry: the hybrid “module”
A **geometry** is a *pair*:
- a **shader plugin** (role `"geometry"`) that contributes:
    - `geometry.types` — canonical types/aliases used by all GLSL
    - `geometry.ops` — metric-aware ops (e.g., `dot_g`, `normalize_g`, constructors)
- a **runtime** object that implements:
  ```ts
  interface GeometryRuntime<F extends GeoFrame> {
    createDefaultFrame(): F;
    moveLocal(frame: F, local: Vec3, speed: number, dt: number): void;
    rotateLocal(frame: F, angular: Vec3, rotSpeed: number, dt: number): void;
    stabilize?(frame: F): void;
  }
  ```
Together they are exposed as:
```ts
interface GeometryModule<F extends GeoFrame> {
  shader: Plugin;              // GLSL chunks provider
  runtime: GeometryRuntime<F>; // CPU frame owner/updater
}
```
**Euclidean v0** is our first module.

### GLSL types & ops (Euclidean v0)
We use a dual-form tangent API so both “just a direction” and “direction at a basepoint” are supported:
```glsl
// geometry.types
#define Point vec3
#define Dir   vec3

struct Tangent { Point p; Dir v; };
struct Ray     { Point o; Dir d; };
struct Frame   { Point p; Dir f; Dir u; Dir r; };

// geometry.ops
Tangent at(Point p, Dir v);
Ray     makeRay(Point o, Dir d);
Tangent asTangent(Ray r);
Ray     asRay(Tangent t);

float   dot_g(Point p, Dir a, Dir b);
float   dot_g(Tangent a, Tangent b);
float   norm_g(Point p, Dir v);
float   norm_g(Tangent a);
Dir     normalize_g(Point p, Dir v);
Tangent normalize_g(Tangent a);
```
In **Euclidean**, the metric ignores `Point p`; in curved geometries it won’t.


## Parameter System

The parameter system provides a clean abstraction layer between user-facing controls and shader uniforms. It enables runtime adjustment of values with rich metadata for UI generation, validation, and persistence.

### Key Concepts

Parameters are **not** uniforms. They are higher-level constructs that:
- Carry metadata (ranges, units, UI hints)
- Support validation and constraints
- Enable automatic UI generation
- Can be persisted across sessions
- Eventually map to uniforms (but with transformations)

### How It Works

1. **Declaration**: Plugins optionally declare parameters with rich metadata
2. **Registration**: Tracer registers parameters with the ParameterManager
3. **Updates**: User changes flow through parameters → plugin state → uniforms
4. **Persistence**: Parameter values can be saved/restored independently

### Plugin Integration

Plugins opt into the parameter system by:

```
// Declare which values to expose
constructor(opts: CameraOptions) {
    this.fovRadians = opts.fovDegrees * Math.PI / 180;
    this.exposedParams = new Set(opts.parameters || []);
}

// Provide metadata for exposed parameters
parameters(): ParameterDescriptor[] {
    if (!this.exposedParams.has('fov')) return [];
    return [{
        name: 'fov', 
        type: 'angle',
        default: 60,
        min: 10, max: 120,
        unit: 'degrees'
    }];
}
// Update internal state from parameters
applyParameters(params: ParameterView): void {
    if (this.exposedParams.has('fov')) {
        this.fovRadians = params.get('fov') * Math.PI / 180;
    }
}
````


## Uniforms: lifecycle & rules
- **Plugins declare uniforms** with local names in TS:
  ```
  uniforms(): UniformDecl[] { return [{ name: "cam_pos", type: "vec3" }, ...]; }
  ```
- **Assembler** prefixes them at link time using the plugin’s `namespace`:
    - prefix = `u_${namespace.replace(/[^\w]/g, "_")}_`
    - e.g. camera `cam_pos` → `u_cam_pinhole_cam_pos`
- **Chunks never declare uniforms.** They only *use* the local names; assembler handles declarations + namespace replacement.
- **Uniform binding** happens in `Tracer.frame()` by calling optional `applyUniforms(view, ctx)` on each plugin:
    - `view: UniformManager` is pre-scoped to the plugin’s prefix (so you call `set3f("cam_pos", ...)`).
    - `ctx: PipelineContext` optionally carries `{ geometry: { runtime, frame } }` so the camera can pull `{p,f,u,r}`.

**Engine globals** reserved (declared without prefix):
- `uniform vec2 u_resolution;`
- Future globals: `u_time`, `u_frame`, `u_history`, `u_sampleCount` (accumulation).

## Shader assembly (what the assembler guarantees)
- **Dedup & order.** All chunks are collected, toposorted by `deps`, and **geometry is placed first** (`types`, then `ops`).
- **Contracts.** Fails fast if *exactly one* of `camera.generateRay` / `integrator.integrate` / `display.display` is not present.
- **Uniform prefixing.** Replacement is applied per-plugin over its chunks (using the *same* `GLSLChunk` objects—important).
- **Template.** Assembler wraps with a standard header & main:
  ```
  #version 300 es
  precision highp float;
  in vec2 v_uv; out vec4 outColor;
  uniform vec2 u_resolution;
  /* prefixed uniform decls… */

  /* concatenated chunks… */

  void main() {
    vec3 color = integrate(gl_FragCoord.xy);
    color = display(color);
    outColor = vec4(color, 1.0);
  }
  ```

## Program caching
`ProgramCache.get(vertexSrc, fragmentSrc, key)` compiles or reuses a `ShaderProgram`.
- **Cache key** should include the engine shape **and** a **hash** of the shader sources to avoid “same roles, different code” collisions. (`engine:geo.cam.int.display + hash(fragment)`).
- **Why hash?** Two distinct fragment sources can share the same role list; without hashing you might reuse a stale `ShaderProgram`.

## File & directory layout (current shape)
```
src/
  core/
    types.ts                // contracts (Plugin, GLSLChunk, roles, ChunkNames, geometry, context)
  systems/
    ShaderAssembler.ts
    DependencyResolver.ts
    UniformManager.ts
  rendering/
    ShaderProgram.ts
    ProgramCache.ts
    FullscreenQuad.ts
  tracer/
    Tracer.ts               // façade: use → build → frame
  geometry/
    euclidean/
      EuclideanRuntime.ts   // implements GeometryRuntime<EucFrame>
      EuclideanModule.ts    // bundles shader + runtime
    // future: hyperbolic/, spherical/, …
  plugins/
    geometry/
      EuclideanGeometryPlugin.ts
      glsl/
        euclidean.types.glsl
        euclidean.ops.glsl
    camera/
      PinholeCameraPlugin.ts
    integration/
      NormalsIntegrator.ts
      LambertIntegrator.ts
      RayDirDebug.ts
    scene/
      SceneSDFDemoPlugin.ts
    display/
      SRGBDisplay.ts
  glsl/
    fullscreen.vert.glsl
main.ts
```

## Build/execute lifecycle
```ts
// app/bootstrap
const tracer = new Tracer({ canvas, vertexSrc });
const { module: geo, frame } = createEuclideanModule();

tracer.use(geo.shader);
tracer.setContext({ geometry: { runtime: geo.runtime, frame } });

tracer
        .use(new PinholeCameraPlugin({
          fovYDeg: 60,
          parameters: ['fov']  // NEW: Expose FOV as adjustable parameter
        }))
        .use(new SceneSDFDemoPlugin())
        .use(new LambertIntegrator({ animate: true }))
        .use(new SRGBDisplayPlugin())
        .build();

// NEW: Programmatic parameter control
tracer.setParameter('cam.pinhole', 'fov', 45);

function resize() { /* set DPR-correct width/height; tracer.setSize() */ }
requestAnimationFrame(function loop() { tracer.frame(); requestAnimationFrame(loop); });
```

## Conventions & guardrails
- **Never declare uniforms inside GLSL chunks.** Let the assembler do it from `uniforms()`.
- **Stable chunk names.** Use `ChunkNames` constants for `name` and `deps`.
- **One call to `p.chunks()`** per plugin in the assembler (reuse the same objects for replacement).
- **Short field names in GLSL**, clear function names in APIs (e.g., `Ray{ o,d }`, `Frame{ p,f,u,r }`).
- **Namespaces matter.** Keep them stable: they determine uniform prefixes and cache keys.
- **Parameters vs uniforms.** Parameters are user-facing with metadata; uniforms are GPU bindings. Keep them separate.
- **Opt-in parameters.** Plugins work without parameters. When needed, expose them explicitly via constructor options.









