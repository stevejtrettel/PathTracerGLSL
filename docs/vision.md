# Research Path Tracer: Design Document

## Executive Summary

This document describes a GPU-accelerated path tracer architecture designed for long-term research in non-Euclidean geometries and advanced rendering algorithms. The system separates the mathematical "World" (geometry, objects, materials) from the "Photography" process (how we observe that world), enabling independent experimentation with both geometric spaces and rendering techniques. The architecture prioritizes mathematical clarity, research flexibility, and a "write-once" engine that remains stable as algorithms and geometries evolve.

## Core Architecture: The Four Pillars

### 1. World (Mathematical Reality)
The **World** represents the mathematical space and its contents:
- **Geometry**: The manifold structure (Euclidean, hyperbolic, Schwarzschild, etc.)
- **Scene**: Objects embedded in that space (SDFs, meshes, implicit surfaces)
- **Materials**: Surface scattering properties (BSDFs)
- **Lights**: Energy sources
- **Media**: Optional participating media

### 2. Photography (Observation Process)
The **Photography** stack captures how we observe the world:
- **Camera**: Maps image pixels to rays in the world
- **Sampler**: Provides controlled randomness for Monte Carlo
- **Tracer**: Constructs light transport paths
- **Film**: Accumulates and reconstructs the image
- **Developer**: Processes output (tonemapping, color management)

### 3. Engine (Infrastructure)
The **Engine** provides invisible orchestration:
- **Shader Compilation**: Assembles GLSL from components
- **Parameter Management**: Handles user-facing values
- **Uniform Binding**: Syncs parameters to GPU
- **Resource Management**: Textures, buffers, framebuffers
- **Render Pipeline**: Coordinates the actual rendering

### 4. Extensions (Optional Enhancements)
**Extensions** add functionality without affecting core rendering:
- **Controls**: Camera movement, object manipulation
- **UI**: Parameter editing panels
- **Analytics**: Performance monitoring, convergence analysis
- **Debug**: Visualization overlays, path inspection
- **Scripting**: Animation, batch rendering

### 5. Blueprints (Prebuilt Configurations)
**Blueprints** provide ready-to-use configurations:
- **Worlds**: CornellBox, HyperbolicRoom, SchwarzschildLab
- **Photographers**: PathTracer, DirectCapture, Researcher
- **Studios**: Complete world+photography setups

## Plug-and-Play Architecture

### Component Independence
Any **World** can be rendered with any **Photography** setup:

```typescript
// Mix and match freely
const world1 = new World({ geometry: new HyperbolicGeometry(), ... });
const world2 = new World({ geometry: new EuclideanGeometry(), ... });

const photo1 = new Photography({ tracer: new PathTracer(), ... });
const photo2 = new Photography({ tracer: new BidirectionalTracer(), ... });

// All combinations work
engine.render(world1, photo1);  // Hyperbolic path tracing
engine.render(world1, photo2);  // Hyperbolic BDPT
engine.render(world2, photo1);  // Euclidean path tracing
engine.render(world2, photo2);  // Euclidean BDPT
```

### Internal Flexibility
Components themselves are composable:

```typescript
// Build different photographers by swapping parts
const photographer1 = new Photography({
  camera: new PinholeCamera(),
  tracer: new PathTracer(),
  sampler: new HaltonSampler(),
  film: new SimpleFilm(),
  developer: new LinearDeveloper()
});

const photographer2 = new Photography({
  camera: new StereoscopicCamera(),  // VR rendering
  tracer: new PhotonMapper(),        // Different algorithm
  sampler: new BlueNoiseSampler(),   // Better distribution
  film: new AdaptiveFilm(),          // Variance tracking
  developer: new FilmicDeveloper()   // Cinematic look
});
```

### Advanced Use Cases

