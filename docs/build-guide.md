# Build Guide - Research Path Tracer

## Prerequisites

### Development Environment
- Node.js 18+ or modern browser environment
- TypeScript 5+ for type safety
- WebGL2-capable GPU
- Modern IDE with GLSL syntax highlighting

### WebGL2 Requirements
```typescript
// Check capabilities early:
const gl = canvas.getContext('webgl2');
if (!gl) throw new Error('WebGL2 not supported');

// Required extensions:
const required = [
  'EXT_color_buffer_float',    // HDR rendering
  'OES_texture_float_linear'   // Texture filtering
];

for (const ext of required) {
  if (!gl.getExtension(ext)) {
    console.warn(`Missing ${ext}: Using fallback`);
  }
}
```

### Project Structure
```
project/
├── src/
│   ├── math/          # Step 1: Math utilities
│   ├── engine/        # Step 2: Infrastructure
│   ├── world/         # Step 3: Basic modules
│   ├── photography/   # Step 4: Basic modules
│   └── app/          # Step 5: Orchestration
├── shaders/          # GLSL sources
├── assets/           # HDRIs, textures
└── tests/           # Validation
```

## Implementation Order

### Step 1: Math Utilities (No Dependencies)

Start here - these are used everywhere:

```typescript
// math/core.ts - TypeScript utilities
export function clamp(x: number, min: number, max: number): number;
export function mix(a: number, b: number, t: number): number;
```

```glsl
// math/core.glsl - GLSL utilities
float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec3 mix3(vec3 a, vec3 b, float t) { return mix(a, b, t); }

// math/spectrum.glsl - Abstract color type
typedef vec3 Spectrum;
Spectrum spectrum_add(Spectrum a, Spectrum b) { return a + b; }
Spectrum spectrum_scale(Spectrum s, float k) { return s * k; }

// math/sampling.glsl - Automatic dimensions
int g_dimension = 0;
float next_1d() {
  return sample_1d(pixel_id, sample_id, g_dimension++);
}
vec2 next_2d() {
  vec2 result = sample_2d(pixel_id, sample_id, g_dimension);
  g_dimension += 2;
  return result;
}
```

### Step 2: Engine Infrastructure

Build in dependency order:

#### 2.1 Types & Data Structures
```typescript
// engine/types.ts
interface ModuleDescriptor {
  id: { kind: string; name: string; version: string };
  fragment: { functions: string; uniforms?: string };
  provides?: string[];
  requires?: string[];
}

interface CompiledProgram {
  id: string;
  program: WebGLProgram;
  uniformMap: UniformMap;
  recipe: Recipe;
}

interface UniformMapping {
  paramPath: string;      // "camera.position"
  glslName: string;       // "u_camera_pinhole_position"  
  location: WebGLUniformLocation | null;
  type: string;
}
```

#### 2.2 Module Registry
```typescript
// engine/ModuleRegistry.ts
class ModuleRegistry {
  private modules = new Map<string, ModuleDescriptor>();
  
  register(module: ModuleDescriptor) {
    const key = `${module.id.kind}:${module.id.name}`;
    // Validate module contract
    this.validate(module);
    this.modules.set(key, module);
  }
  
  resolve(kind: string, name: string): ModuleDescriptor {
    const key = `${kind}:${name}`;
    const module = this.modules.get(key);
    if (!module) throw new Error(`Module not found: ${key}`);
    return module;
  }
}
```

#### 2.3 Shader Compiler
```typescript
// engine/ShaderCompiler.ts
class ShaderCompiler {
  private programs = new Map<string, CompiledProgram>();
  
  initialize(recipes: Recipe[]) {
    // Compile all recipes at startup
    for (const recipe of recipes) {
      const key = this.getKey(recipe);
      const program = this.compile(recipe);
      this.programs.set(key, program);
    }
  }
  
  private compile(recipe: Recipe): CompiledProgram {
    // 1. Collect modules from recipe
    const modules = this.collectModules(recipe);
    
    // 2. Validate dependencies
    this.validateDependencies(modules);
    
    // 3. Sort (Geometry first)
    const sorted = this.topologicalSort(modules);
    
    // 4. Apply prefixes
    const prefixed = this.applyPrefixes(sorted);
    
    // 5. Generate main()
    const main = this.generateMain();
    
    // 6. Compile GLSL
    const source = this.assembleSource(prefixed, main);
    const program = this.compileGLSL(source);
    
    // 7. Build UniformMap
    const uniformMap = UniformMap.build(modules, program, this.gl);
    
    return { id: generateId(), program, uniformMap, recipe };
  }
}
```

