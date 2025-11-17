# Procedural and Varying Material Properties: Discussion Notes

## Context

When materials have properties that vary across space (procedural patterns, textures, spatially-varying roughness), we need an efficient system that works on the GPU. These are notes from our September discussions about handling this in a research path tracer.

---

## The Core Problem

Materials can have properties that are:
1. **Constant** - Same value everywhere (e.g., all glass has IOR = 1.5)
2. **Uniform** - Can change via UI but same across object (e.g., adjustable roughness slider)
3. **Varying** - Different at every point (e.g., marble texture, wood grain)

The challenge: How to handle all three efficiently without sacrificing GPU performance?

---

## Discussion: Compile-Time Specialization

### Your Confirmation

**You said:** "We should definitely build the most efficient shader we can, from the given data. Most of the time I imagine having a relatively small number of objects with variable parameters and many other objects with fixed parameters."

**You agreed:** "My intuition is we compile on startup like everything else. It's ok if it takes a second... If materials have UI parameters we would just compile to use all parameters that are allowed to take nonzero values / are hooked to a uniform."

### The Agreed Approach

Generate optimized shaders at scene load time based on what's actually in the scene:

```typescript
// Scene description distinguishes property types
const scene = {
  materials: {
    glass: {
      albedo: [1, 1, 1],                    // Constant - compile as literal
      roughness: 0.0,                       // Constant
      ior: parameter(1.5, {min: 1.0, max: 3.0})  // Uniform - UI controllable
    },
    marble: {
      albedo: procedural("marble_pattern(p)"),  // Varying - spatial function
      roughness: 0.3,                       // Constant
      ior: 1.5                              // Constant
    },
    metal: {
      albedo: texture("metal_albedo.png"),  // Varying - texture
      roughness: parameter(0.3),            // Uniform - UI controllable
      metallic: 1.0                         // Constant
    }
  }
};
```

### Generated Code Example

The compiler analyzes the scene and generates specialized property accessors:

```glsl
// Constants get baked in as #define
#define GLASS_ROUGHNESS 0.0
#define MARBLE_ROUGHNESS 0.3
#define MARBLE_IOR 1.5
#define METAL_METALLIC 1.0

// UI parameters become uniforms
uniform float u_glass_ior;
uniform float u_metal_roughness;

// Textures
uniform sampler2D u_metal_albedo_texture;

MaterialProperties material_get_properties(int mat_id, vec3 p) {
  MaterialProperties props;
  
  if (mat_id == MAT_GLASS) {
    props.albedo = vec3(1, 1, 1);      // Constant - literal
    props.roughness = GLASS_ROUGHNESS;  // Constant - #define
    props.ior = u_glass_ior;           // Uniform - UI parameter
  }
  else if (mat_id == MAT_MARBLE) {
    props.albedo = marble_pattern(p);  // Procedural function
    props.roughness = MARBLE_ROUGHNESS;
    props.ior = MARBLE_IOR;
  }
  else if (mat_id == MAT_METAL) {
    vec2 uv = compute_uv(p);
    props.albedo = texture(u_metal_albedo_texture, uv).rgb;  // Texture lookup
    props.roughness = u_metal_roughness;  // Uniform parameter
    props.metallic = METAL_METALLIC;
  }
  
  return props;
}
```

---

## Optimization Strategies Discussed

### 1. Dead Code Elimination

If no materials use a property, remove all code related to it:

```typescript
// Analysis phase
const analysis = {
  hasRoughness: scene.materials.some(m => m.roughness !== undefined),
  hasMetallic: scene.materials.some(m => m.metallic !== undefined),
  hasClearcoat: scene.materials.some(m => m.clearcoat !== undefined),
};

// Generation phase
if (!analysis.hasMetallic) {
  // Don't generate ANY metallic code
  // Skip entire metallic lobe in BRDF
}
```

**Example:**
```glsl
// Original Disney BRDF: 200+ lines with all lobes
// Generated for simple diffuse scene: 30 lines, just diffuse lobe
```

