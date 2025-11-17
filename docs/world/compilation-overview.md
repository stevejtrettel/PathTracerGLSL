# World Compilation System - Overview

## Introduction

The **World Compilation System** transforms high-level TypeScript descriptions of scenes and lighting into optimized GLSL modules for the path tracer. It provides:

- **Automatic GLSL code generation** from declarative descriptions
- **UI-controllable parameters** without shader recompilation
- **Consistent patterns** across scene and lighting
- **Type safety** from TypeScript to GLSL

This document explains how all the pieces fit together.

---

## Architecture

### The Three Core Components

```
┌──────────────────────────────────────────────────────────┐
│                    User Descriptions                      │
│  (TypeScript: SceneDescription + LightingDescription)     │
└────────────┬─────────────────────────────┬───────────────┘
             │                             │
             ▼                             ▼
    ┌────────────────┐            ┌────────────────┐
    │ SceneCompiler  │            │ LightsCompiler │
    │                │            │                │
    │ • Object SDFs  │            │ • Samplers     │
    │ • Materials    │            │ • Light data   │
    │ • Parameters   │            │ • Parameters   │
    └────────┬───────┘            └────────┬───────┘
             │                             │
             ▼                             ▼
    ┌────────────────┐            ┌────────────────┐
    │ Scene Module   │            │ Lighting Module│
    │  (GLSL)        │            │  (GLSL)        │
    └────────┬───────┘            └────────┬───────┘
             │                             │
             └──────────────┬──────────────┘
                            ▼
                   ┌────────────────┐
                   │ Render Engine  │
                   │  (WebGL)       │
                   └────────────────┘
```

### Component Responsibilities

| Component | Input | Output | Responsibility |
|-----------|-------|--------|----------------|
| **SceneCompiler** | SceneDescription | Scene Module | Generate object SDFs, material properties, ray marching |
| **LightsCompiler** | LightingDescription | Lighting Module | Generate light samplers, light data access |
| **Parameter System** | ParameterMetadata | Uniforms + Bindings | Connect UI to shader uniforms |

---

## Key Patterns

### 1. Property Value Abstraction

**Both compilers** use the same pattern for flexible property specification:

```typescript
// SceneCompiler
type MaterialPropertyValue<T> = T | { param: string } | { glsl: string };

// LightsCompiler
type LightPropertyValue<T> = T | { param: string };
```

**Three modes**:

| Mode | Syntax | Compiles To | Use Case |
|------|--------|-------------|----------|
| **Constant** | `roughness: 0.8` | Inline GLSL constant | Static values |
| **Parameter** | `roughness: { param: 'mat.roughness' }` | Uniform reference | UI-controllable |
| **Procedural** | `albedo: { glsl: '...' }` | GLSL helper function | Complex patterns |

### 2. Automatic Uniform Generation

Users **never write uniform declarations**. The compilers:

1. **Scan** property values for `{ param: '...' }` references
2. **Generate** uniform declarations automatically
3. **Create** runtime bindings for parameter updates

**Example flow**:

```typescript
// User writes this:
materials: new Map([
  ['floor', {
    roughness: { param: 'floor.roughness' }  // ← Parameter reference
  }]
])

// Compiler generates this:
uniform float u_scene_floor_roughness;  // ← Uniform declaration

// And this:
props.roughness = u_scene_floor_roughness;  // ← Usage in GLSL

// And this:
{
  uniform: 'u_scene_floor_roughness',
  parameters: ['floor.roughness'],
  compute: (params) => params['floor.roughness'] || 0.8
}  // ← Runtime binding
```

### 3. Symmetric Compilation

Both compilers follow **identical patterns**:

```typescript
class SceneCompiler {
  compile(scene: SceneDescription): ModuleDescriptor {
    // 1. Analyze parameter usage
    const paramUsage = this.analyzeParameterUsage(scene.materials, scene.parameters);

    // 2. Generate uniforms (if needed)
    const uniforms = this.generateUniforms(paramUsage);

    // 3. Generate GLSL functions (using constants or uniform refs)
    const functions = this.generateAllFunctions(scene, paramUsage);

    // 4. Generate uniform bindings
    const bindings = this.generateUniformBindings(paramUsage, scene.parameters);

    return { id, fragment: { constants, uniforms, functions }, bindings };
  }

  private isParam<T>(value: MaterialPropertyValue<T>): boolean { /* ... */ }
  private paramToUniform(path: string): string { /* ... */ }
  private analyzeParameterUsage(...): Map<string, 'vec3' | 'float'> { /* ... */ }
  private generateUniforms(...): string { /* ... */ }
  private generateUniformBindings(...): UniformBinding[] { /* ... */ }
}
```