#### 2.4 Resource Manager
```typescript
// engine/ResourceManager.ts
class ResourceManager {
  private capabilities: CapabilityReport;
  
  constructor(gl: WebGL2RenderingContext) {
    this.capabilities = CapabilityChecker.check(gl);
    if (!this.capabilities.floatRenderTargets) {
      console.warn('HDR not available, using LDR fallback');
    }
  }
  
  setupFilmBuffers(manifest: FilmManifest): FilmResources {
    // Check for reuse
    if (this.currentManifest?.equals(manifest)) {
      this.clearBuffers();
      return this.currentResources;
    }
    
    // Allocate new
    const resources = this.createResources(manifest);
    this.currentManifest = manifest;
    return resources;
  }
}
```

#### 2.5 Uniform Binder
```typescript
// engine/UniformBinder.ts
class UniformBinder {
  private uniformMap: UniformMap;
  private pendingChanges = new Map<string, any>();
  
  buildBindings(program: CompiledProgram) {
    this.uniformMap = program.uniformMap;
  }
  
  updateUniforms(changes: ParameterChanges) {
    // Queue changes
    for (const change of changes.changes) {
      this.pendingChanges.set(change.path, change.value);
    }
  }
  
  frameUpdate() {
    // Flush all at once
    for (const [path, value] of this.pendingChanges) {
      const binding = this.uniformMap.getBinding(path);
      if (binding?.location) {
        this.applyUniform(binding, value);
      }
    }
    this.pendingChanges.clear();
  }
}
```

#### 2.6 Render Executor
```typescript
// engine/RenderExecutor.ts
class RenderExecutor {
  private triangleVAO: WebGLVertexArrayObject;
  
  setupGeometry() {
    // Full-screen triangle (3 vertices)
    const vertices = new Float32Array([
      -1, -1,   // Bottom-left
       3, -1,   // Bottom-right (extends past viewport)
      -1,  3    // Top-left (extends past viewport)
    ]);
    // ... create VAO
  }
  
  renderFrame() {
    this.gl.bindVertexArray(this.triangleVAO);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }
}
```

### Step 3: Basic World Modules

Start with simplest implementations:

#### 3.1 Euclidean Geometry
```typescript
// world/geometry/Euclidean.ts
const EuclideanGeometry: ModuleDescriptor = {
  id: { kind: 'Geometry', name: 'Euclidean', version: '1.0.0' },
  provides: ['geodesic', 'dot', 'frame'],
  fragment: {
    functions: `
      typedef vec3 Point;
      typedef vec3 Direction;
      
      Point g_geodesic(Point o, Direction d, float t) {
        return o + d * t;
      }
      
      float g_dot(Direction a, Direction b, Point p) {
        return dot(a, b);
      }
      
      Frame g_frame(Point p, Direction n) {
        Direction up = abs(n.y) < 0.9 ? vec3(0,1,0) : vec3(1,0,0);
        Direction t = normalize(cross(up, n));
        Direction b = cross(n, t);
        return Frame(p, t, b, normalize(n));
      }
    `
  }
};
```

#### 3.2 Simple Objects
```typescript
// world/objects/Sphere.ts
const SphereObject: CompiledObject = {
  distance: `
    float sphere_sdf(vec3 p) {
      return length(p - sphere_center) - sphere_radius;
    }
  `,
  classifier: `
    int classify_sphere(vec3 p) {
      return sphere_sdf(p) < 0.0 ? MATERIAL_DIFFUSE : MATERIAL_AIR;
    }
  `,
  normal: `
    vec3 normal_sphere(vec3 p) {
      return normalize(p - sphere_center);
    }
  `
};
```

#### 3.3 Basic Scene
```typescript
// world/scene/SimpleScene.ts
function generateSimpleScene(objects: CompiledObject[]): ModuleDescriptor {
  return {
    id: { kind: 'Scene', name: 'Simple', version: '1.0.0' },
    provides: ['intersect', 'intersect_any', 'classify_point'],
    fragment: {
      functions: `
        bool sc_intersect(Ray ray, out Hit hit) {
          float t = 0.0;
          for (int i = 0; i < MAX_STEPS && t < ray.tmax; i++) {
            vec3 p = ray.origin + ray.direction * t;
            
            // Evaluate all objects
            float d = MAX_DIST;
            ${objects.map(obj => `d = min(d, ${obj.distance}(p));`).join('\n')}
            
            if (d < EPSILON) {
              // Hit! Build hit structure
              hit = create_hit(t, p, ray.direction);
              return true;
            }
            
            t += d * 0.9; // Conservative
          }
          return false;
        }
      `
    }
  };
}
```

