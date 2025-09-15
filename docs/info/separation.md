# Algorithm-Infrastructure Separation Pattern

## Core Philosophy

The system separates **algorithmic research** from **WebGL infrastructure**:

- **Research components** (Film, Camera, Tracer) own the mathematical algorithms and shader logic
- **Engine services** provide the WebGL machinery (buffer management, shader compilation, framebuffer operations)
- Research happens by writing new algorithms, not by fighting with infrastructure

## The Pattern

### Research Component Responsibilities
1. **Define the algorithm** as GLSL functions
2. **Declare resource needs** (buffers, textures, uniforms)
3. **Implement the mathematical logic**
4. **Set algorithm-specific parameters**

### Engine Service Responsibilities
1. **Manage WebGL resources** (textures, framebuffers, programs)
2. **Provide boilerplate** (vertex shaders, fullscreen quads, ping-pong buffers)
3. **Handle binding and state** (texture units, framebuffers, uniforms)
4. **Execute the algorithm** using the research component's code

## Concrete Example: Film Accumulation

### Research Layer: Film Defines Algorithm

```typescript
// photography/film/VarianceAdaptiveFilm.ts
export class VarianceAdaptiveFilm implements Film {
  private varianceThreshold = 0.01;
  
  // Film provides the accumulation algorithm
  getAccumulationShader(): string {
    return `
      uniform sampler2D u_previousBeauty;
      uniform sampler2D u_currentBeauty;
      uniform sampler2D u_previousVariance;
      uniform sampler2D u_currentVariance;
      uniform float u_frameCount;
      
      // The actual research algorithm
      vec4 accumulate(vec2 uv) {
        vec4 previous = texture(u_previousBeauty, uv);
        vec4 current = texture(u_currentBeauty, uv);
        
        // Compute variance-based weight
        float prevVar = texture(u_previousVariance, uv).r;
        float currVar = texture(u_currentVariance, uv).r;
        float variance = mix(currVar, prevVar, 0.9);
        
        // Adaptive weighting based on variance
        float confidence = 1.0 / (1.0 + variance * 100.0);
        float weight = mix(0.05, 0.95, confidence);
        
        return mix(current, previous, weight);
      }
      
      // Also compute variance update
      float updateVariance(vec2 uv) {
        // Welford's online variance algorithm
        vec4 current = texture(u_currentBeauty, uv);
        vec4 mean = texture(u_previousBeauty, uv);
        float n = u_frameCount;
        
        vec4 delta = current - mean;
        float variance = dot(delta, delta) / n;
        return variance;
      }
    `;
  }
  
  // Declare what buffers this film needs
  getRequiredBuffers(): BufferSpec[] {
    return [
      { name: 'beauty', format: 'rgba16f' },
      { name: 'variance', format: 'r32f' },
      { name: 'albedo', format: 'rgba16f' }  // For denoising
    ];
  }
  
  // Film decides when to stop
  shouldContinue(stats: AccumulationStats): boolean {
    return stats.averageVariance > this.varianceThreshold 
           && stats.frameCount < 1000;
  }
}
```

### Engine Layer: Service Provides Infrastructure