```typescript
class LightsCompiler {
  compile(lighting: LightingDescription): ModuleDescriptor {
    // 1. Analyze parameter usage
    const paramUsage = this.analyzeParameterUsage(lighting.lights, lighting.parameters);

    // 2. Generate uniforms (if needed)
    const uniforms = this.generateUniforms(paramUsage);

    // 3. Generate GLSL functions (using constants or uniform refs)
    const functions = this.generateAllFunctions(lighting, paramUsage);

    // 4. Generate uniform bindings
    const bindings = this.generateUniformBindings(paramUsage, lighting.parameters);

    return { id, fragment: { constants, uniforms, functions }, bindings };
  }

  private isParam<T>(value: LightPropertyValue<T>): boolean { /* ... */ }
  private paramToUniform(path: string): string { /* ... */ }
  private analyzeParameterUsage(...): Map<string, 'vec3' | 'float'> { /* ... */ }
  private generateUniforms(...): string { /* ... */ }
  private generateUniformBindings(...): UniformBinding[] { /* ... */ }
}
```

**Same methods, same logic, same patterns!**

### 4. Mode-Agnostic Samplers

Light samplers **don't know** if values are constants or uniforms. They always use the same accessor:

```glsl
// Sampler code (IDENTICAL for all modes)
LightSample sample_light_0(Point p, vec2 xi) {
  vec3 light_pos = lighting_get_light(0).param0.xyz;  // ← Accessor
  vec3 radiance = lighting_get_light(0).radiance;
  // ... sampling logic
}
```

The **accessor implementation** changes based on mode:

```glsl
// Constants mode
const LightData u_lights[3] = LightData[](/* ... */);

LightData lighting_get_light(int light_id) {
  return u_lights[light_id];  // Array access
}
```

```glsl
// Uniforms mode
LightData lighting_get_light(int light_id) {
  if (light_id == 0) {
    return LightData(
      u_light_red_light_color * u_light_red_light_intensity,
      vec4(u_light_red_light_position, 0.0),
      vec4(0.0), vec4(0.0)
    );
  }
  // ... more lights
}
```

**Result**: Samplers are **pure** and **simple** - no conditional logic!

---

## Compilation Flow

### Step-by-Step Process

#### 1. User Creates Descriptions

```typescript
// Scene
const scene: SceneDescription = {
  objects: [
    { id: 'floor', sdf: '...', material: 'floor_mat' }
  ],
  materials: new Map([
    ['floor_mat', {
      albedo: { param: 'floor.color' },  // ← Parameter
      roughness: 0.8                      // ← Constant
    }]
  ]),
  parameters: {
    'floor.color': { type: 'color', default: [0.8, 0.8, 0.8] }
  }
};

// Lighting
const lighting: LightingDescription = {
  lights: [
    {
      type: 'point',
      id: 'sun',
      position: { param: 'sun.position' },  // ← Parameter
      color: [1, 1, 1],                      // ← Constant
      intensity: 100.0
    }
  ],
  parameters: {
    'sun.position': { type: 'vec3', default: [5, 10, 5] }
  }
};
```

#### 2. Compile Modules

```typescript
const sceneCompiler = new SceneCompiler();
const lightsCompiler = new LightsCompiler();

const sceneModule = sceneCompiler.compile(scene);
const lightingModule = lightsCompiler.compile(lighting);
```

#### 3. Compilers Analyze Parameters

```typescript
// SceneCompiler finds:
paramUsage = Map {
  'floor.color' => 'vec3'
}

// LightsCompiler finds:
paramUsage = Map {
  'sun.position' => 'vec3'
}
```

#### 4. Compilers Generate Uniforms

```glsl
// From SceneCompiler
uniform vec3 u_scene_floor_color;

// From LightsCompiler
uniform vec3 u_light_sun_position;
```

#### 5. Compilers Generate GLSL Code

**Scene module**:

```glsl
MaterialProperties scene_material_properties(int mat_id, Point p) {
  MaterialProperties props;
  // ...
  if (mat_id == MATERIAL_FLOOR_MAT) {
    props.albedo = u_scene_floor_color;  // ← Uniform
    props.roughness = 0.8;                // ← Constant
    // ...
  }
  return props;
}
```

**Lighting module**:

```glsl
LightData lighting_get_light(int light_id) {
  if (light_id == 0) {
    return LightData(
      vec3(1.0, 1.0, 1.0) * 100.0,        // ← Constants (color * intensity)
      vec4(u_light_sun_position, 0.0),    // ← Uniform (position)
      vec4(0.0), vec4(0.0)
    );
  }
  // ...
}
```

#### 6. Compilers Generate Uniform Bindings

```typescript
// Scene bindings
[
  {
    uniform: 'u_scene_floor_color',
    parameters: ['floor.color'],
    type: 'vec3',
    compute: (params) => params['floor.color'] || [0.8, 0.8, 0.8]
  }
]

// Lighting bindings
[
  {
    uniform: 'u_light_sun_position',
    parameters: ['sun.position'],
    type: 'vec3',
    compute: (params) => params['sun.position'] || [5, 10, 5]
  }
]
```

#### 7. Engine Compiles Shaders

```typescript
const shader = engine.compileShader({
  modules: [sceneModule, lightingModule, /* ... */]
});
```

#### 8. Engine Sets Up Uniform Bindings

```typescript
for (const binding of allBindings) {
  const location = gl.getUniformLocation(shader, binding.uniform);
  uniformLocations.set(binding.uniform, location);
}
```

#### 9. UI Updates Parameters

```typescript
parameterStore.set('floor.color', [1.0, 0.5, 0.5]);  // User changes color
```

#### 10. Engine Updates Uniforms

```typescript
// Find affected bindings
const affectedBindings = bindings.filter(b =>
  b.parameters.includes('floor.color')
);

// Compute new values
for (const binding of affectedBindings) {
  const newValue = binding.compute(parameterStore.getAll());
  const location = uniformLocations.get(binding.uniform);

  // Update GPU
  if (binding.type === 'vec3') {
    gl.uniform3fv(location, newValue);
  }
}
```

#### 11. Render Continues with New Values

**No recompilation needed!** Shader code stays the same, only uniform values change.

---

## Module Integration

### Module Descriptor Format

Both compilers produce `ModuleDescriptor` objects:

```typescript
interface ModuleDescriptor {
  id: {
    kind: 'scene' | 'lighting';
    name: string;
    version: string;
  };

  fragment: {
    constants: string;    // #define directives
    uniforms?: string;    // uniform declarations (optional)
    functions: string;    // GLSL function definitions
  };

  uniformBindings?: UniformBinding[];
  parameters?: Record<string, ParameterMetadata>;
}
```

### Shader Composition

The engine combines modules into a single shader:

```glsl
// ===== CONSTANTS (from all modules) =====
#define NUM_OBJECTS 3          // ← Scene module
#define NUM_MATERIALS 4
#define NUM_LIGHTS 2           // ← Lighting module
#define LIGHT_SAMPLE_COUNT 1

// ===== UNIFORMS (from all modules) =====
uniform vec3 u_scene_floor_color;     // ← Scene module
uniform float u_scene_floor_roughness;
uniform vec3 u_light_sun_position;    // ← Lighting module
uniform float u_light_sun_intensity;

// ===== FUNCTIONS (from all modules) =====

// Scene module functions
float sdf_floor(vec3 p) { /* ... */ }
MaterialProperties scene_material_properties(int mat_id, Point p) { /* ... */ }
bool scene_intersect(Ray ray, out Hit hit) { /* ... */ }

// Lighting module functions
LightData lighting_get_light(int light_id) { /* ... */ }
LightSample lighting_sample(Point p, vec2 xi) { /* ... */ }
float lighting_pdf(Point p, Direction wi) { /* ... */ }

// Main path tracer (uses both modules)
vec3 trace_path(Ray ray) {
  Hit hit;
  if (scene_intersect(ray, hit)) {
    MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
    LightSample ls = lighting_sample(hit.p, random2());
    // ...
  }
}
```

---

## Example: Complete Flow

### Input (TypeScript)