#### 3.4 Lambert Material
```typescript
// world/materials/Lambert.ts
const LambertMaterial: ModuleDescriptor = {
  id: { kind: 'Material', name: 'Lambert', version: '1.0.0' },
  provides: ['interact'],
  fragment: {
    functions: `
      Spectrum m_interact(Direction wi, Hit hit, vec2 xi, 
                          out Direction wo, out float pdf) {
        // Cosine-weighted sampling
        float phi = 2.0 * PI * xi.x;
        float cos_theta = sqrt(xi.y);
        float sin_theta = sqrt(1.0 - xi.y);
        
        wo = hit.frame.t * sin_theta * cos(phi) +
             hit.frame.b * sin_theta * sin(phi) +
             hit.frame.n * cos_theta;
        
        pdf = cos_theta / PI;
        return spectrum_scale(albedo, 1.0 / PI);
      }
    `
  }
};
```

### Step 4: Basic Photography Modules

#### 4.1 Pinhole Camera
```typescript
const PinholeCamera: ModuleDescriptor = {
  id: { kind: 'Camera', name: 'Pinhole', version: '1.0.0' },
  provides: ['generate_ray'],
  fragment: {
    uniforms: `
      uniform mat3 u_camera_frame;
      uniform vec3 u_camera_position;
      uniform float u_camera_tan_fov;
    `,
    functions: `
      Ray c_generate_ray(vec2 pixel, vec2 xi) {
        vec2 ndc = (pixel + xi - 0.5 * u_resolution) / u_resolution.y;
        vec3 dir = u_camera_frame * vec3(ndc * u_camera_tan_fov, 1.0);
        return Ray(u_camera_position, normalize(dir), 0.001, 10000.0);
      }
    `
  }
};
```

#### 4.2 Direct Estimator
```typescript
const DirectEstimator: ModuleDescriptor = {
  id: { kind: 'Estimator', name: 'Direct', version: '1.0.0' },
  provides: ['estimate'],
  requires: ['intersect', 'interact', 'sample_light'],
  fragment: {
    functions: `
      Spectrum e_estimate(Ray ray) {
        Hit hit;
        if (!sc_intersect(ray, hit)) {
          return spectrum_black();
        }
        
        // Direct lighting only
        LightSample ls = l_sample_light(hit.p, next_2d());
        if (ls.pdf > 0.0 && !sc_intersect_any(make_ray(hit.p, ls.wi), ls.dist)) {
          Direction wo;
          float bsdf_pdf;
          Spectrum f = m_interact(-ray.direction, hit, next_2d(), wo, bsdf_pdf);
          return spectrum_scale(f, ls.radiance * abs(g_dot(ls.wi, hit.n, hit.p)) / ls.pdf);
        }
        
        return spectrum_black();
      }
    `
  }
};
```

### Step 5: App Orchestration

#### 5.1 Parameter Store
```typescript
class ParameterStore {
  private parameters = new Map<string, any>();
  onChange?: (changes: ParameterChanges) => void;
  
  set(path: string, value: any) {
    const old = this.get(path);
    this.parameters.set(path, value);
    this.onChange?.({ 
      changes: [{ path, oldValue: old, newValue: value }] 
    });
  }
}
```

#### 5.2 Render Coordinator
```typescript
class RenderCoordinator {
  private resetPrefixes = ['camera.', 'material.', 'scene.'];
  
  handleParameterChange(path: string, oldValue: any, newValue: any) {
    if (this.shouldReset(path)) {
      this.resetAccumulation();
    }
  }
  
  private shouldReset(path: string): boolean {
    return this.resetPrefixes.some(prefix => path.startsWith(prefix));
  }
  
  async runProgressive() {
    while (this.running) {
      await this.engine.renderFrame();
      this.accumulator.increment();
      await this.nextFrame();
    }
  }
}
```

