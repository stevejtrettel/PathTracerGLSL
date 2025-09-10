# Plugin Architecture for Modular Path Tracer

## Core Concept

The path tracer uses a **plugin-based architecture** where each mathematical/algorithmic component is a
self-contained plugin that declares what it provides and what it needs.
The engine acts as a thin orchestrator that assembles plugins into a
working renderer.

## Abstract Architecture

### Plugin Contract
Every plugin must:
1. **Declare its namespace** (for uniform/function namespacing)
2. **Provide GLSL code chunks** with explicit dependencies
3. **Declare uniforms** it needs
4. **Expose parameters** for UI/animation

### Plugin Types

```typescript
// Base plugin interface
interface Plugin {
  readonly namespace: string;          // Unique identifier
  readonly type: PluginType;          // What kind of plugin
  
  getGLSLChunks(): GLSLChunk[];      // GLSL contributions
  uniforms(): UniformDeclaration[];   // Uniforms needed
  parameters(): Parameter[];          // Tweakable values
}

// GLSL chunk with dependencies
interface GLSLChunk {
  name: string;                       // e.g., "camera.generateRay"
  dependencies: string[];             // e.g., ["geometry.types", "math.common"]
  source: string;                     // Actual GLSL code
}

// Uniform declaration
interface UniformDeclaration {
  name: string;                       // Local name (unprefixed)
  type: 'float' | 'vec3' | 'mat4' | 'sampler2D' | 'int';
  value: () => any;                   // Function returning current value
}
```

## The Five Plugin Types

### 1. Geometry Platform (Foundation, not a plugin)
```typescript
interface GeometryPlatform {
  getTypeDefs(): string;      // "struct Ray { vec3 origin; vec3 dir; }"
  getOperations(): string;     // "float dot_g(vec3 a, vec3 b) { ... }"
}
```
Provides the mathematical foundation all other plugins build on.

### 2. Camera Plugin
```typescript
interface CameraPlugin extends Plugin {
  type: 'camera';
  // Must provide GLSL function: Ray generateRay(vec2 uv)
}

class PinholeCamera implements CameraPlugin {
  namespace = 'pinhole_camera';
  type = 'camera' as const;
  
  getGLSLChunks(): GLSLChunk[] {
    return [{
      name: 'camera.generateRay',
      dependencies: ['geometry.types'],
      source: `
        Ray generateRay(vec2 uv) {
          vec3 origin = u_pinhole_camera_position;
          vec3 direction = normalize(vec3(
            (uv - 0.5) * u_pinhole_camera_sensorSize,
            -u_pinhole_camera_focalLength
          ));
          return Ray(origin, direction);
        }
      `
    }];
  }
  
  uniforms(): UniformDeclaration[] {
    return [
      { name: 'position', type: 'vec3', value: () => this.position },
      { name: 'focalLength', type: 'float', value: () => this.focalLength },
      { name: 'sensorSize', type: 'vec2', value: () => this.sensorSize }
    ];
  }
}
```

