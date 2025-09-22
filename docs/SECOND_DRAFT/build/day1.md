# Day 1 Build: Minimal Working Path Tracer

## Goal

Get a real path-traced sphere on screen by end of day. Not a test pattern, not a hardcoded color - actual rays going through actual modules producing actual pixels.

## What We're Building

**Visual target**: A colored sphere on colored background, rendered via path tracing  
**Technical target**: App → Engine → Modules → GPU → Pixels  
**Success metric**: Can change sphere color via parameter and see it update

## Required Components

### Core System Files (Morning - 4 hours)

```
src/
  app/
    App.ts                    // Orchestrator
    ParameterStore.ts         // Simple key-value store
    
  engine/
    Engine.ts                 // Simplified but real
    types.ts                  // Only essential types
    RenderExecutor.ts         // Triangle + draw
    UniformBinder.ts          // Basic uniform updates
    
  world/
    modules/
      EuclideanGeometry.ts    // Real geometry module
      SolidColorMaterial.ts   // Real material module
      
  photography/
    modules/
      PinholeCamera.ts        // Real camera module
      SimpleEstimator.ts      // Real estimator module
```

### Absolute Minimum Implementation

#### 1. App.ts (30 minutes)
```typescript
export class App {
  private engine: Engine;
  private parameters: ParameterStore;
  private canvas: HTMLCanvasElement;
  private frameCount = 0;
  
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 required');
    
    this.parameters = new ParameterStore();
    this.engine = new Engine(gl);
    
    // Hardcode initial recipe for day 1
    this.engine.loadModules({
      geometry: EuclideanGeometry,
      material: SolidColorMaterial,
      camera: PinholeCamera,
      estimator: SimpleEstimator
    });
  }
  
  render(): void {
    // Update any changed parameters
    const changes = this.parameters.getChanges();
    if (changes) {
      this.engine.updateUniforms(changes);
    }
    
    // Render frame
    this.engine.renderFrame();
    this.frameCount++;
  }
  
  setParameter(path: string, value: any): void {
    this.parameters.set(path, value);
  }
}
```

#### 2. ParameterStore.ts (20 minutes)
```typescript
export class ParameterStore {
  private values = new Map<string, any>();
  private changed = new Map<string, any>();
  
  set(path: string, value: any): void {
    const old = this.values.get(path);
    this.values.set(path, value);
    this.changed.set(path, { old, new: value });
  }
  
  getChanges(): ParameterChanges | null {
    if (this.changed.size === 0) return null;
    
    const changes = Array.from(this.changed.entries()).map(([path, vals]) => ({
      path,
      oldValue: vals.old,
      newValue: vals.new,
      timestamp: Date.now()
    }));
    
    this.changed.clear();
    return { changes, source: 'user', triggersReset: false };
  }
}
```

#### 3. Engine.ts - Day 1 Version (60 minutes)
```typescript
export class Engine {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private executor: RenderExecutor;
  private uniforms: UniformBinder;
  private frameCount = 0;
  
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.executor = new RenderExecutor(gl);
    this.uniforms = new UniformBinder(gl);
  }
  
  loadModules(modules: Day1Modules): void {
    // Day 1: Just concatenate modules and compile
    const vertexSource = MINIMAL_VERTEX_SHADER;
    const fragmentSource = this.assembleFragmentShader(modules);
    
    this.program = this.compileAndLink(vertexSource, fragmentSource);
    this.gl.useProgram(this.program);
    
    // Build uniform bindings
    this.uniforms.buildBindings(this.program, modules);
  }
  
  private assembleFragmentShader(modules: Day1Modules): string {
    // Day 1: No prefixing, just concatenate in order
    return `
      #version 300 es
      precision highp float;
      
      // Base types from Geometry
      ${modules.geometry.source}
      
      // Material functions
      ${modules.material.source}
      
      // Camera functions
      ${modules.camera.source}
      
      // Estimator functions
      ${modules.estimator.source}
      
      // Engine uniforms
      uniform vec2 u_resolution;
      uniform int u_frame_index;
      
      // Output
      out vec4 fragColor;
      
      // Main
      void main() {
        vec2 pixel = gl_FragCoord.xy;
        vec2 xi = vec2(0.5);  // No AA on day 1
        
        Ray ray = generate_ray(pixel, xi);
        vec3 radiance = estimate(ray);
        vec3 color = clamp(radiance, 0.0, 1.0);
        
        fragColor = vec4(color, 1.0);
      }
    `;
  }
  
  renderFrame(): void {
    // Update engine uniforms
    this.uniforms.frameUpdate({
      width: this.gl.canvas.width,
      height: this.gl.canvas.height,
      frameIndex: this.frameCount,
      sampleCount: this.frameCount,
      time: performance.now() / 1000
    });
    
    // Draw
    this.executor.renderFrame();
    this.frameCount++;
  }
  
  updateUniforms(changes: ParameterChanges): void {
    this.uniforms.queueUpdates(changes);
  }
}
```