```typescript
const scene: SceneDescription = {
  objects: [
    {
      id: 'sphere',
      sdf: 'float sdf(vec3 p) { return length(p) - 1.0; }',
      material: 'metal'
    }
  ],

  materials: new Map([
    ['metal', {
      albedo: { param: 'metal.color' },
      roughness: { param: 'metal.roughness' },
      metallic: 0.9,
      ior: 1.5,
      emission: [0, 0, 0],
      emission_strength: 0.0
    }]
  ]),

  parameters: {
    'metal.color': {
      type: 'color',
      default: [0.9, 0.9, 0.95],
      name: 'Metal Color'
    },
    'metal.roughness': {
      type: 'float',
      default: 0.1,
      range: [0, 1],
      step: 0.01,
      name: 'Metal Roughness'
    }
  }
};

const lighting: LightingDescription = {
  lights: [
    {
      type: 'point',
      id: 'key_light',
      position: { param: 'key.position' },
      color: { param: 'key.color' },
      intensity: 50.0
    }
  ],

  parameters: {
    'key.position': {
      type: 'vec3',
      default: [5, 5, 5],
      name: 'Key Light Position'
    },
    'key.color': {
      type: 'color',
      default: [1, 1, 1],
      name: 'Key Light Color'
    }
  }
};
```

### Compilation

```typescript
const sceneModule = sceneCompiler.compile(scene);
const lightingModule = lightsCompiler.compile(lighting);
```

### Output (GLSL)

```glsl
// ===== CONSTANTS =====
#define NUM_OBJECTS 1
#define NUM_MATERIALS 2
#define MATERIAL_AIR 0
#define MATERIAL_METAL 1
#define NUM_LIGHTS 1

// ===== UNIFORMS =====
uniform vec3 u_scene_metal_color;
uniform float u_scene_metal_roughness;
uniform vec3 u_light_key_position;
uniform vec3 u_light_key_color;

// ===== SCENE FUNCTIONS =====

float sdf_sphere(vec3 p) {
  return length(p) - 1.0;
}

float dispatch_sdf(vec3 p, out int closest_material) {
  float d = sdf_sphere(p);
  closest_material = MATERIAL_METAL;
  return d;
}

MaterialProperties scene_material_properties(int mat_id, Point p) {
  MaterialProperties props;

  if (mat_id == MATERIAL_METAL) {
    props.albedo = u_scene_metal_color;      // ← Uniform
    props.roughness = u_scene_metal_roughness; // ← Uniform
    props.metallic = 0.9;                     // ← Constant
    props.ior = 1.5;
    props.emission = vec3(0.0);
    props.emission_strength = 0.0;
    props.light_id = -1;
  }

  return props;
}

bool scene_intersect(Ray ray, out Hit hit) {
  // ... ray marching code
}

// ===== LIGHTING FUNCTIONS =====

LightData lighting_get_light(int light_id) {
  if (light_id == 0) {
    vec3 color = u_light_key_color;           // ← Uniform
    float intensity = 50.0;                    // ← Constant
    vec3 radiance = color * intensity;

    return LightData(
      radiance,
      vec4(u_light_key_position, 0.0),        // ← Uniform
      vec4(0.0), vec4(0.0)
    );
  }
  return LightData(vec3(0.0), vec4(0.0), vec4(0.0), vec4(0.0));
}

LightSample sample_light_0(Point p, vec2 xi) {
  LightSample ls;

  vec3 light_pos = lighting_get_light(0).param0.xyz;
  vec3 radiance = lighting_get_light(0).radiance;

  vec3 to_light = light_pos - p;
  float distance_sq = dot(to_light, to_light);
  float distance = sqrt(distance_sq);

  ls.wi = to_light / distance;
  ls.distance = distance;
  ls.radiance = radiance / distance_sq;
  ls.pdf = 1.0;
  ls.light_id = 0;

  return ls;
}

LightSample lighting_sample(Point p, vec2 xi) {
  return sample_light_0(p, xi);
}

float lighting_pdf(Point p, Direction wi) {
  return 0.0;
}

int lighting_count() {
  return NUM_LIGHTS;
}
```

### Uniform Bindings (TypeScript)

