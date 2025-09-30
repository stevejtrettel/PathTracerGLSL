# Research Path Tracer: Architecture Design Document

## Executive Summary

This document describes the architecture for a research-grade path tracer designed to 
explore rendering algorithms across diverse geometries. The system prioritizes 
mathematical clarity, research flexibility, and long-term extensibility. 
It separates the mathematical "world" being rendered from the "photography"
process used to observe it, enabling independent experimentation with both 
geometric spaces and rendering algorithms.

## Core Philosophy

### Design Principles

1. **Mathematics-First**: Code should directly reflect mathematical concepts from differential geometry and rendering research papers
2. **Compositional**: Complex behaviors emerge from combining simple, well-defined components
3. **Research-Grade**: Prioritize flexibility and clarity over production performance
4. **Progressive Complexity**: Simple tasks should be simple; complex tasks should be possible
5. **Long-Term Vision**: Architecture should support 5+ years of graphics research

### Conceptual Foundation

The architecture is built on a fundamental separation between:

- **World**: The mathematical reality we're simulating (geometry, objects, materials)
- **Photography**: How we choose to observe that reality (camera, sampling, integration)

This mirrors the physical distinction between the scene being photographed and the photographic process itself.

## Architecture Overview

### Top-Level Structure

```
research-pathtracer/
├── src/
│   ├── world/                 # Mathematical reality
│   ├── photography/           # Observation process
│   ├── blueprints/           # Pre-built configurations
│   ├── extensions/           # Optional enhancements
│   └── engine/               # Infrastructure
├── examples/
├── tests/
└── docs/
```

### Component Hierarchy

```
Application
├── World [Required]
│   ├── Geometry              # Manifold structure
│   ├── Scene                 # Objects in space
│   ├── Materials             # Surface properties
│   ├── Lights                # Energy sources
│   └── Media                 # Participating media
│
├── Photography [Required]
│   ├── Camera                # View projection
│   ├── Sampler               # Random strategies
│   ├── Tracer                # Path construction
│   ├── Film                  # Accumulation
│   └── Developer             # Output processing
│
├── Blueprints [Convenience]
│   ├── Worlds                # Pre-configured scenes
│   ├── Photographers         # Rendering strategies
│   └── Studios               # Complete setups
│
├── Extensions [Optional]
│   ├── Controls              # Interactive navigation
│   ├── UI                    # Parameter editing
│   ├── Analytics             # Performance metrics
│   ├── Scripting             # Automation
│   └── Debug                 # Visualization tools
│
└── Engine [Infrastructure]
    ├── Parameters            # Uniform management
    ├── Compilation           # Shader generation
    ├── Memory                # Resource management
    └── Platform              # WebGL/WebGPU abstraction
```

## Component Specifications

### World Components

#### Geometry
**Purpose**: Defines the ambient mathematical space

**Interface**:
```typescript
interface Geometry {
  // Geodesic evolution
  geodesic(origin: Vec, direction: Vec, t: number): GeodesicState;
  
  // Parallel transport along paths
  parallel_transport(vector: Vec, along: Path): Vec;
  
  // Metric tensor at a point
  metric_tensor(point: Vec): Tensor;
  
  // Optional: Christoffel symbols for optimization
  christoffel_symbols?(point: Vec): ChristoffelSymbols;
  
  // Optional: Curvature for advanced algorithms
  riemann_curvature?(point: Vec): RiemannTensor;
}
```

**Implementations**:
- `EuclideanGeometry`: Standard flat space
- `HyperbolicGeometry`: Constant negative curvature
- `SphericalGeometry`: Constant positive curvature
- `ThurstonGeometries`: All eight 3D geometries
- `SchwarzschildGeometry`: Black hole spacetime
- `NumericalGeometry`: From metric tensor g_μν

#### Scene
**Purpose**: Defines objects embedded in the geometry

