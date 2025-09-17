# Material Module Contract

## Purpose
Material modules define how surfaces and volumes interact with light. They are generated at build time based on scene analysis, producing optimized GLSL containing only the features actually needed.

## Generation Pipeline
```typescript
// Build time: Analyze scene and generate optimized BRDF
MaterialAnalyzer → analyze(scene) → MaterialCompiler → compile() → ModuleDescriptor
```

## Module Descriptor
```typescript
{
  id: {
    kind: 'material',
    name: string,                // e.g., 'optimized_brdf'
    version: string
  },
  provides: ['material'],
  requires: ['geometry'],        // For g_dot, g_frame, etc.
  fragment: {
    functions: string,          // Generated optimized GLSL
    uniforms: string,          // Only uniforms actually needed
  },
  parameters: Array<{          // UI-controllable parameters
    name: string,
    type: string,
    default: any,
    uniform: boolean          // True if runtime-variable
  }>
}
```

## Required Functions

Generated materials must implement ONE of these interfaces:

### Option A: Simple Shading (Direct Illumination Only)
```glsl
vec3 m_shade(Direction wi, Hit hit)
```
- **wi**: Incident direction (toward surface, i.e., -ray.direction)
- **hit**: Complete hit information
- **returns**: Shaded color for direct illumination

### Option B: Full Interaction (Path Tracing)
```glsl
vec3 m_interact(Direction wi, Hit hit, vec2 xi, out Direction wo, out float pdf)
```
- **wi**: Incident direction (toward surface)
- **hit**: Complete hit information
- **xi**: Random numbers [0,1)²
- **wo**: [output] Sampled outgoing direction
- **pdf**: [output] Probability density of sampling wo
- **returns**: BSDF * cos(θ) / pdf contribution

## Generation Examples

### Analyzed Simple Scene
```typescript
// Scene only uses diffuse materials with constant albedos
const analysis = {
  hasRoughness: false,
  hasMetallic: false,
  hasClearcoat: false,
  allAlbedosConstant: true,
  uniqueAlbedos: [[0.8,0.2,0.2], [0.2,0.8,0.2]]
};

const module = MaterialCompiler.compile(analysis);
// Generates:
```
```glsl
// Optimized for diffuse-only scene
const vec3 albedos[2] = vec3[](
  vec3(0.8, 0.2, 0.2),
  vec3(0.2, 0.8, 0.2)
);

vec3 m_interact(Direction wi, Hit hit, vec2 xi, out Direction wo, out float pdf) {
  // No roughness/metallic code at all - just Lambert
  Frame frame = g_frame(hit.p, hit.n);
  
  // Cosine-weighted hemisphere sampling
  float phi = 2.0 * PI * xi.x;
  float cos_theta = sqrt(xi.y);
  float sin_theta = sqrt(1.0 - xi.y);
  
  wo = frame.t * sin_theta * cos(phi) + 
       frame.b * sin_theta * sin(phi) + 
       frame.n * cos_theta;
  
  pdf = cos_theta / PI;
  return albedos[hit.object_id] / PI;  // Direct array access
}
```

### Partial Disney BRDF
```typescript
// Scene uses roughness but no metallic/clearcoat
const analysis = {
  hasRoughness: true,
  roughnessUniform: true,  // UI controllable
  hasMetallic: false,      // Never used
  hasClearcoat: false,     // Never used
};

// Generates:
```
```glsl
uniform float u_roughness[MAX_OBJECTS];  // Runtime controllable

vec3 m_interact(Direction wi, Hit hit, vec2 xi, out Direction wo, out float pdf) {
  float roughness = u_roughness[hit.object_id];
  float alpha = roughness * roughness;
  
  // GGX sampling and evaluation
  wo = sample_ggx_vndf(wi, hit.n, alpha, xi);
  
  // Simplified evaluation - no metallic mixing
  float D = ggx_d(hit.n, wo, alpha);
  float G = ggx_g(wi, wo, hit.n, alpha);
  float F = 0.04;  // Constant dielectric Fresnel
  
  pdf = D * G / (4.0 * abs(dot(wi, hit.n)));
  return get_albedo(hit.object_id) * (1.0 - F) / PI + vec3(F * D * G);
}

// Metallic code completely eliminated
```

