# Compiler System

The compiler transforms a **SceneDescription** and **RenderStrategy** into a **CompiledRenderer** — a self-contained bundle of GLSL shaders, a GPU pipeline specification, and uniform bindings that the Engine executes blindly.

```
SceneDescription + RenderStrategy
        │
        ▼
   ┌──────────┐
   │ Compiler  │
   └──────────┘
        │
        ├─ 1. Analyze  → SceneFeatures
        ├─ 2. Validate → ValidationError[]
        ├─ 3. Plan     → RenderPlan
        └─ 4. Generate → CompiledRenderer
                              │
                              ├─ shaders: Map<string, ShaderProgram>
                              ├─ pipeline: RenderPipeline
                              ├─ uniforms: UniformBinding[]
                              ├─ parameters: ParameterMetadata
                              └─ exportTargets: ExportTarget
```

## Inputs

### SceneDescription

A declarative scene definition with no rendering logic:

```typescript
{
    id: 'cornell',
    ambientSpace: { type: 'euclidean' },
    objects: ObjectDescription[],       // SDF, analytic, or mesh geometry
    materials: Record<string, MaterialDescription>,
    lights: LightDescription[],
}
```

**Objects** are geometry primitives. Currently only SDF objects are supported:

```typescript
{
    kind: 'sdf',
    sdf: { type: 'sphere', parameters: { center: [0,0,0], radius: 1.0 } },
    material: 'materialName',          // references materials map
    transform?: { position?: Vec3 },   // translation only (no rotation/scale yet)
}
```

Available SDF types: `sphere`, `plane`, `box`. The `plane` SDF uses the convention `dot(p, normal) + offset = 0`, where negative values are solid. The normal points toward empty space.

**Materials** describe surface properties. Each has a `model` and property values that can be constants or GLSL expressions:

```typescript
{
    model: 'lambert',                           // only lambert supported currently
    albedo: [0.8, 0.2, 0.2],                   // constant Vec3
    roughness: 0.5,                             // constant scalar
    emission: { kind: 'glsl', source: '...' },  // procedural GLSL expression
}
```

**Lights** are explicit light sources:

```typescript
{ kind: 'point', position: [3, 4, 2], intensity: 30.0, color: [1, 1, 1] }
```

### RenderStrategy

Controls *how* the scene is rendered — algorithms, quality settings, camera:

```typescript
{
    id: 'pathtracer',
    transport: {
        maxBounces: 8,
        directLighting: 'nee',              // 'none' | 'nee' | 'mis'
        russianRoulette: { enabled: true, startDepth: 3 },
        samplesPerFrame: 1,
    },
    camera: { type: 'pinhole', fov: 0.8 },
    accumulation: { type: 'average' },
    display: { type: 'reinhard' },
}
```

## Phase 1: Analyze

**File:** `src/compiler/analyze/Analyzer.ts`

Scans the scene and extracts a feature summary. No validation — just counting and flagging.

```typescript
function analyze(scene: SceneDescription): SceneFeatures
```

Produces:

```typescript
{
    ambientSpace: 'euclidean',
    geometry: { hasSDFs: true, hasAnalytic: false, hasMeshes: false, sdfCount: 2, ... },
    materials: { hasLambert: true, hasDisney: false, ..., hasProcedural: false },
    lighting: { pointLightCount: 1, directionalLightCount: 0, totalLightCount: 1 },
}
```

This drives decisions downstream — the Planner uses it to decide what code to emit, and the Validator uses it to reject unsupported combinations.

## Phase 2: Validate

**File:** `src/compiler/analyze/Validator.ts`

Checks features against what the compiler currently supports. Collects *all* errors before failing (not fail-on-first):

```typescript
function validate(features, scene, strategy): ValidationError[]
```

Current checks:
- Non-Euclidean ambient space → error
- Mesh or analytic objects → error
- Directional lights → error
- MIS requested with no lights → error
- Unknown material references → error (with object index context)
- Rotation or scale transforms → error (with object index context)

The Compiler filters for `severity === 'error'` and throws with all messages concatenated. Warnings pass through.

## Phase 3: Plan

**File:** `src/compiler/plan/Planner.ts`

