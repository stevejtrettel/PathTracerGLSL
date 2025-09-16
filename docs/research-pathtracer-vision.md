
# Research Path Tracer: Updated Vision

## Executive Summary

This document lays out the long-term vision for a GPU-accelerated research renderer built for non-Euclidean geometries and advanced light transport. The system **separates the mathematical “World”** (geometry, scene, BSDFs) from **“Photography”** (camera, tracer, film), while a small **Engine** composes shader modules into a deterministic program based on a **recipe**—no runtime feature branching, no preprocessor switches.

We now have a working skeleton: a module system, a recipe compiler that emits deterministic GLSL, a parameter registry with reset policies, a uniform binder, a tiny resource directory for samplers, a texture-unit pool, a resource binder, a minimal render pipeline, and an orchestrating render engine with focused tests. This updated vision reconciles the original document with the present direction and codifies the contracts that have emerged.

---

## Core Architecture: The Pillars

### 1) World (Mathematical Reality)

Represents the space and its contents:

* **Geometry**: The metric/manifold (Euclidean, Hyperbolic, Schwarzschild, …)
* **Scene**: Objects embedded in that space (SDFs, meshes, implicits)
* **Materials**: BSDFs / phase functions
* **Lights**: Emitters (area, environment, procedural)
* **Media**: Optional participating media

World components supply **shader fragments** (functions, uniforms, public symbols) consumed by the Engine’s recipe compiler.

### 2) Photography (Observation Process)

Encodes how we observe:

* **Camera**: Ray generation
* **Sampler**: Sample layout and RNG strategy
* **Tracer**: Path construction
* **Film**: Accumulation/reconstruction (GPU ping-pong)
* **Developer**: Output transforms (tone map, color)

Photography components also provide **fragments**, parameters, and samplers.

### 3) Engine (Infrastructure & Determinism)

A small orchestrator with strict contracts:

* **Recipe compiler**: Assembles GLSL from module fragments; resolves `requires → provides`; namespaces private symbols; emits a canonical vertex + fragment and a **UniformManifest**.
* **ProgramKey & cache**: Stable key from link report + vertex template version; programs hot-swap when shape changes.
* **Parameter system**: Central **ParameterStore** with kinds and **reset policies** (`none | accumulation | program`); **UniformBinder** applies dirty values.
* **Resource system**: App populates a **ResourceDirectory** of logical samplers; **TextureUnitPool** (LRU + pinning) assigns units; **ResourceBinder** activates and binds.
* **Render pipeline**: Minimal fullscreen draw + film ping-pong via a **FramebufferPool**.
* **Diagnostics**: Per-frame micro-stats and compiler diagnostics.

> **Departure from the original doc:** We do **not** use an uber-shader with `#define` toggles. Shader shape is decided purely by the **recipe**; identical recipes produce **byte-for-byte identical** GLSL.

### 4) Extensions (Optional)

Non-core features layered on top:

* **Controls** (orbit/fly), **UI** (parameter panes), **Analytics** (stats), **Debug** (visualizers), **Scripting** (batch/animation).

### 5) Blueprints (Prebuilt Configs)

Convenient “studios”:

* **Worlds**: CornellBox, HyperbolicRoom, SchwarzschildLab
* **Photographers**: DirectCapture, PathTracer, Researcher
* **Studios**: Ready-to-run World + Photography combos

---

## Plug-and-Play via Recipes

Any World can be rendered with any Photography by composing their modules into an **AssemblyRecipe**:

```ts
// A minimal module
const materialLambert = {
  id: { kind: "Material", name: "Lambert", version: "1.0.0" },
  fragment: {
    uniforms: `uniform vec3 albedo;`,
    functions: `
      vec3 shadePixel(vec2 fragUV) { return albedo; }
    `,
    provides: ["shadePixel"],
    requires: [],
    entrypoints: { fragmentMain: "shadePixel" },
  },
  parameters: [
    { name: "albedo", kind: "vec3", default: [1,1,1], resetPolicy: "accumulation" },
  ],
};

const tracerFlat = {
  id: { kind: "Tracer", name: "Flat", version: "1.0.0" },
  fragment: {
    functions: `vec3 integrateSample(vec2 p) { return vec3(1.0); }`,
    provides: ["integrateSample"],
  },
};

const recipe = {
  modules: [materialLambert, tracerFlat],
  entry: { name: "shadePixel" },
  constants: { /* optional build-time constants */ },
};

// Orchestrate
const engine = new RenderEngine(gl, cache, fboPool, pipelineFactory);
// (re)compile on recipe shape changes
const out = engine.render(width, height, recipe);
```