### Full Disney with Optimizations
```typescript
// Scene uses many Disney features
const analysis = {
  hasRoughness: true,
  hasMetallic: true,
  hasClearcoat: true,
  clearcoatConstant: true,  // Always 0.1
  subsurfaceUsed: false,    // Never used
};

// Generates specialized Disney with:
// - Clearcoat compiled to constant
// - Subsurface code eliminated
// - Optimized sampling strategy
```

## Property Access Generation

The compiler generates optimized property accessors:

```glsl
// For mixed constant/procedural properties
vec3 get_albedo(int id, Point p) {
  // Fast path: constants (most objects)
  if (id < 47) {
    const vec3 values[47] = vec3[](
      vec3(0.8, 0.2, 0.2),
      vec3(0.2, 0.8, 0.2),
      // ... 45 more compile-time constants
    );
    return values[id];
  }
  
  // Slow path: procedural (few objects)
  switch(id) {
    case 47: return marble_pattern(p);
    case 48: return wood_grain(p);
  }
}

// For uniform properties
float get_roughness(int id) {
  return u_roughness[id];  // Always uniform in this scene
}

// For unused properties
float get_metallic(int id) {
  return 0.0;  // Compiled to constant - never used
}
```

## Optimization Strategies

### 1. Feature Elimination
```typescript
if (!analysis.hasClearcoat) {
  // Don't generate any clearcoat code
  // Saves ~30% of Disney BRDF complexity
}
```

### 2. Sampling Strategy Selection
```typescript
if (!analysis.hasRoughness || maxRoughness < 0.1) {
  // Use simpler uniform sampling
  generateUniformSampling();
} else {
  // Use importance sampling
  generateGGXImportanceSampling();
}
```

### 3. Constant Specialization
```glsl
// If all materials have roughness = 0.5
const float ROUGHNESS = 0.5;
const float ALPHA = 0.25;  // Precomputed
const float ALPHA2 = 0.0625;  // Precomputed

// No texture lookups or uniform access needed
```

### 4. Batch Property Access
```glsl
// Instead of multiple function calls
struct MaterialProperties {
  vec3 albedo;
  float roughness;
  float metallic;
};

// One batched lookup
MaterialProperties props = get_properties(hit.object_id);
```

## Builder Interface

```typescript
class MaterialBuilder {
  // Analysis phase
  static analyze(scene: Scene): MaterialAnalysis {
    return {
      hasRoughness: scene.objects.some(o => o.material.roughness !== undefined),
      hasMetallic: scene.objects.some(o => o.material.metallic > 0),
      // ... analyze all features
    };
  }
  
  // Compilation phase
  static compile(analysis: MaterialAnalysis): ModuleDescriptor {
    const compiler = new MaterialCompiler(analysis);
    
    // Generate only needed code
    const functions = compiler.generateOptimizedBRDF();
    const uniforms = compiler.generateUniforms();
    const accessors = compiler.generatePropertyAccessors();
    
    return {
      id: { kind: 'material', name: 'optimized_brdf', version: '1.0.0' },
      fragment: {
        functions: functions + accessors,
        uniforms: uniforms,
        provides: ['interact', 'eval', 'sample']
      }
    };
  }
  
  // Configuration methods
  setBaseImplementation(type: 'lambert' | 'ggx' | 'disney'): void;
  enableFeature(feature: string, params: any): void;
  addProcedural(name: string, code: string): void;
}
```

## Special Cases

### Glass Material
```typescript
// Glass always needs full interface handling
if (analysis.hasGlass) {
  // Include Fresnel, refraction
  // But still optimize other aspects
}
```

### Emissive Materials
```typescript
if (analysis.hasEmission) {
  // Add emission function
  `vec3 m_emission(Hit hit) {
    return emission_values[hit.object_id];
  }`
}
```

