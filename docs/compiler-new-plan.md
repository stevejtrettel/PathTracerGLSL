# PathTracerGLSL: Compiler Architecture Plan

> **HISTORICAL (July 2026):** this plan was executed — the vertical slice it specifies is built ([compiler-system.md](compiler-system.md)). Forward design is now governed by [fable-compiler-contracts.md](fable-compiler-contracts.md), which supersedes the type sketches below where they differ. Kept as the record of the original handoff.

**Status:** Superseded  
**Scope:** Design of the Compiler layer — the missing piece between the locked Engine/App and actual rendering

---

## Core Concept

The Compiler takes a `SceneDescription` and a `RenderStrategy` and produces a `CompiledRenderer` — the locked contract the Engine already knows how to execute.

```
compile(scene: SceneDescription, strategy: RenderStrategy) → CompiledRenderer
```

This is a **real compiler**, not a template filler or module assembler. It makes structural decisions based on what the scene contains and what the strategy requires, emitting exactly the GLSL needed — no dead code, no unused branches, no runtime dispatch over things knowable at compile time.

---

## Compiler Internal Structure

Three phases:

### 1. Analyze
Walk the `SceneDescription` and `RenderStrategy`. Produce a `SceneFeatures` object describing what the compiler needs to generate. Pure TypeScript — no GLSL yet.

```typescript
interface SceneFeatures {
    ambientSpace: AmbientSpaceType;
    geometry: {
        hasSDFs: boolean;
        hasAnalytic: boolean;
        hasMeshes: boolean;
        sdfCount: number;
        analyticCount: number;
    };
    materials: {
        models: Set<MaterialModel>;   // which BRDF models are actually used
        hasEmissive: boolean;
        hasDielectrics: boolean;
        hasVolumes: boolean;
        hasProcedural: boolean;       // any spatially-varying properties
    };
    lighting: {
        samplableLightCount: number;
        hasEnvironment: boolean;
        needsMIS: boolean;            // derived: samplable lights + strategy requests MIS
    };
    strategy: {
        transport: TransportFeatures;
        camera: CameraFeatures;
        accumulation: AccumulationFeatures;
        display: DisplayFeatures;
    };
}
```

The analyzer is the foundation. If it misses something, wrong code gets generated.

### 2. Plan
Consume `SceneFeatures`, decide what passes are needed and what code capabilities each requires. This is where architectural decisions live — how many framebuffer passes, what each pass does, whether MIS is emitted, whether BVH traversal exists in the shader at all.

### 3. Generate
Consume the plan, emit GLSL strings for each pass. Mechanical given a good plan. Outputs a complete `CompiledRenderer` per the locked Engine contract.

---

## SceneDescription

```typescript
interface SceneDescription {
    ambientSpace: AmbientSpaceDescription;  // First — constrains everything else
    objects: ObjectDescription[];
    materials: Map<string, MaterialDescription>;
    lights: LightDescription[];
}
```

### Ambient Space

A first-class citizen. The choice of ambient space constrains:
- What rendering strategies are possible
- What SDF library functions are available
- What intersection approaches are valid
- How geodesics, normals, and parallel transport work

```typescript
interface AmbientSpaceDescription {
    type: 'euclidean' | 'hyperbolic' | 'spherical' | 'sol' | ...;
    parameters?: { curvature?: number };
}
```

The ambient space ships as a hand-written GLSL library (euclidean.glsl, hyperbolic.glsl, etc.) providing the core geometric interface: `ambient_geodesic`, `ambient_dot`, `ambient_parallel_transport`, `ambient_frame`. The compiler selects and includes the appropriate one.

### Objects

Three geometry types, all valid in a single scene:

