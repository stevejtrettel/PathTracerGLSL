# Engine Architecture & Current State (Developer Guide)

This doc is a snapshot of how the rendering engine works **right now**. It’s meant to be a practical guide for contributors—what pieces exist, why they exist, how they fit together, and how you extend them safely.

---

## High-level pipeline

```
AssemblyRecipe (modules + constants + entry)
        │
        ▼
 linkRecipe()       ← validates provides/requires; prunes; orders
        │ LinkReport
        ▼
 namespaceModule()  ← prefixes private identifiers per-module
        │ ModuleNamespaceResults
        ▼
 compileRecipe()    ← emits GLSL + manifest (logical→namespaced)
        │ vertexSrc, fragmentSrc, manifest
        ▼
 ProgramCache       ← keyed by computeProgramKey()
        │ ProgramLike
        ▼
 RenderEngine       ← orchestrates uniforms, samplers, film, draw
        │
        ├─ UniformBinder    (CPU → non-sampler uniforms)
        ├─ ResourceBinder   (CPU → samplers via TextureUnitPool)
        ├─ FramebufferPool  (ping-pong HDR film)
        └─ RenderPipeline   (VAO, engine uniforms, draw & swap)
```

---

## Core data model

### `AssemblyRecipe`

* **What:** Immutable spec for building one fragment program.
* **Contents:**

    * `modules`: `ShaderModuleDescriptor[]` (id + GLSL fragment sections).
    * `constants`: `{ [name]: number | boolean | string }`.
    * `entry`: `{ name: string }` (public symbol to call from `main()`).
* **Invariants:** All `requires` must be provided by exactly one module; exactly one entry provider must be reachable.

### `ShaderFragment` (module fragments)

* Freeform text sections:

    * `uniforms`: GLSL `uniform` declarations.
    * `functions`: GLSL functions, may expose public `provides`.
    * `mainCode`: optional GLSL appended as a section.
* Declarative lists:

    * `requires`: public symbols this module expects.
    * `provides`: public symbols this module exports.

---

## Linking & namespacing

### `linkRecipe(recipe)`

* **Builds a symbol table** from `provides`.
* **Validates** every `requires` resolves to *exactly one* provider.
* **Computes reachability** from the entry provider; prunes unused modules.
* **Topologically sorts** reachable modules (ties: `priority`, `kind`, `name`, `version`, `id-hash`).
* **Errors** on:

    * Missing symbol, ambiguous providers, entry provider issues, cycles (including self-dependency).
* **Outputs:**

    * `resolvedOrder[]`, `symbolTable`, `reachableModules[]`, `warnings[]`, `entryProvider`.

### `namespaceModule(module, {preserve})`

* **Goal:** deterministic collision-free names for *private* identifiers.
* **Preserves** any names in `preserve` (entry + all `provides`/`requires`).
* **Prefixes** (with stable, human-readable token) the module’s:

    * `uniform` names
    * private helper function names (function *definitions* not in `preserve`)
* **Safe textual rewriting**:

    * Replaces identifier tokens only (skips comments, strings, preprocessor lines).
    * Leaves built-ins (e.g., `dot`) alone unless you explicitly mapped them (you won’t).
* **Uniform parsing**:

    * Handles `uniform float exposure;`, `uniform vec3 a,b;`
    * Handles samplers and **sampler arrays** (`uniform sampler2D set[4];`)
    * **Ignores uniform blocks** `uniform Block { ... };` (by design in v1)
* **Outputs per module:**

    * `uniforms`, `functions`, `mainCode` (rewritten text)
    * `uniformMappings[]` with `{ logicalName, namespacedName, type?, arraySize? }`
    * `helperMappings` (original→namespaced)
    * `namespacePrefix` (e.g., `m3af2b1_`)

---

## Compilation & caching

### `compileRecipe(recipe)`

* Runs `linkRecipe` and `namespaceModule` for all reachable modules.
* Emits:

    * **Vertex shader**: a deterministic fullscreen quad.
    * **Fragment shader**:

        * Header + engine prelude (stable engine uniforms)
        * Inlined recipe constants as `const` declarations
        * Concatenated `uniforms` / `functions` / `mainCode`
        * Canonical `main()` that calls the **entry**:
          `vec3 color = entry(gl_FragCoord.xy); outColor = vec4(color, 1.0);`
* Builds a **UniformManifest**:

    * `entries[]`: all uniforms (with provenance)
    * `byLogical{}` and `byNamespaced{}` **for non-samplers**
    * `samplers[]`: `{ logical, namespaced, type, arraySize? }`
* **Guarantees**:

    * No `#if/#ifdef` toggles in output—recipe fully determines code shape.
    * Identical recipes → identical GLSL bytes.

### `computeProgramKey(recipe, link, vertexTag)`

* Stable cache key from:

    * Linked module **ComponentID** hashes **in resolved order**
    * **Sorted** constants table
    * Vertex-template version string (e.g., `"v1"`)
* Digest: FNV-1a (32b) over a stable JSON payload.

---

## Runtime binding