**Samplers (resources)** are provided by the app per frame (or on change):

```ts
const dir = new ResourceDirectory();
dir.set("albedoMap", { texture: glTex, target: gl.TEXTURE_2D, pin: true });
engine.setResourceDirectory(dir);
```

**Parameters** flow through the central store:

```ts
const store = engine.getParameterStore();
store.set("Material/Lambert@1.0.0", "albedo", [0.9, 0.2, 0.2]); // resets film
```

---

## Contracts & Types (Engine ↔ Modules)

### ShaderFragment (module payload)

```ts
interface ShaderFragment {
  uniforms?: string;          // GLSL uniform declarations
  functions: string;          // GLSL helper functions
  mainCode?: string;          // optional extra main body snippets
  provides?: string[];        // public symbols exported
  requires?: string[];        // public symbols the module needs
  entrypoints?: { fragmentMain?: string };
}
```

### Module Parameters (declarative)

```ts
type ParamKind = "float" | "int" | "bool" | "vec2" | "vec3" | "vec4" | "mat3" | "mat4";
type ResetPolicy = "none" | "accumulation" | "program";

interface ModuleParamSpec {
  name: string;
  kind: ParamKind;
  default: number | boolean | number[] | Float32Array;
  resetPolicy?: ResetPolicy;  // default "none" for module specs; store defaults to "accumulation" if omitted
  min?: number; max?: number; step?: number;
  persistent?: boolean;       // default true
  description?: string;
}
```

### Uniform Manifest (compiler output)

```ts
interface UniformManifestEntry {
  logicalName: string;        // as written in module fragment
  namespacedName: string;     // compiler-prefixed variant in linked program
  type?: string;              // e.g., "float", "vec3", "sampler2D", when detectable
  owner: { kind: string; name: string; version: string };
}

interface UniformManifest {
  entries: ReadonlyArray<UniformManifestEntry>;
  byLogical: Readonly<Record<string, string>>;
  byNamespaced: Readonly<Record<string, string>>;
}
```

---

## Engine Runtime: What Happens Per Frame

1. **Collect dirty parameters** from `ParameterStore`.
2. **Apply reset policy**:

    * `program` → force recompile next
    * `accumulation` → clear film
3. **(Re)compile** if ProgramKey (recipe shape) changed:

    * Build/link/namespace; emit GLSL + manifest
    * Rebuild pipeline and binder(s)
    * Auto-register module parameter schemas by scope
    * Reset accumulation counters
4. **Ensure film size** (FBO pool)
5. **Bind uniforms** via `UniformBinder.setMany()`
6. **Bind samplers** (if provided) via `ResourceBinder` using `ResourceDirectory` snapshot and `TextureUnitPool`
7. **Draw** via `RenderPipeline` (fullscreen pass)
8. **Advance counters** (`frameIndex`, `sampleCount`)
9. **Diagnostics hook** (optional micro-stats)

---

## Advanced Use Cases

### Stereo / VR

Provide two camera modules or a camera that writes different rays based on viewport region; treat each eye as a pass in a future multi-pass pipeline. Today, stereo can be two renders with different recipes/cameras.

### Stateful Algorithms (BDPT/MLT)

State buffers (light paths, reservoirs) will live in **resources** owned by the Engine (texture/buffer pools) but requested by modules (declared in a resource spec). The tracer module can expose functions that read/write those resources; the Engine provides binding and lifetime. For WebGL2, SSBO-like data can be emulated via float textures.

---

## What Changed vs. The Original Document

* **No preprocessor #ifdefs** for feature toggles. We assemble the *exact* shader needed by the selected modules; output is deterministic.
* **Parameter reset policy** is explicit and enforced in the render loop.
* **Resource binding** is driven by a small, app-provided `ResourceDirectory` + `TextureUnitPool` (pinning and LRU).
* **Film is GPU ping-pong** (simple for now), with intent to extend; Developer remains flexible (GPU or CPU).
* **Single-pass pipeline** today; designed to evolve into a multi-pass DAG with the same deterministic assembly contracts.

---

## Implementation Plan (Phases)

### Phase 1 — Deterministic Single-Pass (✅ in progress)

* Module fragments + dependency linker ✓
* Namespacing + manifest ✓
* ProgramKey + cache interfaces ✓
* Render pipeline (fullscreen) + FBO pool ✓
* ParameterStore + UniformBinder ✓
* ResourceDirectory + TextureUnitPool + ResourceBinder ✓
* RenderEngine orchestrator + focused tests ✓