**Interface**:
```typescript
interface Scene {
  // Universal intersection method
  scene_intersect(ray: GeodesicRay): Intersection | null;
  
  // Material at intersection
  scene_material(intersection: Intersection): Material;
  
  // For participating media
  density?(point: Vec): number;
  
  // For emissive world
  emission?(point: Vec, direction: Vec): Spectrum;
  
  // Future: acceleration structure hints
  supports_acceleration?(): boolean;
}
```

**Implementations**:
- `SDFScene`: Signed distance functions with CSG
- `MeshScene`: Triangle meshes (future: with BVH)
- `ImplicitScene`: Isosurfaces with root finding
- `HybridScene`: Combines multiple representations
- `VolumetricScene`: Participating media

#### Materials
**Purpose**: Surface and volume scattering properties

**Interface**:
```typescript
interface Material {
  // BSDF evaluation
  f(wi: Vec, wo: Vec, intersection: Intersection): Spectrum;
  
  // Importance sampling
  sample_f(wi: Vec, intersection: Intersection, sample: Vec2): BSDFSample;
  
  // Probability density
  pdf(wi: Vec, wo: Vec, intersection: Intersection): number;
  
  // Optional: Emission
  Le?(wo: Vec, intersection: Intersection): Spectrum;
  
  // Optional: Subsurface scattering
  subsurface?(): SubsurfaceParams;
}
```

**Implementations**:
- `LambertianMaterial`: Diffuse reflection
- `SpecularMaterial`: Mirror/glass
- `MicrofacetMaterial`: Rough surfaces
- `PrincipledBSDF`: Disney/Pixar-style uber-shader
- `LayeredMaterial`: Coating over substrate

#### Lights
**Purpose**: Direct illumination sources

**Interface**:
```typescript
interface Light {
  // Sample a direction to the light
  sample(from: Vec, sample: Vec2): LightSample;
  
  // Evaluate radiance along ray
  Le(ray: Ray): Spectrum;
  
  // Probability density
  pdf(from: Vec, wi: Vec): number;
  
  // Optional: Associated geometry
  geometry_id?: PrimitiveID;
}
```

**Implementations**:
- `PointLight`: Omnidirectional point
- `DirectionalLight`: Infinite distance
- `AreaLight`: Emissive geometry
- `EnvironmentLight`: HDR environment map
- `IESLight`: Measured light profiles

### Photography Components

#### Camera
**Purpose**: Projects world onto image plane

**Interface**:
```typescript
interface Camera {
  // Generate ray for pixel sample
  generate_ray(pixel: Vec2, lens_sample: Vec2): Ray;
  
  // Optional: Importance for bidirectional
  We?(ray: Ray): number;
  
  // Optional: Depth of field
  sample_lens?(sample: Vec2): LensSample;
}
```

**Implementations**:
- `PinholeCamera`: Perfect projection
- `ThinLensCamera`: Depth of field
- `RealisticCamera`: Full lens system
- `PanoramicCamera`: 360° capture
- `OrthographicCamera`: Parallel projection

#### Sampler
**Purpose**: Controlled random number generation

**Interface**:
```typescript
interface Sampler {
  // Get random values
  next_1d(): number;
  next_2d(): Vec2;
  
  // Pixel/sample management
  start_pixel(x: number, y: number): void;
  start_sample(index: number): void;
  
  // For reproducibility
  clone(): Sampler;
  set_seed(seed: number): void;
}
```

**Implementations**:
- `RandomSampler`: Pseudorandom
- `HaltonSampler`: Low-discrepancy sequence
- `SobolSampler`: (0,2)-sequence
- `BlueNoiseSampler`: Optimal distribution
- `StratifiedSampler`: Jittered grid

#### Tracer
**Purpose**: Path construction strategies

**Interface**:
```typescript
interface Tracer {
  // Build light transport paths
  trace(
    ray: Ray,
    world: World,
    sampler: Sampler
  ): Path[];
  
  // Configuration
  max_depth: number;
  russian_roulette: boolean;
}
```

