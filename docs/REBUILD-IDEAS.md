## The Core Implementation Challenge

You're absolutely right - we need to think about the actual mechanics. The biggest challenge in your system is that you have **CPU orchestration** that generates **GPU shaders** that must be specialized for each world/photography combination. Let's design something genuinely simple and maintainable.

## The Simplest Possible Component System

### Core Pattern: Interfaces + Concrete Classes

```typescript
// Every component has a simple interface
interface Component {
  readonly type: string;
  readonly id: string;
}

// Every component can provide shader code
interface ShaderProvider {
  getShaderCode(): ShaderFragment;
}

// Shader fragments are just typed strings
interface ShaderFragment {
  defines?: string;
  uniforms?: string;
  functions: string;
  mainCode?: string;  // For insertion into main()
}
```

### The Key Insight: Registry Pattern

Instead of complex dependency injection, use a simple registry:

```typescript
class ComponentRegistry {
  private components = new Map<string, Component>();
  
  register(component: Component): void {
    this.components.set(component.id, component);
  }
  
  get<T extends Component>(id: string): T {
    const component = this.components.get(id);
    if (!component) {
      throw new Error(`Component ${id} not found`);
    }
    return component as T;
  }
  
  getAllOfType<T extends Component>(type: string): T[] {
    return Array.from(this.components.values())
      .filter(c => c.type === type) as T[];
  }
}
```

## Practical Example: Geometry Implementation

Let's see how this works in practice:

```typescript
// The interface (what all geometries must provide)
interface Geometry extends Component, ShaderProvider {
  type: 'geometry';
  
  // CPU-side methods (for debugging/preview)
  geodesicCPU(origin: Vec3, direction: Vec3, t: number): Vec3;
  metricTensorCPU(point: Vec3): Mat3;
}

// Concrete implementation
class EuclideanGeometry implements Geometry {
  readonly type = 'geometry' as const;
  readonly id = 'euclidean';
  
  geodesicCPU(origin: Vec3, direction: Vec3, t: number): Vec3 {
    // Simple for Euclidean - straight line
    return vec3.add(origin, vec3.scale(direction, t));
  }
  
  metricTensorCPU(point: Vec3): Mat3 {
    return mat3.identity();  // Flat space
  }
  
  getShaderCode(): ShaderFragment {
    return {
      defines: `
        #define GEOMETRY_EUCLIDEAN
      `,
      functions: `
        vec3 geodesic(vec3 origin, vec3 direction, float t) {
          return origin + direction * t;
        }
        
        mat3 metricTensor(vec3 point) {
          return mat3(1.0);
        }
        
        vec3 parallelTransport(vec3 v, vec3 from, vec3 to) {
          return v;  // No change in flat space
        }
      `
    };
  }
}
```

## The Engine: Dead Simple Orchestration

Here's the key - the engine should be **boring**:

```typescript
class RenderEngine {
  private registry = new ComponentRegistry();
  private shaderCache = new Map<string, WebGLProgram>();
  private gl: WebGL2RenderingContext;
  
  constructor(canvas: HTMLCanvasElement) {
    this.gl = canvas.getContext('webgl2')!;
  }
  
  // Set up a render configuration
  configure(config: RenderConfig): RenderPipeline {
    // Register all components
    this.registry.register(config.world.geometry);
    this.registry.register(config.world.scene);
    this.registry.register(config.photography.camera);
    this.registry.register(config.photography.tracer);
    
    // Build shader from components
    const shader = this.buildShader(config);
    
    // Return a pipeline that can render
    return new RenderPipeline(this.gl, shader, this.registry);
  }
  
  private buildShader(config: RenderConfig): WebGLProgram {
    // Generate cache key from component IDs
    const key = `${config.world.geometry.id}_${config.world.scene.id}_${config.photography.tracer.id}`;
    
    // Check cache
    if (this.shaderCache.has(key)) {
      return this.shaderCache.get(key)!;
    }
    
    // Build new shader
    const shader = this.compileShader(config);
    this.shaderCache.set(key, shader);
    return shader;
  }
  
  private compileShader(config: RenderConfig): WebGLProgram {
    // Gather shader fragments from all components
    const fragments: ShaderFragment[] = [
      config.world.geometry.getShaderCode(),
      config.world.scene.getShaderCode(),
      config.photography.camera.getShaderCode(),
      config.photography.tracer.getShaderCode()
    ];
    
    // Combine into final shader
    const vertexShader = this.buildVertexShader();  // Usually static
    const fragmentShader = this.buildFragmentShader(fragments);
    
    return this.createProgram(vertexShader, fragmentShader);
  }
}
```

## TypeScript Features You Should Know

### 1. Const Assertions (for literal types)
```typescript
class EuclideanGeometry {
  readonly type = 'geometry' as const;  // Type is exactly 'geometry', not string
}
```

