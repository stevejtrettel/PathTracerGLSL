# Compiler Architecture: Next Steps

> **STATUS (July 2026):** partially superseded. §2 (Shader IR) and §7 (error wiring) are **built**; §4's Option B (generated per-material dispatch) is **adopted** into [fable-compiler-contracts.md](fable-compiler-contracts.md) §3.3, which now governs all GLSL-contract questions. Still-live TS-side ideas: §1 (scene/strategy compilation split), §3 (uniform/resource unification), §6 (pipeline flexibility — evolved into the contracts' pipeline-archetype direction).

Design notes for evolving the compiler beyond the current vertical slice. These changes are interconnected — the IR, uniform unification, and scene/strategy split are three facets of making the compiler's internal model richer so it can validate and optimize before emitting strings.

## 1. Scene/Strategy Split

**Problem:** `compile(scene, strategy)` re-analyzes, re-validates, and re-plans objects/materials/lights every time — even when only the strategy changes. With multiple strategies per scene, this is redundant work and blurs two independent concerns.

**Proposed design:**

```
Phase 1: compileScene(scene) → CompiledScene
  - Analyze features
  - Validate scene-level constraints
  - Resolve objects, materials, lights
  - Generate scene-specific GLSL (SDF dispatch, material lookup, light sampling)

Phase 2: bindStrategy(compiledScene, strategy) → CompiledRenderer
  - Validate strategy against scene features (e.g. MIS needs lights)
  - Select templates (camera, accumulation, display, transport)
  - Set #defines (MAX_BOUNCES, ENABLE_NEE, etc.)
  - Assemble final shader from scene GLSL + strategy templates
  - Build pipeline, uniforms, parameters
```

**What belongs where:**