**Implementations**:
- `DirectTracer`: Primary visibility only
- `WhittedTracer`: Recursive ray tracing
- `PathTracer`: Unidirectional Monte Carlo
- `BidirectionalTracer`: Light and eye paths
- `PhotonMapper`: Photon mapping
- `MLTTracer`: Metropolis light transport
- `VolumetricTracer`: Participating media

#### Film
**Purpose**: Image accumulation and reconstruction

**Interface**:
```typescript
interface Film {
  // Add radiance sample
  add_sample(
    pixel: Vec2,
    radiance: Spectrum,
    weight: number
  ): void;
  
  // Get current estimate
  get_image(): Image;
  
  // Reset accumulation
  clear(): void;
  
  // Optional: Adaptive sampling
  get_variance?(x: number, y: number): number;
}
```

**Implementations**:
- `InstantFilm`: No accumulation
- `SimpleFilm`: Box filter
- `GaussianFilm`: Gaussian reconstruction
- `AdaptiveFilm`: Variance-based sampling
- `DeepFilm`: Stores auxiliary buffers

#### Developer
**Purpose**: Image processing and output

**Interface**:
```typescript
interface Developer {
  // Process HDR to output
  process(image: Image): Output;
  
  // Configuration
  exposure: number;
  gamma: number;
}
```

**Implementations**:
- `LinearDeveloper`: No processing
- `ReinhardDeveloper`: Reinhard tonemapping
- `FilmicDeveloper`: Filmic curve
- `ACESDeveloper`: Academy standard
- `AnalyticDeveloper`: Statistics/heatmaps

### Blueprint System

Pre-configured combinations for common use cases:

#### World Blueprints
```typescript
Blueprints.Worlds = {
  // Test scenes
  CornellBox: (overrides?) => World,
  MISTest: (overrides?) => World,
  FurnaceTest: (overrides?) => World,
  
  // Geometric showcases
  HyperbolicRoom: (overrides?) => World,
  ThurstonGallery: (overrides?) => World,
  SchwarzschildLab: (overrides?) => World,
  
  // Research scenes
  CausticPool: (overrides?) => World,
  VolumetricCornell: (overrides?) => World,
  SubsurfaceTest: (overrides?) => World
}
```

#### Photography Blueprints
```typescript
Blueprints.Photographers = {
  // Rendering strategies
  DirectCapture: (overrides?) => Photography,
  PathTracer: (overrides?) => Photography,
  Researcher: (overrides?) => Photography,  // With analytics
  Production: (overrides?) => Photography,   // High quality
  Interactive: (overrides?) => Photography,  // Real-time preview
}
```

#### Studio Blueprints
Complete world + photography setups:
```typescript
Blueprints.Studios = {
  QuickPreview: (config) => Studio,
  PaperFigure: (config) => Studio,
  InteractiveExplorer: (config) => Studio,
  Benchmark: (config) => Studio,
}
```

### Extension System

Optional components that enhance functionality:

```typescript
interface Extension {
  // Lifecycle
  attach(renderer: Renderer): void;
  detach(): void;
  
  // Optional: Frame callbacks
  on_frame_start?(): void;
  on_frame_end?(): void;
}
```

**Available Extensions**:
- `OrbitControls`: Mouse/touch navigation
- `ParameterUI`: Dat.GUI-style panels
- `StatsMonitor`: FPS and performance
- `PathDebugger`: Visualize light paths
- `ConvergenceAnalyzer`: Track error reduction
- `Animator`: Keyframe animation
- `Recorder`: Video/image sequence export

### Engine Infrastructure

#### Parameter System
Manages shader uniforms and dynamic values:
```typescript
class ParameterManager {
  register(name: string, type: Type, value: any): void;
  bind_uniforms(program: WebGLProgram): void;
  on_change(callback: (name: string) => void): void;
}
```

#### Compilation System
Generates GLSL/WGSL from geometry + scene:
```typescript
class ShaderCompiler {
  compile(
    geometry: Geometry,
    scene: Scene,
    tracer: Tracer
  ): ShaderProgram;
}
```