### `ParameterStore` (v1.1)

* **What:** Validates & tracks *non-sampler* parameter values per scope.
* **Kinds:** `"float" | "int" | "boolean" | "vec2" | "vec3" | "vec4" | "mat3" | "mat4"`.
* **Reset policies:** `"none" | "accumulation" | "program"`.
* **API:**

    * `register(scope, descriptors[])` — define parameters for a component scope (`Kind/Name@Version`).
    * `set(scope, logical, value)` — validates + marks dirty if changed.
    * `collectDirty()` — returns `{ scope, logical, value, kind, resetPolicy }[]`.
    * `markClean(scope?, logicals?)`
    * `serialize()` / `deserialize(data, markDirty?)`
    * `removeScope(scope)` / `clear()`
* **Notes:** scalar range checks (`min`/`max`) enforced; matrices accept arrays or `Float32Array`.

### `UniformBinder`

* **Binds** non-sampler uniforms to the current GL program:

    * Looks up **namespaced** uniform via `manifest.byLogical[logical]`.
    * Dispatches to correct `gl.uniform*` based on declared or inferred kind.
    * Robust: skips if uniform pruned or optimized out; never throws during frame (type mistakes become a “skip”).
* **Batch API:** `setMany([{ logical, value, kind? }]) → { bound, skipped[] }`

### `ResourceDirectory`

* **App-facing registry** of *logical* samplers:
  `set(logical, { texture: WebGLTexture|null, target: GLenum, pin?: boolean })`.
* `snapshot()` returns a fresh POJO the engine can pass to the binder.
* `texture: null` is allowed (explicit unbind / first frame).

### `TextureUnitPool`

* **Manages** a fixed contiguous range of texture units:

    * Stable mapping per logical name
    * LRU eviction among *unpinned* mappings
    * `pin()`/`unpin()` to protect a mapping from eviction
* **Methods:** `acquire(logical, {pin?})`, `release(logical)`, `unitOf(logical)`, `debugState()`.

### `ResourceBinder`

* **Bridges** logical samplers → GL texture unit bindings:

    * Validates names against `manifest.samplers`.
    * For each `{logical → {texture,target,pin?}}`:

        * `unit = pool.acquire(logical, {pin})`
        * `gl.activeTexture(TEXTURE0 + unit)`
        * `gl.bindTexture(target, texture)` (texture may be `null`)
        * queues `{ logical, value: unit, kind: "int" }` to `UniformBinder.setMany`
    * Stats: `{ attempted, bound, skipped[], errors[] }`
* **Keeps track** of all logicals it touched to support `reset()`.

---

## Drawing

### `FramebufferPool`

* **Ping-pong HDR film** (2 color attachments: READ texture, WRITE FBO).
* `ensureSize(w,h, {linearFiltering?, forceRGBA8?})`

    * Chooses RGBA16F + `EXT_color_buffer_float` when available, else RGBA8.
* `pair() → { readTex, writeFbo }`
* `swap()` — flips roles after render.
* `clear()` — zeroes both attachments (accumulation reset).
* **Handles** uninitialized state (`null` attachments) safely.

### `RenderPipeline`

* **Owns** VAO/VBO for fullscreen quad.
* **Uniforms:**

    * Engine prelude (global): `u_resolution`, `u_frameIndex`
    * Film-specific (if present in manifest): `historyColor` (sampler2D), `sampleCount` (int)
* **Render flow:**

    1. `pool.ensureSize(width, height)`
    2. `{ readTex, writeFbo } = pool.pair()`
    3. Bind program + VAO; set engine uniforms
    4. If present:

        * Bind `readTex` to the configured unit (default 0) and set `historyColor`
        * Set `sampleCount`
    5. Draw fullscreen strip
    6. `pool.swap()`

### `RenderEngine`

* **Owner**/orchestrator that connects everything per frame.
* **On (re)compile**:

    * Runs `linkRecipe` + `compileRecipe`
    * Computes program key; reuses or re-creates program via cache
    * Builds `RenderPipeline`, `UniformBinder`, `ResourceBinder`
    * Registers module parameter schemas (if provided)
    * **Resets accumulation** on new program shape
* **Per frame**:

    * Pulls `dirty` params from `ParameterStore`; applies resets:

        * Any `"program"` param forces recompile next frame (you’re using this to gate structural changes).
        * `"accumulation"` changes trigger film reset (unless a recompile already did).
    * `UniformBinder.setMany(dirty)`
    * If app provided a `ResourceDirectory`, `ResourceBinder.bind(snapshot)`
    * Sets engine counters → `RenderPipeline.render(w,h)`
    * Increments `frameIndex`/`sampleCount`
    * Returns diagnostics: linked module order, compiler warnings, sampler bind stats.

---

## Determinism & safety guarantees

* Recipes with identical inputs produce **byte-identical GLSL**.
* No feature preprocessor branches in emitted GLSL.
* Linker is strict: **no ambiguity, no missing requirements, no cycles**.
* Namespacing is identifier-aware (won’t mangle comments/strings/preproc).
* Bind phases are **idempotent** and **non-throwing** during a frame; bad input yields “skipped” diagnostics instead of crashing.

