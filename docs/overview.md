# Research Path Tracer: Complete Architecture

## Table of Contents
1. [Core Vision](#core-vision)
2. [System Architecture](#system-architecture)
3. [The Four Pillars](#the-four-pillars)
4. [Module Contracts](#module-contracts)
5. [Workflows](#workflows)
6. [Implementation Roadmap](#implementation-roadmap)
7. [Technical Reference](#technical-reference)

---

## Core Vision

### Philosophy
**Mathematics First**: The code you write mirrors the equations in your paper. All GPU plumbing, shader compilation, and resource management is hidden. When implementing a BSDF, you write the BSDF equation. When implementing hyperbolic geometry, you write the metric tensor.

### Primary Use Cases

**Research Mode**: Algorithm development and validation
- Write new integrators, materials, geometries
- Compare rendering techniques side-by-side
- Gather convergence data
- Validate against reference implementations

**Production Mode**: Creating final images
- Design scenes with SDFs or loaded meshes
- Fine-tune lighting and materials
- Render publication-quality figures
- Generate artistic imagery

### Design Principles

1. **Deterministic Execution**: Same inputs → same pixels, always
2. **Clear Contracts**: Every module knows exactly what it must provide and what it can use
3. **Zero Magic**: Explicit over implicit, documented over inferred
4. **Fail Correctly**: Clear errors when something's wrong, no silent failures
5. **Interchangeable Parts**: Any camera + any integrator, any geometry + any material

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                         USER CODE                            │
│                   (Research & Creative)                      │
├────────────┬─────────────────────┬───────────────────────────┤
│            │                     │                           │
│   World    │   Photography       │   Extensions              │
│            │                     │                           │
│ Geometry   │   Camera            │   Controls                │
│ Materials  │   Integrator        │   UI                      │
│ Scene      │   Film              │   Analysis                │
│ Lights     │   Developer         │   Export                  │
└────────────┴─────────────────────┴───────────────────────────┘
                           │
                    Module Descriptors
                           │
┌──────────────────────────▼───────────────────────────────────┐
│                          APP                                 │
│                    (Orchestration)                           │
├───────────────────────────────────────────────────────────────┤
│ • Module composition → Recipes                               │
│ • Workflow management (research & production modes)          │
│ • Parameter coordination                                     │
│ • State management (current world/photographer)              │
│ • Extension hosting                                          │
└───────────────────────────────────────────────────────────────┘
                           │
                        Recipe
                           │
┌──────────────────────────▼───────────────────────────────────┐
│                        ENGINE                                │
│                  (Boring Infrastructure)                     │
├───────────────────────────────────────────────────────────────┤
│ • Shader compilation with automatic prefixing                │
│ • Contract validation                                        │
│ • GL resource management                                     │
│ • Film buffers (accumulation/swap)                          │
│ • Parameter binding                                          │
│ • Render loop execution                                      │
└───────────────────────────────────────────────────────────────┘
                           │
                        WebGL2
                           │
                        Pixels
```

### Data Flow

```
1. User writes mathematics (modules)
   ↓
2. App composes modules into recipe
   ↓
3. Engine compiles and validates
   ↓
4. Engine executes render loop
   ↓
5. Pixels to screen/file
```

---

## The Four Pillars

### Pillar 1: Engine (Infrastructure)

**Purpose**: Handle all GPU orchestration and shader machinery  
**Principle**: Boring, deterministic, invisible during research  
**Changes**: Never (once working)

```typescript
interface Engine {
  // Core rendering
  render(width: number, height: number, recipe: AssemblyRecipe): RenderOutcome;
  
  // State management
  getParameterStore(): ParameterStore;
  setResourceDirectory(resources: ResourceDirectory): void;
  
  // Film access
  getFilmBuffers(): FilmBuffers;
  clearAccumulation(): void;
  
  // Lifecycle
  pause(): void;
  resume(): void;
  reset(): void;
}
```

**Engine Responsibilities**:
- **Shader Compilation**: Transform modules → GLSL with automatic prefixing
- **Contract Validation**: Ensure all required functions are provided
- **Uniform Management**: Auto-prefix parameters (pos → u_camera_pinhole_pos)
- **Resource Binding**: Texture units, samplers, buffers
- **Film Management**: Accumulation buffers, ping-pong, clear on parameter change
- **Built-in Types**: Provide Ray, Hit, Frame structs to all shaders
- **Error Reporting**: Clear messages when contracts aren't met

**Engine Does NOT**:
- Know about specific geometries, materials, or algorithms
- Make rendering decisions
- Handle user input
- Manage scene descriptions

### Pillar 2: App (Orchestration)

**Purpose**: Coordinate research and production workflows  
**Principle**: User's command center for experiments and rendering  
**Changes**: When adding new workflows

```typescript
interface App {
  // Configuration
  loadWorld(world: World): void;
  setPhotographer(photographer: Photography): void;
  
  // Rendering control
  start(): void;
  stop(): void;
  reset(): void;
  
  // Render modes
  setMode(mode: 'realtime' | 'convergent'): void;
  async renderSamples(count: number): Promise<void>;
  async renderUntilConverged(threshold: number): Promise<void>;
  
  // Research workflows
  async comparePhotographers(photos: Photography[]): Promise<Comparison>;
  async parameterSweep(configs: SweepConfig[]): Promise<SweepResults>;
  
  // Parameters
  parameters: ParameterInterface;
  
  // Import/Export
  async saveImage(filename: string, format: 'exr' | 'png'): Promise<void>;
  loadPreset(name: string): void;
  saveConfiguration(name: string): void;
  
  // Extensions
  use(extension: Extension): void;
}
```

**App Responsibilities**:
- **Module Selection**: Maintain current world/photographer configuration
- **Recipe Building**: Combine modules based on current selection
- **State Management**: Track what's loaded, what's changed
- **Workflow Support**: A/B testing, parameter sweeps, convergence
- **Extension Hosting**: Controls, UI, analysis plugins
- **Mode Management**: Switch between realtime/convergent rendering

### Pillar 3: World (Mathematical Content)

**Purpose**: Define the space and everything in it  
**Principle**: Write differential geometry and material physics  
**Changes**: Every research project

```typescript
interface World {
  // Module provision
  getModules(): ModuleDescriptor[];  // Geometry + Materials + Lights
  
  // Scene description
  getScene(): Scene;  // Object placements, material assignments
  
  // Resources
  getResources(): ResourceDirectory;  // Textures, environment maps
  
  // Metadata
  getName(): string;
  getDescription(): string;
  getRequiredFeatures(): string[];  // What this world needs from photography
}
```

**World Provides**:

#### Geometry (Required)
```glsl
// Every geometry MUST provide:
vec3 g_geodesic(vec3 origin, vec3 direction, float t)
float g_dot(vec3 v1, vec3 v2, vec3 point)
mat3 g_parallel_transport(vec3 from_point, vec3 to_point)
Frame g_frame(vec3 point, vec3 normal)

// Geometry MAY provide:
float g_distance(vec3 p1, vec3 p2)
vec3 g_exp_map(vec3 point, vec3 tangent)
vec3 g_log_map(vec3 from, vec3 to)
```

#### Materials (Required per material type)
```glsl
// Every material MUST provide:
vec3 m_eval(vec3 wi, vec3 wo, Hit hit)
vec3 m_sample(vec3 wi, Hit hit, vec2 rand, out float pdf)
float m_pdf(vec3 wi, vec3 wo, Hit hit)

// Materials use from geometry:
g_dot() for angle calculations
g_frame() for tangent space
```

#### Scene (Required)
```glsl
// The scene MUST provide:
bool s_intersect(Ray ray, out Hit hit)
vec3 s_get_material_params(int material_id, int param_id)

// Scene MAY provide:
float s_distance_bound(vec3 point)  // For sphere tracing
bool s_any_hit(Ray ray, float max_t)  // For shadows
```

### Pillar 4: Photography (Observation Methods)

**Purpose**: Define how we observe and integrate light  
**Principle**: Write rendering algorithms as they appear in papers  
**Changes**: When exploring new techniques

```typescript
interface Photography {
  // Module provision
  getModules(): ModuleDescriptor[];  // Camera + Integrator + Film + Developer
  
  // Configuration
  getEntry(): EntryPoint;  // Main shader function
  getRenderMode(): 'realtime' | 'convergent';
  
  // Capabilities
  supportsAccumulation(): boolean;
  getRequiredWorldFeatures(): string[];  // What geometry/material functions needed
  
  // Metadata
  getName(): string;
  getDescription(): string;
}
```

**Photography Provides**:

#### Camera (Required)
```glsl
// Every camera MUST provide:
Ray c_generate_ray(vec2 pixel, vec2 sample_offset)

// Camera MAY provide:
float c_ray_pdf(Ray ray)
vec2 c_ray_differential(vec2 pixel)
```

#### Integrator (Required)
```glsl
// Every integrator MUST provide:
vec3 i_integrate(vec2 pixel)  // Main entry point

// Integrator uses from world:
s_intersect() for ray-scene queries
m_eval(), m_sample() for materials
g_geodesic() for ray marching

// Integrator MAY provide film strategy:
vec3 i_accumulate(vec3 new_sample, vec3 old_value, int count)
```

#### Film (Optional, Engine provides default)
```glsl
// Film strategy MAY override:
vec3 f_accumulate(vec3 new, vec3 old, int count)
float f_compute_variance(vec3 color, int count)
bool f_should_continue(float variance, int count)
```

#### Developer (Optional)
```glsl
// Developer MAY provide:
vec3 d_tonemap(vec3 hdr_color)
vec3 d_postprocess(vec3 color)
```

---

## Module Contracts

### Contract Documentation Structure

Each module type has a contract file:
```
contracts/
├── GEOMETRY_CONTRACT.md
├── MATERIAL_CONTRACT.md
├── CAMERA_CONTRACT.md
├── INTEGRATOR_CONTRACT.md
└── COMMON_TYPES.md
```

### Example Contract: Geometry

```markdown
# Geometry Module Contract

## Required Functions
All geometry modules MUST provide these functions with exact signatures:

### g_geodesic
```glsl
vec3 g_geodesic(vec3 origin, vec3 direction, float t)
```
Move point along geodesic by parameter t.

### g_dot
```glsl
float g_dot(vec3 v1, vec3 v2, vec3 point)
```
Metric inner product at given point.

### g_parallel_transport
```glsl
mat3 g_parallel_transport(vec3 from_point, vec3 to_point)
```
Parallel transport matrix between points.

### g_frame
```glsl
Frame g_frame(vec3 point, vec3 normal)
```
Build orthonormal frame with given normal.

## Available Types
These are provided by the engine:
- `struct Ray { vec3 o; vec3 d; }`
- `struct Hit { vec3 p; vec3 n; float t; vec2 uv; int mat_id; }`
- `struct Frame { vec3 t; vec3 b; vec3 n; }`

## Parameters
Declare uniforms without prefix:
- `uniform float curvature;` → `u_geometry_hyperbolic_curvature`
```

### Compiler Validation

```typescript
class ModuleValidator {
  validate(module: ModuleDescriptor): ValidationResult {
    const contract = this.getContract(module.id.kind);
    const missing = contract.required.filter(
      fn => !module.fragment.provides?.includes(fn)
    );
    
    if (missing.length > 0) {
      return {
        valid: false,
        error: `Missing required functions: ${missing.join(', ')}\n` +
               `See contracts/${module.id.kind}_CONTRACT.md`
      };
    }
    
    return { valid: true };
  }
}
```

---

## Workflows

### Research Workflow: Algorithm Development

```typescript
// 1. Implement new integrator
class MyIntegrator implements Photography {
  getModules() {
    return [{
      id: { kind: "Integrator", name: "MyNew", version: "1.0.0" },
      fragment: {
        requires: ["g_geodesic", "m_eval", "s_intersect"],
        functions: `
          vec3 i_integrate(vec2 pixel) {
            // Your algorithm from the paper
            Ray ray = c_generate_ray(pixel, vec2(0));
            Hit hit;
            if (!s_intersect(ray, hit)) return vec3(0);
            
            // Implement your radiance estimation...
            return radiance;
          }
        `,
        provides: ["i_integrate"]
      }
    }];
  }
}

// 2. Test against reference
const app = new ResearchApp(gl);
app.loadWorld(new CornellBox());  // Standard test scene

// 3. Compare with existing
const comparison = await app.comparePhotographers([
  new MyIntegrator(),
  new PathTracer(),  // Reference
]);

// 4. Parameter study
const sweep = await app.parameterSweep([
  { module: "MyIntegrator", param: "samples", values: [1, 4, 16, 64] }
]);
```

### Production Workflow: Creating Art

```typescript
// 1. Design scene
class MyArtScene implements World {
  getScene() {
    return {
      sdf: `
        float scene(vec3 p) {
          float sphere1 = length(p - vec3(0,0,0)) - 1.0;
          float sphere2 = length(p - vec3(2,0,0)) - 0.7;
          return min(sphere1, sphere2);
        }
      `,
      materials: [
        { type: "ggx", roughness: 0.1, albedo: [0.9, 0.2, 0.2] },
        { type: "ggx", roughness: 0.8, albedo: [0.2, 0.2, 0.9] }
      ]
    };
  }
}

// 2. Fine-tune and render
const app = new ProductionApp(gl);
app.loadWorld(new MyArtScene());
app.setPhotographer(new ProductionPathTracer({
  bounces: 12,
  samples: 10000
}));

// 3. Adjust lighting
app.parameters.set("Environment", "intensity", 0.5);
app.parameters.set("Light/Sun", "direction", [1, 1, 0.5]);

// 4. Render final
await app.renderUntilConverged(0.001);  // Or fixed samples
await app.saveImage("final_art.exr", "exr");
```

### Module Development Workflow

```bash
# 1. Copy template
cp templates/geometry_template.glsl geometries/my_geometry.glsl

# 2. Implement required functions
# Editor shows CONTRACT inline

# 3. Test compilation
npm run validate geometries/my_geometry.glsl
# ERROR: Missing required function: g_parallel_transport

# 4. Fix and test with simple scene
npm run preview geometries/my_geometry.glsl

# 5. Run full test suite
npm test geometries/my_geometry.glsl
```

---

## Implementation Roadmap

### Phase 0: Foundation (Week 1)
- [ ] Engine core with module compilation
- [ ] Contract validation system
- [ ] Automatic uniform prefixing
- [ ] Built-in type definitions

### Phase 1: Minimal Viable Tracer (Week 2)
- [ ] App orchestration layer
- [ ] Euclidean geometry (hardcoded)
- [ ] Lambert material
- [ ] Pinhole camera
- [ ] Direct illumination integrator
- [ ] Basic parameter UI

### Phase 2: Path Tracing (Week 3-4)
- [ ] Accumulation film
- [ ] Path tracer integrator
- [ ] GGX material
- [ ] Environment lighting
- [ ] Convergence detection

### Phase 3: Research Tools (Week 5-6)
- [ ] A/B comparison framework
- [ ] Parameter sweep automation
- [ ] Statistics collection
- [ ] Export to EXR

### Phase 4: Non-Euclidean (Month 2)
- [ ] Abstract geometry interface
- [ ] Hyperbolic implementation
- [ ] Spherical implementation
- [ ] Geodesic ray marching

### Phase 5: Advanced Rendering (Month 3)
- [ ] Multiple importance sampling
- [ ] Bidirectional path tracing
- [ ] Russian roulette
- [ ] Adaptive sampling

### Phase 6: Production Features (Month 4+)
- [ ] Mesh loading
- [ ] Texture support
- [ ] Animation timeline
- [ ] Denoising integration

---

## Technical Reference

### File Structure
```
src/
├── engine/
│   ├── compiler/
│   │   ├── shader-compiler.ts      # Recipe → GLSL
│   │   ├── module-validator.ts     # Contract checking
│   │   ├── prefix-transformer.ts   # Auto-prefixing
│   │   └── builtin-types.ts        # Ray, Hit, Frame
│   ├── runtime/
│   │   ├── render-loop.ts          # Frame execution
│   │   ├── parameter-store.ts      # Uniform management
│   │   └── film-manager.ts         # Accumulation
│   └── resources/
│       ├── texture-pool.ts         # GPU resources
│       └── buffer-manager.ts       # FBO management
│
├── app/
│   ├── core/
│   │   ├── app.ts                  # Base application
│   │   ├── recipe-builder.ts       # Module composition
│   │   └── state-manager.ts        # Current configuration
│   ├── workflows/
│   │   ├── research-app.ts         # A/B testing, sweeps
│   │   ├── production-app.ts       # Rendering pipeline
│   │   └── debug-app.ts            # Shader development
│   └── extensions/
│       ├── extension-api.ts        # Plugin interface
│       └── built-in/
│           ├── orbit-controls.ts
│           ├── parameter-ui.ts
│           └── stats-monitor.ts
│
├── worlds/
│   ├── contracts/
│   │   └── WORLD_CONTRACT.md
│   ├── geometries/
│   │   ├── euclidean/
│   │   ├── hyperbolic/
│   │   └── spherical/
│   ├── materials/
│   │   ├── lambert/
│   │   ├── ggx/
│   │   └── measured/
│   └── scenes/
│       ├── cornell-box/
│       ├── test-spheres/
│       └── complex-sdf/
│
├── photography/
│   ├── contracts/
│   │   └── PHOTOGRAPHY_CONTRACT.md
│   ├── cameras/
│   │   ├── pinhole/
│   │   ├── thin-lens/
│   │   └── fisheye/
│   ├── integrators/
│   │   ├── direct/
│   │   ├── path/
│   │   ├── bidirectional/
│   │   └── debug/
│   ├── films/
│   │   ├── accumulator/
│   │   └── variance/
│   └── developers/
│       ├── reinhard/
│       ├── aces/
│       └── false-color/
│
├── contracts/              # Module contracts
│   ├── COMMON_TYPES.md
│   ├── GEOMETRY_CONTRACT.md
│   ├── MATERIAL_CONTRACT.md
│   ├── CAMERA_CONTRACT.md
│   └── INTEGRATOR_CONTRACT.md
│
└── templates/              # Starter code
    ├── new-geometry.glsl
    ├── new-material.glsl
    ├── new-camera.glsl
    └── new-integrator.glsl
```

### Module Descriptor Reference
```typescript
interface ModuleDescriptor {
  // Identity
  id: {
    kind: "Geometry" | "Material" | "Camera" | "Integrator" | "Film" | "Developer";
    name: string;        // "Hyperbolic", "GGX", etc.
    version: string;     // "1.0.0"
  };
  
  // Shader code
  fragment: {
    uniforms?: string;   // Auto-prefixed by compiler
    functions: string;   // Your mathematical code
    provides?: string[]; // Functions this module exports
    requires?: string[]; // Functions this module needs
    entrypoints?: {      // For integrators
      fragmentMain?: string;
    };
  };
  
  // Parameters
  parameters?: Array<{
    name: string;        // Clean name (auto-prefixed)
    kind: ParameterKind; // "float", "vec3", etc.
    default: any;
    min?: number;
    max?: number;
    step?: number;
    resetPolicy?: "none" | "accumulation" | "program";
    description?: string;
  }>;
  
  // Metadata
  metadata?: {
    author?: string;
    paper?: string;      // Reference publication
    description?: string;
  };
}
```

### Render Mode Configuration
```typescript
interface RenderConfig {
  mode: "realtime" | "convergent";
  
  // Realtime settings
  targetFPS?: number;
  maxSamples?: 1;  // No accumulation
  
  // Convergent settings  
  samplesPerFrame?: number;
  maxAccumulation?: number;
  convergenceThreshold?: number;
  
  // Shared
  resolution: [number, number];
  seed?: number;
}
```

---

## Open Questions for Next Iteration

1. **Module Composition**: Should materials be per-object or per-world? Both?

2. **Hot Reload**: Should shader modules hot-reload during development?

3. **Caching Strategy**: How aggressively should we cache compiled programs?

4. **Debug Overlays**: What debug visualizations would help development?

5. **Parameter Animation**: How should we handle time-varying parameters?

6. **Multi-GPU**: Should we plan for multi-GPU from the start?

7. **Network Rendering**: Should recipes be serializable for remote rendering?

8. **Module Repository**: Should we support loading modules from a registry?

---

This architecture provides a clear separation between mathematics 
(what you write) and infrastructure (what the engine handles).
Each module knows exactly what it must provide through explicit contracts, 
and the compiler validates everything before running. 
The system supports both research workflows (rapid experimentation) 
and production workflows (final rendering), while keeping the boring parts
ctruly boring and hidden.