Transforms the scene description into a concrete generation plan. All ambiguity is resolved here — the Generator receives fully concrete data.

```typescript
function plan(features, scene, strategy): RenderPlan
```

### What the Planner does:

**1. Assigns material IDs.** Materials are sorted alphabetically by name for deterministic ordering, then assigned integer IDs (0, 1, 2...). Property values are resolved: scalars are normalized (a single number becomes `[n, n, n]` for colors), missing values get defaults (albedo defaults to `[0.8, 0.8, 0.8]`, roughness to `1.0`).

**2. Resolves SDF objects.** Filters to `kind === 'sdf'` objects, looks up material IDs from the name→id map, extracts SDF type and parameters. Each object gets a sequential index.

**3. Resolves lights.** Point lights get color defaulted to white if not specified. Each light gets a sequential ID.

**4. Makes code emission decisions based on features + strategy:**
- `brdfModels`: which BRDF includes are needed (e.g. `['lambert']`)
- `emitNEE`: true if `directLighting !== 'none'` AND the scene has lights
- `emitRussianRoulette`: from strategy config
- `maxBounces`: from strategy config
- `unrollSDFDispatch`: true if ≤ 8 objects (currently always true)

**5. Plans uniforms.** Lists all uniforms the shader needs with their types, parameter paths (for the Engine's parameter system), and default values:

```typescript
[
    { name: 'u_resolution',     type: 'vec2',  parameterPath: 'engine.resolution' },
    { name: 'u_sampleCount',    type: 'int',   parameterPath: 'engine.sampleCount' },
    { name: 'u_frameIndex',     type: 'int',   parameterPath: 'engine.frameIndex' },
    { name: 'u_time',           type: 'float', parameterPath: 'engine.time' },
    { name: 'u_pixelOffset',    type: 'vec2',  parameterPath: 'engine.pixelOffset' },
    { name: 'u_imageSize',      type: 'vec2',  parameterPath: 'engine.imageSize' },
    { name: 'u_cameraPosition', type: 'vec3',  parameterPath: 'camera.position' },
    { name: 'u_cameraTarget',   type: 'vec3',  parameterPath: 'camera.target' },
]
```

## Phase 4: Generate

**Files:** `src/compiler/generate/Generator.ts`, `ShaderBuilder.ts`, `PipelineBuilder.ts`

Takes the RenderPlan and produces the final CompiledRenderer. This phase has no decision-making — it mechanically emits code from the plan.

```typescript
function generate(plan, scene, strategy): CompiledRenderer
```

The renderer ID is `${strategy.id}-${scene.id}` (e.g. `pathtracer-cornell`). This must be unique across all renderers loaded into the Engine, because the Engine stores compiled WebGL programs in a flat map keyed by shader ID.

### Shader Building

**File:** `src/compiler/generate/ShaderBuilder.ts`

Produces two shaders per renderer:

#### Main shader (`${rendererId}-main`)

The pathtracer fragment shader is assembled by concatenating sections in dependency order. Some sections are static GLSL library files, others are generated per-scene.

```
┌─────────────────────────────────────────────────────┐
│ Header                                    (generated)│
│   #version 300 es                                    │
│   precision highp float/int                          │
│   out vec4 fragColor                                 │
│   #define MAX_BOUNCES 8                              │
│   #define ENABLE_NEE              (if NEE enabled)   │
│   #define ENABLE_RUSSIAN_ROULETTE (if RR enabled)    │
│   #define RR_START_DEPTH 3        (if RR enabled)    │
│   #define TAN_FOV 0.422...        (from camera fov)  │
├─────────────────────────────────────────────────────┤
│ Uniform declarations                      (generated)│
│   uniform vec2 u_resolution;                         │
│   uniform vec3 u_cameraPosition;                     │
│   uniform sampler2D u_previous;   (always present)   │
│   ...                                                │
├─────────────────────────────────────────────────────┤
│ structs.glsl                              (library)  │
│   Type aliases: Point, Direction, Spectrum, Radiance │
│   Structs: Ray, Frame, Hit, LightSample,             │
│            MaterialProperties                        │
├─────────────────────────────────────────────────────┤
│ rng.glsl                                  (library)  │
│   Hash-based RNG: hash_init(), random(), random2()   │
│   Deterministic per pixel+frame                      │
├─────────────────────────────────────────────────────┤
│ math.glsl                                 (library)  │
│   PI, TWO_PI, EPSILON                                │
│   luminance(), build_basis(), local_to_world()       │
├─────────────────────────────────────────────────────┤
│ euclidean.glsl                            (library)  │
│   ambient_geodesic()  — straight line (origin+dir*t) │
│   ambient_frame()     — orthonormal frame from normal│
│   ambient_dot()       — standard dot product         │
│   ambient_parallel_transport() — identity             │
├─────────────────────────────────────────────────────┤
│ sdf_primitives.glsl                       (library)  │
│   sdf_sphere(), sdf_plane(), sdf_box()               │
├─────────────────────────────────────────────────────┤
│ SDF Dispatch                              (generated)│
│   Per-object wrappers: sdf_object_0(p), _1(p), ...   │
│   scene_sdf(p, out material) — with material tracking│
│   scene_sdf_dist(p) — distance only (for normals)    │
├─────────────────────────────────────────────────────┤
│ raymarch.glsl                             (library)  │
│   scene_normal()        — finite differences (6 eval)│
│   scene_intersect()     — primary ray march          │
│   scene_intersect_any() — shadow ray (conservative)  │
│   Depends on generated scene_sdf / scene_sdf_dist    │
├─────────────────────────────────────────────────────┤
│ Material Lookup                           (generated)│
│   scene_material_properties(id, p)                   │
│   if/else if dispatch per material ID                │
│   Supports constant values and GLSL expressions      │
├─────────────────────────────────────────────────────┤
│ lambert.glsl                              (library)  │
│   interaction_surface_shade(wi, wo, hit, props)      │
│   interaction_surface_scatter(wo, hit, props, pdf)   │
│   interaction_surface_pdf(wi, wo, hit, props)        │
│   interaction_surface_emit(props)                    │
│   All take MaterialProperties as parameter           │
├─────────────────────────────────────────────────────┤
│ Light Sampling                  (generated, if NEE)  │
│   lighting_sample(p) → LightSample                   │
│   Single light: direct sampling                      │
│   Multiple lights: uniform random selection           │
├─────────────────────────────────────────────────────┤
│ camera_pinhole.glsl                       (template) │
│   camera_generateRay(pixel, xi)                      │
│   Uses TAN_FOV define, u_imageSize, u_cameraPosition │
├─────────────────────────────────────────────────────┤
│ path_trace.glsl                           (template) │
│   transport_trace(ray) → Radiance                    │
│   Bounce loop with throughput accumulation            │
│   Fetches MaterialProperties once per bounce          │
│   #ifdef ENABLE_NEE: shadow ray + direct lighting    │
│   #ifdef ENABLE_RUSSIAN_ROULETTE: survival test      │
├─────────────────────────────────────────────────────┤
│ main_accumulate.glsl                      (template) │
│   void main()                                        │
│   Pixel jitter, RNG init, ray generation             │
│   Progressive average: mix(previous, new, 1/(n+1))   │
└─────────────────────────────────────────────────────┘
```

#### Display shader (`${rendererId}-display`)

A simple tonemapping pass:

```
#version 300 es + precision + fragColor declaration
    │
    ▼
tonemap_reinhard.glsl
    - safe_color() — NaN/Inf protection
    - linear_to_srgb() — proper sRGB transfer function
    - tonemap_reinhard() — x / (1 + x)
    - main() — reads u_radiance texture, outputs LDR
```

Both shaders share the same vertex shader (`fullscreen.vert.glsl`) which draws a fullscreen triangle using the `gl_VertexID` trick — no VAO required.

### Generated Code Details

The compiler generates three scene-specific code blocks. These can't be library files because they depend on the specific objects, materials, and lights in the scene.

**SDF Dispatch** — one wrapper function per object, plus two dispatch functions:

```glsl
// Per-object wrapper (handles translation)
float sdf_object_0(vec3 p) {
    return sdf_plane(p, vec3(0.0, 1.0, 0.0), 0.0);
}
float sdf_object_1(vec3 p) {
    p = p - vec3(0.0, 0.0, 0.0);    // if has translation
    return sdf_sphere(p, vec3(0.0, 0.0, 0.0), 1.0);
}

// Full dispatch — returns distance and identifies material
float scene_sdf(vec3 p, out int material) {
    float d = 1e20;
    float d_obj;
    material = 0;
    d_obj = sdf_object_0(p);
    if (d_obj < d) { d = d_obj; material = 0; }
    d_obj = sdf_object_1(p);
    if (d_obj < d) { d = d_obj; material = 1; }
    return d;
}

// Distance-only — no material tracking, used by normal estimation (6 calls)
// and shadow rays. Faster because it skips material bookkeeping.
float scene_sdf_dist(vec3 p) {
    float d = 1e20;
    d = min(d, sdf_object_0(p));
    d = min(d, sdf_object_1(p));
    return d;
}
```

**Material Lookup** — if/else if chain over material IDs:

```glsl
MaterialProperties scene_material_properties(int id, vec3 p) {
    MaterialProperties props;
    props.albedo = vec3(0.8);           // defaults
    props.emission = vec3(0.0);
    props.emission_strength = 0.0;
    props.roughness = 1.0;
    if (id == 0) {
        props.albedo = vec3(0.73, 0.73, 0.73);
        props.roughness = 1.0;
    } else if (id == 1) {
        props.albedo = vec3(0.65, 0.05, 0.05);
        props.roughness = 1.0;
    }
    return props;
}
```

GLSL expressions are inlined directly: `props.albedo = some_glsl_expr;`

**Light Sampling** — generated only when NEE is enabled:

```glsl
// Single light — direct sampling, pdf = 1
LightSample lighting_sample(Point p) {
    LightSample ls;
    vec3 light_vector = vec3(3.0, 4.0, 2.0) - p;
    ls.distance = length(light_vector);
    ls.wi = normalize(light_vector);
    ls.position = vec3(3.0, 4.0, 2.0);
    ls.radiance = vec3(30.0, 30.0, 30.0) / (ls.distance * ls.distance);
    ls.pdf = 1.0;
    return ls;
}

// Multiple lights — uniform random selection, pdf = 1/N
LightSample lighting_sample(Point p) {
    LightSample ls;
    float light_choice = random() * 2.0;
    if (light_choice < 1.0) {
        // ... light 0
    } else if (light_choice < 2.0) {
        // ... light 1
    }
    ls.pdf = 0.5;
    return ls;
}
```

### Pipeline Building

**File:** `src/compiler/generate/PipelineBuilder.ts`

Produces the execution specification that tells the Engine what GPU work to do each frame:

```
Frame N:
  1. main-pass
     - shader: pathtracer-cornell-main
     - input:  u_previous ← accumulation_previous (last frame's result)
     - output: accumulation_current
     - Traces one sample per pixel, blends with previous frame

  2. display-pass
     - shader: pathtracer-cornell-display
     - input:  u_radiance ← accumulation_current
     - output: screen
     - Tonemaps HDR → LDR for display

  3. postFrame
     - swap accumulation buffers (current ↔ previous)
```

The accumulation buffer is a `double_buffer` with `rgba32f` format — two textures that ping-pong each frame. The screen buffer is the default framebuffer (canvas).

Pipeline builder also produces:
- **UniformBinding[]** — connects parameter store paths to shader uniforms with a compute function
- **ParameterMetadata** — camera position/target with defaults, groups, and `triggersReset: true`
- **ExportTargets** — `hdr` export reads from `accumulation_previous` as float data (post-frame swap semantics: after the swap, the freshly written frame lives in `previous`)

## GLSL Architecture

The GLSL code is split into two categories:

### Library files (reusable, scene-independent)

These are imported via Vite's `?raw` suffix and concatenated into the shader. They never change between scenes.

| File | Provides | Depends on |
|------|----------|------------|
| `structs.glsl` | Ray, Hit, Frame, LightSample, MaterialProperties, type aliases | — |
| `rng.glsl` | hash_init, random, random2 | — |
| `math.glsl` | PI, EPSILON, luminance, build_basis, local_to_world | — |
| `euclidean.glsl` | ambient_geodesic, ambient_frame, ambient_dot | structs |
| `sdf_primitives.glsl` | sdf_sphere, sdf_plane, sdf_box | — |
| `raymarch.glsl` | scene_normal, scene_intersect, scene_intersect_any | scene_sdf (generated), euclidean |
| `lambert.glsl` | shade, scatter, pdf, emit | MaterialProperties, math, euclidean |

### Generated code (scene-specific)

Emitted by `ShaderBuilder.ts` functions. Contains baked-in constants from the scene description.

| Function | Generates | Why it can't be a library |
|----------|-----------|--------------------------|
| `generateSDFDispatch` | scene_sdf, scene_sdf_dist, sdf_object_N | Object types, parameters, materials are scene-specific |
| `generateMaterialLookup` | scene_material_properties | Material IDs, property values are scene-specific |
| `generateLightSampling` | lighting_sample | Light positions, intensities, count are scene-specific |

### Template files (algorithm-specific, strategy-selected)

Selected based on strategy settings, but their code is fixed:

| File | Selected when | Role |
|------|--------------|------|
| `camera_pinhole.glsl` | `camera.type === 'pinhole'` | Ray generation with FOV + jitter |
| `path_trace.glsl` | always (only transport) | Bounce loop with conditional NEE/RR via `#ifdef` |
| `main_accumulate.glsl` | `accumulation.type === 'average'` | Progressive frame averaging |
| `tonemap_reinhard.glsl` | `display.type === 'reinhard'` | HDR → LDR display pass |
| `fullscreen.vert.glsl` | always | Fullscreen triangle via gl_VertexID |

### Dependency ordering

The fragment shader sections must appear in a specific order because GLSL requires functions to be defined before use:

```
structs  →  rng  →  math  →  euclidean  →  sdf_primitives
    →  SDF dispatch (generated, calls sdf_primitives)
    →  raymarch (calls scene_sdf, scene_sdf_dist, ambient_*)
    →  material lookup (generated)
    →  lambert (calls scene_material_properties, ambient_dot)
    →  light sampling (generated, calls random)
    →  camera (calls random2)
    →  path_trace (calls everything above)
    →  main (calls camera, path_trace)
```

## Renderer ID Namespacing

The Engine stores compiled WebGL programs in a flat `programs` Map keyed by shader ID. If two renderers use the same key, the second overwrites the first. The compiler prevents this by prefixing all shader IDs with the renderer ID:

```
Renderer: pathtracer-cornell
  Shaders: pathtracer-cornell-main, pathtracer-cornell-display
  Pipeline passes reference: pathtracer-cornell-main, pathtracer-cornell-display

Renderer: direct-cornell
  Shaders: direct-cornell-main, direct-cornell-display
  Pipeline passes reference: direct-cornell-main, direct-cornell-display
```

Multiple strategies can compile the same scene and coexist in the Engine.

## Path Tracing Loop

The core rendering algorithm in `path_trace.glsl`:

```
for each bounce (0..MAX_BOUNCES):
    1. March ray → Hit (or miss → sky color, break)
    2. Fetch MaterialProperties once for this hit
    3. Add emission: radiance += throughput * emit(props)
    4. [if NEE] Sample a light, trace shadow ray, add direct contribution
    5. [if RR] Russian roulette survival test after startDepth bounces
    6. Sample BRDF → new direction wi, pdf
    7. Update throughput: throughput *= shade(wi, wo, hit, props) / pdf
    8. Offset origin along normal, continue with new ray
```

MaterialProperties is fetched once per bounce and passed to all interaction functions (shade, scatter, emit), avoiding redundant material lookups.

## Current Limitations

Supported:
- Geometry: SDF sphere, plane, box (translation only)
- Materials: Lambert
- Lights: point lights
- Ambient space: Euclidean
- Camera: pinhole
- Accumulation: average
- Display: Reinhard

Not yet supported:
- Geometry: analytic, mesh, rotation/scale transforms, CSG
- Materials: Disney, dielectric, emissive
- Lights: directional, area, environment maps
- Ambient spaces: hyperbolic, spherical
- Cameras: thin lens, orthographic
- Accumulation: exponential, variance
- Display: ACES, filmic
- MIS (multiple importance sampling)