**VR/Stereo Rendering**:
```typescript
class StereoscopicCamera implements Camera {
  getShaderCode(): ShaderFragment {
    return {
      functions: `
        Ray generateCameraRay(vec2 pixel) {
          float eye = pixel.x < u_resolution.x * 0.5 ? -1.0 : 1.0;
          vec3 origin = vec3(eye * u_ipd * 0.5, 0, 0);
          // Generate ray for appropriate eye
        }
      `
    };
  }
}
```

**Stateful Algorithms** (Bidirectional Path Tracing):
```typescript
class BidirectionalTracer implements Tracer {
  private lightPaths: PathBuffer;
  private eyePaths: PathBuffer;
  
  getShaderCode(): ShaderFragment {
    // Returns shader that traces from both ends
  }
  
  // Can maintain internal state between frames
  updatePaths() { ... }
}
```

## The Engine's Role

### Core Responsibilities

The **Engine** is the stable orchestrator that:

1. **Compiles Shaders**: Assembles GLSL from component fragments
2. **Manages State**: Tracks active world, photography, extensions
3. **Binds Resources**: Syncs parameters to uniforms, textures to units
4. **Executes Renders**: Runs the GPU pipeline
5. **Handles Swapping**: Cleanly switches between configurations

```typescript
class RenderEngine {
  private shaderCache = new Map<string, WebGLProgram>();
  private parameterManager = new ParameterManager();
  private uniformManager = new UniformManager();
  private currentPipeline?: RenderPipeline;
  
  // Main entry point
  render(world: World, photography: Photography): Image {
    // 1. Generate shader cache key from component IDs
    const key = this.getShaderKey(world, photography);
    
    // 2. Get or compile shader
    const shader = this.shaderCache.get(key) || 
                  this.compileShader(world, photography);
    
    // 3. Create pipeline if needed
    if (this.needsNewPipeline(shader)) {
      this.currentPipeline = new RenderPipeline(shader);
    }
    
    // 4. Sync parameters to uniforms
    this.syncParameters(world, photography);
    
    // 5. Execute render
    return this.currentPipeline.render();
  }
}
```

### Parameter and Uniform Management

**Parameters** (user-facing values) flow to **Uniforms** (GPU values):

```typescript
class ParameterManager {
  private parameters = new Map<string, Parameter<any>>();
  private bindings = new Map<string, UniformBinding[]>();
  
  // Register component parameters
  register(component: Parameterized, namespace: string) {
    component.getParameters().forEach(param => {
      const key = `${namespace}.${param.name}`;
      this.parameters.set(key, param);
      
      // Set up uniform bindings
      if (param.metadata.uniform) {
        param.onChange(value => {
          this.markDirty(param.metadata.uniform!);
        });
      }
    });
  }
  
  // Apply to GPU
  sync(uniformManager: UniformManager) {
    this.parameters.forEach(param => {
      if (param.metadata.uniform) {
        uniformManager.set(param.metadata.uniform, param.value);
      }
    });
  }
}
```

### Hot-Swapping Scenarios

**Switching Cameras**:
```typescript
// Two cameras ready to swap
const camera1 = new PinholeCamera();
const camera2 = new FisheyeCamera();

// Swap by creating new photography
photography.camera = camera2;
engine.render(world, photography);  // Automatically recompiles if needed
```

**Switching Photographers**:
```typescript
// Keep world, swap entire photography stack
const photo1 = Blueprints.Photographers.PathTracer();
const photo2 = Blueprints.Photographers.DirectCapture();

// Real-time preview, then high-quality
engine.render(world, photo2);  // Fast preview
engine.render(world, photo1);  // Quality render
```

**A/B Testing**:
```typescript
// Render same world with different techniques
const results = [photo1, photo2, photo3].map(photo => ({
  image: engine.render(world, photo),
  stats: engine.getStats()
}));
```

## TypeScript Implementation Details

### Interfaces and Traits

**Core Pattern**: Interfaces define contracts, traits define shared behaviors.