#### Memory Management
Handles GPU resources:
```typescript
class ResourceManager {
  create_texture(spec: TextureSpec): Texture;
  create_buffer(data: ArrayBuffer): Buffer;
  track_usage(): MemoryStats;
}
```

## Usage Examples

### Basic Path Tracer
```typescript
// Simple setup using blueprints
const studio = Blueprints.Studios.PathTracer({
  world: {
    geometry: 'euclidean',
    scene: my_sdf_scene
  },
  samples_per_pixel: 100
});

const image = studio.render();
```

### Research Experiment
```typescript
// Testing new geodesic integration
const world = new World({
  geometry: new ExperimentalGeometry({
    integrator: 'dormand-prince',
    tolerance: 1e-6
  }),
  scene: Blueprints.Scenes.CornellBox(),
  materials: new PhysicalMaterials(),
  lights: [new AreaLight()]
});

const photography = new Photography({
  camera: new PinholeCamera(),
  sampler: new HaltonSampler(),
  tracer: new PathTracer({ max_depth: 10 }),
  film: new AdaptiveFilm(),
  developer: new AnalyticDeveloper()  // For measurements
});

const renderer = new Renderer(world, photography);

// Add analytics
renderer.add_extension('analytics', new ConvergenceAnalyzer());

// Render and analyze
const result = renderer.render();
const stats = renderer.get_extension('analytics').get_report();
```

### Interactive Explorer
```typescript
// Real-time preview with controls
const explorer = Blueprints.Studios.InteractiveExplorer({
  world: {
    geometry: 'hyperbolic',
    scene: my_scene
  }
});

// Add interactivity
explorer.add_extension('controls', new OrbitControls());
explorer.add_extension('ui', new ParameterUI([
  'geometry.curvature',
  'materials.roughness',
  'tracer.max_depth'
]));

// Start interactive loop
explorer.start_interactive();
```

### Comparative Rendering
```typescript
// Same world, different observation strategies
const world = Blueprints.Worlds.CausticPool();

const strategies = [
  Blueprints.Photographers.PathTracer(),
  Blueprints.Photographers.BidirectionalTracer(),
  Blueprints.Photographers.PhotonMapper()
];

const results = strategies.map(photography => {
  const renderer = new Renderer(world, photography);
  return {
    image: renderer.render(),
    stats: renderer.get_stats()
  };
});

// Compare convergence rates
plot_convergence_comparison(results);
```

## Supported Rendering Algorithms

### Implemented in Initial Version
1. **Direct Illumination**: Single-bounce rendering
2. **Whitted Ray Tracing**: Recursive specular paths
3. **Path Tracing**: Unidirectional Monte Carlo
4. **Next Event Estimation**: Direct light sampling
5. **Multiple Importance Sampling**: Optimal combination

### Planned Implementations
1. **Bidirectional Path Tracing**: Connect eye and light paths
2. **Metropolis Light Transport**: Markov chain sampling
3. **Photon Mapping**: Density estimation
4. **Progressive Photon Mapping**: Adaptive radius
5. **Vertex Connection Merging**: Unified framework
6. **Gradient-Domain Rendering**: Finite differences
7. **Neural Rendering**: ML-guided sampling

## Geometry Support

### Core Geometries
1. **Euclidean**: Standard 3D space
2. **Hyperbolic**: H³ in various models (Poincaré, Klein, hyperboloid)
3. **Spherical**: S³ geometry
4. **Product Geometries**: S² × ℝ, H² × ℝ
5. **Nil Geometry**: Heisenberg group
6. **Sol Geometry**: Split solvable
7. **SL₂(ℝ) Geometry**: Universal cover
8. **Schwarzschild**: Non-rotating black hole
9. **Kerr**: Rotating black hole
10. **FLRW**: Cosmological models

