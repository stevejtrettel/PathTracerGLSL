# Materials Contract

## Architecture

One material module per scene. MaterialIDs index into parameter tables for that single material implementation.

## Module Structure

```typescript
{
  id: {
    kind: 'material',
    name: string,              // 'disney' | 'lambert' | 'glass' | ...
    version: string
  },
  provides: ['material'],
  requires: ['geometry'],
  fragment: {
    functions: string,         // BSDF implementation
    uniforms: string,         // Parameter tables
    constants: string,        // Material count, type flags
  },
  parameters: Array<{         // Runtime-adjustable parameters
    name: string,
    type: string,
    default: any,
    uniform: boolean
  }>
}
```

## Material Analysis

```typescript
interface MaterialAnalysis {
  usedMaterialIds: MaterialID[];
  parameterRanges: {
    albedo?: [Vec3, Vec3];      // Min/max if varying
    roughness?: [number, number];
    metallic?: [number, number];
    ior?: [number, number];
  };
  hasVolumes: boolean;          // Any participating media
  hasDielectrics: boolean;      // Any refractive materials
  hasEmission: boolean;         // Any emissive materials
}
```

## Required Functions

### BSDF Interface

```glsl
// Evaluate BSDF for given directions
Spectrum evaluate(Direction wi, Direction wo, Hit hit)

// Sample BSDF direction  
Direction sample(Direction wi, Hit hit, vec2 xi, out float pdf)

// Probability density of sampling wo given wi
float pdf(Direction wi, Direction wo, Hit hit)
```

- **wi**: Incident direction (toward surface, i.e., -ray.direction)
- **wo**: Outgoing direction (away from surface)
- **hit**: Complete hit information with material interface
- **xi**: Random numbers [0,1]² for sampling
- **pdf**: Probability density in solid angle measure

Note: Engine will auto-prefix these to `m_evaluate`, `m_sample`, `m_pdf`

## Optional Functions

```glsl
// Surface emission
Spectrum emission(Hit hit)

// Type queries
bool is_delta(int mat_id)

// Simplified shading (for direct-only renderers)
Spectrum shade(Direction wi, Hit hit)
```

Note: Engine will auto-prefix these with `m_`

## Volume Properties

For participating media (NOT transport algorithms):

```glsl
Spectrum sigma_s(Point p, int mat_id)    // Scattering coefficient
Spectrum sigma_a(Point p, int mat_id)    // Absorption coefficient
float sigma_max(int mat_id)              // Majorant for delta tracking

// Phase function
Direction sample_phase(Direction wi, Point p, int mat_id, vec2 xi, out float pdf)
float eval_phase(Direction wi, Direction wo, Point p, int mat_id)
```

Note: Engine will auto-prefix these with `m_`

## Parameter Tables

MaterialIDs index into parameter arrays:

```glsl
// Generated based on analysis
struct MaterialParams {
  vec3 albedo;
  float roughness;
  float metallic;
  float ior;
};

// Compile-time constant
const MaterialParams params[NUM_MATERIALS] = MaterialParams[](
  MaterialParams(vec3(0.8, 0.2, 0.2), 0.3, 0.0, 1.5),  // ID 0
  MaterialParams(vec3(0.9, 0.9, 0.9), 0.1, 1.0, 1.5),  // ID 1
  // ...
);

// Or runtime uniform
uniform MaterialParams u_params[NUM_MATERIALS];

// Lookup by MaterialID
MaterialParams get_params(int mat_id) {
  return params[mat_id];
}
```

## Material Types

```glsl
// Type flags for dispatch
const int material_types[NUM_MATERIALS] = int[](
  MAT_TYPE_OPAQUE,                        // ID 0
  MAT_TYPE_DIELECTRIC,                    // ID 1
  MAT_TYPE_PARTICIPATING,                 // ID 2
  MAT_TYPE_OPAQUE | MAT_TYPE_SUBSURFACE, // ID 3
);

// Helper for type checking
bool is_participating(int mat_id) {
  return (material_types[mat_id] & MAT_TYPE_PARTICIPATING) != 0;
}
```

## Example: Lambert BRDF

```glsl
// Simple diffuse material
Spectrum evaluate(Direction wi, Direction wo, Hit hit) {
  // Handle air interface
  if (hit.material_to == MATERIAL_AIR && hit.material_from == MATERIAL_AIR) {
    return Spectrum(0);
  }
  
  // Get surface material
  int mat_id = (hit.material_to == MATERIAL_AIR) ? 
               hit.material_from : hit.material_to;
  
  MaterialParams mp = get_params(mat_id);
  
  // Lambert BRDF
  float cos_o = g_dot(wo, hit.n, hit.p);
  if (cos_o <= 0.0) return Spectrum(0);
  
  return Spectrum(mp.albedo / PI);
}

Direction sample(Direction wi, Hit hit, vec2 xi, out float pdf) {
  // Cosine-weighted hemisphere sampling
  Frame frame = hit.frame;
  float cos_theta = sqrt(xi.y);
  float sin_theta = sqrt(1.0 - xi.y);
  float phi = 2.0 * PI * xi.x;
  
  Direction wo = frame.t * sin_theta * cos(phi) + 
                 frame.b * sin_theta * sin(phi) + 
                 frame.n * cos_theta;
  
  pdf = cos_theta / PI;
  return wo;
}

float pdf(Direction wi, Direction wo, Hit hit) {
  float cos_o = g_dot(wo, hit.n, hit.p);
  return (cos_o > 0.0) ? cos_o / PI : 0.0;
}
```