```typescript
// Traits for cross-cutting concerns
interface ShaderProvider {
  getShaderCode(): ShaderFragment;
}

interface Parameterized {
  getParameters(): Parameter[];
}

// Core interfaces compose traits
interface Geometry extends ShaderProvider, Parameterized { }
interface Camera extends ShaderProvider, Parameterized { }
interface Material extends ShaderProvider, Parameterized { }

// Containers are plain interfaces
interface World {
  geometry: Geometry;
  scene: Scene;
  materials: Map<string, Material>;
  lights: Light[];
}
```

### Main Contracts

**ShaderFragment Contract**:
```typescript
interface ShaderFragment {
  defines?: string;      // #define FEATURE_X
  uniforms?: string;     // uniform declarations
  functions: string;     // GLSL functions
  mainCode?: string;     // Code for main()
}
```

**Parameter Contract**:
```typescript
interface Parameter<T> {
  name: string;
  value: T;
  onChange(callback: (value: T) => void): void;
  metadata: {
    uniform?: string;      // GPU uniform name
    min?: number;         // UI constraints
    max?: number;
    category?: string;    // UI grouping
  };
}
```

**Extension Contract**:
```typescript
interface Extension {
  readonly id: string;
  readonly type: string;
  attach(pipeline: RenderPipeline): void;
  detach(): void;
  update?(deltaTime: number): void;
}
```

### Type Safety Benefits

```typescript
// Compile-time safety
const world: World = {
  geometry: new Camera(),  // ❌ TypeScript ERROR
  scene: new SDFScene(),   // ✓
};

// Generic functions via traits
function collectShaders(providers: ShaderProvider[]): ShaderFragment[] {
  return providers.map(p => p.getShaderCode());
}

// Works with any ShaderProvider
collectShaders([geometry, camera, material]);  // ✓ Type-safe
```

## File Structure