#### 4. EuclideanGeometry.ts - Real Module (30 minutes)
```typescript
export const EuclideanGeometry = {
  source: `
    struct Ray {
      vec3 origin;
      vec3 direction;
    };
    
    struct Hit {
      float t;
      vec3 point;
      vec3 normal;
    };
    
    // Simple sphere intersection for day 1
    bool intersect_sphere(Ray ray, out Hit hit) {
      vec3 center = vec3(0.0, 0.0, 0.0);
      float radius = 1.0;
      
      vec3 oc = ray.origin - center;
      float a = dot(ray.direction, ray.direction);
      float b = 2.0 * dot(oc, ray.direction);
      float c = dot(oc, oc) - radius * radius;
      
      float discriminant = b * b - 4.0 * a * c;
      if (discriminant < 0.0) return false;
      
      float t = (-b - sqrt(discriminant)) / (2.0 * a);
      if (t < 0.001) return false;
      
      hit.t = t;
      hit.point = ray.origin + ray.direction * t;
      hit.normal = normalize(hit.point - center);
      
      return true;
    }
  `,
  parameters: []
};
```

#### 5. SolidColorMaterial.ts - Real Module (20 minutes)
```typescript
export const SolidColorMaterial = {
  source: `
    uniform vec3 u_material_color;
    
    vec3 evaluate_material(vec3 wi, vec3 wo, Hit hit) {
      // Simple Lambertian for day 1
      float NdotL = max(dot(hit.normal, wo), 0.0);
      return u_material_color * NdotL;
    }
  `,
  parameters: [
    { name: 'color', type: 'vec3', default: [1.0, 0.5, 0.5] }
  ]
};
```

#### 6. PinholeCamera.ts - Real Module (20 minutes)
```typescript
export const PinholeCamera = {
  source: `
    Ray generate_ray(vec2 pixel, vec2 xi) {
      vec2 ndc = (pixel / u_resolution) * 2.0 - 1.0;
      ndc.x *= u_resolution.x / u_resolution.y;  // Aspect ratio
      
      Ray ray;
      ray.origin = vec3(0.0, 0.0, 3.0);
      ray.direction = normalize(vec3(ndc * 0.5, -1.0));
      
      return ray;
    }
  `,
  parameters: []
};
```

#### 7. SimpleEstimator.ts - Real Module (30 minutes)
```typescript
export const SimpleEstimator = {
  source: `
    vec3 estimate(Ray ray) {
      Hit hit;
      
      if (intersect_sphere(ray, hit)) {
        // Fake light direction for day 1
        vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0));
        vec3 wi = -ray.direction;
        return evaluate_material(wi, lightDir, hit);
      }
      
      // Sky color
      return vec3(0.5, 0.7, 1.0);
    }
  `,
  parameters: []
};
```

### Afternoon: Get It Running (4 hours)

#### 8. RenderExecutor.ts (45 minutes)
```typescript
export class RenderExecutor {
  private gl: WebGL2RenderingContext;
  private triangleVAO: WebGLVertexArrayObject;
  
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.setupGeometry();
  }
  
  private setupGeometry(): void {
    const vertices = new Float32Array([
      -1, -1,
       3, -1,
      -1,  3
    ]);
    
    this.triangleVAO = this.gl.createVertexArray()!;
    this.gl.bindVertexArray(this.triangleVAO);
    
    const vbo = this.gl.createBuffer()!;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, vbo);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);
    
    this.gl.enableVertexAttribArray(0);
    this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 0, 0);
    
    this.gl.bindVertexArray(null);
  }
  
  renderFrame(): void {
    this.gl.bindVertexArray(this.triangleVAO);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
    this.gl.bindVertexArray(null);
  }
}
```