```typescript
// engine/services/accumulation/AccumulationService.ts
export class AccumulationService {
  private bufferSets: Map<string, PingPongBuffer> = new Map();
  private accumProgram: WebGLProgram;
  private quadVAO: WebGLVertexArrayObject;
  
  // Set up infrastructure for a specific film
  initialize(film: Film, gl: WebGL2RenderingContext) {
    // Allocate buffers based on film's requirements
    const specs = film.getRequiredBuffers();
    specs.forEach(spec => {
      const pingPong = new PingPongBuffer(gl, spec);
      this.bufferSets.set(spec.name, pingPong);
    });
    
    // Compile film's shader with engine boilerplate
    const filmCode = film.getAccumulationShader();
    this.accumProgram = this.compileAccumulationProgram(gl, filmCode);
    
    // Create fullscreen quad (engine infrastructure)
    this.quadVAO = this.createFullscreenQuad(gl);
  }
  
  // Execute accumulation using film's algorithm
  accumulate(film: Film, newFrameData: FrameData) {
    const gl = this.gl;
    
    // Use the compiled program
    gl.useProgram(this.accumProgram);
    
    // Bind all the buffers (engine handles the mechanics)
    let textureUnit = 0;
    this.bufferSets.forEach((buffer, name) => {
      gl.activeTexture(gl.TEXTURE0 + textureUnit);
      gl.bindTexture(gl.TEXTURE_2D, buffer.read);
      gl.uniform1i(gl.getUniformLocation(this.accumProgram, `u_previous${name}`), textureUnit++);
      
      gl.activeTexture(gl.TEXTURE0 + textureUnit);
      gl.bindTexture(gl.TEXTURE_2D, newFrameData.get(name));
      gl.uniform1i(gl.getUniformLocation(this.accumProgram, `u_current${name}`), textureUnit++);
    });
    
    // Set frame count
    gl.uniform1f(gl.getUniformLocation(this.accumProgram, 'u_frameCount'), this.frameCount);
    
    // Render to accumulation buffer (engine handles framebuffer)
    this.bufferSets.get('beauty').bindWrite(gl);
    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    
    // Swap buffers for next frame
    this.bufferSets.forEach(buffer => buffer.swap());
    this.frameCount++;
  }
  
  private compileAccumulationProgram(gl: WebGL2RenderingContext, filmCode: string): WebGLProgram {
    // Engine provides the boilerplate
    const vertexShader = `#version 300 es
      const vec2 positions[3] = vec2[](
        vec2(-1, -1),
        vec2(3, -1),
        vec2(-1, 3)
      );
      out vec2 v_uv;
      void main() {
        vec2 pos = positions[gl_VertexID];
        v_uv = pos * 0.5 + 0.5;
        gl_Position = vec4(pos, 0, 1);
      }
    `;
    
    const fragmentShader = `#version 300 es
      precision highp float;
      in vec2 v_uv;
      out vec4 fragColor;
      
      ${filmCode}  // Insert film's algorithm
      
      void main() {
        fragColor = accumulate(v_uv);
      }
    `;
    
    return compileShader(gl, vertexShader, fragmentShader);
  }
}
```

## Extension to Other Components

### Camera: Ray Generation

```typescript
// photography/camera/ThinLensCamera.ts
export class ThinLensCamera implements Camera {
  getRayGenerationShader(): string {
    return `
      uniform float u_focalLength;
      uniform float u_aperture;
      
      Ray generateRay(vec2 pixel, vec2 lensSample) {
        // Camera owns the projection math
        vec2 ndc = (pixel / u_resolution) * 2.0 - 1.0;
        vec3 rayDir = normalize(vec3(ndc * tan(u_fov), -1));
        
        // Depth of field (research algorithm)
        vec3 focalPoint = rayDir * u_focalLength;
        vec2 lensPoint = lensSample * u_aperture;
        vec3 origin = vec3(lensPoint, 0);
        
        return Ray(origin, normalize(focalPoint - origin));
      }
    `;
  }
}

// engine/services/raygeneration/RayGenerationService.ts
export class RayGenerationService {
  // Provides the infrastructure to use camera's ray generation
  compileWithCamera(camera: Camera, restOfShader: string): WebGLProgram {
    const cameraCode = camera.getRayGenerationShader();
    return this.compile(cameraCode + restOfShader);
  }
}
```

### Tracer: Path Construction

```typescript
// photography/tracer/PathTracer.ts
export class PathTracer implements Tracer {
  getPathTracingShader(): string {
    return `
      uniform int u_maxBounces;
      uniform bool u_useNEE;
      
      vec3 tracePath(vec2 pixel) {
        Ray ray = generateRay(pixel, rand2());
        vec3 throughput = vec3(1);
        vec3 radiance = vec3(0);
        
        for (int bounce = 0; bounce < u_maxBounces; bounce++) {
          Intersection hit = sceneIntersect(ray);
          if (!hit.valid) {
            radiance += throughput * sampleEnvironment(ray.dir);
            break;
          }
          
          // Material sampling (research happens here)
          vec3 wo = -ray.dir;
          BSDFSample sample = sampleBSDF(hit, wo, rand2());
          
          // Next event estimation (algorithm choice)
          if (u_useNEE) {
            radiance += throughput * sampleDirectLight(hit, wo);
          }
          
          // Russian roulette (research choice)
          float p = max(throughput.r, max(throughput.g, throughput.b));
          if (rand() > p) break;
          throughput /= p;
          
          // Update path
          throughput *= sample.f * abs(dot(sample.wi, hit.normal)) / sample.pdf;
          ray = Ray(hit.pos, sample.wi);
        }
        
        return radiance;
      }
    `;
  }
}
```