### Scene Representations
1. **Signed Distance Functions**: With constructive solid geometry
2. **Implicit Surfaces**: Level sets with root finding
3. **Triangle Meshes**: With BVH acceleration (future)
4. **Voxel Grids**: For volume rendering
5. **Point Clouds**: With splatting (future)
6. **Subdivision Surfaces**: Catmull-Clark/Loop (future)

## Future Directions and Open Decisions

### Acceleration Structures
**Status**: Deferred

**Open Questions**:
- Where do acceleration structures live? (Scene vs. separate component)
- How do we handle geometry-aware acceleration?
- Should we support multiple acceleration strategies per scene?
- How do we handle dynamic scenes?

**Current Plan**: Implement as internal Scene detail initially, refactor when mesh support is added.

### GPU Architecture
**Status**: Under consideration

**Open Questions**:
- Single uber-shader vs. specialized shaders per configuration?
- How to handle register pressure in complex geometries?
- WebGPU compute shaders vs. fragment shader tracing?
- CPU fallback for complex numerical integration?

### Material System Extensions
**Status**: Basic system designed

**Future Work**:
- Layered materials with proper Fresnel
- Measured BRDFs
- Subsurface scattering (BSSRDF)
- Hair/fur shading models
- Volume boundaries

### Advanced Sampling
**Status**: Framework in place

**Future Work**:
- Reservoir sampling for many lights
- Blue noise in path space
- Neural importance sampling
- Adaptive sampling maps
- Sobol sequence optimization

### Differentiable Rendering
**Status**: Not yet considered

**Potential Approach**:
- Automatic differentiation for SDFs
- Edge sampling for discontinuities
- Parameter optimization framework
- Inverse rendering applications

### Network Rendering
**Status**: Not planned initially

**Considerations**:
- Distributed path tracing
- Cloud rendering backend
- Collaborative sessions
- Progressive streaming

## Performance Considerations

### Design Trade-offs
- **Flexibility over speed**: Modular design may impact performance
- **Memory patterns**: Structure-of-arrays vs. array-of-structures per component
- **Shader complexity**: Generic shaders may have lower occupancy
- **Dynamic dispatch**: Virtual functions vs. compile-time polymorphism

### Optimization Strategies
1. **Shader specialization**: Generate optimal shaders for common cases
2. **Caching**: Reuse computed geodesics, Christoffel symbols
3. **Level-of-detail**: Simplified geometry for distant objects
4. **Importance caching**: Reuse importance samples across pixels
5. **Progressive refinement**: Low-quality preview, then refine

## Testing Strategy

### Unit Tests
- Geometry: Verify geodesics conserve energy
- Materials: Energy conservation, reciprocity
- Sampling: Statistical correctness
- Film: Proper accumulation

### Integration Tests
- Known analytical solutions (furnace test)
- Comparison with reference implementations
- Convergence to ground truth
- Cross-geometry consistency

### Visual Tests
- Reference image comparison
- Perceptual metrics
- Temporal stability
- Edge case galleries

## Development Roadmap

### Phase 1: Foundation
- Core architecture
- Euclidean geometry
- SDF scenes
- Basic path tracer
- Simple materials

### Phase 2: Non-Euclidean
- Hyperbolic geometry
- Spherical geometry
- Geodesic integration
- Parallel transport
- Adapted materials

### Phase 3: Advanced Geometry
- Thurston geometries
- Schwarzschild spacetime
- Numerical metrics
- Complex scenes

### Phase 4: Advanced Rendering 
- Bidirectional path tracing
- Photon mapping
- Volume rendering
- Subsurface scattering

### Phase 5: Production Features 
- Mesh support with BVH
- Adaptive sampling
- Animation system
- Network rendering

### Phase 6: Research Extensions 
- Novel algorithms
- Experimental geometries
- Machine learning integration
- Differentiable rendering

## Conclusion

This architecture provides a solid foundation for long-term rendering research 
while maintaining the flexibility to explore novel algorithms and geometries. 
The world/photography separation ensures clean abstraction boundaries, 
while the hierarchical component system allows both simple usage and deep customization.
The blueprint system provides quick starts for common cases, and the extension system
keeps optional features from complicating the core.