### 2. Type Guards (for safe casting)
```typescript
function isGeometry(component: Component): component is Geometry {
  return component.type === 'geometry';
}

// Usage
const component = registry.get('some-id');
if (isGeometry(component)) {
  // TypeScript knows this is a Geometry now
  component.geodesicCPU(origin, dir, t);
}
```

### 3. Discriminated Unions (for variants)
```typescript
type SceneObject = 
  | { type: 'sdf'; distance: (p: Vec3) => number }
  | { type: 'mesh'; vertices: Float32Array; indices: Uint32Array }
  | { type: 'implicit'; evaluate: (p: Vec3) => number };

// TypeScript narrows type based on 'type' field
function intersect(obj: SceneObject, ray: Ray) {
  switch(obj.type) {
    case 'sdf':
      return marchSDF(obj.distance, ray);  // obj.distance is available
    case 'mesh':
      return intersectMesh(obj.vertices, obj.indices, ray);
    case 'implicit':
      return findRoot(obj.evaluate, ray);
  }
}
```

### 4. Partial Types (for overrides)
```typescript
interface CameraConfig {
  fov: number;
  aspect: number;
  near: number;
  far: number;
}

// Partial<T> makes all properties optional
function createCamera(overrides?: Partial<CameraConfig>) {
  const defaults: CameraConfig = {
    fov: 60,
    aspect: 16/9,
    near: 0.1,
    far: 1000
  };
  
  return { ...defaults, ...overrides };
}
```

## The Shader Generation Strategy

Keep it **dead simple** - template strings with replacement:

```typescript
class ShaderBuilder {
  private defines: string[] = [];
  private uniforms: string[] = [];
  private functions: string[] = [];
  private mainCode: string[] = [];
  
  addFragment(fragment: ShaderFragment) {
    if (fragment.defines) this.defines.push(fragment.defines);
    if (fragment.uniforms) this.uniforms.push(fragment.uniforms);
    this.functions.push(fragment.functions);
    if (fragment.mainCode) this.mainCode.push(fragment.mainCode);
  }
  
  build(): string {
    return `
      #version 300 es
      precision highp float;
      
      // Defines
      ${this.defines.join('\n')}
      
      // Uniforms
      ${this.uniforms.join('\n')}
      
      // Functions from components
      ${this.functions.join('\n')}
      
      // Main
      void main() {
        ${this.mainCode.join('\n')}
      }
    `;
  }
}
```

## Practical Component Swapping

The beauty of this system is how easy swapping becomes:

```typescript
// Start with Euclidean
let config: RenderConfig = {
  world: {
    geometry: new EuclideanGeometry(),
    scene: new SDFScene(myShapes),
    materials: new BasicMaterials()
  },
  photography: {
    camera: new PinholeCamera(),
    tracer: new PathTracer(),
    film: new SimpleFilm()
  }
};

let pipeline = engine.configure(config);
pipeline.render();

// Switch to hyperbolic - just swap one component
config.world.geometry = new HyperbolicGeometry();
pipeline = engine.configure(config);  // Engine handles everything
pipeline.render();
```

## The Parameter System (Simple but Powerful)

```typescript
class Parameter<T> {
  private value: T;
  private listeners: ((value: T) => void)[] = [];
  
  constructor(
    public readonly name: string,
    initialValue: T,
    public readonly uniform?: string  // GLSL uniform name
  ) {
    this.value = initialValue;
  }
  
  get(): T { return this.value; }
  
  set(newValue: T): void {
    this.value = newValue;
    this.listeners.forEach(fn => fn(newValue));
  }
  
  onChange(fn: (value: T) => void): void {
    this.listeners.push(fn);
  }
}

// Usage in components
class HyperbolicGeometry implements Geometry {
  curvature = new Parameter('curvature', -1.0, 'u_curvature');
  
  getShaderCode(): ShaderFragment {
    return {
      uniforms: `uniform float u_curvature;`,
      functions: `/* uses u_curvature in geodesic calculation */`
    };
  }
}
```

## The Complete Simple Engine

Here's what your engine directory should look like:

```typescript
// engine/core.ts
export class RenderEngine {
  private gl: WebGL2RenderingContext;
  private registry = new ComponentRegistry();
  private parameters = new ParameterManager();
  private shaderCache = new Map<string, WebGLProgram>();
  
  constructor(canvas: HTMLCanvasElement) {
    this.gl = canvas.getContext('webgl2', {
      antialias: false,
      preserveDrawingBuffer: true
    })!;
  }
  
  // The only method you need to care about
  render(config: RenderConfig): Image {
    // 1. Register components
    this.registerAll(config);
    
    // 2. Build/get cached shader
    const shader = this.getShader(config);
    
    // 3. Set up uniforms from parameters
    this.parameters.bindToShader(shader);
    
    // 4. Render
    return this.executeRender(shader, config);
  }
  
  // Everything else is private implementation
  private registerAll(config: RenderConfig) { /* ... */ }
  private getShader(config: RenderConfig) { /* ... */ }
  private executeRender(shader: WebGLProgram, config: RenderConfig) { /* ... */ }
}
```