### 2. Constant Folding

When all instances of a property have the same value, make it a compile-time constant:

```typescript
// Analysis
const roughnessValues = scene.materials.map(m => m.roughness);
const allSame = roughnessValues.every(v => v === roughnessValues[0]);

if (allSame) {
  // Generate: #define ROUGHNESS 0.5
} else {
  // Generate: uniform float u_roughness[NUM_MATERIALS];
}
```

### 3. Adaptive Compilation Based on Scene Size

We discussed different strategies depending on object count:

**Small scenes (< 20 objects):**
```glsl
// Unroll everything, inline constants
float d = sphere_sdf(p, vec3(0,0,0), 1.0);  // Position and radius inlined
d = min(d, sphere_sdf(p, vec3(2,0,0), 0.5));
```

**Medium scenes (20-100 objects):**
```glsl
// Mix: unroll a few important ones, arrays for the rest
float d = sphere_sdf(p, vec3(0,0,0), 1.0);  // Important object
d = min(d, sphere_sdf(p, vec3(2,0,0), 0.5));

for (int i = 0; i < remaining; i++) {
  d = min(d, sphere_sdf(p, u_sphere_positions[i], u_sphere_radii[i]));
}
```

---

## Performance Comparison

We discussed the performance implications:

### Constant Properties
```glsl
uniform vec3 material_albedos[10];
vec3 albedo = material_albedos[mat_id];  // ~1-2 cycles
```

### Procedural Properties  
```glsl
vec3 albedo = marble_pattern(p);  // ~20-50 cycles
```

### Mixed (Compile-Time Specialized)
```glsl
// Optimized - no runtime branching for constant/procedural decision
vec3 albedo = (mat_id == GLASS) ? vec3(1,1,1) :
              (mat_id == MARBLE) ? marble_pattern(p) :
              vec3(0.8, 0.2, 0.2);
```

**Key insight:** The branching overhead is negligible compared to SDF marching and Monte Carlo sampling. For a research path tracer, the clarity of compile-time specialization outweighs micro-optimizations.

---

## Procedural Pattern Examples

We touched on several pattern types:

### Noise-Based Patterns
```glsl
vec3 marble_pattern(vec3 p) {
  float veins = fbm(p * 4.0) * 0.5 + 0.5;
  return mix(vec3(0.9, 0.9, 0.9), vec3(0.2, 0.15, 0.1), 
             smoothstep(0.4, 0.6, veins));
}

vec3 wood_pattern(vec3 p) {
  float rings = fract(length(p.xz) * 5.0 + noise(p) * 0.5);
  return mix(vec3(0.4, 0.2, 0.1), vec3(0.6, 0.4, 0.2), rings);
}
```

### Geometric Patterns
```glsl
vec3 voronoi_color(vec3 p) {
  vec2 cell = voronoi(p.xz);
  float f = cell.x;  // Distance to nearest cell
  return vec3(f);
}

float checkerboard(vec3 p) {
  vec3 q = floor(p);
  return mod(q.x + q.y + q.z, 2.0);
}
```

---

## Texture Support

We discussed texture integration:

**Your statement:** "I will want image textures for all of these! I will even moreso want procedural versions of all of these, where I write a function when I describe the scene. But being able to assign a precomputed image (or the output of a shader, saved as a texture/image) is a crucial piece of it."

### Texture System
```glsl
// UV computation (must be provided per-geometry)
vec2 compute_uv(vec3 p) {
  // Could be spherical, planar, triplanar, etc.
  // Depends on object shape and desired mapping
}

// Texture sampling in material_get_properties
vec3 albedo = texture(u_albedo_textures[texture_id], uv).rgb;
```

### Challenges
- **UV mapping for SDFs:** Not all SDFs have natural UV coordinates
- **Your approach:** "I am the developer and sole user so I won't use image textures in geometries where that makes no sense"

---

## Integration with Parameter System