## File Tree

```
src/
├── engine/
│   ├── services/
│   │   ├── accumulation/
│   │   │   ├── AccumulationService.ts      # Framebuffer management
│   │   │   ├── PingPongBuffer.ts          # Double buffering
│   │   │   └── BufferAllocator.ts         # Texture allocation
│   │   │
│   │   ├── raygeneration/
│   │   │   ├── RayGenerationService.ts    # Camera shader integration
│   │   │   └── ProjectionUtilities.ts     # Common projection helpers
│   │   │
│   │   ├── pathtracing/
│   │   │   ├── PathTracingService.ts      # Manages path tracing execution
│   │   │   ├── SampleBuffer.ts            # Random number delivery
│   │   │   └── BounceManager.ts           # Recursive bounce infrastructure
│   │   │
│   │   ├── shadercompilation/
│   │   │   ├── ShaderCompiler.ts          # GLSL compilation
│   │   │   ├── ShaderCache.ts             # Program caching
│   │   │   └── ShaderAssembler.ts         # Combines components
│   │   │
│   │   └── resources/
│   │       ├── TexturePool.ts             # Texture allocation/reuse
│   │       ├── UniformBinder.ts           # Uniform management
│   │       └── VAOManager.ts              # Vertex array objects
│   │
│   └── core/
│       ├── EngineContext.ts               # Global engine state
│       └── ServiceRegistry.ts             # Service locator
│
├── photography/
│   ├── film/
│   │   ├── Film.ts                        # Interface
│   │   ├── SimpleAverageFilm.ts          # Basic accumulation
│   │   ├── VarianceAdaptiveFilm.ts       # Variance-based
│   │   ├── TemporalReprojectionFilm.ts   # Motion vectors
│   │   └── ReservoirFilm.ts              # ReSTIR accumulation
│   │
│   ├── camera/
│   │   ├── Camera.ts                      # Interface
│   │   ├── PinholeCamera.ts              # Simple projection
│   │   ├── ThinLensCamera.ts             # DOF
│   │   ├── RealisticLensCamera.ts        # Lens systems
│   │   └── EquirectangularCamera.ts      # 360 capture
│   │
│   ├── tracer/
│   │   ├── Tracer.ts                      # Interface
│   │   ├── DirectTracer.ts               # Direct lighting only
│   │   ├── PathTracer.ts                 # Unidirectional
│   │   ├── BidirectionalTracer.ts        # BDPT
│   │   └── PhotonMapper.ts               # Two-pass
│   │
│   └── sampler/
│       ├── Sampler.ts                     # Interface
│       ├── RandomSampler.ts              # Pure random
│       ├── HaltonSampler.ts              # Low-discrepancy
│       └── BlueNoiseSampler.ts           # Blue noise
│
└── world/
    ├── geometry/
    │   ├── Geometry.ts                    # Interface
    │   ├── EuclideanGeometry.ts          # Provides geodesic()
    │   ├── HyperbolicGeometry.ts         # H³ geodesics
    │   └── SchwarzschildGeometry.ts      # GR geodesics
    │
    └── materials/
        ├── Material.ts                    # Interface
        ├── LambertianMaterial.ts          # Provides evalBSDF()
        ├── MicrofacetMaterial.ts          # GGX/Beckmann
        └── LayeredMaterial.ts             # Substrate+coating
```

## Key Benefits

1. **Research Focus**: You write algorithms, not WebGL boilerplate
2. **Clean Testing**: Test algorithms independently from infrastructure
3. **Easy Experimentation**: Swap accumulation strategies by changing Film
4. **Reusable Infrastructure**: Write buffer management once, use everywhere
5. **Clear Boundaries**: Research code never touches `gl.bindFramebuffer()`