## The Key Design Decisions

### 1. **No Dependency Injection Framework**
Just use a simple registry. You can get any component by ID.

### 2. **No Complex State Management**
Components are mostly stateless. Parameters handle mutable state.

### 3. **No Abstract Base Classes**
Just interfaces and concrete implementations.

### 4. **No Event Bus**
Direct callbacks where needed (onChange for parameters).

### 5. **Cache Aggressively**
Shaders are expensive to compile. Cache them by component combination.

### 6. **CPU Fallback for Everything**
Every GPU operation should have a CPU equivalent for debugging.

## Making It "Set and Forget"

The engine becomes truly stable when:

1. **It only orchestrates** - doesn't contain any rendering logic
2. **Components are self-contained** - they provide their own shader code
3. **Caching is automatic** - no manual cache management
4. **Parameters are declarative** - components declare their parameters
5. **No hidden dependencies** - everything goes through the registry

## Example: Adding a New Geometry

Once the engine is built, adding new geometries is trivial:

```typescript
class SchwarzschildGeometry implements Geometry {
  readonly type = 'geometry' as const;
  readonly id = 'schwarzschild';
  
  // Parameters
  mass = new Parameter('mass', 1.0, 'u_mass');
  
  geodesicCPU(origin: Vec3, direction: Vec3, t: number): Vec3 {
    // Implement geodesic equation solution
  }
  
  getShaderCode(): ShaderFragment {
    return {
      uniforms: `uniform float u_mass;`,
      functions: `
        vec3 geodesic(vec3 origin, vec3 direction, float t) {
          // GLSL implementation
        }
      `
    };
  }
}

// That's it! No engine changes needed
```

This design is:
- **Simple**: No complex patterns or frameworks
- **Reliable**: Components can't break each other
- **Maintainable**: Clear boundaries and responsibilities
- **Flexible**: Easy to add new components
- **Efficient**: Automatic caching, minimal overhead



## Let's Get Concrete: Cameras with Different Parameters

The key insight is that **parameters are self-describing**:

```typescript
interface Camera extends Component, ShaderProvider {
  type: 'camera';
  
  // Every camera must provide these
  generateRay(pixel: Vec2, sample: Vec2): Ray;  // CPU version
  getParameters(): Parameter<any>[];  // Self-describing parameters!
}

class PinholeCamera implements Camera {
  readonly type = 'camera' as const;
  readonly id = 'pinhole';
  
  // Simple parameters
  fov = new Parameter('fov', 60, 'u_fov');
  aspect = new Parameter('aspect', 16/9, 'u_aspect');
  
  getParameters() {
    return [this.fov, this.aspect];
  }
  
  generateRay(pixel: Vec2, sample: Vec2): Ray {
    // CPU implementation for debugging
    const tanHalfFov = Math.tan(this.fov.get() * Math.PI / 360);
    // ... ray generation
  }
  
  getShaderCode(): ShaderFragment {
    return {
      uniforms: `
        uniform float u_fov;
        uniform float u_aspect;
        uniform vec2 u_resolution;
      `,
      functions: `
        Ray generateCameraRay(vec2 pixel) {
          vec2 ndc = (pixel / u_resolution) * 2.0 - 1.0;
          float tanHalfFov = tan(radians(u_fov) * 0.5);
          
          vec3 direction = normalize(vec3(
            ndc.x * u_aspect * tanHalfFov,
            ndc.y * tanHalfFov,
            -1.0
          ));
          
          return Ray(vec3(0.0), direction);
        }
      `
    };
  }
}

class ThinLensCamera implements Camera {
  readonly type = 'camera' as const;
  readonly id = 'thin_lens';
  
  // More complex parameters
  fov = new Parameter('fov', 60, 'u_fov');
  aspect = new Parameter('aspect', 16/9, 'u_aspect');
  aperture = new Parameter('aperture', 0.1, 'u_aperture');
  focusDistance = new Parameter('focus', 5.0, 'u_focus_distance');
  
  getParameters() {
    return [this.fov, this.aspect, this.aperture, this.focusDistance];
  }
  
  getShaderCode(): ShaderFragment {
    return {
      uniforms: `
        uniform float u_fov;
        uniform float u_aspect;
        uniform float u_aperture;
        uniform float u_focus_distance;
        uniform vec2 u_resolution;
      `,
      functions: `
        Ray generateCameraRay(vec2 pixel) {
          vec2 ndc = (pixel / u_resolution) * 2.0 - 1.0;
          float tanHalfFov = tan(radians(u_fov) * 0.5);
          
          // Ray to focus point
          vec3 focusDir = normalize(vec3(
            ndc.x * u_aspect * tanHalfFov,
            ndc.y * tanHalfFov,
            -1.0
          ));
          vec3 focusPoint = focusDir * u_focus_distance;
          
          // Sample lens
          vec2 lens = randomInDisk() * u_aperture;
          vec3 origin = vec3(lens, 0.0);
          vec3 direction = normalize(focusPoint - origin);
          
          return Ray(origin, direction);
        }
      `
    };
  }
}
```