```typescript
type ObjectDescription = SDFObject | AnalyticObject | MeshObject;

interface SDFObject {
    kind: 'sdf';
    sdf: StandardSDF | CustomSDF;
    material: string;
    transform?: Transform;
}

interface StandardSDF {
    type: 'sphere' | 'box' | 'plane' | 'torus' | 'capsule' | ...;
    parameters: Record<string, number | number[]>;
}

interface CustomSDF {
    type: 'custom';
    glsl: string;        // complete sdf function body
    imports?: string[];  // vetted library functions needed
}

interface AnalyticObject {
    kind: 'analytic';
    shape: StandardAnalytic | CustomAnalytic;
    material: string;
    transform?: Transform;
}

interface MeshObject {
    kind: 'mesh';
    data: Float32Array;
    material: string;
    transform?: Transform;
}
```

The compiler's geometry analysis determines what intersection code to emit:
- SDFs only → ray marching, unrolled dispatch for small counts
- Analytics only → direct intersection tests
- Mixed → unified `sceneIntersect` dispatching across types
- Meshes → BVH traversal (texture-packed for WebGL2)

### Materials

All materials share a common set of properties (one material model at a time per scene — or multiple, see below). Properties can be constants or spatially-varying GLSL expressions.

```typescript
type MaterialProperty = number | number[] | string; // constant or glsl expression of p

interface MaterialDescription {
    model: 'lambert' | 'disney' | 'dielectric' | 'emissive' | ...;
    albedo: MaterialProperty;
    roughness: MaterialProperty;
    metallic: MaterialProperty;
    ior: MaterialProperty;
    emission: MaterialProperty;
    // future: customBSDF?: string;
}
```

#### Multiple Material Models Per Scene

The compiler supports different BRDF models on different objects simultaneously. Since material IDs are compile-time constants, the compiler generates precise per-model dispatch with no runtime overhead:

```glsl
// Generated — only the models actually present in the scene
Spectrum evaluateBRDF(vec3 wi, vec3 wo, Hit hit, MaterialProperties props) {
    if (hit.materialId == 0) return lambert(wi, wo, props);
    if (hit.materialId == 1) return dielectric(wi, wo, props);
}
```

No Disney code emitted if no material uses Disney. No GGX if no material needs it. The shader is exactly as complex as this specific scene requires.

#### Procedural Materials

Spatially-varying properties are GLSL expressions of position `p`. The compiler generates a `getMaterial(int id, vec3 p)` function that evaluates them at the hit point before dispatch. This covers everything from simple noise-based texturing to fully custom spatial functions.

---

## RenderStrategy

```typescript
interface RenderStrategy {
    id: string;
    transport: TransportDescription;
    camera: CameraDescription;
    accumulation: AccumulationDescription;
    display: DisplayDescription;
}
```

Each axis is independently swappable and independently extensible. Changing tonemapping doesn't touch transport. Swapping cameras doesn't affect accumulation. The compiler handles each axis separately.

### Transport

For WebGL2, predominantly unidirectional path tracing. Structured as explicit algorithmic choices rather than named presets — presets are just saved configurations for convenience, not an architectural concept.

```typescript
interface TransportDescription {
    maxBounces: number;
    directLighting: 'none' | 'nee' | 'mis';
    russianRoulette: { enabled: boolean; startDepth: number };
    volumeStrategy: 'none' | 'delta_tracking' | 'raymarching';
    samplesPerFrame: number;
    // ... more axes TBD
}
```

The transport axis has the most impact on generated code. A debug strategy and a full path tracer share almost nothing. The compiler uses the transport description to determine what intersection, BSDF, and light sampling code to emit.

### Camera, Accumulation, Display

*(To be detailed)*

---

## Key Design Principles

1. **Generate, don't template.** The compiler emits exactly the GLSL this scene+strategy needs. Dead code elimination is structural, not a post-process.

2. **Ambient space is foundational.** It constrains what everything else can do. Analyzed first, referenced throughout generation.

3. **Compile-time dispatch.** Material models, geometry types, light counts — all known at compile time. Dispatch is unrolled, not switched at runtime over possibilities that don't exist in the scene.