This pattern scales to all components: 
Geometry provides geodesic equations, Material provides BSDF evaluation,
Camera provides projection—each as GLSL functions that the engine infrastructure
executes.





# UPDATE TO FILE TREE


```
engine/
  core/
    RenderEngine.ts            # Orchestrates pipelines, frame loop, hot-swap
    EngineContext.ts           # GL, caps, resolution, time, logger
    CapabilityQuery.ts         # Probes extensions, formats, MRT support
    Stats.ts                   # Timing (timer queries), memory, counters
    Errors.ts                  # ContractError, CompileError, RuntimeError

  assemble/
    ModuleDescriptor.ts        # MID schema: provides/requires, resources, entrypoints
    DependencyResolver.ts      # Verifies all requires→provides links
    SymbolPrefixer.ts          # Safe renaming/prefixing of symbols per module
    ShaderAssembler.ts         # Emits single minimal shader from selected modules
    FeatureHash.ts             # Stable cache key from IDs, constants, formats, res

  pipeline/
    Pipeline.ts                # Immutable description: modules, passes, resources
    PipelineManager.ts         # Prebuild, activate, swap, LRU of inactive pipelines
    Pass.ts                    # Generic pass interface (inputs/outputs, execute)
    PassRegistry.ts            # Built-in pass types: FullscreenDrawPass, BlitPass
    ResizePolicy.ts            # Rules when resolution changes

  runtime/
    ShaderCompiler.ts          # Compile/link; capture logs
    ProgramCache.ts            # Hash→program; reflection cache
    Reflection.ts              # Uniform/texture locations, block layouts
    UniformBinder.ts           # Applies parameter snapshots to the current program
    FullscreenTriangle.ts      # Minimal VAO/IBO helper (or use a VAOManager)

  resources/
    TexturePool.ts             # Alloc/reuse textures (rgba16f, r32f, etc.)
    FramebufferPool.ts         # FBO allocation & reuse, completeness checks
    PingPong.ts                # Double-buffer helper
    BufferPool.ts              # SSBO substitute via textures (if needed in GL2)
    Formats.ts                 # Map logical → GL enums; queried by CapabilityQuery

  params/
    ParameterStore.ts          # Registration, namespaces, descriptors
    Snapshot.ts                # Immutable per-frame parameter snapshot
    BindingMap.ts              # Param→uniform routes (with engine prefixes)

  sampling/
    SampleLayout.ts            # Global (pixel, frame, domain, dimension) indexing
    SamplerGlue.ts             # Bridges the sampler module to the engine layout

  diagnostics/
    Log.ts                     # Structured logs with compile/build phases
    StatsCollector.ts          # Aggregates frame/compile stats
    ShaderDump.ts              # Persist assembled GLSL for inspection
```

## In Depth Descriptions

### engine/core

**RenderEngine.ts**
Owns the frame loop and active pipeline. It coordinates prebuild/activate/swap of `Pipeline`s, applies per-frame `Snapshot`s of parameters, sequences pass execution, and accumulates timing/memory stats. It never “knows” about algorithms (path tracing, BDPT, etc.); it only runs the ordered list of `Pass` objects defined by the active pipeline. Responsible for safe hot-swaps, resize propagation, and error surfacing to diagnostics.

**EngineContext.ts**
Container for shared, immutable engine state passed into lifecycle hooks: WebGL2 context, capability flags, current resolution, time/frame counters, logger/diagnostics sinks, and pools/managers (by reference). Provides narrow getters; prevents components from mutating global engine state directly. Acts as a stable “service locator” without algorithm semantics.

**CapabilityQuery.ts**
Probes the GL context and extensions at startup and caches a normalized capability set (float color attachments, MRT count, texture formats, timer queries, etc.). Central source of truth for “can we allocate/use X?” decisions. All resource creation and assembler options consult this module to avoid runtime surprises.

**Stats.ts**
Defines lightweight counters and timing utilities (optionally backed by timer queries) for compile times, frame times, passes executed, program switches, and memory footprints. Provides a low-overhead API for the engine to record metrics per frame and aggregate rolling statistics for the diagnostics panel.