---

## Extending the engine

### Add a new shader module

1. Create a `ShaderFragment` with `uniforms`, `functions`, optional `mainCode`.
2. Fill `provides`/`requires` accurately (public symbol names are the linker’s truth).
3. (Optional) Export a parameter schema (array of descriptors) on the module descriptor so the engine can auto-register UI/state via `registerModuleParams`.

### Add parameters

* Define a `ModuleParamSchema` and attach it to the module descriptor.
* Values live in `ParameterStore` under scope `Kind/Name@Version`.
* Use `resetPolicy` to control accumulation vs program reset behavior.

### Bind textures

* Register sampler resources with `ResourceDirectory`:

  ```ts
  dir.set("albedoMap", { texture: glTex, target: gl.TEXTURE_2D, pin: true });
  ```
* The engine discovers which samplers exist through the **manifest**; unknown names are ignored (and reported).

---

## Practical examples

### Compile & render once

```ts
// Build recipe
const recipe = {
  modules: [ lambertModule, filmModule ],
  constants: { PI: 3.14159265, ENABLE_SOMETHING: true },
  entry: { name: "shadePixel" }
};

// Orchestrate
engine.setResourceDirectory(myResources);
const result = engine.render(canvas.width, canvas.height, recipe);

// Diagnostics
console.table(result.diagnostics.moduleOrder);
console.log(result.diagnostics.resources);
```

### Update a parameter safely

```ts
// Change exposure and mark accumulation reset automatically (depending on resetPolicy)
store.set("Material/Lambert@1.0.0", "exposure", 1.2);

// Next engine.render(...) will bind the new value and reset film if needed.
```

---

## What’s deliberately **not** in v1

* Uniform Blocks (`uniform Block { ... };`) are stripped during parsing and not mapped into the manifest.
* Multi-pass / DAG orchestration (single pass only).
* AST-level GLSL parsing/optimization (textual token-aware rewriting only).
* Sampler arrays beyond manifest metadata (no runtime iteration helpers yet).

---

# Next Steps (Roadmap)

Here’s a pragmatic path to pushing pixels from a simple “world + photography”:

### 1) Minimal “World” & “Photography” types

* **World**: a list of components (materials, sky, integrator) that each produce a `ShaderModuleDescriptor` + optional param schema.
* **Photography**: camera intrinsics/extrinsics encoded as uniforms and/or constants (e.g., resolution, focal length, view/proj matrices).
* **Adapter**: `buildRecipe(world, photography): AssemblyRecipe`

    * Flattens module descriptors
    * Selects the right entry symbol (e.g., `shadePixel`)
    * Adds photography constants

**Deliverables**

* `src/app/build-recipe.ts` helper with a tiny, hardcoded world (sky gradient + passthrough film).
* Unit tests: “changing camera param toggles accumulation reset but not program reset”.

---

### 2) “Film” module family

* Ship **two** tiny film modules:

    1. **Passthrough**: no accumulation (for bring-up)
    2. **Simple accumulation**: writes weighted sum, consumes `historyColor` and `sampleCount`
* Provide param schemas and small GLSL for each.
* This lets you verify `RenderPipeline`’s dynamic uniform discovery.

**Deliverables**

* `Film/Passthrough@1.0.0`
* `Film/Accumulate@1.0.0`
* Tests: manifest contains `sampleCount` and (for accumulate) `historyColor` when expected.

---

### 3) Resource loading façade

* Super-thin async loader that returns `WebGLTexture` given a URL (+ sampler state options).
* Plugs into `ResourceDirectory`.
* **Mockable** for tests.

**Deliverables**

* `src/engine/resources/texture-loader.ts`
* Test: loads a 2×2 RGBA, binds as `albedoMap`, frame does not crash, binder stats show 1 bound.

---

### 4) Developer diagnostics overlay (optional but high-ROI)

* Log the **ProgramKey.short**, module order, and a compact manifest table (logical→namespaced).
* Toggle to dump the exact fragment GLSL (helps confirm namespacing & entry call).

**Deliverables**

* `src/devtools/diagnostics.ts` with pluggable hook (you already have `onRenderStats` in `RenderEngine`).

---

### 5) Stretch: “Integrator” skeleton

* A toy integrator module that samples a sky (no geometry) and returns a color based on `fragCoord` / `uv`.
* This is your first real “world” picture.

**Deliverables**

* `Integrator/Sky@1.0.0` using a simple gradient or procedural sun.
* Wire it as the recipe’s entry `shadePixel`.

---

### 6) Hardening & coverage

* Unit tests for:

    * Ambiguous providers / missing requires / cycles in the linker.
    * Namespacing edge-cases (keywords, preproc lines).
    * ProgramKey changes on constants & modules; stability when order of input modules changes.
    * ParameterStore: range enforcement, float vs int, serialize/deserialize across versions.
* Fuzz-ish tests on `replaceIds` using randomized comments/strings to prevent regressions.