### 3. Integrator Plugin (Contains Estimator + Pattern + Accumulation)
```typescript
interface IntegratorPlugin extends Plugin {
  type: 'integrator';
  // Must provide GLSL function: vec3 integrate(vec2 fragCoord)
}

class MonteCarloIntegrator implements IntegratorPlugin {
  namespace = 'mc_integrator';
  type = 'integrator' as const;
  
  constructor(
    private estimator: Estimator,        // What we're integrating
    private pattern: SamplePattern,      // How we sample
    private accumulation: AccumulationPolicy  // How we accumulate
  ) {}
  
  getGLSLChunks(): GLSLChunk[] {
    return [
      // Include sub-component chunks
      ...this.estimator.getGLSLChunks(),
      ...this.pattern.getGLSLChunks(),
      ...this.accumulation.getGLSLChunks(),
      
      // Main integration
      {
        name: 'integrator.integrate',
        dependencies: ['estimator.estimate', 'pattern.init', 'accumulation.accumulate'],
        source: `
          vec3 integrate(vec2 fragCoord) {
            uint rng = initRNG(fragCoord, u_frame);
            Ray ray = generateRay(fragCoord / u_resolution);
            vec3 sample = estimate(ray, rng);
            vec3 history = texture(u_accumBuffer, fragCoord / u_resolution).rgb;
            return accumulate(sample, history, u_sampleCount);
          }
        `
      }
    ];
  }
  
  uniforms(): UniformDeclaration[] {
    // Merge uniforms from sub-components with prefixing
    return [
      ...this.estimator.uniforms().map(u => ({
        ...u,
        name: `estimator_${u.name}`
      })),
      ...this.pattern.uniforms().map(u => ({
        ...u,
        name: `pattern_${u.name}`
      })),
      ...this.accumulation.uniforms().map(u => ({
        ...u,
        name: `accumulation_${u.name}`
      }))
    ];
  }
}
```

### 4. Display Plugin
```typescript
interface DisplayPlugin extends Plugin {
  type: 'display';
  // Must provide GLSL function: vec3 display(vec3 hdr)
}

class ACESDisplay implements DisplayPlugin {
  namespace = 'aces';
  type = 'display' as const;
  
  getGLSLChunks(): GLSLChunk[] {
    return [{
      name: 'display.tonemap',
      dependencies: [],
      source: `
        vec3 display(vec3 hdr) {
          // ACES tone mapping curve
          const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
          vec3 x = hdr;
          return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
        }
      `
    }];
  }
}
```

### 5. Controls Plugin
```typescript
interface ControlsPlugin extends Plugin {
  type: 'controls';
  
  onMouseMove(dx: number, dy: number): void;
  onKeyPress(key: string): void;
  update(dt: number): void;
}

class OrbitControls implements ControlsPlugin {
  namespace = 'orbit';
  type = 'controls' as const;
  
  constructor(private camera: CameraPlugin) {}
  
  onMouseMove(dx: number, dy: number) {
    this.theta += dx * 0.01;
    this.phi = clamp(this.phi + dy * 0.01, -PI/2, PI/2);
    this.updateCameraPosition();
  }
  
  // No GLSL contribution - controls are CPU-side only
  getGLSLChunks() { return []; }
  uniforms() { return []; }
}
```

## Engine Assembly

The engine collects all plugins and assembles the final shader:

```typescript
class PathTracerEngine {
  private plugins: Plugin[] = [];
  private shaderProgram: WebGLProgram;
  
  use(plugin: Plugin): this {
    this.plugins.push(plugin);
    return this;
  }
  
  build() {
    // 1. Resolve dependencies and order GLSL chunks
    const resolver = new DependencyResolver();
    for (const plugin of this.plugins) {
      for (const chunk of plugin.getGLSLChunks()) {
        resolver.addChunk(chunk);
      }
    }
    const orderedChunks = resolver.resolve();
    
    // 2. Collect and namespace uniforms
    const uniforms = [];
    for (const plugin of this.plugins) {
      for (const uniform of plugin.uniforms()) {
        uniforms.push({
          ...uniform,
          name: `u_${plugin.namespace}_${uniform.name}`  // Prefix with namespace
        });
      }
    }
    
    // 3. Assemble final shader
    const fragmentShader = `
      precision highp float;
      
      // Geometry platform types (always first)
      ${this.geometry.getTypeDefs()}
      ${this.geometry.getOperations()}
      
      // Uniforms
      ${uniforms.map(u => `uniform ${u.type} ${u.name};`).join('\n')}
      
      // Common uniforms
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform int u_frame;
      uniform sampler2D u_accumBuffer;
      
      // Plugin code (dependency-ordered)
      ${orderedChunks.join('\n\n')}
      
      // Main render loop
      void main() {
        vec3 color = integrate(gl_FragCoord.xy);
        color = display(color);
        gl_FragColor = vec4(color, 1.0);
      }
    `;
    
    this.shaderProgram = compileShader(vertexShader, fragmentShader);
  }
  
  render() {
    // Update uniforms from all plugins
    for (const plugin of this.plugins) {
      for (const uniform of plugin.uniforms()) {
        const location = gl.getUniformLocation(
          this.shaderProgram, 
          `u_${plugin.namespace}_${uniform.name}`
        );
        setUniform(location, uniform.type, uniform.value());
      }
    }
    
    // Render fullscreen quad
    drawFullscreenQuad();
  }
}
```

