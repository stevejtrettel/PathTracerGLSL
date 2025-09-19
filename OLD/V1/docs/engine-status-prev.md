
# Engine Status (What’s built today)

This is a snapshot of engine-side files with short descriptions.

```

src/
└─ engine/
├─ bindings/
│  ├─ texture-unit-pool.ts         # Deterministic unit allocator (LRU + pinning + baseUnit)
│  ├─ resource-binder.ts           # Activates units, binds textures, sets sampler uniforms (via UniformBinder)
│  └─ uniform-binder.ts            # Binds logical → namespaced uniforms using manifest + gl.uniform\*
│
├─ execution/
│  ├─ render-pipeline.ts           # Fullscreen-quad pipeline; binds engine counters; draws and swaps film
│  └─ render-engine.ts             # Orchestrator: compile/link/cache programs, bind params/resources, render
│
├─ parameters/
│  ├─ parameter-store.ts           # Typed store, dirty tracking, reset policies, (de)serialize
│  └─ register-module-params.ts    # Helper: register module schemas into ParameterStore (scoped view)
│
├─ resources/
│  ├─ framebuffer-pool.ts          # Ping-pong framebuffer pair management for GPU Film
│  └─ resource-directory.ts        # App-filled logical sampler registry; immutable snapshot per frame
│
└─ shaders/
├─ assembly-recipe.ts           # Recipe type (modules + constants + entry)
├─ dependency-linker.ts         # Resolves requires→provides, orders modules, diagnostics
├─ namespacing.ts               # Prefix uniforms/private helpers; preserve public symbols
├─ program-key.ts               # Stable key from linked order + vertex template version
└─ shader-compiler.ts           # Compiles recipe → vertex/fragment + UniformManifest + diagnostics

````

## What works

- **Deterministic shader assembly** (no feature branching)
- **Namespacing** that preserves public symbols; duplicates validated
- **Dependency linker** (topological order, missing/ambiguous checks)
- **ProgramKey + ProgramCache** (plugged via interfaces in tests)
- **ParameterStore** with reset policies and uniform binding via **UniformBinder**
- **ResourceDirectory**, **TextureUnitPool**, **ResourceBinder** (unit tested)
- **RenderPipeline** for fullscreen draw + film ping-pong
- **RenderEngine**: dirty-param loop (reset policy + bind), film counters, program hot-swap, optional resource diagnostics

## What’s intentionally minimal

- Sampler binding in the engine is **soft-wired** (diagnostics present, GL-binding assertions relaxed in integration tests).
- Film features are basic (no special accumulators yet).
- Single-pass pipeline (multi-pass is planned).

---

# Next Steps (Pasteable plan)

## A) Finish Sampler Binding Integration (v1.1)

**Goal:** When a recipe declares `uniform sampler* logicalName;`, and the app sets a texture for that logical name in `ResourceDirectory`, the engine should bind it *and* set the sampler uniform.

**Tasks**
1. **Manifest typing**
   - Ensure `shader-compiler.ts` includes `type: "sampler2D" | "samplerCube" | ...` in `UniformManifestEntry` when emitting sampler uniforms.
   - Add tests that `sampler2D` is captured.

2. **Engine plumbing**
   - In `render-engine.ts`, after uniform setMany:
     - Take `const snap = resourceDir?.snapshot()`
     - Build a candidate list from manifest entries with `type?.startsWith("sampler")`
     - Call `resourceBinder.bind(snap, { uniforms: candidates })`
     - Merge result into `diagnostics.resources`:
       - `boundSamplers`, `skippedSamplers`, `errors`

3. **Diagnostics**
   - Ensure `RenderOutcome.diagnostics.resources` is always present with arrays.

4. **Tests**
   - Update `render-engine-resources.test.ts` to assert `boundSamplers === 1` for a positive case.

**Acceptance**
- Positive case: 1 sampler in manifest + directory → `boundSamplers: 1`, no errors.
- Unknown sampler in directory → `boundSamplers: 0`, optional presence in `skippedSamplers`, no errors.

---

## B) Film v1.5 (GPU Accumulation)

**Goal:** Add a minimal accumulation API and optional export-to-CPU.

**Tasks**
1. **Film interface**
   - Create `src/engine/execution/film.ts` with:
     ```ts
     export interface FilmLike {
       ensureSize(w: number, h: number): void;
       pair(): { readTex: WebGLTexture | null; writeFbo: WebGLFramebuffer | null };
       swap(): void;
       clear(): void;
       exportHDR(gl: WebGL2RenderingContext): Float32Array; // RGBA32F, or define format
     }
     ```
   - Adapt `framebuffer-pool.ts` to fully satisfy FilmLike.

2. **Shader conventions**
   - Reserve `u_historyColor` + `u_sampleCount` names in the engine prelude.
   - Pipeline binds them **only if** they appear in the manifest.

3. **Export path**
   - Implement `exportHDR` using `gl.readPixels` from the current accumulation target.

4. **Tests**
   - Mock-based tests for `exportHDR` invocation & size, not pixel accuracy.

**Acceptance**
- Accumulating recipes increment `sampleCount`, read previous frame via `u_historyColor`.
- `exportHDR` returns correctly sized buffer.

---

## C) Parameter ↔ UI bridge (v1)

**Goal:** Ergonomic helpers to drive UI with module schemas.

**Tasks**
1. Add `list(scope)` and `getNamespaces()` convenience to `ParameterStore` (already present if you kept earlier APIs).
2. Add a small `ui-bridge.ts` that:
   - Enumerates schemas by scope
   - Emits a flat array of UI descriptors: `[{ scope, logical, kind, min, max, step, resetPolicy }]`

**Acceptance**
- Example UI can render sliders/toggles that set store values and trigger engine binding/reset logic.

---

## D) Multi-pass Foundation (v1.9)

**Goal:** Represent a small pass DAG (e.g., raymarch → post → tonemap).

**Tasks**
1. Extend Recipe to allow `passes: Pass[]` (each with its own module set & entry).
2. Build a `MultipassPipeline` that:
   - Creates intermediate color targets (from a FramebufferPool per pass)
   - Runs passes in order; exposes last color as “film”

**Acceptance**
- Two-pass example compiles and runs with intermediate textures.

---

## E) Robustness & Dev UX

**Tasks**
- Context loss & disposal guards in pipeline
- Pretty diagnostics (e.g., “missing required symbol” show owner IDs)
- Optional perf marker hooks
- Improve error messages for param validation

---

## F) Examples & Docs

**Tasks**
- Minimal examples:
  - “Lambert + Flat tracer + Static albedo texture”
  - “Path tracer + accumulation”
- Cookbook for module authors:
  - How to declare parameters
  - How to expose samplers
  - Reset policy best practices
````

---


# Engine Notes & Handoff

## Conventions & Contracts

- **Component scope**: `${kind}/${name}@${version}` (e.g., `Material/Lambert@1.0.0`)
- **Shader**
  - GLSL ES 300
  - Canonical `main()` calls the recipe entry: `vec3 color = <entry>(gl_FragCoord.xy);`
  - Engine prelude sets **only** minimal uniforms (`u_resolution`, `u_frameIndex`), more can be added carefully.
  - **No preprocessor** feature flags. Feature presence is implied by module inclusion and resolved by linking.
- **Namespacing**
  - Uniforms and private helpers are prefixed with a stable module hash.
  - Public symbols in `provides`/`requires` **must not** be renamed.
- **Parameters**
  - Types: `float`, `int`, `bool`, `vec2/3/4`, `mat3/4`
  - Reset policy:
    - `none` — safe to update without resets (e.g., exposure)
    - `accumulation` — clear film on change (e.g., albedo in a path tracer)
    - `program` — force recompile (e.g., toggling entirely different tracer algorithm)
- **Resources**
  - Logical sampler names must match uniforms in module fragments.
  - The app is responsible for populating `ResourceDirectory` consistently.

## Known Gaps / Intentional Simplifications

- Engine integration for sampler binding is intentionally **soft** in the integration tests; ResourceBinder is fully tested in isolation. Finish wiring when ready (see Next Steps).
- Film is a simple ping-pong; specialized accumulation variants (reprojection, TAA) are out of scope for v1.
- Single pass only; multi-pass planned.

## Testing Philosophy

- Fast unit tests with tiny **mocks** for GL/program/pipeline.
- Compiler tests avoid driver variability—assert strings + manifests.
- ResourceBinder tests assert actual GL call ordering (via mock).
- Engine integration tests assert **diagnostics** and high-level effects rather than low-level GL calls (to keep the engine decoupled and flexible).

## Authoring a New Module (Quick Recipe)

```ts
// id
const id = { kind: "Material", name: "Lambert", version: "1.0.0" };