The UI can **automatically** build controls:

```typescript
class ParameterUI {
  buildPanel(camera: Camera) {
    const params = camera.getParameters();
    
    params.forEach(param => {
      // Automatically create appropriate UI control
      if (typeof param.get() === 'number') {
        this.addSlider(param);
      } else if (typeof param.get() === 'boolean') {
        this.addCheckbox(param);
      }
      // etc...
    });
  }
}
```

## The Integrator Challenge: Orchestrating the Main Loop

Integrators are tricky because they orchestrate the entire render loop. Here's the key insight: **they generate the shader's main function**:

```typescript
interface Tracer extends Component, ShaderProvider {
  type: 'tracer';
  
  // Tracers are special - they generate the main rendering loop
  getMainLoopCode(): string;
  
  // They also need to know what other components to call
  getRequiredFunctions(): string[];
}

class DirectTracer implements Tracer {
  readonly type = 'tracer' as const;
  readonly id = 'direct';
  
  maxDistance = new Parameter('maxDistance', 100, 'u_max_distance');
  
  getRequiredFunctions() {
    return [
      'generateCameraRay',  // From camera
      'sceneIntersect',     // From scene
      'evaluateMaterial'    // From materials
    ];
  }
  
  getShaderCode(): ShaderFragment {
    return {
      uniforms: `
        uniform float u_max_distance;
      `,
      functions: `
        vec3 traceDirect(vec2 pixel) {
          Ray ray = generateCameraRay(pixel);
          
          Intersection hit = sceneIntersect(ray, u_max_distance);
          if (!hit.valid) {
            return vec3(0.0);  // Background
          }
          
          // Direct lighting only
          vec3 color = evaluateMaterial(hit);
          return color;
        }
      `
    };
  }
  
  getMainLoopCode(): string {
    return `
      vec2 pixel = gl_FragCoord.xy;
      vec3 color = traceDirect(pixel);
      outColor = vec4(color, 1.0);
    `;
  }
}

class PathTracer implements Tracer {
  readonly type = 'tracer' as const;
  readonly id = 'pathtracer';
  
  maxDepth = new Parameter('maxDepth', 5, 'u_max_depth');
  russianRoulette = new Parameter('rr', true, 'u_russian_roulette');
  
  getShaderCode(): ShaderFragment {
    return {
      uniforms: `
        uniform int u_max_depth;
        uniform bool u_russian_roulette;
      `,
      functions: `
        vec3 tracePath(vec2 pixel) {
          Ray ray = generateCameraRay(pixel);
          vec3 throughput = vec3(1.0);
          vec3 radiance = vec3(0.0);
          
          for (int depth = 0; depth < u_max_depth; depth++) {
            Intersection hit = sceneIntersect(ray, 1000.0);
            
            if (!hit.valid) {
              // Hit environment
              radiance += throughput * getEnvironment(ray.direction);
              break;
            }
            
            // Add emission
            radiance += throughput * getEmission(hit);
            
            // Sample BSDF
            vec3 wi = -ray.direction;
            BSDFSample sample = sampleBSDF(hit, wi);
            
            if (sample.pdf < 0.001) break;
            
            // Update throughput
            throughput *= sample.f * abs(dot(sample.wo, hit.normal)) / sample.pdf;
            
            // Russian roulette
            if (u_russian_roulette && depth > 3) {
              float p = max(throughput.r, max(throughput.g, throughput.b));
              if (random() > p) break;
              throughput /= p;
            }
            
            // Next ray
            ray = Ray(hit.position, sample.wo);
          }
          
          return radiance;
        }
      `
    };
  }
  
  getMainLoopCode(): string {
    return `
      vec2 pixel = gl_FragCoord.xy;
      
      // Multiple samples for Monte Carlo
      vec3 color = vec3(0.0);
      for (int s = 0; s < SAMPLES_PER_PASS; s++) {
        initRandom(pixel, u_frame * SAMPLES_PER_PASS + s);
        color += tracePath(pixel);
      }
      color /= float(SAMPLES_PER_PASS);
      
      // Accumulate with previous frames
      vec3 previousColor = texture(u_previousFrame, pixel / u_resolution).rgb;
      float weight = float(u_frame) / float(u_frame + 1);
      outColor = vec4(mix(color, previousColor, weight), 1.0);
    `;
  }
}
```

## Scenes: The Intersection Challenge

Scenes are interesting because they need to handle multiple primitive types. Here's a clean approach:

```typescript
interface Scene extends Component, ShaderProvider {
  type: 'scene';
  
  // CPU intersection for debugging
  intersect(ray: Ray): Intersection | null;
  
  // Scene might have dynamic elements
  update?(time: number): void;
}

class SDFScene implements Scene {
  readonly type = 'scene' as const;
  readonly id = 'sdf_scene';
  
  constructor(private shapes: SDFShape[]) {}
  
  getShaderCode(): ShaderFragment {
    // Build SDF from shapes
    const sdfCode = this.shapes.map((shape, i) => 
      shape.getSDFCode(`shape_${i}`)
    ).join('\n');
    
    return {
      functions: `
        ${sdfCode}
        
        float sceneSDF(vec3 p) {
          float d = 1000000.0;
          ${this.shapes.map((_, i) => 
            `d = min(d, shape_${i}(p));`
          ).join('\n')}
          return d;
        }
        
        Intersection sceneIntersect(Ray ray, float maxDist) {
          float t = 0.0;
          
          for (int i = 0; i < 256; i++) {
            vec3 p = geodesic(ray.origin, ray.direction, t);
            float d = sceneSDF(p);
            
            if (d < 0.001) {
              // Hit! Compute normal
              vec3 normal = normalize(vec3(
                sceneSDF(p + vec3(0.001, 0, 0)) - sceneSDF(p - vec3(0.001, 0, 0)),
                sceneSDF(p + vec3(0, 0.001, 0)) - sceneSDF(p - vec3(0, 0.001, 0)),
                sceneSDF(p + vec3(0, 0, 0.001)) - sceneSDF(p - vec3(0, 0, 0.001))
              ));
              
              return Intersection(true, p, normal, t, 0);  // material ID = 0
            }
            
            if (t > maxDist) break;
            
            t += d * 0.9;  // Conservative march
          }
          
          return Intersection(false, vec3(0), vec3(0), 0.0, 0);
        }
      `
    };
  }
}

// But we can also have completely different scene types!
class VoxelScene implements Scene {
  readonly type = 'scene' as const;
  readonly id = 'voxel_scene';
  
  voxelData = new Parameter<Texture3D>('voxels', null!, 'u_voxelData');
  
  getShaderCode(): ShaderFragment {
    return {
      uniforms: `
        uniform sampler3D u_voxelData;
      `,
      functions: `
        Intersection sceneIntersect(Ray ray, float maxDist) {
          // DDA voxel traversal
          vec3 voxelPos = floor(ray.origin);
          vec3 step = sign(ray.direction);
          vec3 tDelta = abs(1.0 / ray.direction);
          vec3 tMax = /* compute initial tMax */;
          
          float t = 0.0;
          
          while (t < maxDist) {
            // Sample voxel
            float density = texture(u_voxelData, voxelPos / 128.0).r;
            
            if (density > 0.5) {
              // Hit!
              return Intersection(true, voxelPos + 0.5, /* normal */, t, 0);
            }
            
            // Step to next voxel
            if (tMax.x < tMax.y && tMax.x < tMax.z) {
              voxelPos.x += step.x;
              t = tMax.x;
              tMax.x += tDelta.x;
            } else if (tMax.y < tMax.z) {
              voxelPos.y += step.y;
              t = tMax.y;
              tMax.y += tDelta.y;
            } else {
              voxelPos.z += step.z;
              t = tMax.z;
              tMax.z += tDelta.z;
            }
          }
          
          return Intersection(false, vec3(0), vec3(0), 0.0, 0);
        }
      `
    };
  }
}
```

## The Magic: Shader Assembly

Here's where it all comes together. The engine assembles shaders by:

1. **Collecting all shader fragments**
2. **Checking dependencies**
3. **Building final shader**

```typescript
class ShaderAssembler {
  assemble(components: Component[]): string {
    const fragments: ShaderFragment[] = [];
    const requiredFunctions = new Set<string>();
    let mainLoop = '';
    
    // Collect all shader code and requirements
    for (const component of components) {
      if (this.isShaderProvider(component)) {
        fragments.push(component.getShaderCode());
      }
      
      if (this.isTracer(component)) {
        component.getRequiredFunctions().forEach(f => 
          requiredFunctions.add(f)
        );
        mainLoop = component.getMainLoopCode();
      }
    }
    
    // Verify all required functions are provided
    const providedFunctions = this.extractProvidedFunctions(fragments);
    for (const required of requiredFunctions) {
      if (!providedFunctions.has(required)) {
        throw new Error(`Missing required function: ${required}`);
      }
    }
    
    // Build final shader
    return this.buildShader(fragments, mainLoop);
  }
  
  private buildShader(fragments: ShaderFragment[], mainLoop: string): string {
    const builder = new ShaderBuilder();
    
    // Add common headers
    builder.addLine('#version 300 es');
    builder.addLine('precision highp float;');
    
    // Add common structures
    builder.addLine(`
      struct Ray {
        vec3 origin;
        vec3 direction;
      };
      
      struct Intersection {
        bool valid;
        vec3 position;
        vec3 normal;
        float t;
        int materialId;
      };
      
      struct BSDFSample {
        vec3 wo;
        vec3 f;
        float pdf;
      };
    `);
    
    // Add all fragments
    fragments.forEach(f => builder.addFragment(f));
    
    // Add main function
    builder.addLine('out vec4 outColor;');
    builder.addLine('void main() {');
    builder.addLine(mainLoop);
    builder.addLine('}');
    
    return builder.build();
  }
}
```