We discussed how varying properties integrate with the ParameterStore:

```typescript
// Compiler outputs parameter metadata
compilerOutput = {
  module: compiledMaterialModule,
  parameters: [
    { 
      path: "glass.ior", 
      uniform: "u_glass_ior", 
      type: "float",
      default: 1.5,
      min: 1.0,
      max: 3.0,
      reset: true  // Changing this requires re-accumulation
    },
    {
      path: "metal.roughness",
      uniform: "u_metal_roughness",
      type: "float",
      default: 0.3,
      reset: true
    }
  ]
};

// App automatically registers these
compilerOutput.parameters.forEach(param => {
  app.parameterStore.register(param.path, param.default, {
    min: param.min,
    max: param.max,
    onChange: (value) => {
      engine.setUniform(param.uniform, value);
      if (param.reset) {
        film.reset();
      }
    }
  });
});
```

---

## Batched Property Access

A key design decision: get all properties in a single call.

**Single Query Pattern:**
```glsl
// Good - one call gets everything
MaterialProperties props = material_get_properties(mat_id, p);
vec3 albedo = props.albedo;
float roughness = props.roughness;
float ior = props.ior;
```

**Why this matters:**
- **Cache-friendly:** All property data accessed together
- **Clear interface:** One function to understand
- **Optimizable:** Compiler can inline and optimize the whole struct

**Anti-pattern (never do this):**
```glsl
// Bad - multiple calls
vec3 albedo = material_get_albedo(mat_id, p);
float roughness = material_get_roughness(mat_id, p);
float ior = material_get_ior(mat_id, p);
```

---

## Where Code Lives

**Materials Module (generated at build time):**
```typescript
Materials.generate() returns {
  glsl: `
    #define MAT_GLASS 0
    #define MAT_MARBLE 1
    
    uniform float u_glass_ior;
    uniform sampler2D u_metal_albedo;
    
    vec3 marble_pattern(vec3 p) {
      // Procedural function
    }
    
    MaterialProperties material_get_properties(int mat_id, vec3 p) {
      // Generated based on scene analysis
    }
  `,
  parameters: [/* UI parameter metadata */],
  textures: [/* Required texture bindings */]
}
```

---

## Open Questions From Discussions

These came up but weren't fully resolved:

1. **How many procedural patterns to include?**
   - Should common patterns (marble, wood, checker) be built-in?
   - Or always user-defined in scene description?

2. **Texture atlasing for many textures:**
   - Pack all textures into one atlas?
   - Or keep separate (simpler but more texture units)?

3. **Procedural pattern library organization:**
   - Part of Materials module?
   - Separate "texture" module?
   - Inline in scene description?

4. **Gradient information:**
   - Do we need `material_get_property_gradient()` for advanced effects?
   - Or is property value at a point sufficient?

5. **Time-varying properties:**
   - Should properties accept a time parameter?
   - `marble_pattern(p, time)` for animation?

---

## Key Principles We Agreed On

1. **Compile-time specialization** - Generate optimal code per scene
2. **Single compilation at startup** - One second compile time is acceptable
3. **Three property types** - Constant, uniform (UI), varying (procedural/texture)
4. **Dead code elimination** - Remove unused properties entirely
5. **Constant folding** - Compile constants as literals
6. **Batched access** - `material_get_properties()` returns everything
7. **Parameter integration** - Uniforms automatically register with ParameterStore

---

## Summary

The procedural materials system uses **compile-time analysis and generation** to create optimized property accessors. By distinguishing between constant, uniform, and varying properties at scene definition time, the compiler can:

- **Eliminate** code for unused features
- **Inline** constant values
- **Specialize** property lookups to avoid runtime branching
- **Integrate** with the parameter system for UI controls

The result: efficient GPU code that handles simple constant materials (fast path) and complex procedural/textured materials (when needed) without maintaining an uber-shader with all possibilities.

**Not locked in:** These are design discussions, not final decisions. The right balance between flexibility and optimization will become clearer during implementation.