#### 9. UniformBinder.ts - Minimal (45 minutes)
```typescript
export class UniformBinder {
  private gl: WebGL2RenderingContext;
  private locations = new Map<string, WebGLUniformLocation | null>();
  private pending = new Map<string, any>();
  
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }
  
  buildBindings(program: WebGLProgram, modules: Day1Modules): void {
    // Get engine uniforms
    this.locations.set('resolution', 
      this.gl.getUniformLocation(program, 'u_resolution'));
    this.locations.set('frame_index',
      this.gl.getUniformLocation(program, 'u_frame_index'));
    
    // Get material uniforms (day 1: hardcoded)
    this.locations.set('material.color',
      this.gl.getUniformLocation(program, 'u_material_color'));
  }
  
  queueUpdates(changes: ParameterChanges): void {
    for (const change of changes.changes) {
      this.pending.set(change.path, change.newValue);
    }
  }
  
  frameUpdate(state: EngineStateInfo): void {
    // Update engine uniforms
    const resLoc = this.locations.get('resolution');
    if (resLoc) {
      this.gl.uniform2f(resLoc, state.width, state.height);
    }
    
    const frameLoc = this.locations.get('frame_index');
    if (frameLoc) {
      this.gl.uniform1i(frameLoc, state.frameIndex);
    }
    
    // Update pending parameters
    for (const [path, value] of this.pending) {
      const loc = this.locations.get(path);
      if (loc) {
        if (Array.isArray(value) && value.length === 3) {
          this.gl.uniform3fv(loc, value);
        }
      }
    }
    
    this.pending.clear();
  }
}
```

#### 10. index.html - Test Page (15 minutes)
```html
<!DOCTYPE html>
<html>
<head>
  <title>Day 1 Path Tracer</title>
  <style>
    body { margin: 0; background: #222; }
    canvas { display: block; }
    #controls {
      position: absolute;
      top: 10px;
      left: 10px;
      color: white;
    }
  </style>
</head>
<body>
  <canvas id="canvas" width="800" height="600"></canvas>
  <div id="controls">
    <label>
      Material Color:
      <input type="color" id="colorPicker" value="#ff8080">
    </label>
  </div>
  
  <script type="module">
    import { App } from './build/app/App.js';
    
    const canvas = document.getElementById('canvas');
    const app = new App(canvas);
    
    // Handle color changes
    document.getElementById('colorPicker').addEventListener('input', (e) => {
      const hex = e.target.value;
      const r = parseInt(hex.substr(1,2), 16) / 255;
      const g = parseInt(hex.substr(3,2), 16) / 255;
      const b = parseInt(hex.substr(5,2), 16) / 255;
      app.setParameter('material.color', [r, g, b]);
    });
    
    // Render loop
    function animate() {
      app.render();
      requestAnimationFrame(animate);
    }
    animate();
  </script>
</body>
</html>
```

## Build Order

### Morning (4 hours)
1. **Set up project structure** (30 min)
    - Create directories
    - Set up TypeScript config
    - Verify build works

2. **Core types** (30 min)
    - Only what's needed for day 1
    - Ray, Hit, EngineState

3. **RenderExecutor** (45 min)
    - Triangle geometry
    - Basic draw call

4. **Write modules** (45 min)
    - EuclideanGeometry
    - SolidColorMaterial
    - PinholeCamera
    - SimpleEstimator

5. **Basic Engine** (60 min)
    - Load and concatenate modules
    - Compile shaders
    - No pipeline yet

6. **UniformBinder** (45 min)
    - Hardcoded uniform locations
    - Basic updates

### Afternoon (4 hours)
1. **App class** (30 min)
    - Wire everything together

2. **ParameterStore** (20 min)
    - Simple parameter tracking

3. **Debug compilation errors** (60 min)
    - This always takes time

4. **Get sphere rendering** (60 min)
    - Fix intersection math
    - Fix camera setup

5. **Add color control** (30 min)
    - Wire up parameter changes

6. **Test and polish** (60 min)
    - Make sure it's stable

## What We're NOT Doing Day 1

- ❌ Module registry
- ❌ Compilation pipeline
- ❌ Prefixing
- ❌ Resource management
- ❌ Film accumulation
- ❌ Multiple recipes
- ❌ State machine
- ❌ Error handling
- ❌ Performance tracking

## Success Criteria

By end of day 1, you should have:
- ✅ A colored sphere on screen
- ✅ Blue background
- ✅ Can change sphere color with UI
- ✅ Real path tracing (ray → intersection → material → color)
- ✅ Clean architecture ready for expansion

## Common Day 1 Issues

| Problem | Solution |
|---------|----------|
| Black screen | Check camera position and direction |
| No sphere | Intersection math - check discriminant |
| Shader errors | Start with simpler shaders, add complexity |
| Uniforms not updating | Check useProgram is called first |
| Wrong colors | Check color space (0-1 not 0-255) |

## Day 2 Preview

Once day 1 works, day 2 adds:
- Module registry
- Basic compilation pipeline
- Multiple materials
- Film accumulation
- Scene module separation

But first, get day 1 working. Real pixels from real path tracing by end of day.