## Handling Complex Interactions

What about when components need to interact? Use a **coordinator pattern**:

```typescript
class RenderCoordinator {
  private world: World;
  private photography: Photography;
  private film: Film;
  
  constructor(config: RenderConfig) {
    this.world = config.world;
    this.photography = config.photography;
    this.film = new Film(config.width, config.height);
  }
  
  render(): Image {
    // Progressive rendering loop
    for (let sample = 0; sample < this.photography.samplesPerPixel; sample++) {
      // Render one sample
      this.renderSample(sample);
      
      // Update UI if needed
      if (sample % 10 === 0) {
        this.updatePreview();
      }
    }
    
    return this.film.develop();
  }
  
  private renderSample(sampleIndex: number) {
    // Set uniform for sample index
    this.setUniform('u_sample', sampleIndex);
    
    // Render to framebuffer
    this.renderPass();
    
    // Accumulate in film
    this.film.accumulate(this.getFramebuffer());
  }
}
```

## The Complete Integration Example

Let's see how all these pieces work together:

```typescript
// 1. Create components
const geometry = new HyperbolicGeometry();
const scene = new SDFScene([
  new Sphere(vec3(0, 0, -5), 1),
  new Box(vec3(2, 0, -5), vec3(1, 1, 1))
]);
const camera = new ThinLensCamera();
const tracer = new PathTracer();

// 2. Configure parameters (automatically builds UI)
camera.aperture.set(0.05);
camera.focusDistance.set(5.0);
tracer.maxDepth.set(8);

// 3. Create render configuration
const config: RenderConfig = {
  world: { geometry, scene },
  photography: { camera, tracer },
  width: 1920,
  height: 1080
};

// 4. Engine handles everything else
const engine = new RenderEngine(canvas);
const image = engine.render(config);

// 5. Want to change something? Just swap it
config.world.geometry = new SchwarzschildGeometry();
const newImage = engine.render(config);  // Automatically rebuilds shader
```

## Why This Works for Research

1. **Adding new algorithms is isolated** - Just implement a new Tracer
2. **Parameters are self-documenting** - UI builds itself
3. **Shader caching is automatic** - No manual management
4. **Dependencies are explicit** - Tracer declares what it needs
5. **Testing is simple** - Each component can be tested independently

The key insight: **Let each component own its complexity**, but keep the interfaces dead simple. The engine just orchestrates - it doesn't need to understand the math or algorithms.








## Yes! A Unified Parameter/Uniform System

This is absolutely crucial to get right. Here's a clean design that handles both parameters and uniforms elegantly:

## The Core Insight: Three Types of Values

```typescript
// 1. Parameters: User-facing values that can be changed
// 2. Uniforms: GPU-side values derived from parameters
// 3. Computed values: Derived from multiple parameters

class Parameter<T> {
  private value: T;
  private listeners: Set<(value: T) => void> = new Set();
  
  constructor(
    public readonly name: string,
    initialValue: T,
    public readonly metadata: ParameterMetadata = {}
  ) {
    this.value = initialValue;
  }
  
  get(): T { return this.value; }
  
  set(newValue: T): void {
    if (this.value !== newValue) {
      this.value = newValue;
      this.listeners.forEach(fn => fn(newValue));
    }
  }
  
  onChange(fn: (value: T) => void): void {
    this.listeners.add(fn);
  }
}

interface ParameterMetadata {
  uniform?: string;        // Maps to GPU uniform
  min?: number;           // For UI sliders
  max?: number;
  step?: number;
  category?: string;      // For UI grouping
  visible?: boolean;      // Hidden from UI
  compute?: () => any;    // Computed from other params
}
```

## The Parameter Manager

```typescript
class ParameterManager {
  private parameters = new Map<string, Parameter<any>>();
  private dirtyUniforms = new Set<string>();
  private uniformValues = new Map<string, any>();
  private computedUniforms = new Map<string, () => any>();
  
  // Register a parameter from a component
  register(param: Parameter<any>, owner: Component): void {
    const key = `${owner.id}.${param.name}`;
    this.parameters.set(key, param);
    
    // If it maps to a uniform, track it
    if (param.metadata.uniform) {
      param.onChange(() => {
        this.dirtyUniforms.add(param.metadata.uniform!);
      });
      
      // Set initial value
      this.uniformValues.set(param.metadata.uniform, param.get());
    }
    
    // If it's computed, store the computation
    if (param.metadata.compute) {
      this.computedUniforms.set(param.metadata.uniform!, param.metadata.compute);
    }
  }
  
  // Register all parameters from a component
  registerComponent(component: Component): void {
    // Use reflection or explicit listing
    if ('getParameters' in component) {
      const params = (component as any).getParameters();
      params.forEach((param: Parameter<any>) => {
        this.register(param, component);
      });
    }
  }
  
  // Get all parameters for UI building
  getAllParameters(): Map<string, Parameter<any>> {
    return this.parameters;
  }
  
  // Get parameters by category for organized UI
  getParametersByCategory(): Map<string, Parameter<any>[]> {
    const categories = new Map<string, Parameter<any>[]>();
    
    this.parameters.forEach(param => {
      const category = param.metadata.category || 'General';
      if (!categories.has(category)) {
        categories.set(category, []);
      }
      categories.get(category)!.push(param);
    });
    
    return categories;
  }
}
```