The design prioritizes mathematical clarity and research flexibility over production 
performance, making it ideal for academic exploration and paper production
while remaining practical for day-to-day development.




# Addendum: TypeScript Type Architecture

## Core Concepts: Interfaces, Traits, and Composition

### What Are Interfaces?
In TypeScript, an **interface** defines a contract - a shape that an object must have. Unlike classes, interfaces don't contain implementation, just the structure.

```typescript
interface Camera {
  getShaderCode(): ShaderFragment;
  getParameters(): Parameter[];
}

// Any class implementing Camera MUST have these methods
class PinholeCamera implements Camera {
  getShaderCode() { /* must implement */ }
  getParameters() { /* must implement */ }
}
```

### What Are Traits?
**Traits** are interfaces that define cross-cutting concerns - behaviors shared across different component types. Think of them as "abilities" that components can have.

```typescript
// Traits define shared capabilities
interface ShaderProvider {
  getShaderCode(): ShaderFragment;
}

interface Parameterized {
  getParameters(): Parameter[];
}

interface Updatable {
  update(deltaTime: number): void;
}
```

### Composition Over Inheritance
Instead of complex inheritance hierarchies, we **compose** interfaces from traits:

```typescript
// Geometry has both ShaderProvider and Parameterized abilities
interface Geometry extends ShaderProvider, Parameterized {
  // Plus geometry-specific requirements (if any)
}

// Camera also has both abilities
interface Camera extends ShaderProvider, Parameterized {
  // Plus camera-specific requirements (if any)
}
```

## Complete Type Architecture

### Core Traits (Shared Behaviors)

```typescript
// Trait: Can provide GLSL shader code
interface ShaderProvider {
  getShaderCode(): ShaderFragment;
}

// Trait: Has user-adjustable parameters
interface Parameterized {
  getParameters(): Parameter[];
}

// Trait: Updates over time
interface Updatable {
  update(deltaTime: number): void;
}

// Trait: Can be serialized/deserialized
interface Serializable {
  serialize(): JsonObject;
  deserialize(data: JsonObject): void;
}
```

### World Components (Mathematical Reality)

```typescript
// Geometry defines the manifold structure
interface Geometry extends ShaderProvider, Parameterized {
  // All behavior is in shader, so no CPU methods needed
  // But TypeScript ensures every Geometry can provide shader code
}

// Scene defines world in space
interface Scene extends ShaderProvider, Parameterized, Updatable {
  // Might need update for animated scenes
}

// Material defines surface properties
interface Material extends ShaderProvider, Parameterized {
  // Could add CPU methods for debugging
  roughness?: number;  // Optional CPU-side hints
  metallic?: number;
}

// Light defines emission
interface Light extends ShaderProvider, Parameterized {
  intensity?: number;  // Optional CPU-side hint
}

// World container - not a component itself
interface World {
  geometry: Geometry;
  scene: Scene;
  materials: Map<string, Material>;
  lights: Light[];
  media?: Media;  // Optional participating media
}
```

### Photography Components (Observation Process)

```typescript
// Camera generates rays
interface Camera extends ShaderProvider, Parameterized, Updatable {
  // Might need update for animation
}

// Sampler provides RNG strategy
interface Sampler extends ShaderProvider, Parameterized {
  seed: number;
  reset(): void;
}

// Tracer defines path construction
interface Tracer extends ShaderProvider, Parameterized {
  getMainLoop(): string;  // Provides the main() shader code
  getRequiredFunctions(): string[];  // Declares dependencies
}

// Film accumulates samples (CPU-side)
interface Film extends Parameterized, Updatable {
  accumulate(sample: Sample): void;
  getImage(): Float32Array;
  reset(): void;
  // No shader code - runs on CPU
}

// Developer processes output (CPU-side)
interface Developer extends Parameterized {
  process(hdrImage: Float32Array): ImageData;
  // No shader code - runs on CPU
}

// Photography container
interface Photography {
  camera: Camera;
  sampler: Sampler;
  tracer: Tracer;
  film: Film;
  developer: Developer;
}
```