```
research-pathtracer/
├── src/
│   ├── core/
│   │   ├── types.ts              # Core interfaces and traits
│   │   ├── parameter.ts          # Parameter system
│   │   ├── shader-fragment.ts    # Shader types
│   │   └── math/
│   │       ├── vec3.ts
│   │       ├── mat4.ts
│   │       └── utils.ts
│   │
│   ├── engine/
│   │   ├── render-engine.ts      # Main orchestrator
│   │   ├── shader-compiler.ts    # GLSL assembly
│   │   ├── parameter-manager.ts  # Parameter tracking
│   │   ├── uniform-manager.ts    # GPU uniform binding
│   │   ├── resource-manager.ts   # Texture/buffer management
│   │   ├── render-pipeline.ts    # Execution pipeline
│   │   └── shader-cache.ts       # Compiled program cache
│   │
│   ├── world/
│   │   ├── geometry/
│   │   │   ├── geometry.ts       # Geometry interface
│   │   │   ├── euclidean.ts
│   │   │   ├── hyperbolic.ts
│   │   │   ├── spherical.ts
│   │   │   ├── schwarzschild.ts
│   │   │   └── shaders/
│   │   │       └── geodesics.glsl
│   │   │
│   │   ├── scene/
│   │   │   ├── scene.ts          # Scene interface
│   │   │   ├── sdf-scene.ts
│   │   │   ├── mesh-scene.ts
│   │   │   ├── implicit-scene.ts
│   │   │   └── primitives/
│   │   │       ├── sphere.ts
│   │   │       ├── box.ts
│   │   │       └── torus.ts
│   │   │
│   │   ├── materials/
│   │   │   ├── material.ts       # Material interface
│   │   │   ├── lambertian.ts
│   │   │   ├── specular.ts
│   │   │   ├── principled.ts
│   │   │   └── shaders/
│   │   │       └── bsdfs.glsl
│   │   │
│   │   └── lights/
│   │       ├── light.ts          # Light interface
│   │       ├── point-light.ts
│   │       ├── area-light.ts
│   │       └── environment.ts
│   │
│   ├── photography/
│   │   ├── camera/
│   │   │   ├── camera.ts         # Camera interface
│   │   │   ├── pinhole.ts
│   │   │   ├── thin-lens.ts
│   │   │   ├── stereoscopic.ts
│   │   │   └── shaders/
│   │   │       └── projections.glsl
│   │   │
│   │   ├── sampler/
│   │   │   ├── sampler.ts        # Sampler interface
│   │   │   ├── random.ts
│   │   │   ├── halton.ts
│   │   │   └── blue-noise.ts
│   │   │
│   │   ├── tracer/
│   │   │   ├── tracer.ts         # Tracer interface
│   │   │   ├── direct.ts
│   │   │   ├── path-tracer.ts
│   │   │   ├── bidirectional.ts
│   │   │   ├── photon-mapper.ts
│   │   │   └── shaders/
│   │   │       └── integrators.glsl
│   │   │
│   │   ├── film/
│   │   │   ├── film.ts           # Film interface
│   │   │   ├── simple-film.ts
│   │   │   ├── adaptive-film.ts
│   │   │   └── deep-film.ts
│   │   │
│   │   └── developer/
│   │       ├── developer.ts      # Developer interface
│   │       ├── linear.ts
│   │       ├── reinhard.ts
│   │       └── filmic.ts
│   │
│   ├── blueprints/
│   │   ├── worlds/
│   │   │   ├── cornell-box.ts
│   │   │   ├── hyperbolic-room.ts
│   │   │   └── schwarzschild-lab.ts
│   │   │
│   │   ├── photographers/
│   │   │   ├── path-tracer.ts
│   │   │   ├── direct-capture.ts
│   │   │   └── researcher.ts
│   │   │
│   │   └── studios/
│   │       ├── quick-preview.ts
│   │       ├── paper-figure.ts
│   │       └── interactive.ts
│   │
│   ├── extensions/
│   │   ├── extension.ts          # Extension interface
│   │   ├── controls/
│   │   │   ├── orbit-controls.ts
│   │   │   └── fly-controls.ts
│   │   │
│   │   ├── ui/
│   │   │   ├── parameter-ui.ts
│   │   │   └── stats-panel.ts
│   │   │
│   │   └── debug/
│   │       ├── path-visualizer.ts
│   │       └── shader-inspector.ts
│   │
│   ├── shaders/
│   │   ├── common/
│   │   │   ├── structs.glsl     # Shared data structures
│   │   │   ├── random.glsl      # RNG utilities
│   │   │   └── utils.glsl       # Common functions
│   │   │
│   │   └── templates/
│   │       ├── vertex.glsl      # Fullscreen quad
│   │       └── fragment.glsl    # Main template
│   │
│   └── index.ts                  # Main entry point
│
├── examples/
│   ├── basic-path-tracer.ts
│   ├── hyperbolic-explorer.ts
│   ├── schwarzschild-lensing.ts
│   └── comparison-suite.ts
│
├── tests/
│   ├── unit/
│   │   ├── geometry.test.ts
│   │   └── parameter.test.ts
│   │
│   └── integration/
│       ├── furnace-test.ts
│       └── convergence-test.ts
│
├── docs/
│   ├── architecture.md
│   ├── geometries.md
│   └── extending.md
│
├── assets/
│   ├── hdri/
│   ├── meshes/
│   └── textures/
│
├── package.json
├── tsconfig.json
├── webpack.config.js
└── README.md
```

## Implementation Strategy

### Phase 1: Minimal Viable Renderer (Week 1)

**Goal**: Render a sphere in Euclidean space with direct lighting.

1. **Core Types** (`src/core/types.ts`)
   ```typescript
   interface ShaderProvider { }
   interface Parameterized { }
   interface Geometry extends ShaderProvider, Parameterized { }
   // ... other core interfaces
   ```