## The Uniform Manager

```typescript
class UniformManager {
  private gl: WebGL2RenderingContext;
  private currentProgram: WebGLProgram | null = null;
  private uniformLocations = new Map<string, WebGLUniformLocation>();
  private textureUnits = new Map<string, number>();
  private nextTextureUnit = 0;
  
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }
  
  // Set up uniforms for a shader program
  setupProgram(program: WebGLProgram, paramManager: ParameterManager): void {
    this.currentProgram = program;
    this.gl.useProgram(program);
    
    // Cache uniform locations
    this.cacheUniformLocations(program);
    
    // Bind all uniforms from parameters
    this.bindAllUniforms(paramManager);
  }
  
  private cacheUniformLocations(program: WebGLProgram): void {
    const numUniforms = this.gl.getProgramParameter(program, this.gl.ACTIVE_UNIFORMS);
    
    for (let i = 0; i < numUniforms; i++) {
      const info = this.gl.getActiveUniform(program, i);
      if (info) {
        const location = this.gl.getUniformLocation(program, info.name);
        if (location) {
          this.uniformLocations.set(info.name, location);
        }
      }
    }
  }
  
  private bindAllUniforms(paramManager: ParameterManager): void {
    paramManager.getAllParameters().forEach(param => {
      if (param.metadata.uniform) {
        this.setUniform(param.metadata.uniform, param.get());
      }
    });
  }
  
  // Set a single uniform
  setUniform(name: string, value: any): void {
    const location = this.uniformLocations.get(name);
    if (!location) return;  // Uniform might not be used in shader
    
    // Handle different types
    if (typeof value === 'number') {
      this.gl.uniform1f(location, value);
    } else if (value instanceof Float32Array) {
      switch(value.length) {
        case 2: this.gl.uniform2fv(location, value); break;
        case 3: this.gl.uniform3fv(location, value); break;
        case 4: this.gl.uniform4fv(location, value); break;
        case 9: this.gl.uniformMatrix3fv(location, false, value); break;
        case 16: this.gl.uniformMatrix4fv(location, false, value); break;
      }
    } else if (value instanceof WebGLTexture) {
      // Handle textures
      if (!this.textureUnits.has(name)) {
        this.textureUnits.set(name, this.nextTextureUnit++);
      }
      const unit = this.textureUnits.get(name)!;
      this.gl.activeTexture(this.gl.TEXTURE0 + unit);
      this.gl.bindTexture(this.gl.TEXTURE_2D, value);
      this.gl.uniform1i(location, unit);
    }
    // Add more types as needed
  }
  
  // Update only dirty uniforms (optimization)
  updateDirtyUniforms(dirtySet: Set<string>, values: Map<string, any>): void {
    dirtySet.forEach(uniformName => {
      const value = values.get(uniformName);
      if (value !== undefined) {
        this.setUniform(uniformName, value);
      }
    });
    dirtySet.clear();
  }
}
```

## Real-World Component Example

Here's how components use this system:

```typescript
class PBRMaterial implements Material {
  readonly type = 'material' as const;
  readonly id = 'pbr';
  
  // Parameters with rich metadata
  albedo = new Parameter('albedo', vec3(0.5, 0.5, 0.5), {
    uniform: 'u_albedo',
    category: 'Material',
  });
  
  metallic = new Parameter('metallic', 0.0, {
    uniform: 'u_metallic',
    category: 'Material',
    min: 0,
    max: 1,
    step: 0.01
  });
  
  roughness = new Parameter('roughness', 0.5, {
    uniform: 'u_roughness',
    category: 'Material',
    min: 0.01,  // Never exactly 0
    max: 1,
    step: 0.01
  });
  
  ior = new Parameter('ior', 1.5, {
    uniform: 'u_ior',
    category: 'Material',
    min: 1,
    max: 3,
    step: 0.01
  });
  
  // Computed uniform - F0 derived from IOR
  f0 = new Parameter('f0', vec3(0.04, 0.04, 0.04), {
    uniform: 'u_f0',
    visible: false,  // Hidden from UI
    compute: () => {
      const n = this.ior.get();
      const f0_scalar = Math.pow((n - 1) / (n + 1), 2);
      return vec3(f0_scalar, f0_scalar, f0_scalar);
    }
  });
  
  constructor() {
    // When IOR changes, update F0
    this.ior.onChange(() => {
      this.f0.set(this.f0.metadata.compute!());
    });
  }
  
  getParameters(): Parameter<any>[] {
    return [this.albedo, this.metallic, this.roughness, this.ior, this.f0];
  }
  
  getShaderCode(): ShaderFragment {
    return {
      uniforms: `
        uniform vec3 u_albedo;
        uniform float u_metallic;
        uniform float u_roughness;
        uniform float u_ior;
        uniform vec3 u_f0;
      `,
      functions: `
        // PBR BRDF implementation using these uniforms
      `
    };
  }
}
```