4. **Open for extension.** New SDF primitives, new BRDF models, new transport algorithms add to the compiler's registry. The `SceneDescription` and `RenderStrategy` interfaces accommodate them without structural changes.

5. **Analyze before generating.** The feature set is built completely before any GLSL is emitted. Generation is mechanical given a complete plan.

---

## What's Not Decided Yet

- Full `CameraDescription` structure
- Full `AccumulationDescription` structure  
- Full `DisplayDescription` structure
- BVH storage strategy for WebGL2 (texture-packed most likely)
- Exact `TransportDescription` axes beyond the basics
- SDF library organization and naming
- Error reporting and source maps
- How custom GLSL in materials/objects is validated




# Compiler Implementation: Handoff to Claude Code

## Context

This project is a WebGL2 path tracer with a three-layer architecture: App → Engine → Compiler. The App and Engine layers are complete and locked. The Compiler layer currently contains a `SimpleCompiler` (hardcoded GLSL, do not touch) and placeholder types.

The task is to build a real `Compiler` class alongside the existing `SimpleCompiler`. It lives in `src/compiler/`.

---

## What the Compiler Does

The Compiler takes two inputs and produces one output:

```
compile(scene: SceneDescription, strategy: RenderStrategy) → CompiledRenderer
```

`CompiledRenderer` is the locked Engine contract — its type is already defined in `compiler/types.ts` and must not change. The Engine executes `CompiledRenderer` objects without knowing anything about how they were produced.

The Compiler is a real compiler in the CS sense. It analyzes its inputs and generates efficient GLSL tailored exactly to this scene and strategy — no dead code, no unused branches, no runtime dispatch over things knowable at compile time. A scene with two Lambertian materials should produce a shader with no GGX code. A strategy with no MIS should produce a shader with no MIS weight calculations.

---

## Internal Structure: Three Phases

The Compiler runs three phases internally:

**Analyze** — Walk `SceneDescription` and `RenderStrategy`. Produce a `SceneFeatures` object that captures everything the rest of the pipeline needs to know. Pure TypeScript, no GLSL. This is the foundation — if it misses something, the wrong code gets generated.

**Plan** — Consume `SceneFeatures`. Decide what passes are needed, what each pass requires, what code capabilities are needed. Produce a `RenderPlan`. Still pure TypeScript. This is where architectural decisions live — how many framebuffer passes, whether to unroll SDF dispatch, which BRDF functions to include.

**Generate** — Consume `RenderPlan`. Emit complete GLSL strings for each shader pass. Assemble them into a valid `CompiledRenderer`. This phase is mechanical given a correct plan.

These three phases should be clearly separated in the code — separate files/classes for Analyzer, Planner, Generator.

---

## File Structure

New files go in `src/compiler/`. Do not modify any existing files except `compiler/types.ts` (which needs its `SceneDescription` and `RenderStrategy` types replaced — see below). Do not touch `SimpleCompiler.ts`.

Suggested structure — Claude Code should use judgment on exact filenames:

```
src/compiler/
  Compiler.ts          ← new entry point, wires together the three phases
  types.ts             ← update SceneDescription and RenderStrategy only
  SimpleCompiler.ts    ← DO NOT TOUCH
  analyze/             ← Analyzer and its output types
  plan/                ← Planner and its output types
  generate/            ← Generator, shader builders, GLSL library files
  scenes/              ← test scene definitions
```

The GLSL library files (ambient space, SDF primitives, material models, lighting, etc.) should live under `generate/glsl/` as plain `.glsl` files, loaded and included by the Generator as needed. Claude Code should decide the appropriate loading mechanism for this Vite project.

---

## Updated Types

Replace `SceneDescription` and `RenderStrategy` in `compiler/types.ts` with the following designs. All other types in that file (CompiledRenderer, RenderPipeline, etc.) are locked and must not change.

### SceneDescription

```typescript
interface SceneDescription {
    id: string;
    name?: string;
    ambientSpace: AmbientSpaceDescription;
    objects: ObjectDescription[];
    materials: Map<string, MaterialDescription>;
    lights: LightDescription[];
}
```