2. **Basic Math** (`src/core/math/`)
    - Vec3, Mat4 utilities
    - No external dependencies

3. **Minimal Engine** (`src/engine/render-engine.ts`)
   ```typescript
   class RenderEngine {
     constructor(canvas: HTMLCanvasElement) {
       this.gl = canvas.getContext('webgl2');
     }
     
     render(world: World, photography: Photography): void {
       const shader = this.compileShader(world, photography);
       this.drawFullscreenQuad(shader);
     }
   }
   ```

4. **Euclidean Geometry** (`src/world/geometry/euclidean.ts`)
   ```typescript
   class EuclideanGeometry implements Geometry {
     getShaderCode(): ShaderFragment {
       return {
         functions: `
           vec3 geodesic(vec3 o, vec3 d, float t) {
             return o + d * t;
           }
         `
       };
     }
   }
   ```

5. **Simple SDF Scene** (`src/world/scene/sdf-scene.ts`)
    - Single sphere at origin

6. **Direct Tracer** (`src/photography/tracer/direct.ts`)
    - Primary rays only
    - Hard-coded lighting

7. **Test Render**
   ```typescript
   const world = { 
     geometry: new EuclideanGeometry(),
     scene: new SDFScene([new Sphere()])
   };
   const photography = {
     camera: new PinholeCamera(),
     tracer: new DirectTracer()
   };
   engine.render(world, photography);
   ```

### Phase 2: Add Path Tracing (Week 2)

1. **Random Sampler** implementation
2. **Path Tracer** with Russian roulette
3. **Simple Film** for accumulation
4. **Materials** (Lambertian)

### Phase 3: Parameter System (Week 3)

1. **Parameter/Uniform managers**
2. **Automatic UI generation**
3. **Hot-swapping support**

### Phase 4: Non-Euclidean (Week 4)

1. **Hyperbolic geometry**
2. **Geodesic integration in shaders**
3. **Metric-aware materials**

### Phase 5: Extensions (Week 5)

1. **Extension interface**
2. **Orbit controls**
3. **Stats panel**

## Critical Design Questions

### Architecture Questions

1. **Q: Should Film and Developer run on GPU or CPU?**
    - **A**: Film on CPU for flexibility (adaptive sampling, deep buffers). Developer on CPU for standard image processing libraries. Only move to GPU if performance demands.

2. **Q: How do we handle shader variants vs. uber-shader?**
    - **A**: Use shader variants with preprocessor defines. Cache by feature set hash. This avoids register pressure and branching overhead.

3. **Q: Should parameters be reactive (MobX-style) or explicit callbacks?**
    - **A**: Explicit callbacks are simpler and more predictable. Use `onChange` handlers.

4. **Q: How do we handle multi-pass algorithms (photon mapping, BDPT)?**
    - **A**: Tracers can maintain internal state between frames. The engine just calls `render()` repeatedly.

### Implementation Questions

5. **Q: TypeScript strict mode or not?**
    - **A**: Yes, use `strict: true`. Catches more bugs, especially around null/undefined.

6. **Q: WebGL2 only, or WebGL1 fallback?**
    - **A**: WebGL2 only. Need features like multiple render targets, 3D textures, integer attributes.

7. **Q: How do we handle asynchronous resource loading?**
    - **A**: Promise-based loading phase before rendering. Show loading UI via extension.

8. **Q: Do we support multiple canvases/viewports?**
    - **A**: Not initially. Can add later via multiple RenderEngine instances.

### Performance Questions

9. **Q: When do we invalidate shader cache?**
    - **A**: Never automatically. Only on explicit component change. Use stable IDs.

10. **Q: How do we handle memory limits?**
    - **A**: ResourceManager tracks GPU memory. Film can downsample if needed.

### Research Questions

11. **Q: How do we handle wavelength-dependent rendering?**
    - **A**: Start with RGB. Design interfaces to support spectral later (carry wavelength in paths).