### Extension System (Optional Enhancements)

```typescript
// Extensions use a different pattern - they're plugins
interface Extension {
  readonly id: string;
  readonly type: string;
  attach(pipeline: RenderPipeline): void;
  detach(): void;
  update?(deltaTime: number): void;
}

// Concrete extension example
class OrbitControls implements Extension {
  readonly id = 'orbit-controls';
  readonly type = 'controls';
  
  attach(pipeline: RenderPipeline) {
    // Add event listeners
  }
  
  detach() {
    // Remove event listeners
  }
}
```

### Supporting Types

```typescript
// Shader fragment that components provide
interface ShaderFragment {
  defines?: string;      // #define FEATURE_X
  uniforms?: string;     // uniform float u_time;
  functions: string;     // GLSL functions
  mainCode?: string;     // Code for main()
}

// Parameter for UI and uniforms
interface Parameter<T> {
  name: string;
  value: T;
  metadata: {
    uniform?: string;    // Maps to GPU uniform
    min?: number;        // UI constraints
    max?: number;
    step?: number;
    category?: string;   // UI grouping
  };
}

// The pipeline that renders
interface RenderPipeline {
  render(): void;
  getParameter(name: string): Parameter<any>;
  setParameter(name: string, value: any): void;
}
```

## How This Keeps Us Organized

### 1. **Compile-Time Safety**
```typescript
// This CANNOT compile - TypeScript catches the error
const world: World = {
  geometry: new PinholeCamera(),  // ERROR: Camera is not Geometry
  scene: new SDFScene(),
  materials: new Map(),
  lights: []
};
```

### 2. **Generic Functions via Traits**
```typescript
// Works with ANY component that has parameters
function buildUIPanel(component: Parameterized): UIPanel {
  const panel = new UIPanel();
  component.getParameters().forEach(param => {
    panel.addControl(param);
  });
  return panel;
}

// Can pass ANY parameterized component
buildUIPanel(myGeometry);  // ✓ Works
buildUIPanel(myCamera);    // ✓ Works
buildUIPanel(myFilm);      // ✓ Works
```

### 3. **Clear Required vs Optional**
```typescript
class RenderEngine {
  // Required components are explicit in the type signature
  render(world: World, photography: Photography): Image {
    // world.geometry is guaranteed to exist and be a Geometry
    // world.media might not exist - TypeScript knows it's optional
    
    if (world.media) {
      // TypeScript knows media exists in this block
    }
  }
}
```

### 4. **Interface Segregation**
Components only implement what they need:
```typescript
// Film doesn't need ShaderProvider - it runs on CPU
interface Film extends Parameterized, Updatable {
  // Just what Film actually needs
}

// Geometry doesn't need Updatable if it's static
interface Geometry extends ShaderProvider, Parameterized {
  // Just what Geometry needs
}
```

### 5. **Easy Testing via Mocks**
```typescript
// Can create test doubles that implement interfaces
class MockGeometry implements Geometry {
  getShaderCode() { return { functions: 'vec3 geodesic() { return vec3(0); }' }; }
  getParameters() { return []; }
}

// Test the engine without real components
const testWorld: World = {
  geometry: new MockGeometry(),
  // ...
};
```

## The Key Benefits

1. **Type Safety**: Can't mix up components or forget required methods
2. **IntelliSense**: IDE knows exactly what methods are available
3. **Refactoring**: Change an interface, TypeScript shows you every place that needs updating
4. **Documentation**: Interfaces serve as living documentation
5. **Testing**: Easy to mock interfaces for unit tests
6. **Flexibility**: Traits allow sharing behavior without inheritance hierarchies

This architecture gives you a **stable, type-safe engine** where you can focus on mathematics and algorithms, knowing the TypeScript compiler is catching structural errors for you.