**AmbientSpaceDescription** — type field selects the geometry of space: `'euclidean' | 'hyperbolic' | 'spherical'`. Optional parameters (e.g. curvature). This is the most foundational field — it constrains what geometry, rendering strategies, and SDF library functions are valid.

**ObjectDescription** — a discriminated union on `kind`:
- `'sdf'` — has an `sdf` field which is either a standard primitive (type + parameters) or a custom GLSL body. Has `material` (string key), optional `transform`.
- `'analytic'` — direct intersection. Not implemented in the slice but the type should exist.
- `'mesh'` — BVH-traced geometry. Not implemented in the slice but the type should exist.

Standard SDF primitive types to support initially: `sphere`, `plane`, `box`, `torus`, `capsule`. Each has a `parameters` record with named numeric values (e.g. radius, center, normal, offset).

Custom SDFs provide a GLSL function body and an optional list of named library imports they depend on.

**MaterialDescription** — has a `model` field (`'lambert' | 'disney' | 'dielectric' | 'emissive'`) plus material properties. Properties can be constants (number or number[]) or GLSL expressions (string) for procedural/spatially-varying values. The Analyzer detects which case applies and the Generator emits accordingly.

**LightDescription** — discriminated union on `kind`. For the slice: `'point'` with position and intensity. Design the type to accommodate `'directional'` and others later.

### RenderStrategy

```typescript
interface RenderStrategy {
    id: string;
    transport: TransportDescription;
    camera: CameraDescription;
    accumulation: AccumulationDescription;
    display: DisplayDescription;
}
```

**TransportDescription** — maxBounces, directLighting (`'none' | 'nee' | 'mis'`), russianRoulette (enabled + startDepth), samplesPerFrame.

**CameraDescription** — type (`'pinhole' | 'thinlens' | 'orthographic'`), fov, and type-specific parameters.

**AccumulationDescription** — type (`'average' | 'exponential' | 'variance'`), with type-specific parameters.

**DisplayDescription** — type (`'reinhard' | 'aces' | 'filmic' | 'none'`), exposure.

---

## The Vertical Slice

Build the full three-phase pipeline for exactly this case:

- Euclidean ambient space
- SDF objects only (sphere and plane)
- Lambert material model only, constant properties
- One point light, NEE direct lighting (no MIS needed with one light)
- Pinhole camera
- Simple average accumulation
- Reinhard tonemapping

This exercises the entire real architecture end-to-end. Everything outside this list is out of scope for this task.

### Concrete test scene

Create a file `src/compiler/scenes/minimalScene.ts` that exports a `SceneDescription` and a `RenderStrategy` matching the slice spec above. A sphere and a plane, two Lambert materials, one point light, simple pathtracer strategy. This is the integration test — if `new Compiler().compile(minimalScene, simplePathtracer)` produces a `CompiledRenderer` that renders a visible image, the slice is complete.

---

## What the Generator Must Produce

For the slice, the Generator produces three shader passes matching the existing pipeline pattern already used in `SimpleCompiler._generatePathtracerRenderer`:

1. **Pathtracer pass** — reads `accumulation_previous`, writes to `accumulation_current`. This is where all the interesting generated code lives.
2. **Display pass** — reads `accumulation_current`, applies tonemapping, writes to `rgb` buffer.
3. **Composite pass** — copies `rgb` to screen.

The framebuffer setup (double buffer for accumulation, texture for rgb, screen) and the postFrame swap follow the same pattern already used by `SimpleCompiler`. The Generator should produce the same pipeline structure.

### What the pathtracer shader must contain

The Generator builds the pathtracer fragment shader by assembling pieces in dependency order. The key principle: every piece is emitted only if needed. Lambert code only if a Lambert material exists. NEE only if `directLighting !== 'none'`. Russian roulette only if enabled. The Generator reads the plan and emits accordingly.