### Volume Materials
```typescript
if (analysis.hasVolumes) {
  // Add volume functions
  `vec3 m_sigma_s(Point p) { ... }
   vec3 m_sigma_a(Point p) { ... }`
}
```

## Performance Impact

Generated materials achieve:
- **30-70% fewer instructions** vs uber-shader
- **Better GPU occupancy** (fewer registers)
- **Improved cache coherence** (compact code)
- **Reduced branching** (features compiled out)

## Hit Structure Access

Materials receive complete hit information:
```glsl
struct Hit {
  Point p;              // Hit point
  Direction n;          // Normal (outward facing)
  Direction incident;   // Incoming ray direction
  float t;              // Ray parameter
  vec2 uv;              // Texture coordinates
  int object_id;        // Which object was hit
  int part_id;          // Which part (for compounds)
  int material_id;      // Material type identifier
  
  // Material interface (populated by scene)
  int material_from;    // Material ray is traveling through
  int material_to;      // Material ray would enter
  float ior_from;       // IOR of from material
  float ior_to;         // IOR of to material
  float ior_ratio;      // ior_from / ior_to (precomputed)
  
  // Derived by material if needed:
  // Frame frame = g_frame(hit.p, hit.n);
  // float NdotI = -g_dot(hit.incident, hit.n, hit.p);
}
```

## Material Property Access

Materials can access per-object properties from the scene:
```glsl
// Inside material functions:
vec3 albedo = sc_get_vec3_param(hit.object_id, PARAM_ALBEDO);
float roughness = sc_get_float_param(hit.object_id, PARAM_ROUGHNESS);

// Or for procedural materials:
vec3 albedo = marble_pattern(hit.p);
float roughness = wear_map(hit.p, hit.n);
```

## Complete Implementation Examples

### Two-Sided Material (Leaf/Paper)
```glsl
vec3 m_interact(Direction wi, Hit hit, vec2 xi, out Direction wo, out float pdf) {
  // Check which side we're hitting from
  bool front_face = g_dot(wi, hit.n, hit.p) < 0;
  
  vec3 albedo = front_face ? 
    vec3(0.2, 0.8, 0.2) :  // Green front
    vec3(0.6, 0.6, 0.4);   // Pale back
  
  // Potentially add translucency
  if (!front_face && xi.x < 0.3) {
    // 30% chance of transmission through thin material
    wo = -wi;  // Straight through
    pdf = 0.3;
    return albedo * 0.5;  // Some attenuation
  }
  
  // Regular diffuse for rest
  Frame frame = g_frame(hit.p, hit.n);
  float phi = 2.0 * PI * xi.x;
  float cos_theta = sqrt(xi.y);
  float sin_theta = sqrt(1.0 - xi.y);
  
  wo = frame.t * sin_theta * cos(phi) + 
       frame.b * sin_theta * sin(phi) + 
       frame.n * cos_theta;
  
  pdf = cos_theta / PI;
  return albedo / PI;
}
```

### Nested Dielectric (Water in Glass)
```glsl
vec3 m_interact(Direction wi, Hit hit, vec2 xi, out Direction wo, out float pdf) {
  // Scene has already resolved the interface for us!
  // If we're water hitting glass boundary:
  // hit.material_from = WATER (ior = 1.33)
  // hit.material_to = GLASS (ior = 1.5)
  // hit.ior_ratio = 1.33/1.5 = 0.887
  
  // Just use the precomputed ratio
  float eta = hit.ior_ratio;
  
  // Standard glass code works for ANY interface
  float cos_theta_i = -g_dot(wi, hit.n, hit.p);
  float F = fresnel_dielectric(cos_theta_i, eta);
  
  if (xi.x < F) {
    wo = reflect_direction(wi, hit.n, hit.p);
    pdf = F;
    return vec3(1.0);
  } else {
    wo = refract_direction(wi, hit.n, eta, hit.p);
    pdf = 1.0 - F;
    return vec3(eta * eta);  // Radiance correction
  }
}
```

