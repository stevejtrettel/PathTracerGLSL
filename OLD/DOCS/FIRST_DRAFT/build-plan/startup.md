You're right - the math files can just be GLSL directly! Let me create a revised, correct implementation plan:

## Revised Implementation Plan: Minimal Sphere on Plane

### Phase 1: WebGL Foundation (See pixels)

```typescript
// src/index.ts
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2');
if (!gl) throw new Error('WebGL2 not supported');

gl.clearColor(0.2, 0.3, 0.4, 1.0);
gl.clear(gl.COLOR_BUFFER_BIT);
```
✅ **Checkpoint**: Blue canvas visible

### Phase 2: Math Infrastructure (GLSL files)

**Step 2.1: Type definitions**
```glsl
// src/math/types.glsl
// Note: Point and Direction will be defined by geometry module
struct Ray {
  Point o;
  Direction d;
};

struct Hit {
  Point p;
  Direction n;
  float t;
  int material_from;
  int material_to;
  int object_id;
};

struct Frame {
  Direction t;
  Direction b;  
  Direction n;
};
```

**Step 2.2: Core utilities**
```glsl
// src/math/core.glsl
float saturate(float x) {
  return clamp(x, 0.0, 1.0);
}
```

### Phase 3: Basic Engine Structure

**Step 3.1: Types**
```typescript
// src/engine/types.md
export interface ModuleDescriptor {
  id: {
    kind: 'Geometry' | 'Objects' | 'Scene' | 'Material' | 'Camera' | 'Estimator' | 'Film' | 'Developer';
    name: string;
    version: string;
  };
  fragment: {
    functions: string;
    uniforms?: string;
    provides?: string[];
    requires?: string[];
  };
  parameters?: Array<{
    name: string;
    type: 'float' | 'vec2' | 'vec3' | 'int';
    default: any;
  }>;
}

export interface Recipe {
  world: {
    geometry: ModuleDescriptor;
    objects: ModuleDescriptor;
    scene: ModuleDescriptor;
    materials: ModuleDescriptor;
  };
  photography: {
    camera: ModuleDescriptor;
    estimator: ModuleDescriptor;
    film: ModuleDescriptor;
    developer: ModuleDescriptor;
  };
}
```

**Step 3.2: Resource Manager**
```typescript
// src/engine/resources/ResourceManager.ts
export class ResourceManager {
  private triangleVAO: WebGLVertexArrayObject | null = null;
  
  createFullscreenTriangle(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    
    const positions = new Float32Array([-1,-1, 3,-1, -1,3]);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    
    gl.bindVertexArray(null);
    this.triangleVAO = vao;
    return vao;
  }
  
  getVAO(): WebGLVertexArrayObject {
    if (!this.triangleVAO) throw new Error('VAO not created');
    return this.triangleVAO;
  }
}
```

**Step 3.3: Shader Compiler (simplified for v1)**
```typescript
// src/engine/compiler/ShaderCompiler.ts
import mathTypes from '../../math/types.glsl?raw';
import mathCore from '../../math/core.glsl?raw';

export class ShaderCompiler {
  constructor(private gl: WebGL2RenderingContext) {}
  
  compileRecipe(recipe: Recipe): WebGLProgram {
    // 1. Extract modules in order (Geometry first!)
    const modules = [
      recipe.world.geometry,
      recipe.world.objects,
      recipe.world.scene,
      recipe.world.materials,
      recipe.photography.camera,
      recipe.photography.estimator,
      recipe.photography.film,
      recipe.photography.developer
    ];
    
    // 2. Build fragment shader
    const fragmentSrc = this.buildFragmentShader(modules);
    
    // 3. Compile
    const vertexSrc = this.getVertexShader();
    return this.compileProgram(vertexSrc, fragmentSrc);
  }
  
  private buildFragmentShader(modules: ModuleDescriptor[]): string {
    // For v1: Simple concatenation with basic prefixes
    const prefixMap: Record<string, string> = {
      'Geometry': 'g_',
      'Scene': 'sc_',
      'Material': 'm_',
      'Camera': 'c_',
      'Estimator': 'e_',
      'Film': 'f_',
      'Developer': 'd_'
    };
    
    let code = `#version 300 es
precision highp float;
out vec4 fragColor;

// Math infrastructure
${mathCore}
${mathTypes}