**Errors.ts**
Defines structured error types (`ContractError`, `CompileError`, `RuntimeError`, `ResourceError`) with enough context (phase, module ID, pipeline ID) to debug build or runtime failures. Centralizes formatting and severity tagging so diagnostics and logs present actionable messages without leaking low-level GL gibberish.

---

### engine/assemble

**ModuleDescriptor.ts**
Declares the Module Interface Descriptor (MID) schema consumed by the assembler: module identity/version, provided entrypoints, required symbols, declared uniforms/constants/resources, and raw GLSL fragments. This is the “ABI” between research modules and the engine—pure data, no GL calls—enabling dependency checks, symbol prefixing, and deterministic builds.

**DependencyResolver.ts**
Builds and validates the dependency graph across selected modules by matching `requires` to `provides`. Detects missing providers, ambiguous providers, and cyclic dependencies before compilation. Produces a topologically sorted list of modules and a resolved symbol map that downstream steps (prefixing, assembly) can trust.

**SymbolPrefixer.ts**
Performs hygienic symbol renaming to eliminate cross-module name collisions. Given a symbol table and module short IDs, it rewrites function/struct/uniform identifiers to engine-scoped names (`g_modSym_*`) and updates all call sites in the fragments. Guarantees that independent modules can reuse intuitive local names without coordination.

**ShaderAssembler.ts**
Creates the one and only minimal shader for the pipeline. Concatenates prefixed fragments in dependency order, injects glue code to wire declared entrypoints (e.g., `generateRay → tracePixel → accumulate → toneMap`), and emits a complete vertex/fragment pair. No `#ifdef` feature branching; the output contains only what the active modules require.

**FeatureHash.ts**
Computes a stable cache key from the ordered module IDs/versions, resolved constants, resource formats, precision settings, and a coarse resolution bin. Any change that requires a different linked program must alter this hash. Used uniformly by `ProgramCache` and `PipelineManager` to avoid accidental cache misses or collisions.

---

### engine/pipeline

**Pipeline.ts**
An immutable, data-only description of a runnable configuration: which modules are active, which shader (by `FeatureHash`) it uses, the ordered list of `Pass` descriptors (inputs/outputs), and declared persistent scratch resources. Pipelines carry no GL objects themselves, enabling prebuild, activation, and LRU management without side effects.

**PipelineManager.ts**
Creates, prebuilds, activates, and evicts pipelines. Owns the mapping from `Pipeline` to realized GPU state (linked program handle, allocated resources, reflection/binding maps). Supports atomic `swap(activeId)` with VRAM-aware residency (LRU of inactive pipelines) and handles rebuilds on hash or resolution changes.

**Pass.ts**
Abstract, algorithm-agnostic pass descriptor and runner. A pass declares named inputs/outputs (textures/buffers), a target (FBO or default), viewport, and a callable that binds the assembled program entrypoint(s) and issues a fullscreen draw. There is no notion of “path tracing” here—just “execute this draw reading A, writing B.”

**PassRegistry.ts**
Catalog of built-in pass types and helpers (FullscreenDrawPass, BlitPass, ClearPass). Each pass implementation knows how to validate its IO contracts, acquire attachments from pools, and emit minimal draw calls. Keeps pass implementations consistent and testable across pipelines.

**ResizePolicy.ts**
Encodes when and how resources are reallocated on size changes (e.g., round up to tiles, preserve ping-pong history where legal, invalidate tracer scratch when dependency flags demand). Centralizes resolution transition rules so `PipelineManager` and pools behave consistently.

---

### engine/runtime

**ShaderCompiler.ts**
Compiles and links GLSL sources; captures and normalizes compiler/linker logs. Handles platform quirks (precision qualifiers, extension pragmas) based on `CapabilityQuery`. Returns a linked program plus a structured diagnostic record for `ProgramCache` and `ShaderDump`.

**ProgramCache.ts**
Caches linked programs by `FeatureHash`. On miss, invokes `ShaderCompiler`, stores reflection, and returns an opaque handle. Responsible for lifetime management (delete on eviction) and guards against using programs after context loss or resize invalidations.

**Reflection.ts**
Parses program interfaces (uniforms, samplers, blocks, locations) into a stable map keyed by engine-prefixed names. Provides lookup APIs for `UniformBinder` and pass runners, insulating the rest of the engine from raw GL queries and location churn.