| Concern | Scene | Strategy |
|---------|-------|----------|
| SDF dispatch | scene | |
| Material lookup | scene | |
| Light sampling | scene | |
| Camera template | | strategy |
| Transport (#defines) | | strategy |
| Accumulation template | | strategy |
| Display/tonemap | | strategy |
| BRDF includes | both — scene says which models, strategy decides nothing | |
| Pipeline structure | | strategy (determines pass count, buffer formats) |
| Uniforms | both — scene may add procedural uniforms, strategy adds camera | |

The `CompiledScene` would be a cacheable intermediate:

```typescript
interface CompiledScene {
    features: SceneFeatures;
    sdfDispatchGLSL: ShaderBlock;
    materialLookupGLSL: ShaderBlock;
    lightSamplingGLSL: ShaderBlock;
    brdfModels: MaterialModel[];
    uniformsFromScene: PlannedUniform[];  // procedural material uniforms, etc.
}
```

## 2. Shader IR (Intermediate Representation)

**Problem:** Shader assembly is string concatenation. Once joined, provenance is lost — you can't trace a GPU error back to its source template or codegen function.

**Proposed design:** Replace raw strings with tagged blocks.

```typescript
interface ShaderBlock {
    source: string;
    origin: string;       // 'glsl/raymarch.glsl' or 'generated:sdf-dispatch'
    lineCount: number;
}

interface AssembledShader {
    glsl: string;
    sourceMap: BlockSourceMap;
}

interface BlockSourceMap {
    blocks: Array<{
        origin: string;
        startLine: number;   // in assembled output
        lineCount: number;
    }>;

    // Given a line in the assembled shader, return origin + local line
    resolve(line: number): { origin: string, localLine: number };
}
```

**Usage in ShaderBuilder:**

```typescript
// Before (current):
sections.push(structsGLSL);
sections.push(generateSDFDispatch(plan.objects));
return sections.join('\n');

// After:
blocks.push(block(structsGLSL, 'glsl/structs.glsl'));
blocks.push(block(generateSDFDispatch(plan.objects), 'generated:sdf-dispatch'));
return assemble(blocks);  // → { glsl, sourceMap }
```

**What this enables:**
- GPU shader error → "line 247 → glsl/raymarch.glsl:32 (scene_intersect)"
- Per-block size reporting (which generated section is largest?)
- Validation: detect duplicate includes, missing dependencies
- Deterministic test comparisons (block-by-block instead of full string diff)

The implementation is ~50 lines. The `assemble` function joins strings and builds the source map in one pass.

## 3. Uniform/Resource Unification

**Problem:** The shader has two sources of truth for "what inputs does this shader need":
1. `plan.uniforms` → scalar/vector uniforms, set via ParameterManager
2. Pipeline texture bindings → `{ 'u_previous': 'accumulation_previous' }`, set by RenderExecutor

These are declared separately and connected implicitly. If the GLSL declares `uniform sampler2D u_previous` but the pipeline doesn't wire it (or vice versa), you get a silent failure.

Additionally, the display shader declares its own uniforms (`u_radiance`, `u_resolution`) inside the GLSL template, completely outside the compiler's uniform system.

**Current uniform flow:**

```
Scalar uniforms:
  Planner → plan.uniforms → ShaderBuilder (declares in GLSL)
                           → PipelineBuilder (creates UniformBinding[])
                           → Engine/ParameterManager (sets GL uniforms each frame)

Texture uniforms:
  PipelineBuilder → pipeline.passes[].inputs.textures (wiring spec)
  ShaderBuilder → hardcoded `uniform sampler2D u_previous;` in GLSL
  RenderExecutor → binds textures before each pass
```

**Proposed: single planned resource list:**

```typescript
type PlannedResource =
    | { kind: 'parameter', name: string, type: UniformType, parameterPath: string, default?: any }
    | { kind: 'texture', name: string, source: string }   // source = pipeline buffer ref
    | { kind: 'builtin', name: string, type: UniformType } // engine-provided, always present

interface ResourcePlan {
    // All resources for a shader, in one place
    resources: PlannedResource[];
}
```

The Generator uses this to:
1. Emit all `uniform` declarations (no more hardcoded texture uniforms in GLSL)
2. Build `UniformBinding[]` from `parameter` resources
3. Build pipeline texture wiring from `texture` resources
4. Validate: every declared uniform has a source, every wired texture has a declaration

**Important:** This does NOT change how the Engine sets uniforms. ParameterManager still handles scalars, RenderExecutor still handles textures. The unification is in the compiler's model, not the Engine's execution.

**Engine builtins** (`engine.resolution`, `engine.frameIndex`, etc.) are values the Engine injects into the parameter bag each frame. The compiler knows about them as `parameterPath` strings. The Engine doesn't declare these uniforms — the compiler does via `PlannedResource`. This is already the case; the resource plan just makes it explicit.

## 4. Material Dispatch Architecture

**Problem:** Currently there's one set of `interaction_surface_*` functions from `lambert.glsl`. Adding Disney/dielectric means either a giant if/else inside each function, or a better dispatch strategy.

**Option A: If/else in interaction functions (simple, slow at scale)**

```glsl
Spectrum interaction_surface_shade(Direction wi, Direction wo, Hit hit, MaterialProperties props) {
    if (props.model == 0) return lambert_shade(wi, wo, hit, props);
    if (props.model == 1) return disney_shade(wi, wo, hit, props);
    if (props.model == 2) return dielectric_shade(wi, wo, hit, props);
}
```

Requires adding a `model` field to `MaterialProperties`. Every bounce evaluates the dispatch even though it's statically known per material.

**Option B: Generated per-material interaction (specialized, compiler-driven)**

The compiler generates a wrapper that calls the right BRDF directly:

```glsl
// Generated — compiler knows material 0 is lambert, material 1 is disney
void shade_material(int id, Direction wi, Direction wo, Hit hit, MaterialProperties props,
                    out Spectrum result) {
    if (id == 0) { result = lambert_shade(wi, wo, hit, props); }
    else if (id == 1) { result = disney_shade(wi, wo, hit, props); }
}
```

The BRDF library files (`lambert.glsl`, `disney.glsl`) export named functions (`lambert_shade`, `disney_shade`) instead of the generic `interaction_surface_shade`. The compiler includes only the BRDF files that the scene actually uses.

The path trace template calls `shade_material(hit.material_to, ...)` instead of `interaction_surface_shade(...)`. This is essentially a vtable dispatch generated at compile time.

**Option C: Fully inlined per-material (most specialized)**

For scenes with few materials, generate separate path trace loops or fully inline the BRDF for each material. This is what production renderers do but is probably overkill for now.

**Recommendation:** Option B. It's the natural extension of the existing codegen pattern (we already generate per-material dispatch in `scene_material_properties`). The same pattern applied to BRDF functions.

## 5. Ambient Space as First-Class Concept

**Problem:** Currently `euclidean.glsl` provides `ambient_geodesic`, `ambient_frame`, `ambient_dot`, `ambient_parallel_transport` — but swapping in hyperbolic/spherical isn't just a file swap. The ambient space affects:

- How rays are marched (geodesic integration vs straight lines)
- Step size adaptation (curvature affects safe step distance)
- Normal estimation (finite differences in curved space)
- How `scene_intersect` works
- Whether SDFs need modification (distance fields in curved space aren't Euclidean distances)

**Implication:** `raymarch.glsl` can't remain a static library file — it needs to be either:
- Generated per ambient space, or
- Templated with `#ifdef` blocks for space-specific behavior, or
- Split into space-dependent and space-independent parts

The Planner already captures `ambientSpace` from the scene. The Generator would select/generate the appropriate raymarching implementation based on this.

**Design consideration:** The ambient space functions form a coherent "geometry backend" — they should be designed as a swappable module with a fixed interface. The rest of the rendering code (BRDF, light sampling, camera) should only interact with geometry through the `ambient_*` functions. This is already the case in the Euclidean implementation; the challenge is ensuring it holds for curved spaces.

## 6. Pipeline Flexibility

**Problem:** Different render strategies need different GPU resource configurations:

| Strategy | Buffers needed |
|----------|---------------|
| Basic pathtracer | 1 accumulation (double-buffered) |
| Deferred shading | G-buffer (albedo + normal + depth MRT) + accumulation |
| Variance-adaptive | Accumulation + variance texture + sample count |
| Bidirectional PT | Light path storage + accumulation |
| Multi-pass denoise | Accumulation + temporal history (3+ frames) |

The pipeline system already supports this via `framebuffers` array and MRT. The gap is in how the compiler decides what resources to create.

**Current flow:** `PipelineBuilder` hardcodes a fixed pipeline (accumulation double-buffer + screen).

**Proposed flow:** The Planner determines required resources based on strategy features:

```typescript
// In the plan phase:
interface ResourceRequirements {
    framebuffers: FramebufferRequirement[];
    // derived from strategy.accumulation, strategy.transport, etc.
}
```

The Generator/PipelineBuilder then mechanically creates the pipeline from requirements. This connects to the uniform unification — texture resources declared by the shader must match framebuffers created by the pipeline.

## 7. Error Reporting Wiring

**Problem:** The error system has all the pieces but nothing connects them. There are three disconnected layers:

1. **Compiler validation** — `Validator` uses `DiagnosticBag` to accumulate errors, then `throwIfErrors()` converts them to a plain `CompilationError`. The formatted output from `ConsoleReporter` is never shown.

2. **Shader compile errors** — When the Engine fails to compile GLSL, it throws a raw string like `"Shader compilation failed (pathtracer-main-main): ERROR: 0:142: 'foo' : undeclared identifier"`. The `ShaderErrorMapper` can map line 142 back to `glsl/raymarch.glsl:32`, and `ConsoleReporter` can format this beautifully — but nothing calls either.

3. **Runtime errors** — The typed error hierarchy (`RenderError`, `ResourceError`, `ParameterError`, etc.) exists in `src/errors/RenderErrors.ts` but is mostly unused by the Engine.

**Current state of each piece:**

| Piece | Status |
|-------|--------|
| `DiagnosticBag` + `DiagnosticBuilder` | Working — used by Validator |
| `ConsoleReporter` | Built, never called |
| `JSONReporter` | Built, never called |
| `ShaderErrorMapper.mapShaderErrors()` | Built, never called |
| `ShaderErrorMapper.mapEngineShaderError()` | Built, never called |
| `CompiledRenderer.sourceMaps` | Populated by Generator, never consumed |
| Error codes (`codes.ts`) | Defined, mostly unused |

**Wiring needed:**

### A. Compiler → App (validation errors)

The Compiler's `throwIfErrors()` throws a `CompilationError` that wraps a `DiagnosticBag`. The app layer should catch this and format with `ConsoleReporter` instead of just logging `error.message`:

```typescript
try {
    const renderer = compiler.compile(scene, strategy);
} catch (e) {
    if (e instanceof CompilationError) {
        const reporter = new ConsoleReporter();
        reporter.formatBag(e.diagnostics);  // pretty-printed with source context
    }
}
```

This is a small app-layer change — no Compiler or Engine changes needed.

### B. Engine → App (shader compile errors)

The Engine throws raw strings for GLSL failures. The app layer needs to:
1. Catch the Engine error
2. Pass it through `mapEngineShaderError(error.message, renderer.sourceMaps)`
3. Format the resulting DiagnosticBag with ConsoleReporter

```typescript
try {
    engine.loadRenderer(renderer);
} catch (e) {
    if (renderer.sourceMaps) {
        const bag = mapEngineShaderError(e.message, renderer.sourceMaps);
        if (bag) {
            const reporter = new ConsoleReporter();
            reporter.formatBag(bag);  // "ERROR in glsl/raymarch.glsl:32 — 'foo' undeclared"
        }
    }
}
```

**Design question:** Should this live in the app, or should the Compiler provide a helper that wraps Engine loading with error mapping? Something like:

```typescript
// Hypothetical — compiler knows about its own source maps
compiler.loadWithDiagnostics(engine, renderer);
```

This keeps the app layer simple but couples the Compiler to the Engine interface, which breaks the current layering. Probably better as a standalone utility function that takes `(error, sourceMaps, reporter)`.

### C. ConsoleReporter improvements for GLSL context

The current `ConsoleReporter.formatSourceSnippet()` can show source lines with error pointers. For shader errors, we'd want to show the relevant GLSL source block. This requires the assembled shader source to be available alongside the source map.

`CompiledRenderer` could optionally carry the assembled source for debugging:

```typescript
interface CompiledRenderer {
    // ... existing fields ...
    sourceMaps?: Map<string, SourceMap>;
    assembledSources?: Map<string, string>;  // for error display only
}
```

Or the error mapper could accept the assembled source and embed relevant lines in the diagnostic's `sourceText` field, which ConsoleReporter already renders.

### D. Structured Engine errors (future, Engine-side)

The Engine currently throws plain strings. If it threw typed errors with structured fields (`{ shaderId, infoLog, shaderType }`), the mapping would be cleaner. But the Engine is locked for now — the string-parsing approach in `mapEngineShaderError` is a reasonable bridge.

**Implementation order:**
1. App-layer catch + ConsoleReporter for validation errors (trivial)
2. App-layer catch + mapEngineShaderError + ConsoleReporter for shader errors (small)
3. Pass assembled source through for source context display (medium)
4. Structured Engine errors (future, requires Engine changes)

## Design Principles

1. **The compiler's internal model should be richer than its output.** The CompiledRenderer is a flat bundle of strings and specs. The compiler should understand structure, dependencies, and provenance internally, then flatten for output.

2. **Scene and strategy are independent axes.** Scene determines *what* to render (geometry, materials, lights). Strategy determines *how* (algorithms, quality, camera). The compiler should reflect this separation.

3. **Generated code should be traceable.** Every line of emitted GLSL should point back to its source — a library file, a codegen function, or a template. This is essential for debugging shader compile errors in complex scenes.

4. **Validate before emitting.** The current validator catches unsupported features. A richer IR enables structural validation: does every texture uniform have a pipeline source? Does every material reference a valid BRDF? Are all shader dependencies satisfied? Catch these at compile time, not as silent GPU failures.

5. **The Engine is blind.** The Engine executes CompiledRenderers without understanding their content. All intelligence lives in the compiler. This boundary is load-bearing — don't leak scene/strategy concepts into the Engine.