### Phase 2 — Sampler Integration & Film v1.5

* Ensure sampler types are captured in the manifest where detectable
* Wire sampler binding unconditionally in engine (with diagnostics always present)
* Optional: add `exportHDR()` path to read back the film buffer

### Phase 3 — UI & Authoring Quality of Life

* Parameter introspection helpers for UI (list by scope; min/max/step)
* Example parameter panel that drives the store and shows reset effects

### Phase 4 — Multi-Pass Pipeline (Foundations)

* Extend recipe to express **passes** and their inputs/outputs
* `MultipassPipeline` with intermediate attachments (via pools)
* Example: tracer → post (tone map) pipeline

### Phase 5 — Research Extras

* Sample layout registration (lens/time/nee/etc.)
* Variance/adaptive film module
* Debug visualizers & shader dump tooling

---

## Design Decisions (Updated Answers)

1. **Film & Developer location?**
   Film on GPU (ping-pong) for v1; Developer can be either, starting with simple GPU tone-map or CPU export. We’ll move more to GPU as needed.

2. **Shader variants vs. uber-shader?**
   **Variants via recipe**, not preprocessor. No feature branching at runtime.

3. **Parameters reactive or explicit?**
   Central store with explicit set + dirty tracking. The engine pulls once per frame and applies reset policies deterministically.

4. **Multi-pass algorithms?**
   Encoded as a pass DAG in the recipe (Phase 4). Tracer modules can declare resource needs; Engine binds/allocates.

5. **WebGL2 vs. WebGL1?**
   WebGL2 only.

6. **Strict TypeScript?**
   Yes (`strict: true`)—we rely on types for contracts between modules and Engine.

---

## Testing & Documentation

* **Unit tests** for compiler (string outputs, manifests), binders, pools.
* **Integration tests** for Engine diagnostics and render orchestration.
* **Docs**: Each file carries a header (Purpose, Inputs, Outputs, Invariants). Add `ENGINE_OVERVIEW.md`, `ENGINE_STATUS.md`, and this vision doc. Provide examples and cookbooks for module authors.

---

## Example: Minimal “World × Photography” to Recipe

```ts
// World-supplied module (geometry functions)
const geomEuclid = {
  id: { kind: "Geometry", name: "Euclidean", version: "1.0.0" },
  fragment: {
    functions: `vec3 geodesic(vec3 o, vec3 d, float t) { return o + d * t; }`,
    provides: ["geodesic"],
  },
};

// Photography-supplied (camera + tracer + film)
const cameraPinhole = {
  id: { kind: "Camera", name: "Pinhole", version: "1.0.0" },
  fragment: {
    uniforms: `uniform float u_fov;`,
    functions: `
      Ray generateRay(vec2 px) { /* ... */ }
    `,
    provides: ["generateRay"],
  },
  parameters: [
    { name: "u_fov", kind: "float", default: 60.0, min: 1, max: 179, resetPolicy: "accumulation" },
  ],
};

const tracerPath = {
  id: { kind: "Tracer", name: "Path", version: "0.1.0" },
  fragment: {
    requires: ["generateRay", "geodesic"],
    functions: `
      vec3 shadePixel(vec2 frag) { /* path tracing core */ return vec3(0.0); }
    `,
    provides: ["shadePixel"],
    entrypoints: { fragmentMain: "shadePixel" },
  },
};

const recipe = { modules: [geomEuclid, cameraPinhole, tracerPath], entry: { name: "shadePixel" } };

const engine = new RenderEngine(gl, cache, fboPool, pipelineFactory);
engine.render(800, 600, recipe);
```

---

## Future Directions

* **Geometries**: FLRW, Thurston geometries, GR scenes with analytic geodesics
* **Algorithms**: BDPT, MLT/VCM, reservoir sampling
* **Spectral**: Wavelength domain (retain RGB initially, keep interfaces extensible)
* **WebGPU**: Compute pipelines later; keep recipes and manifests portable
* **Differentiable**: Keep parameter vs. uniform split clean to enable gradients later
* **Distributed**: Multi-GPU / cloud (serialize recipes, parameters, and seeds)

---

## Conclusion

We keep the **engine boring and deterministic**, pushing all research complexity into small, composable modules with explicit contracts. Recipes decide the shader shape; the engine compiles, binds, and draws—no hidden magic. This separation lets you iterate on mathematics and algorithms quickly while keeping infrastructure stable, testable, and predictable.