// Uniforms
uniform vec2 u_resolution;
uniform vec3 u_camera_pinhole_position;
uniform mat3 u_camera_pinhole_frame;
`;
    
    // Add module code with simple prefix application
    for (const module of modules) {
      const prefix = prefixMap[module.id.kind] || '';
      
      // Add module uniforms (if any)
      if (module.fragment.uniforms) {
        code += `\n// ${module.id.kind} uniforms\n`;
        code += module.fragment.uniforms.replace(
          /uniform\s+(\w+)\s+(\w+);/g, 
          `uniform $1 u_${module.id.kind.toLowerCase()}_${module.id.name}_$2;`
        );
      }
      
      // Add module functions with prefix
      code += `\n// ${module.id.kind} functions\n`;
      code += module.fragment.functions;
      // Note: For v1, we're not doing complex prefix transformation
      // Modules will use the prefixed names directly
    }
    
    // Add main
    code += `
void main() {
  vec2 pixel = gl_FragCoord.xy;
  vec2 xi = vec2(0.5); // No random for v1
  
  Ray ray = c_generate_ray(pixel, xi);
  vec3 radiance = e_estimate(ray);
  vec3 accumulated = f_accumulate(radiance, pixel);
  vec3 color = d_develop(accumulated);
  
  fragColor = vec4(color, 1.0);
}`;
    
    return code;
  }
  
  private getVertexShader(): string {
    return `#version 300 es
layout(location = 0) in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`;
  }
  
  private compileProgram(vertSrc: string, fragSrc: string): WebGLProgram {
    // Standard WebGL compilation...
    // (compile shaders, link program, check errors)
    // Return program
  }
}
```

### Phase 4: Create World Modules

**Step 4.1: Euclidean Geometry**
```typescript
// src/world/geometries/euclidean.ts
export const euclideanGeometry: ModuleDescriptor = {
  id: { kind: 'Geometry', name: 'euclidean', version: '1.0' },
  fragment: {
    functions: `
typedef vec3 Point;
typedef vec3 Direction;

Point g_geodesic(Point origin, Direction dir, float t) {
  return origin + dir * t;
}

float g_dot(Direction a, Direction b, Point p) {
  return dot(a, b);
}

Frame g_frame(Point p, Direction n) {
  Direction t = abs(n.y) < 0.999 ? 
    normalize(cross(vec3(0,1,0), n)) : 
    normalize(cross(vec3(1,0,0), n));
  Direction b = cross(n, t);
  Frame f;
  f.t = t;
  f.b = b;
  f.n = n;
  return f;
}`,
    provides: ['g_geodesic', 'g_dot', 'g_frame']
  }
};
```

**Step 4.2: Objects**
```typescript
// src/world/world/simpleObjects.ts
export const simpleObjects: ModuleDescriptor = {
  id: { kind: 'Objects', name: 'simple', version: '1.0' },
  fragment: {
    functions: `
const int MATERIAL_AIR = 0;
const int MATERIAL_RED = 1;
const int MATERIAL_GRAY = 2;

float sphere_sdf(vec3 p) {
  return length(p - vec3(0.0, 1.0, 0.0)) - 1.0;
}

float plane_sdf(vec3 p) {
  return p.y;
}

int classify_sphere(vec3 p) {
  return sphere_sdf(p) < 0.0 ? MATERIAL_RED : MATERIAL_AIR;
}

int classify_plane(vec3 p) {
  return plane_sdf(p) < 0.0 ? MATERIAL_GRAY : MATERIAL_AIR;
}`,
    provides: ['sphere_sdf', 'plane_sdf', 'classify_sphere', 'classify_plane']
  }
};
```

**Step 4.3: Scene**
```typescript
// src/world/scenes/simpleSDFScene.ts
export const simpleSDFScene: ModuleDescriptor = {
  id: { kind: 'Scene', name: 'sdf', version: '1.0' },
  fragment: {
    functions: `
float scene_sdf(vec3 p) {
  return min(sphere_sdf(p), plane_sdf(p));
}

bool sc_intersect(Ray ray, out Hit hit) {
  float t = 0.01;
  
  for (int i = 0; i < 100; i++) {
    Point p = g_geodesic(ray.o, ray.d, t);
    float d = scene_sdf(p);
    
    if (d < 0.001) {
      hit.p = p;
      hit.t = t;
      
      // Determine object and material
      if (sphere_sdf(p) < plane_sdf(p)) {
        hit.object_id = 0;
        hit.material_to = classify_sphere(p);
      } else {
        hit.object_id = 1;
        hit.material_to = classify_plane(p);
      }
      hit.material_from = MATERIAL_AIR;
      
      // Numerical gradient for normal
      vec2 e = vec2(0.001, 0.0);
      hit.n = normalize(vec3(
        scene_sdf(p + e.xyy) - scene_sdf(p - e.xyy),
        scene_sdf(p + e.yxy) - scene_sdf(p - e.yxy),
        scene_sdf(p + e.yyx) - scene_sdf(p - e.yyx)
      ));
      
      return true;
    }
    
    t += d * 0.9;
    if (t > 100.0) break;
  }
  
  return false;
}`,
    provides: ['sc_intersect'],
    requires: ['sphere_sdf', 'plane_sdf', 'classify_sphere', 'classify_plane', 'g_geodesic']
  }
};
```

### Phase 5: Create Photography Modules

**Step 5.1: Camera**
```typescript
// src/photography/cameras/pinhole.ts
export const pinholeCamera: ModuleDescriptor = {
  id: { kind: 'Camera', name: 'pinhole', version: '1.0' },
  fragment: {
    functions: `
Ray c_generate_ray(vec2 pixel, vec2 xi) {
  vec2 uv = (pixel + xi) / u_resolution - 0.5;
  vec3 local_dir = normalize(vec3(uv.x * 2.0, uv.y * 2.0, -1.0));
  
  Ray ray;
  ray.o = u_camera_pinhole_position;
  ray.d = u_camera_pinhole_frame * local_dir;
  return ray;
}`,
    provides: ['c_generate_ray']
  },
  parameters: [
    { name: 'position', type: 'vec3', default: [0, 2, 5] },
    { name: 'frame', type: 'mat3', default: [1,0,0, 0,1,0, 0,0,1] }
  ]
};
```

**Step 5.2: Other photography modules...**
(Estimator, Film, Developer - similar pattern)

### Phase 6: Wire Up App

**Step 6.1: Engine class**
```typescript
// src/engine/Engine.ts
export class Engine {
  private compiler: ShaderCompiler;
  private resources: ResourceManager;
  private program: WebGLProgram | null = null;
  
