# Path Tracer Implementation Architecture

## Core Architectural Decision: Component Type System

### The Fundamental Question

How do we type and manage the diverse components in our system? We have three main approaches:

### Option A: Universal Plugin System
```typescript
interface Plugin {
  readonly id: string;
  readonly type: string;
  initialize(engine: Engine): void;
  getShaderCode?(): ShaderFragment;
  getParameters?(): Parameter[];
  update?(deltaTime: number): void;
  destroy?(): void;
}

// Everything is a plugin
class Camera implements Plugin { type = 'camera'; }
class Geometry implements Plugin { type = 'geometry'; }
class OrbitControls implements Plugin { type = 'controls'; }
```

**Pros:**
- Uniform registration and management
- Easy to add new component types
- Single pattern to learn

**Cons:**
- Lost type safety (everything is `Plugin`)
- Required components aren't distinguished from optional
- Runtime errors instead of compile-time

### Option B: Typed Core + Plugin Extensions
```typescript
// Core components have specific interfaces
interface Geometry {
  geodesic(origin: Vec3, direction: Vec3, t: number): GeodesicState;
  getShaderCode(): GeometryShader;
}

interface Camera {
  generateRay(pixel: Vec2): Ray;
  getShaderCode(): CameraShader;
}

// Extensions use plugin pattern
interface Extension {
  readonly id: string;
  attach(pipeline: RenderPipeline): void;
  detach(): void;
}

class OrbitControls implements Extension { }
```

**Pros:**
- Type safety for core components
- Clear required/optional distinction
- IDE autocomplete and type checking
- Extensions can be experimental without affecting core

**Cons:**
- Two patterns to understand
- Migration friction if extension becomes core

### Option C: Fully Typed Everything
```typescript
interface Geometry { }
interface Camera { }
interface Controls { }
interface UI { }
// Every component type has its own interface
```

**Pros:**
- Maximum type safety
- Each interface perfectly fitted

**Cons:**
- No uniform handling possible
- Lots of interface definitions
- Hard to add new component types

## Recommendation: Hybrid Approach

Based on your research goals, I recommend **Option B with a twist**: typed core components with a **trait system** for shared behaviors.

```typescript
// Traits for shared behaviors
interface ShaderProvider {
  getShaderCode(): ShaderFragment;
}

interface Parameterized {
  getParameters(): Parameter[];
}

interface Updatable {
  update(deltaTime: number): void;
}

// Core components implement specific interface + traits
interface Geometry extends ShaderProvider, Parameterized {
  geodesic(origin: Vec3, direction: Vec3, t: number): GeodesicState;
}

// Extensions are plugins
interface Extension {
  readonly id: string;
  readonly type: string;
  attach(pipeline: RenderPipeline): void;
  detach(): void;
}
```

## Implementation Structure

### 1. Component Registry System

```typescript
// Registry knows about core component types
class ComponentRegistry {
  // Typed storage for core components
  private geometry?: Geometry;
  private camera?: Camera;
  private scene?: Scene;
  private tracer?: Tracer;
  private film?: Film;
  private developer?: Developer;
  
  // Dynamic storage for materials and lights
  private materials = new Map<string, Material>();
  private lights = new Map<string, Light>();
  
  // Plugin storage for extensions
  private extensions = new Map<string, Extension>();
  
  // Type-safe setters for core components
  setGeometry(g: Geometry) { this.geometry = g; }
  setCamera(c: Camera) { this.camera = c; }
  
  // Type-safe getters
  getGeometry(): Geometry {
    if (!this.geometry) throw new Error('Geometry not set');
    return this.geometry;
  }
  
  // Dynamic component management
  addMaterial(id: string, mat: Material) { 
    this.materials.set(id, mat); 
  }
  
  // Extension management
  addExtension(ext: Extension) {
    this.extensions.set(ext.id, ext);
  }
}
```

### 2. Parameter Management Strategy