12. **Q: Should we support differentiable rendering?**
    - **A**: Not initially, but keep parameters/uniforms separate to enable gradient tracking later.

### Major Decision Points

**🔴 Critical Decision: Geometry-Geodesic Relationship**
- **Option A**: Geometry provides geodesic functions directly
- **Option B**: Separate GeodesicIntegrator classes
- **Recommendation**: Option A for simplicity. Each geometry knows its own geodesics best.

**🔴 Critical Decision: Scene Acceleration**
- **Option A**: Scene handles its own acceleration
- **Option B**: Separate Intersector wrapper
- **Recommendation**: Option A. SDFs have implicit acceleration; meshes will add BVH internally.

**🔴 Critical Decision: Extension Architecture**
- **Option A**: Extensions as plugins with lifecycle
- **Option B**: Extensions as services with dependency injection
- **Recommendation**: Option A. Simpler, more predictable.

## Future Directions

### Near-Term (3-6 months)
1. **More Geometries**: Remaining Thurston geometries, FLRW cosmological models
2. **Advanced Materials**: Microfacet models, subsurface scattering
3. **Volume Rendering**: Participating media, atmospheric scattering
4. **Mesh Support**: BVH acceleration, instancing

### Medium-Term (6-12 months)
1. **Advanced Algorithms**: BDPT, MLT, VCM
2. **Spectral Rendering**: Wavelength-dependent transport
3. **WebGPU Port**: Compute shaders, better performance
4. **Animation System**: Keyframes, procedural animation

### Long-Term (1+ years)
1. **Differentiable Rendering**: Inverse problems
2. **Neural Rendering**: ML-guided sampling
3. **Distributed Rendering**: Multi-GPU, cloud rendering
4. **VR/AR Support**: Stereo rendering, reprojection

### Research Opportunities
1. **Novel Geometries**: Discrete geometries, graph embeddings
2. **Quantum Optics**: Photon statistics, entanglement
3. **Artistic Controls**: Non-photorealistic rendering in curved spaces
4. **Perceptual Metrics**: Geometry-aware image quality

## Additional Considerations

### Testing Strategy

**Unit Tests**: Each component in isolation
```typescript
describe('HyperbolicGeometry', () => {
  test('geodesics preserve metric', () => {
    // Verify mathematical properties
  });
});
```

**Integration Tests**: Component combinations
```typescript
test('Euclidean + PathTracer converges to ground truth', () => {
  // Furnace test, Cornell box validation
});
```

**Visual Tests**: Reference image comparison
```typescript
test('Hyperbolic room matches reference', () => {
  // Pixel-wise comparison with tolerance
});
```

### Documentation Strategy

1. **API Documentation**: TSDoc comments on all public interfaces
2. **Mathematical Notes**: Explain geodesic equations, BSDF formulations
3. **Examples**: Working code for each feature
4. **Tutorials**: "Build your first geometry", "Add a new BSDF"

### Performance Monitoring

```typescript
interface RenderStats {
  shaderCompileTime: number;
  frameTime: number;
  samplesPerSecond: number;
  memoryUsage: {
    textures: number;
    buffers: number;
  };
}
```

Built into engine, exposed via extension.

### Error Handling

```typescript
class RenderError extends Error {
  constructor(
    message: string,
    public component: string,
    public phase: 'compile' | 'render' | 'resource'
  ) {
    super(message);
  }
}
```

Clear errors pointing to specific components and phases.

## Conclusion

This architecture provides:
1. **Clear separation of concerns** via the World/Photography split
2. **Type safety** through TypeScript interfaces and traits
3. **Research flexibility** with plug-and-play components
4. **Long-term stability** with a simple, unchanging engine
5. **Mathematical correctness** with geometry-aware rendering

The key to success is keeping the engine boring and stable while pushing complexity 
into well-defined components. This lets you focus on mathematics and algorithms rather
than infrastructure.