  constructor(private gl: WebGL2RenderingContext) {
    this.compiler = new ShaderCompiler(gl);
    this.resources = new ResourceManager();
    this.resources.createFullscreenTriangle(gl);
  }
  
  compileRecipe(recipe: Recipe) {
    this.program = this.compiler.compileRecipe(recipe);
    this.setupUniforms();
  }
  
  private setupUniforms() {
    if (!this.program) return;
    this.gl.useProgram(this.program);
    
    // Set initial uniforms
    const resLoc = this.gl.getUniformLocation(this.program, 'u_resolution');
    this.gl.uniform2f(resLoc, 800, 600);
    
    const posLoc = this.gl.getUniformLocation(this.program, 'u_camera_pinhole_position');
    this.gl.uniform3f(posLoc, 0, 2, 5);
    
    // Identity matrix for camera frame
    const frameLoc = this.gl.getUniformLocation(this.program, 'u_camera_pinhole_frame');
    this.gl.uniformMatrix3fv(frameLoc, false, [1,0,0, 0,1,0, 0,0,1]);
  }
  
  renderFrame() {
    if (!this.program) throw new Error('No program compiled');
    
    this.gl.useProgram(this.program);
    this.gl.bindVertexArray(this.resources.getVAO());
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }
}
```

**Step 6.2: MinimalApp**
```typescript
// src/app/core/MinimalApp.ts
import { Engine } from '../../engine/Engine';
import { Recipe } from '../../engine/types';
// Import all modules...

export class MinimalApp {
  private engine: Engine;
  
  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 not supported');
    
    this.engine = new Engine(gl);
    
    const recipe: Recipe = {
      world: {
        geometry: euclideanGeometry,
        objects: simpleObjects,
        scene: simpleSDFScene,
        materials: constantMaterial
      },
      photography: {
        camera: pinholeCamera,
        estimator: oneshotEstimator,
        film: passthroughFilm,
        developer: clampDeveloper
      }
    };
    
    this.engine.compileRecipe(recipe);
  }
  
  start() {
    const frame = () => {
      this.engine.renderFrame();
      requestAnimationFrame(frame);
    };
    frame();
  }
}
```

✅ **Final result**: Red sphere on gray plane with gradient sky!

This plan properly respects the Recipe structure, uses GLSL files directly for math, and maintains the architectural boundaries while keeping everything minimal.