```typescript
// Three-tier parameter system
class ParameterSystem {
  // Tier 1: Raw values (can be shared)
  private values = new Map<string, Value<any>>();
  
  // Tier 2: Parameters (user-facing)
  private parameters = new Map<string, Parameter<any>>();
  
  // Tier 3: Uniform bindings
  private uniformBindings = new Map<string, UniformBinding[]>();
  
  // Special: Control bindings
  private controlBindings = new Map<string, ControlBinding>();
}

// Value can be shared by multiple parameters
class Value<T> {
  private data: T;
  private subscribers = new Set<(value: T) => void>();
  
  get(): T { return this.data; }
  set(v: T): void {
    this.data = v;
    this.subscribers.forEach(fn => fn(v));
  }
}

// Parameter is user-facing
class Parameter<T> {
  constructor(
    public name: string,
    private source: Value<T> | (() => T),  // Can be value or computed
    public metadata: ParameterMetadata
  ) {}
  
  get(): T {
    if (typeof this.source === 'function') {
      return this.source();
    }
    return this.source.get();
  }
}

// Binding connects parameters to uniforms
interface UniformBinding {
  parameter: string;
  uniforms: string[];  // Can bind to multiple
  transform?: (value: any) => any;
}
```

### 3. Shader Compilation Pipeline

```typescript
class ShaderCompiler {
  // Compilation happens in stages
  compile(registry: ComponentRegistry): WebGLProgram {
    // Stage 1: Gather all shader providers
    const providers = this.gatherProviders(registry);
    
    // Stage 2: Build dependency graph
    const dependencies = this.analyzeDependencies(providers);
    
    // Stage 3: Generate shader code
    const vertexCode = this.generateVertexShader(providers);
    const fragmentCode = this.generateFragmentShader(providers, dependencies);
    
    // Stage 4: Compile and link
    return this.compileAndLink(vertexCode, fragmentCode);
  }
  
  private gatherProviders(registry: ComponentRegistry): ShaderProvider[] {
    const providers: ShaderProvider[] = [];
    
    // Core components that provide shaders
    providers.push(registry.getGeometry());
    providers.push(registry.getCamera());
    providers.push(registry.getScene());
    providers.push(registry.getTracer());
    
    // Materials might provide shaders
    registry.getMaterials().forEach(mat => {
      if ('getShaderCode' in mat) {
        providers.push(mat as ShaderProvider);
      }
    });
    
    return providers;
  }
}
```

## Critical Implementation Decisions

### Decision 1: Uniform Update Strategy

**Option A: Immediate Mode**
```typescript
// Update uniforms as soon as parameters change
parameter.onChange(value => {
  gl.useProgram(program);
  gl.uniform1f(location, value);
});
```

**Option B: Batched Updates**
```typescript
// Collect changes, update before render
class UniformBatcher {
  private dirty = new Set<string>();
  
  markDirty(uniform: string) { this.dirty.add(uniform); }
  
  flush() {
    this.dirty.forEach(name => this.updateUniform(name));
    this.dirty.clear();
  }
}
```

**Recommendation**: Batched updates for performance

### Decision 2: Component Lifecycle

**Option A: Simple Creation**
```typescript
const camera = new Camera();  // Ready to use
```

**Option B: Two-Phase Initialization**
```typescript
const camera = new Camera();
camera.initialize(gl, resources);  // Separate initialization
```

**Option C: Factory Pattern**
```typescript
const camera = cameraFactory.create('pinhole', { fov: 60 });
```

**Recommendation**: Simple creation with lazy initialization

### Decision 3: Shader Feature Toggles

How do we handle optional shader features?

**Option A: Preprocessor Defines**
```glsl
#ifdef USE_ENVIRONMENT_MAP
  color += sampleEnvironment(ray.direction);
#endif
```

**Option B: Uniform Branches**
```glsl
if (u_useEnvironmentMap) {
  color += sampleEnvironment(ray.direction);
}
```