## Example: Disney BRDF

```glsl
// Disney BRDF with GGX microfacet model
Spectrum evaluate(Direction wi, Direction wo, Hit hit) {
  // Handle air interface
  if (hit.material_to == MATERIAL_AIR && hit.material_from == MATERIAL_AIR) {
    return Spectrum(0);
  }
  
  int mat_id = (hit.material_to == MATERIAL_AIR) ? 
               hit.material_from : hit.material_to;
  
  MaterialParams mp = get_params(mat_id);
  
  // Check for dielectric
  if (material_types[mat_id] & MAT_TYPE_DIELECTRIC) {
    return evaluate_dielectric(wi, wo, hit, mp.ior);
  }
  
  // Disney diffuse + specular
  float alpha = mp.roughness * mp.roughness;
  
  Direction h = normalize(wi + wo);
  float D = ggx_d(hit.n, h, alpha);
  float G = ggx_g(wi, wo, hit.n, alpha);
  Spectrum F = fresnel_schlick(Spectrum(mp.albedo), mp.metallic, g_dot(wi, h, hit.p));
  
  Spectrum diffuse = Spectrum(mp.albedo) * (1.0 - mp.metallic) / PI;
  Spectrum specular = F * D * G / (4.0 * abs(g_dot(wi, hit.n, hit.p)) * 
                                         abs(g_dot(wo, hit.n, hit.p)));
  
  return diffuse + specular;
}

Direction sample(Direction wi, Hit hit, vec2 xi, out float pdf) {
  int mat_id = (hit.material_to == MATERIAL_AIR) ? 
               hit.material_from : hit.material_to;
  
  MaterialParams mp = get_params(mat_id);
  float alpha = mp.roughness * mp.roughness;
  
  // GGX importance sampling
  Direction wo = sample_ggx_vndf(wi, hit.frame, alpha, xi);
  
  // Compute PDF
  Direction h = normalize(wi + wo);
  float D = ggx_d(hit.n, h, alpha);
  float G1 = ggx_g1(wi, hit.n, alpha);
  pdf = D * G1 / (4.0 * abs(g_dot(wi, hit.n, hit.p)));
  
  return wo;
}

float pdf(Direction wi, Direction wo, Hit hit) {
  int mat_id = (hit.material_to == MATERIAL_AIR) ? 
               hit.material_from : hit.material_to;
  
  MaterialParams mp = get_params(mat_id);
  float alpha = mp.roughness * mp.roughness;
  
  Direction h = normalize(wi + wo);
  float D = ggx_d(hit.n, h, alpha);
  float G1 = ggx_g1(wi, hit.n, alpha);
  
  return D * G1 / (4.0 * abs(g_dot(wi, hit.n, hit.p)));
}
```

## Glass/Dielectric Materials

```glsl
Spectrum evaluate_dielectric(Direction wi, Direction wo, Hit hit, float ior) {
  // Dielectrics are delta - evaluation returns 0
  // (All contribution comes through sampling)
  return Spectrum(0);
}

Direction sample_dielectric(Direction wi, Hit hit, float ior, vec2 xi, out float pdf) {
  // Use precomputed IOR ratio from hit
  float eta = hit.ior_ratio;
  
  float cos_theta_i = -g_dot(wi, hit.n, hit.p);
  float F = fresnel_dielectric(cos_theta_i, eta);
  
  if (xi.x < F) {
    // Reflection
    pdf = F;
    return reflect_direction(wi, hit.n, hit.p);
  } else {
    // Refraction
    pdf = 1.0 - F;
    Direction wo = refract_direction(wi, hit.n, eta, hit.p);
    
    // Account for radiance change due to IOR
    pdf *= eta * eta;
    return wo;
  }
}

float pdf_dielectric(Direction wi, Direction wo, Hit hit, float ior) {
  return 0.0;  // Delta distribution
}
```

## Emissive Materials

```glsl
Spectrum emission(Hit hit) {
  switch(hit.material_to) {  // Emission from the surface we hit
    case MATERIAL_LIGHT:
      return Spectrum(100.0);  // Constant emission
    case MATERIAL_HOT_METAL:
      return blackbody(2000.0);  // Temperature-based
  }
  return Spectrum(0);
}
```

## Optimization Strategies

1. **Feature elimination**: Remove unused BRDF features
2. **Constant specialization**: Compile constants when all values same
3. **Parameter compression**: Group identical parameter sets
4. **Simplified models**: Use Lambert for high roughness
5. **Precomputed tables**: LUTs for complex functions

## Generation Process

```typescript
class MaterialCompiler {
  compile(materialType: string, usedIds: MaterialID[]): ModuleDescriptor {
    // Select base BRDF
    const brdf = this.loadBRDF(materialType);
    
    // Optimize based on usage
    const optimized = this.optimize(brdf, analysis);
    
    // Generate parameter tables
    const tables = this.generateTables(usedIds);
    
    return {
      id: { kind: 'material', name: materialType, version: '1.0.0' },
      fragment: {
        functions: optimized + tables.accessors,
        constants: tables.constants,
        uniforms: tables.uniforms
      }
    };
  }
}
```

## Validation

1. Material handles all MaterialIDs in scene plus MATERIAL_AIR
2. Energy conservation: albedo ≤ 1, Fresnel ≤ 1
3. PDFs properly normalized over hemisphere
4. wo directions are unit vectors
5. Reciprocity: evaluate(wi, wo) == evaluate(wo, wi) for non-delta
6. Volume properties non-negative
7. Use geometry module for all geometric operations
