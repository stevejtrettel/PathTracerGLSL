# Material Module Contract

## Purpose
Material modules define how surfaces and volumes interact with light, providing either simple shading for direct illumination or full BSDF evaluation and sampling for path tracing. Materials work in any geometry by using geometric operations rather than assuming Euclidean space.

## Core Principle: Every Hit is an Interface
Every ray-surface intersection represents a transition between two materials. Even a simple sphere in empty space involves air→sphere or sphere→air transitions. The renderer ALWAYS tracks both materials at every hit point.

## Module Descriptor
```typescript
{
  type: 'material',
  id: string,                    // e.g., 'disney_brdf', 'glass', 'volumetric'
  provides: ['material'],
  requires: ['geometry'],         // Always needs geometry
  uniforms: [],                   // Material-specific parameters
  resources: [],                  // Textures, etc.
  defines: {
    MATERIAL_TYPE: 'surface' | 'volume' | 'both',
    SUPPORTS_FULL_BSDF?: boolean,  // Has eval/sample/pdf functions
    IS_DELTA?: boolean,            // Perfect specular/transmission
    USES_EMISSION?: boolean,       // Can emit light
    PRIORITY?: number              // For nested dielectrics (default: 0)
  }
}
```

## Direction Convention
- **wi**: Incident direction - points TOWARD the surface (incoming light)
- **wo**: Outgoing direction - points AWAY from surface (scattered light)
- At a hit point: `wi = -ray.direction` (flip the ray direction)
- Both wi and wo are in world space, not local tangent space

## Required Functions (Choose One Interface)

### Option A: Simple Shading (Direct Illumination Only)
For materials that only support direct lighting:
```glsl
vec3 m_shade(Direction wi, Hit hit)
```
- **wi**: Incident direction (toward surface, i.e., -ray.direction)
- **hit**: Complete hit information including material interface
- **returns**: Shaded color for direct illumination
- **Note**: Function will be auto-prefixed to `m_shade` in compiled shader

### Option B: Full Interaction (Path Tracing)
For materials that support indirect illumination:
```glsl
vec3 m_interact(Direction wi, Hit hit, vec2 xi, out Direction wo, out float pdf)
```
- **wi**: Incident direction (toward surface, i.e., -ray.direction)
- **hit**: Complete hit information including material interface
- **xi**: Random numbers [0,1)²
- **wo**: [output] Sampled outgoing direction (away from surface)
- **pdf**: [output] Probability density of sampling wo
- **returns**: BSDF * cos(θ) / pdf contribution
- **Note**: Function will be auto-prefixed to `m_interact` in compiled shader

## Optional Functions (For Advanced Algorithms)

### Separate BSDF Components
When algorithms need to evaluate BSDF separately from sampling:
```glsl
vec3 m_eval(Direction wi, Direction wo, Hit hit)
float m_pdf(Direction wi, Direction wo, Hit hit)
Direction m_sample(Direction wi, Hit hit, vec2 xi, out float pdf)
```
- **Note**: If provided, these override the default behavior from `interact`

### Emission
For emissive materials:
```glsl
vec3 m_emission(Hit hit)
```
- **returns**: Emitted radiance at hit point
- **Note**: Return vec3(0) for non-emissive materials

### Index of Refraction
For dielectric materials:
```glsl
float m_ior(Hit hit)
```
- **returns**: Index of refraction
- **Note**: May vary spatially for gradient-index materials

### Priority
For resolving nested dielectrics:
```glsl
float m_priority(Hit hit)
```
- **returns**: Priority value (higher wins at interfaces)
- **Default**: 0 for opaque materials, standard values for dielectrics

### Material Classification
```glsl
bool m_is_delta()      // True for perfect specular/transmission
bool m_is_emissive()   // True if material emits light
bool m_is_volume()     // True if material has volumetric properties
```

## Volumetric Functions (Optional)