**UniformBinder.ts**
Applies a `Snapshot` of parameters to the current program using `Reflection`. Resolves hierarchical parameter names to engine-prefixed uniform locations, batches updates, and avoids redundant sets across passes. The single place where CPU-side parameter values become GPU uniforms.

**FullscreenTriangle.ts**
Tiny utility that encapsulates the canonical fullscreen draw setup (single VAO with a 3-vertex triangle). Ensures consistent, minimal state changes across all passes and avoids duplicating VAO management logic throughout the engine.

---

### engine/resources

**TexturePool.ts**
Allocator/recycler for textures keyed by (size, format, usage). Consults `CapabilityQuery` and `Formats` before creation, supports aliasing where legal, and returns handles that embed ownership/lifetime. Eliminates duplicate allocations across passes and pipelines.

**FramebufferPool.ts**
Manages framebuffer objects and their attachments. Given a set of color/depth targets, returns a complete FBO with cached attachments. Validates completeness, tracks reuse, and cleans up on resize or eviction, ensuring passes always render into valid targets.

**PingPong.ts**
Double-buffer helper that pairs two TexturePool allocations and exposes read/write handles with a `swap()` operation. Designed for film accumulation and other recurrent passes while keeping ownership and lifetime with the engine.

**BufferPool.ts**
Optional pool for buffer-like resources emulated via textures in WebGL2 (e.g., SSBO-style data using `RGBA32F` textures). Abstracts allocation, resizing, and access patterns for modules that declare persistent non-image data.

**Formats.ts**
Central mapping of logical formats (e.g., “beauty: rgba16f”, “variance: r32f”) to actual GL enums and filtering/wrap policies. Factors in `CapabilityQuery` to choose fallbacks or forbid illegal combinations, keeping format decisions out of passes and modules.

---

### engine/params

**ParameterStore.ts**
Holds the registered parameter tree with descriptors (type, range, units, cadence, binding target). Supports transactions and change tracking without touching GL. Provides namespaced lookup (`camera.fov`, `tracer.maxBounces`) and emits immutable snapshots for rendering.

**Snapshot.ts**
Immutable, per-frame view of all parameters used by the engine. Created at the start of a frame, consumed by `UniformBinder`, guaranteeing no mid-frame mutations. Supports diffing for diagnostics and caching to minimize uniform updates.

**BindingMap.ts**
Resolves parameter descriptors to concrete uniform names in the assembled program (with engine prefixes). Encodes derived bindings (e.g., `fov` → `tanHalfFov`) and per-cadence update policies so `UniformBinder` can apply updates efficiently and correctly.

---

### engine/sampling

**SampleLayout.ts**
Defines deterministic indexing of random samples by `(pixel, frame, domain, dimension)` and manages domain registration (`lens`, `time`, `bsdf_dir`, `nee_pick`, etc.). Prevents collisions and enforces consistent allocation of sample dimensions per tracer’s declared needs.

**SamplerGlue.ts**
Bridges the selected sampler module to the engine’s layout. Seeds streams per pixel/frame, hands out named 1D/2D samples on demand, and ensures determinism regardless of the sampler strategy (pure RNG, Sobol/Halton with scrambling, blue-noise). Contains no RNG math itself—that lives in the sampler module.

---

### engine/diagnostics

**Log.ts**
Structured logging utility with phases (assemble, compile, runtime), severities, and pipeline/module context. Feeds both console output and any on-screen diagnostics extensions without leaking internal exceptions or raw GL errors.

**StatsCollector.ts**
Aggregates `Stats` across frames and builds time-windowed summaries for UI display (samples/sec, program switches, compile times, VRAM usage estimates). Provides hooks for extensions to subscribe to updates without coupling to engine internals.

**ShaderDump.ts**
Persists assembled shader sources, symbol maps, and dependency graphs to a developer-accessible location (memory or file). Enables side-by-side inspection during research and CI snapshots for reproducibility/regression checks.

---

If you want, I can next turn these into ready-to-paste header blocks for each file (Purpose, Inputs, Outputs, Lifecycle, Invariants) so your stubs start with crystal-clear ownership.