```typescript
[
  // Scene bindings
  {
    uniform: 'u_scene_metal_color',
    parameters: ['metal.color'],
    type: 'vec3',
    compute: (params) => params['metal.color'] || [0.9, 0.9, 0.95]
  },
  {
    uniform: 'u_scene_metal_roughness',
    parameters: ['metal.roughness'],
    type: 'float',
    compute: (params) => params['metal.roughness'] || 0.1
  },

  // Lighting bindings
  {
    uniform: 'u_light_key_position',
    parameters: ['key.position'],
    type: 'vec3',
    compute: (params) => params['key.position'] || [5, 5, 5]
  },
  {
    uniform: 'u_light_key_color',
    parameters: ['key.color'],
    type: 'vec3',
    compute: (params) => params['key.color'] || [1, 1, 1]
  }
]
```

### UI Controls

The UI automatically generates controls from parameter metadata:

```
┌─ Material ──────────────┐
│ Metal Color:     [▓▓▓]  │  ← Color picker
│ Metal Roughness:  ─●──  │  ← Slider (0.0 to 1.0)
└─────────────────────────┘

┌─ Lighting ──────────────┐
│ Key Light Position:     │
│   X: [5.0]  Y: [5.0]    │  ← Number inputs
│   Z: [5.0]              │
│ Key Light Color: [▓▓▓]  │  ← Color picker
└─────────────────────────┘
```

### Runtime Updates

User drags "Metal Roughness" slider to 0.5:

1. UI calls: `parameterStore.set('metal.roughness', 0.5)`
2. Engine finds binding for `'u_scene_metal_roughness'`
3. Engine computes: `binding.compute({ 'metal.roughness': 0.5 }) → 0.5`
4. Engine updates: `gl.uniform1f(location, 0.5)`
5. Next frame renders with new roughness value

**No shader recompilation!**

---

## Summary

### The System Provides:

1. **Declarative API**: Describe scenes and lighting in TypeScript, not GLSL
2. **Type Safety**: Compile-time checks from TypeScript to GLSL
3. **Automatic Uniforms**: Never write uniform declarations manually
4. **Runtime Control**: Change parameters without recompiling shaders
5. **Consistent Patterns**: Same approach for scene and lighting
6. **Modular Code**: Samplers, SDFs, materials all separated
7. **Performance**: Constants when possible, uniforms when needed

### Key Innovations:

1. **Property Value Abstraction**: `T | { param: string } | { glsl: string }`
2. **lighting_get_light() Accessor**: Decouples samplers from storage mode
3. **Symmetric Compilation**: Both compilers use identical patterns
4. **Automatic Parameter Detection**: Scan for `{ param: '...' }` references
5. **Uniform Bindings**: Connect runtime parameters to GPU uniforms

### Documentation Index:

- **[scene-compiler.md](./scene-compiler.md)**: SceneCompiler details
- **[lights-compiler.md](./lights-compiler.md)**: LightsCompiler details
- **[parameter-system.md](./parameter-system.md)**: Parameter system details
- **This document**: Big picture overview

---

## Design Philosophy

> **"Make the simple things simple, and the complex things possible."**

**Simple**: Static scene with constant values

```typescript
const scene: SceneDescription = {
  objects: [{ id: 'sphere', sdf: '...', material: 'metal' }],
  materials: new Map([
    ['metal', { albedo: [0.9, 0.9, 0.95], roughness: 0.1, metallic: 0.9, /* ... */ }]
  ])
};
```

No parameters → no uniforms → optimal performance.

**Complex**: Interactive scene with UI controls and procedural materials

```typescript
const scene: SceneDescription = {
  objects: [/* ... */],
  materials: new Map([
    ['floor', {
      albedo: {
        glsl: `vec3 checker(vec3 p) {
          float c = mod(floor(p.x * u_scene_checker_freq) + floor(p.z * u_scene_checker_freq), 2.0);
          return mix(u_scene_checker_color1, u_scene_checker_color2, c);
        }`
      },
      roughness: { param: 'floor.roughness' },
      metallic: 0.0,
      /* ... */
    }]
  ]),
  parameters: {
    'checker.freq': { type: 'float', default: 4.0, range: [1, 20] },
    'checker.color1': { type: 'color', default: [0.8, 0.8, 0.8] },
    'checker.color2': { type: 'color', default: [0.2, 0.2, 0.2] },
    'floor.roughness': { type: 'float', default: 0.8, range: [0, 1] }
  }
};
```

Full flexibility → procedural materials + UI controls + runtime updates.

**The system handles both with the same API.**