The shader needs, in dependency order:

- Version and precision header
- Uniform declarations (resolution, sample count, frame index, previous accumulation texture, camera parameters)
- RNG utilities
- Math utilities (PI, EPSILON, basis construction, cosine hemisphere sampling, luminance)
- Ambient space functions (euclidean for the slice: geodesic is just `origin + dir * t`)
- Ray and Hit struct definitions
- **Generated SDF functions** — one function per object, derived from the object description. A sphere object with center [0,0,0] and radius 1.0 emits a function that calls the sphere SDF library function with those constants baked in.
- **Generated scene dispatch** — `scene_sdf(p)` calls all object SDF functions and returns minimum distance plus material ID. For ≤5 objects this should be unrolled (no loop).
- Normal computation via finite differences on `scene_sdf`
- Ray marcher (`scene_intersect`) and shadow variant (`scene_intersect_any`)
- **Generated material lookup** — `get_material(int id, vec3 p)` dispatches on compile-time integer material IDs. Constant properties emit literal GLSL values. Procedural properties (GLSL string) emit the expression directly.
- BRDF functions — only for models present in the scene. For the slice: Lambert eval, sample, pdf.
- **Generated light evaluation** — for NEE: one block per light. With one point light, no selection needed, just shadow ray + BRDF eval.
- Camera ray generation (pinhole for the slice)
- Path trace loop — bounces, emission check, NEE, Russian roulette, BRDF sampling, throughput update
- Main function — RNG init, ray generation, trace, accumulation blend

### GLSL library files

Reusable GLSL functions (RNG, math, SDF primitives, BRDF models, ambient space implementations) should live as `.glsl` files that the Generator includes verbatim. Claude Code should determine how to load these in the Vite environment. Each file should have a header comment declaring what functions it provides.

---

## Analyzer Responsibilities

The Analyzer must detect and record:
- Which ambient space type
- Which geometry kinds are present, and counts
- Which material models are used (as a Set)
- Whether any material properties are procedural (GLSL strings)
- Whether any materials are emissive
- Light counts by type
- Whether MIS is needed (more than one samplable light AND strategy requests MIS)
- All strategy settings, passed through to the features object

The Analyzer should also validate: if the strategy requests a feature the scene cannot support (e.g. MIS with zero lights), throw a descriptive error rather than producing a broken renderer.

---

## Planner Responsibilities

The Planner takes `SceneFeatures` and produces a `RenderPlan` that tells the Generator exactly what to emit, without the Generator needing to re-examine the `SceneDescription`. Decisions the Planner makes:

- Assign stable compile-time integer IDs to materials (order from Map iteration is fine)
- Assign compile-time integer IDs to lights
- Decide unrolled vs loop SDF dispatch based on object count
- Resolve each material property to either a constant value or a GLSL expression string
- Determine which BRDF code to include
- Determine whether NEE code is needed and for how many lights
- Determine whether Russian roulette code is needed
- Determine what uniforms are needed and their parameter paths

---

## Validation Criteria

The implementation is correct when:

1. `new Compiler().compile(minimalScene, simplePathtracer)` returns without throwing
2. The returned `CompiledRenderer` passes the Engine's existing pipeline validation
3. The generated GLSL compiles in WebGL2 without errors
4. Loading via `engine.loadRenderer(id, compiledRenderer)` works
5. Running the renderer produces a visible image: a sphere and a ground plane, lit by a point light, progressively accumulating

---

## What Is Out of Scope

Do not implement these — they extend the architecture naturally but are not part of the slice:

- Analytic objects or meshes
- Disney, dielectric, emissive material models
- MIS
- Hyperbolic or spherical ambient spaces
- Procedural material properties
- Custom SDF GLSL
- Multiple lights or directional lights
- Variance or exponential accumulation
- ACES or filmic tonemapping

Each of these slots into the existing Analyze → Plan → Generate structure as additional cases. None require structural changes to what is built here.