For participating media:
```glsl
vec3 m_sigma_s(Point p)   // Scattering coefficient
vec3 m_sigma_a(Point p)   // Absorption coefficient
float m_phase_g(Point p)  // Henyey-Greenstein g parameter [-1,1]

// Phase function evaluation
float m_phase_eval(Direction wi, Direction wo, Point p)
Direction m_phase_sample(Direction wi, Point p, vec2 xi, out float pdf)
```

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

## Implementation Examples

### Lambertian Diffuse
```glsl
uniform vec3 albedo;

vec3 m_interact(Direction wi, Hit hit, vec2 xi, out Direction wo, out float pdf) {
  // Opaque material - interface doesn't affect diffuse
  
  // Sample cosine-weighted hemisphere
  Frame frame = g_frame(hit.p, hit.n);
  float phi = 2.0 * PI * xi.x;
  float cos_theta = sqrt(xi.y);
  float sin_theta = sqrt(1.0 - xi.y);
  
  Direction local = vec3(
    sin_theta * cos(phi),
    sin_theta * sin(phi),
    cos_theta
  );
  
  wo = frame.t * local.x + frame.b * local.y + frame.n * local.z;
  pdf = cos_theta / PI;
  
  // BRDF * cos / pdf = (albedo/PI) * cos / (cos/PI) = albedo
  return albedo;
}

vec3 m_eval(Direction wi, Direction wo, Hit hit) {
  return albedo / PI;
}

float m_pdf(Direction wi, Direction wo, Hit hit) {
  return max(0.0, g_dot(wo, hit.n, hit.p)) / PI;
}
```

### Glass Material (Using Interface Info)
```glsl
#define IS_DELTA true
#define PRIORITY 20

vec3 m_interact(Direction wi, Hit hit, vec2 xi, out Direction wo, out float pdf) {
  // Interface info tells us if entering or exiting
  float eta = hit.ior_ratio;  // Already computed by scene!
  
  float cos_theta_i = -g_dot(wi, hit.n, hit.p);
  float F = fresnel_dielectric(cos_theta_i, eta);
  
  if (xi.x < F) {
    // Reflect
    wo = reflect_direction(wi, hit.n, hit.p);
    pdf = F;
    return vec3(1.0);  // F/F = 1
  } else {
    // Refract using precomputed IOR ratio
    wo = refract_direction(wi, hit.n, eta, hit.p);
    pdf = 1.0 - F;
    
    // Radiance correction for IOR change
    return vec3(eta * eta);
  }
}

bool m_is_delta() { return true; }

float m_priority(Hit hit) {
  return 20.0;  // Glass priority
}
```

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
  // ... cosine hemisphere sampling
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
  
  // ... rest of glass implementation
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
```

## Geometry-Agnostic Implementation

Materials must use geometry functions for all geometric operations:
```glsl
// DON'T: Assume Euclidean space
float NdotL = dot(normal, light_dir);  // WRONG!

// DO: Use geometry module
float NdotL = g_dot(normal, light_dir, hit.p);  // Correct

// DON'T: Assume flat parallel transport
Direction reflected = reflect(incident, normal);  // WRONG in curved space!

// DO: Proper reflection in curved space
Direction reflected = reflect_curved(incident, normal, hit.p);

Direction reflect_curved(Direction I, Direction N, Point p) {
  float NdotI = g_dot(N, I, p);
  Direction refl_local = I - 2.0 * NdotI * N;
  // Transport back to ensure it's in the tangent space
  return normalize(refl_local);
}
```

## Validation Requirements
The engine validates that material modules:
1. Provide either `m_shade` OR `m_interact` function
2. Return valid (non-NaN, non-negative) values
3. Maintain energy conservation (albedo ≤ 1)
4. Return normalized directions
5. Return positive PDFs for non-delta materials

## Performance Notes
- Precompute expensive procedural textures when possible
- Use importance sampling to reduce variance
- Consider using LUTs for complex BRDF evaluation
- Cache IOR ratios at material interfaces
- Optimize for common cases (constant albedo, roughness)