## Usage Examples

### Simple Path Tracer
```typescript
const engine = new PathTracerEngine()
  .geometry(new EuclideanGeometry())
  .use(new PinholeCamera({ fov: 60 }))
  .use(new MonteCarloIntegrator(
    new PathTracingEstimator({ maxBounces: 5 }),
    new UniformPattern(),
    new SimpleAccumulation()
  ))
  .use(new ACESDisplay())
  .use(new OrbitControls())
  .build();

engine.render();
```

### Debug Normals Visualizer
```typescript
const engine = new PathTracerEngine()
  .geometry(new EuclideanGeometry())
  .use(new PinholeCamera({ fov: 60 }))
  .use(new MonteCarloIntegrator(
    new NormalsEstimator(),      // Different estimator
    new UniformPattern(),
    new SingleShotAccumulation()  // No temporal accumulation
  ))
  .use(new PassthroughDisplay())  // No tone mapping needed
  .use(new OrbitControls())
  .build();
```

### High Quality Render
```typescript
const engine = new PathTracerEngine()
  .geometry(new EuclideanGeometry())
  .use(new ThinLensCamera({ 
    focalLength: 50,
    aperture: 1.4,
    focusDistance: 2.0 
  }))
  .use(new MonteCarloIntegrator(
    new PathTracingEstimator({ 
      maxBounces: 10,
      enableNEE: true 
    }),
    new SobolPattern(),           // Better sampling
    new VarianceWeightedAccumulation()  // Smart accumulation
  ))
  .use(new ACESDisplay())
  .use(new OrbitControls())
  .build();
```

## Key Benefits

1. **Modularity**: Each plugin is self-contained with clear responsibilities
2. **No conflicts**: Automatic namespacing prevents uniform/function collisions
3. **Dependency management**: Explicit dependencies ensure correct shader assembly
4. **Type safety**: TypeScript interfaces catch errors at compile time
5. **Extensibility**: Easy to add new cameras, estimators, displays without touching core
6. **Mathematical clarity**: Code structure mirrors mathematical concepts

## How It Handles Edge Cases

### Switching between renderers
```typescript
// Just swap the integrator
engine.replacePlugin('integrator', new MonteCarloIntegrator(
  debugMode ? new NormalsEstimator() : new PathTracingEstimator(),
  pattern,
  accumulation
));
```

### Different geometries
```typescript
// Geometry is foundational - requires rebuild
const hyperbolicEngine = new PathTracerEngine()
  .geometry(new HyperbolicGeometry())  // Everything compiles for this geometry
  .use(camera)
  .use(integrator)
  // ... rest stays the same
```

### Complex materials
```typescript
// Materials aren't plugins - they're data the estimator uses
class PathTracingEstimator {
  getGLSLChunks() {
    return [{
      source: `
        vec3 estimate(Ray ray, inout uint rng) {
          Hit hit = intersectScene(ray);
          Material mat = getMaterial(hit.materialId);
          
          // Material evaluation happens inside estimator
          vec3 brdf = evalBRDF(mat, wi, wo);
          // ...
        }
      `
    }];
  }
}
```

This architecture provides maximum flexibility while maintaining clean separation
of concerns and preventing the naming conflicts that plague monolithic renderers.