### Volumetric Material
```glsl
#define MATERIAL_TYPE volume

vec3 m_sigma_s(Point p) {
  float density = cloud_density(p);  // Procedural density
  return vec3(0.8) * density;        // Scattering albedo
}

vec3 m_sigma_a(Point p) {
  float density = cloud_density(p);
  return vec3(0.2) * density;        // Absorption
}

float m_phase_g(Point p) {
  return 0.7;  // Forward scattering
}

float m_phase_eval(Direction wi, Direction wo, Point p) {
  float cos_theta = g_dot(wi, wo, p);
  float g = m_phase_g(p);
  float g2 = g * g;
  float denom = 1.0 + g2 - 2.0 * g * cos_theta;
  return (1.0 - g2) / (4.0 * PI * pow(denom, 1.5));
}

Direction m_phase_sample(Direction wi, Point p, vec2 xi, out float pdf) {
  float g = m_phase_g(p);
  float cos_theta;
  
  if (abs(g) < 0.001) {
    // Isotropic case
    cos_theta = 1.0 - 2.0 * xi.x;
  } else {
    // Henyey-Greenstein sampling
    float s = (1.0 - g*g) / (1.0 - g + 2.0*g*xi.x);
    cos_theta = (1.0 + g*g - s*s) / (2.0 * g);
  }
  
  // Build direction
  float sin_theta = sqrt(max(0.0, 1.0 - cos_theta * cos_theta));
  float phi = 2.0 * PI * xi.y;
  
  Frame frame = g_frame(p, wi);
  Direction wo = frame.t * sin_theta * cos(phi) + 
                 frame.b * sin_theta * sin(phi) + 
                 frame.n * cos_theta;
  
  pdf = m_phase_eval(wi, wo, p);
  return wo;
}
```

## Geometry-Agnostic Implementation

Materials must use geometry functions for all geometric operations:
```glsl
// DON'T: Assume Euclidean space
float NdotL = dot(normal, light_dir);  // WRONG!
Direction reflected = reflect(incident, normal);  // WRONG in curved space!

// DO: Use geometry module
float NdotL = g_dot(normal, light_dir, hit.p);  // Correct

// DO: Proper reflection in curved space
Direction reflect_curved(Direction I, Direction N, Point p) {
  float NdotI = g_dot(N, I, p);
  Direction refl_local = I - 2.0 * NdotI * N;
  // Ensure it's in the tangent space
  return normalize(refl_local);
}

// DO: Proper refraction in curved space
Direction refract_curved(Direction I, Direction N, float eta, Point p) {
  float NdotI = -g_dot(I, N, p);
  float k = 1.0 - eta * eta * (1.0 - NdotI * NdotI);
  if (k < 0.0) return vec3(0);  // Total internal reflection
  return normalize(eta * I + (eta * NdotI - sqrt(k)) * N);
}
```

## Validation Requirements

The compiler ensures generated materials:
1. All required functions are implemented
2. Energy conservation maintained (albedo ≤ 1, Fresnel ≤ 1)
3. PDFs are properly normalized (integrate to 1)
4. Directions are unit vectors
5. No NaN or Inf values possible
6. Return valid (non-negative) values
7. Handle edge cases (grazing angles, total internal reflection)
8. Maintain reciprocity for non-delta materials

## Performance Notes

- **Precompute expensive procedural textures** when possible
- **Use importance sampling** to reduce variance
- **Consider LUTs** for complex BRDF evaluation
- **Cache IOR ratios** at material interfaces
- **Optimize for common cases** (constant albedo, roughness)
- **Batch property lookups** to improve cache coherence
- **Use simplified BRDFs** at distance (LOD)
- **Avoid redundant Frame construction** - compute once per hit

## Debug Support

```typescript
// Can generate debug versions
MaterialCompiler.compile(analysis, {
  debug: true,  // Add comments and validation
  profile: true // Add performance counters
});

// Generates:
// /* Feature: Roughness (uniform) */
// float roughness = u_roughness[hit.object_id];
// DEBUG_COUNTER(ROUGHNESS_ACCESS);
```
