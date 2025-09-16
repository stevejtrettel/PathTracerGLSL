# Research Path Tracer: Complete System Architecture

## Vision

A research-grade GPU path tracer where **mathematics drives implementation**. The code you write mirrors the equations in your papers. All shader compilation, resource management, and GL plumbing is hidden behind clean abstractions.

**Core Principle**: Write differential geometry and rendering algorithms, not WebGL boilerplate.

## System Architecture

```
src/
├── math/              # Mathematical infrastructure (always available)
│   ├── core.glsl     # Pure math: sin, cos, mix, clamp
│   ├── sampling.glsl # Random numbers: sample_2d, sample_sphere
│   ├── geometric.glsl# Universal operations: reflect, refract
│   └── types.glsl    # Interface types: Ray, Hit, Frame
│
├── engine/            # Boring deterministic infrastructure
│   ├── compiler/     # Module → GLSL transformation
│   ├── resources/    # GPU buffer/texture management
│   └── pipeline/     # Render execution
│
├── app/              # Research orchestration
│   ├── core/        # Basic app lifecycle
│   ├── workflows/   # Parameter sweeps, A/B testing
│   └── extensions/  # UI, controls, analysis
│
├── world/            # Mathematical scene content
│   ├── geometries/  # Spaces: Euclidean, hyperbolic, etc.
│   ├── materials/   # BSDFs: Lambert, GGX, etc.
│   ├── scenes/      # Object compositions
│   └── lights/      # Emitters
│
└── photography/      # Observation algorithms
    ├── cameras/     # Ray generation
    ├── estimators/  # Light transport
    ├── films/       # Accumulation
    └── developers/  # Output processing
```

## The Five Pillars

### 1. Math (Infrastructure)
**Purpose**: Universal mathematical operations  
**Available**: Everywhere, always  
**No contracts**: These are utilities, not modules

### 2. Engine (Plumbing)
**Purpose**: Compile shaders, manage GPU, execute renders  
**Principle**: Boring, deterministic, invisible  
**You never modify this once it works**

### 3. App (Orchestration)
**Purpose**: Research workflows and experiment management  
**What it does**: Combines World + Photography, manages parameters, runs experiments  
**This is your control center**

### 4. World (Content)
**Purpose**: Define the mathematical space and its contents  
**Provides**: Geometry, materials, scene structure  
**This is where differential geometry lives**

### 5. Photography (Algorithms)
**Purpose**: Define how light is measured and integrated  
**Provides**: Camera, estimation, accumulation, output  
**This is where rendering algorithms live**

## Data Flow

```
1. App selects World + Photography
   ↓
2. App builds Recipe from modules
   ↓
3. Engine compiles Recipe → GLSL program
   ↓
4. Engine executes render loop
   ↓
5. Pixels to screen/file
```

## Module System

### Module Descriptor
Every module (from World or Photography) conforms to:

```typescript
interface ModuleDescriptor {
  id: {
    kind: string;     // "Geometry", "Camera", etc.
    name: string;     // "Euclidean", "Pinhole", etc.
    version: string;  // "1.0.0"
  };
  
  fragment: {
    uniforms?: string;    // Declarations (auto-prefixed)
    functions: string;    // GLSL implementation
    provides?: string[];  // Functions this module exports
    requires?: string[];  // Functions this module needs
    entrypoints?: {       // For main shader entry
      fragmentMain?: string;
    };
  };
  
  parameters?: Array<{
    name: string;         // Clean name (auto-prefixed)
    kind: ParameterKind;
    default: any;
    min?: number;
    max?: number;
    resetPolicy?: "none" | "accumulation" | "program";
  }>;
}
```

### Auto-Prefixing Convention

The engine automatically prefixes everything:

```glsl
// You write:
uniform vec3 position;
vec3 generate_ray(vec2 pixel) { ... }

// Engine produces:
uniform vec3 u_camera_pinhole_position;
vec3 c_generate_ray(vec2 pixel) { ... }
```

Prefix mapping:
- Uniforms: `u_${kind}_${name}_${param}`
- Geometry: `g_`
- Material: `m_`
- Scene: `sc_`
- Light: `l_`
- Camera: `c_`
- Estimator: `e_`
- Film: `f_`
- Developer: `d_`

## Math Infrastructure

### Always Available
```glsl
// math/core.glsl - Pure mathematics
float saturate(float x);
vec3 mix(vec3 a, vec3 b, float t);

// math/sampling.glsl - Random numbers  
float sample_1d(ivec2 pixel, int sample, int dim);
vec2 sample_2d(ivec2 pixel, int sample, int dim);
vec3 sample_sphere(ivec2 pixel, int sample, int dim);
vec3 sample_hemisphere(vec3 n, ivec2 pixel, int sample, int dim);

// math/geometric.glsl - Geometry-dependent operations
Direction reflect(Direction i, Direction n, Point at);  // Uses g_dot
Direction refract(Direction i, Direction n, float eta, Point at);
```

### Interface Types
```glsl
// math/types.glsl
// Note: Point and Direction are defined by Geometry module

struct Ray {
  Point o;
  Direction d;
};

struct Hit {
  Point p;
  Direction n;
  Direction incident;
  float t;
  vec2 uv;
  vec3 albedo;       // Essential material data
  float roughness;
  int material_id;   // For complex lookups
};

struct Frame {
  Point base;
  Direction t;
  Direction b;  
  Direction n;
};
```

## Module Communication

Modules communicate through:
1. **Function calls** - Using clean names, auto-resolved by engine
2. **Shared types** - Ray, Hit, Frame
3. **Engine uniforms** - `u_resolution`, `u_frame_index`, etc.

## Compilation Process

1. **Module Collection**: Gather all modules from World + Photography
2. **Dependency Resolution**: Order modules, verify all `requires` satisfied
3. **Auto-Prefixing**: Transform uniforms and functions
4. **Orchestration Generation**: Create main() that calls modules in order
5. **Type Injection**: Add Point/Direction from Geometry
6. **Final Assembly**: Complete GLSL program

## Example Workflow

```typescript
// Research session
const app = new ResearchApp(gl);

// Load mathematical space
app.loadWorld(new HyperbolicWorld());

// Set observation algorithm  
app.setPhotographer(new PathTracer());

// Adjust parameters
app.parameters.set("Material/Lambert", "albedo", [0.9, 0.2, 0.2]);

// Run experiment
const results = await app.parameterSweep({
  parameter: "roughness",
  values: [0.1, 0.2, 0.3, 0.4, 0.5]
});
```