#### 5.3 Main App
```typescript
class ResearchApp {
  constructor(canvas: HTMLCanvasElement) {
    // Known recipes
    this.recipes = {
      test: {
        world: {
          geometry: { kind: 'Geometry', name: 'Euclidean' },
          material: { kind: 'Material', name: 'Lambert' },
          scene: { kind: 'Scene', name: 'Simple' },
          lights: { kind: 'Lights', name: 'Point' }
        },
        photography: {
          camera: { kind: 'Camera', name: 'Pinhole' },
          estimator: { kind: 'Estimator', name: 'Direct' },
          film: { kind: 'Film', name: 'Passthrough' },
          developer: { kind: 'Developer', name: 'Identity' }
        }
      }
    };
    
    // Initialize engine with all recipes
    this.engine = new Engine(canvas);
    this.engine.initializeShaders(Object.values(this.recipes));
    
    // Wire up parameter flow
    this.parameterStore.onChange = (changes) => {
      this.engine.updateUniforms(changes);
      this.renderCoordinator.handleParameterChange(changes);
    };
  }
  
  quickStart() {
    this.switchRecipe('test');
    this.renderCoordinator.start();
  }
}
```

### Step 6: First Triangle!

```typescript
// main.ts
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const app = new ResearchApp(canvas);

// Register basic modules
registry.register(EuclideanGeometry);
registry.register(LambertMaterial);
registry.register(PinholeCamera);
registry.register(DirectEstimator);

// Set initial parameters
app.parameterStore.batch({
  'camera.position': [0, 0, 5],
  'camera.fov': 60,
  'material.albedo': [0.8, 0.2, 0.2]
});

// Start rendering!
app.quickStart();
```

## Integration Patterns

### Module Registration Flow
```
1. Create module descriptor with GLSL
2. Register with ModuleRegistry
3. Reference in Recipe
4. Compiler finds and prefixes
5. Functions available in GPU
```

### Parameter Update Flow
```
Store.set() → onChange → Engine.updateUniforms() → Binder.queue()
                      ↘ Coordinator.checkReset() → resetAccumulation()
Next frame: Binder.frameUpdate() → GPU
```

### Recipe Compilation
```
App defines recipes → Engine.initialize(recipes) → Compile all
User selects → App.switchRecipe() → Engine.getProgram() → Instant
```

## Testing Strategy

### Unit Tests
```typescript
describe('ModuleRegistry', () => {
  test('validates dependencies', () => {
    const module = { requires: ['unknown_function'] };
    expect(() => registry.validate(module)).toThrow();
  });
});
```

### Integration Tests
```typescript
test('renders single sphere', async () => {
  app.switchRecipe('sphere_test');
  await app.renderFrames(10);
  const pixels = await app.engine.readPixels();
  expect(pixels).toMatchSnapshot();
});
```

### Visual Tests
- Normals visualization (should be smooth gradients)
- Material IDs (distinct colors per object)
- Direct lighting (shadows present)
- Accumulation (variance decreases)

## Common Recipes

### Minimal Test
```typescript
{
  world: {
    geometry: 'Euclidean',
    material: 'Lambert',
    scene: 'SingleSphere',
    lights: 'Point'
  },
  photography: {
    camera: 'Pinhole',
    estimator: 'Direct',
    film: 'Passthrough',
    developer: 'Identity'
  }
}
```

### Debug Visualization
```typescript
{
  // ... same world
  photography: {
    camera: 'Pinhole',
    estimator: 'NormalVisualizer', // Special debug estimator
    film: 'Passthrough',
    developer: 'Identity'
  }
}
```

## Debugging Techniques

### Shader Errors
```typescript
// Enhance with line numbers
class ShaderCompiler {
  private addLineNumbers(source: string): string {
    return source.split('\n')
      .map((line, i) => `${i+1}: ${line}`)
      .join('\n');
  }
}
```

### Uniform Inspection
```typescript
// Check what got mapped
app.engine.uniformBinder.getUniformMap().debugPrint();
// Shows: parameter path → GLSL name → has location
```

### Step-by-Step Validation
1. Check WebGL context created
2. Verify extensions available
3. Confirm modules registered
4. Validate recipe compilation
5. Inspect uniform mappings
6. Verify first frame renders
7. Check accumulation works

## Next Steps

After first triangle:
1. Add more geometry (box, torus, CSG)
2. Implement path tracer estimator
3. Add environment lighting
4. Implement glass material
5. Add thin lens camera
6. Build UI extension
7. Add variance tracking film
8. Implement ACES developer
9. Create production renderer
10. Build experiment workflows