## The Engine Integration

Here's how it all comes together in the engine:

```typescript
class RenderEngine {
  private paramManager = new ParameterManager();
  private uniformManager: UniformManager;
  private gl: WebGL2RenderingContext;
  
  constructor(canvas: HTMLCanvasElement) {
    this.gl = canvas.getContext('webgl2')!;
    this.uniformManager = new UniformManager(this.gl);
  }
  
  configure(config: RenderConfig): RenderPipeline {
    // Register all component parameters
    this.registerAllComponents(config);
    
    // Build shader
    const shader = this.buildShader(config);
    
    // Set up uniforms
    this.uniformManager.setupProgram(shader, this.paramManager);
    
    // Return pipeline for rendering
    return new RenderPipeline(
      this.gl,
      shader,
      this.paramManager,
      this.uniformManager
    );
  }
  
  private registerAllComponents(config: RenderConfig): void {
    // Register world components
    this.paramManager.registerComponent(config.world.geometry);
    this.paramManager.registerComponent(config.world.scene);
    config.world.materials?.forEach(mat => 
      this.paramManager.registerComponent(mat)
    );
    
    // Register photography components
    this.paramManager.registerComponent(config.photography.camera);
    this.paramManager.registerComponent(config.photography.tracer);
  }
}

class RenderPipeline {
  constructor(
    private gl: WebGL2RenderingContext,
    private shader: WebGLProgram,
    private paramManager: ParameterManager,
    private uniformManager: UniformManager
  ) {}
  
  render(): void {
    // Update any dirty uniforms
    this.uniformManager.updateDirtyUniforms(
      this.paramManager.dirtyUniforms,
      this.paramManager.uniformValues
    );
    
    // Do the actual render
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);  // Fullscreen quad
  }
  
  // Expose parameters for UI
  getParameters() {
    return this.paramManager.getParametersByCategory();
  }
}
```

## Special Cases: Global and Built-in Uniforms

Some uniforms aren't tied to component parameters:

```typescript
class BuiltinUniforms {
  private frame = 0;
  private time = 0;
  private resolution: vec2;
  
  constructor(width: number, height: number) {
    this.resolution = vec2(width, height);
  }
  
  bind(uniformManager: UniformManager): void {
    uniformManager.setUniform('u_frame', this.frame);
    uniformManager.setUniform('u_time', this.time);
    uniformManager.setUniform('u_resolution', this.resolution);
    uniformManager.setUniform('u_random_seed', Math.random());
  }
  
  update(deltaTime: number): void {
    this.frame++;
    this.time += deltaTime;
  }
}
```

## The UI Auto-Generation

The beauty of this system is the UI builds itself:

```typescript
class AutoUI {
  buildFromParameters(paramManager: ParameterManager): void {
    const categories = paramManager.getParametersByCategory();
    
    categories.forEach((params, category) => {
      const folder = this.gui.addFolder(category);
      
      params.forEach(param => {
        if (param.metadata.visible === false) return;
        
        const value = param.get();
        const meta = param.metadata;
        
        if (typeof value === 'number') {
          folder.add(param, 'value', meta.min, meta.max, meta.step)
            .name(param.name)
            .onChange(v => param.set(v));
        } else if (typeof value === 'boolean') {
          folder.add(param, 'value')
            .name(param.name)
            .onChange(v => param.set(v));
        } else if (value instanceof Float32Array && value.length === 3) {
          // Color picker for vec3
          const color = {
            r: value[0] * 255,
            g: value[1] * 255,
            b: value[2] * 255
          };
          folder.addColor(color, 'color')
            .name(param.name)
            .onChange(c => {
              param.set(vec3(c.r/255, c.g/255, c.b/255));
            });
        }
      });
    });
  }
}
```

## Why This Design Works

1. **Single source of truth**: Parameters own their values
2. **Automatic uniform binding**: Just declare the mapping
3. **UI generation**: Metadata drives UI creation
4. **Computed uniforms**: Derived values update automatically
5. **Efficient updates**: Only dirty uniforms are rebound
6. **Type safety**: TypeScript ensures correct types
7. **Debugging**: Can inspect all parameters/uniforms easily

This system is "set and forget" - once built, you just declare parameters on components and everything else happens automatically!