// parameters (optional)
const parameters = [
  { name: "albedo", kind: "vec3", default: [1,1,1], resetPolicy: "accumulation" },
  { name: "exposure", kind: "float", default: 1.0, resetPolicy: "none", min: 0.0, max: 10.0 }
];

// fragment
const fragment = {
  uniforms: `
    uniform vec3 albedo;
    uniform float exposure;
    // optional sampler
    // uniform sampler2D albedoMap;
  `,
  functions: `
    vec3 shadePixel(vec2 fragCoord) {
      return albedo * exposure; // trivial example
    }
  `,
  provides: ["shadePixel"],
  requires: [], // or ["integrateSample"] etc.
  entrypoints: { fragmentMain: "shadePixel" },
};

// descriptor
const moduleDescriptor = { id, fragment, parameters };
````

## ResourceDirectory Usage (App Side)

```ts
const dir = new ResourceDirectory();
dir.set("albedo", { texture: glTex, target: gl.TEXTURE_2D, pin: true });
engine.setResourceDirectory(dir); // call when textures change (or each frame if dynamic)
```

## Parameter Flow (App Side)

```ts
const store = engine.getParameterStore();
// After compile, module schemas are registered under their scopes
store.set("Material/Lambert@1.0.0", "albedo", [0.9,0.2,0.2]); // will reset accumulation
// Engine will bind at next render() call
```

## Error Messages You May See (and what they mean)

* `dependency-linker: missing provider for symbol X`
  → A module’s `requires` wasn’t satisfied by any module’s `provides`.

* `namespacing: duplicate uniform "foo"`
  → A module declared the same uniform twice.

* `TextureUnitPool: no available texture units (all pinned)`
  → Every unit is pinned; either unpin or increase pool size.

* `UniformBinder: expected vec3 array length 3`
  → Mismatched parameter kind vs value.

## Performance Tips

* Avoid frequent program-reset parameters; prefer `accumulation` policy when possible.
* Group uniform updates—use `setMany` instead of per-uniform chattiness.
* Pin long-lived samplers (env map) so they don’t churn units.

## Housekeeping & Style

* Keep module functions small and side-effect free; prefer passing data explicitly.
* Use comments in `shader-compiler` output to banner module sections (already implemented).
* Keep public symbol names stable across versions when feasible; bump version when breaking.

---