**Option C: Shader Variants**
```typescript
// Compile different shaders for different feature sets
const shaderKey = `${features.join('_')}`;
```

**Recommendation**: Shader variants for performance-critical paths

### Decision 4: Resource Management

**Option A: Manual Management**
```typescript
const texture = gl.createTexture();
// ... user manages lifetime
```

**Option B: Automatic Reference Counting**
```typescript
class Resource<T> {
  private refCount = 0;
  retain() { this.refCount++; }
  release() { 
    if (--this.refCount === 0) this.destroy(); 
  }
}
```

**Option C: Garbage Collection**
```typescript
class ResourceManager {
  private resources = new WeakMap();
  // Let JS GC handle it
}
```

**Recommendation**: Reference counting for GPU resources

## Implementation Roadmap

### Phase 1: Core Infrastructure (Week 1-2)
```typescript
// Minimum viable engine
- ComponentRegistry
- Basic ParameterSystem  
- Simple ShaderCompiler
- WebGL context management
```

### Phase 2: Core Components (Week 3-4)
```typescript
// Required components
- EuclideanGeometry
- PinholeCamera
- SDFScene
- DirectTracer
- SimpleFilm
- LinearDeveloper
```

### Phase 3: Parameter System (Week 5)
```typescript
// Full parameter/uniform management
- Value/Parameter/Binding system
- UniformManager
- Automatic UI generation
```

### Phase 4: Extension System (Week 6)
```typescript
// Plugin architecture
- Extension interface
- OrbitControls
- ParameterUI
- StatsMonitor
```

## Code Organization

```
src/
├── core/
│   ├── types.ts           // Core interfaces
│   ├── registry.ts        // Component registry
│   ├── pipeline.ts        // Render pipeline
│   └── math/              // Vector/matrix utilities
│
├── parameters/
│   ├── value.ts           // Value class
│   ├── parameter.ts       // Parameter class
│   ├── manager.ts         // Parameter management
│   └── bindings.ts        // Uniform bindings
│
├── shader/
│   ├── compiler.ts        // Shader compilation
│   ├── cache.ts           // Shader caching
│   ├── fragments.ts       // Shader fragment types
│   └── templates/         // GLSL templates
│
├── world/
│   ├── geometry/
│   │   ├── base.ts        // Geometry interface
│   │   ├── euclidean.ts
│   │   └── hyperbolic.ts
│   ├── scene/
│   │   ├── base.ts        // Scene interface
│   │   ├── sdf.ts
│   │   └── mesh.ts
│   └── materials/
│       ├── base.ts        // Material interface
│       └── lambertian.ts
│
├── photography/
│   ├── camera/
│   ├── tracer/
│   ├── film/
│   └── developer/
│
├── extensions/
│   ├── base.ts            // Extension interface
│   ├── controls.ts
│   └── ui.ts
│
└── engine/
    ├── engine.ts          // Main engine class
    ├── resources.ts       // Resource management
    └── platform.ts        // WebGL/WebGPU abstraction
```

## Open Questions for Implementation

1. **TypeScript Strictness**: How strict should our types be? Use `strict: true`?

2. **Error Handling**: Throw exceptions or return Result types?
```typescript
// Option A: Exceptions
getComponent(): Component {
  if (!component) throw new Error();
  return component;
}

// Option B: Result type
getComponent(): Result<Component, Error> {
  if (!component) return { error: new Error() };
  return { value: component };
}
```

3. **Async Operations**: Some operations (texture loading, shader compilation) are async. Promise-based or callback-based?

4. **Testing Strategy**: Unit tests for components? Integration tests for rendering?

5. **Performance Monitoring**: Built-in profiling or rely on browser tools?

## Next Steps

1. Finalize the component type system decision
2. Implement core registry and parameter system
3. Create minimal working example with one geometry, camera, scene
4. Add shader compilation pipeline
5. Layer in extensions

The key is to start simple and iterate. The architecture should support growth without requiring rewrites.
