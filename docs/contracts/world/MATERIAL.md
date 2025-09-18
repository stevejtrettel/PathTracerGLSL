# Material Module Contract

## Purpose
Material modules handle how surfaces and volumes interact with light. They map material IDs (from Objects) to shading properties and behaviors. Materials are generated at build time based on which material IDs are actually used in the scene, producing optimized GLSL containing only the features needed.

## Core Architecture

### Material Library Structure

```typescript
interface MaterialLibrary {
  // Material ID definitions (shared with Objects module)
  materials: Map<MaterialID, MaterialDefinition>;
  
  // Analysis of which features are actually used
  analysis: MaterialAnalysis;
  
  // Generated optimized shaders
  shaders: {
    interact?: string;  // For path tracing
    shade?: string;     // For direct illumination only
    eval?: string;      // For BRDF evaluation
    sample?: string;    // For importance sampling
  };
}

interface MaterialDefinition {
  id: MaterialID;           // Integer constant (e.g., MATERIAL_GLASS = 0)
  type: 'surface' | 'volume' | 'emissive';
  
  // Surface properties (if applicable)
  surface?: {
    albedo?: Vec3 | string;      // Constant or procedural
    roughness?: number | string;
    metallic?: number | string;
    ior?: number;
    clearcoat?: number;
    // ... other Disney BRDF parameters
  };
  
  // Volume properties (if applicable)
  volume?: {
    sigma_s?: Vec3 | string;  // Scattering coefficient
    sigma_a?: Vec3 | string;  // Absorption coefficient
    phase_g?: number;         // Phase function anisotropy
  };
  
  // Emission properties (if applicable)
  emission?: {
    radiance?: Vec3 | string;
    temperature?: number;     // For blackbody emission
  };
}
```

### Generation Pipeline

```typescript
// Build time: Analyze scene's material usage and generate optimized shaders
MaterialAnalyzer → analyze(usedMaterialIds) → MaterialCompiler → compile() → ModuleDescriptor
```

### Module Descriptor

```typescript
{
  id: {
    kind: 'material',
    name: string,                // e.g., 'optimized_brdf'
    version: string
  },
  provides: ['material'],        // Always provides material shading
  requires: ['geometry'],        // For g_dot, g_frame, etc.
  fragment: {
    functions: string,          // Generated optimized GLSL
    uniforms: string,          // Only uniforms actually needed
    constants: string,         // Material ID constants
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
- **hit**: Complete hit information (includes material_from, material_to)
- **returns**: Shaded color for direct illumination

### Option B: Full Interaction (Path Tracing)
```glsl
vec3 m_interact(Direction wi, Hit hit, vec2 xi, out Direction wo, out float pdf)
```
- **wi**: Incident direction (toward surface)
- **hit**: Complete hit information with material IDs
- **xi**: Random numbers [0,1)²
- **wo**: [output] Sampled outgoing direction
- **pdf**: [output] Probability density of sampling wo
- **returns**: BSDF * cos(θ) / pdf contribution

## Material Property Resolution

The key architectural change: Materials work with IDs, not object IDs:

```glsl
// Material module owns property tables indexed by material ID
struct MaterialProperties {
    vec3 albedo;
    float roughness;
    float metallic;
    // ... other properties
};

// Constant properties (compile-time)
const MaterialProperties material_props[NUM_MATERIALS] = MaterialProperties[](
    MaterialProperties(vec3(0.8, 0.2, 0.2), 0.5, 0.0),  // MATERIAL_RED_PLASTIC
    MaterialProperties(vec3(0.9, 0.9, 0.9), 0.1, 1.0),  // MATERIAL_SILVER
    // ...
);

// Or uniform properties (runtime-controllable)
uniform MaterialProperties u_material_props[NUM_MATERIALS];

// Simple property access by material ID
MaterialProperties get_material_properties(int material_id) {
    return material_props[material_id];
}
```

## Generation Examples

### Scene with Only Diffuse Materials

```typescript
// Analysis shows only diffuse materials used
const analysis = {
  usedMaterials: [
    { id: 0, type: 'surface', albedo: [0.8,0.2,0.2], roughness: 1.0 },
    { id: 1, type: 'surface', albedo: [0.2,0.8,0.2], roughness: 1.0 }
  ],
  hasRoughness: false,  // All roughness = 1.0
  hasMetallic: false,   // No metallic materials
  hasClearcoat: false,
  hasVolumes: false,
  hasEmission: false
};

// Generates simplified BRDF:
```
```glsl
// Material ID constants
const int MATERIAL_AIR = -1;
const int MATERIAL_RED = 0;
const int MATERIAL_GREEN = 1;

// Optimized for diffuse-only
const vec3 albedos[2] = vec3[](
    vec3(0.8, 0.2, 0.2),
    vec3(0.2, 0.8, 0.2)
);

vec3 m_interact(Direction wi, Hit hit, vec2 xi, out Direction wo, out float pdf) {
    // Air has no interaction
    if (hit.material_from == MATERIAL_AIR && hit.material_to == MATERIAL_AIR) {
        pdf = 0.0;
        return vec3(0);
    }
    
    // Get the surface material
    int surface_mat = (hit.material_to == MATERIAL_AIR) ? 
                      hit.material_from : hit.material_to;
    
    // Simple Lambert sampling
    Frame frame = hit.frame;
    float phi = 2.0 * PI * xi.x;
    float cos_theta = sqrt(xi.y);
    float sin_theta = sqrt(1.0 - xi.y);
    
    wo = frame.t * sin_theta * cos(phi) + 
         frame.b * sin_theta * sin(phi) + 
         frame.n * cos_theta;
    
    pdf = cos_theta / PI;
    return albedos[surface_mat] / PI;
}
```

### Mixed Surface and Volume Materials

```typescript
const analysis = {
  usedMaterials: [
    { id: 0, type: 'surface', albedo: [0.8,0.8,0.8], roughness: 0.3, metallic: 0.0 },
    { id: 1, type: 'volume', sigma_s: [1,1,1], sigma_a: [0.1,0.1,0.1], phase_g: 0.7 },
    { id: 2, type: 'surface', ior: 1.5 }  // Glass
  ],
  hasRoughness: true,
  hasVolumes: true,
  hasDielectrics: true
};

// Generates:
```
```glsl
// Material type flags
bool is_volume_material(int mat_id) {
    return mat_id == MATERIAL_FOG;
}

bool is_dielectric(int mat_id) {
    return mat_id == MATERIAL_GLASS;
}

// Surface interaction
vec3 m_interact_surface(Direction wi, Hit hit, vec2 xi, out Direction wo, out float pdf) {
    int mat_id = (hit.material_to == MATERIAL_AIR) ? 
                 hit.material_from : hit.material_to;
    
    switch(mat_id) {
        case MATERIAL_PLASTIC: 
            return interact_rough_plastic(wi, hit, xi, wo, pdf);
        case MATERIAL_GLASS:
            return interact_dielectric(wi, hit, xi, wo, pdf);
    }
    
    pdf = 0.0;
    return vec3(0);
}

// Volume properties
vec3 m_sigma_s(Point p, int mat_id) {
    switch(mat_id) {
        case MATERIAL_FOG: return vec3(1.0);
    }
    return vec3(0);
}

vec3 m_sigma_a(Point p, int mat_id) {
    switch(mat_id) {
        case MATERIAL_FOG: return vec3(0.1);
    }
    return vec3(0);
}

float m_phase_eval(Direction wi, Direction wo, Point p, int mat_id) {
    float g = 0.7;  // From material definition
    float cos_theta = g_dot(wi, wo, p);
    float g2 = g * g;
    float denom = 1.0 + g2 - 2.0 * g * cos_theta;
    return (1.0 - g2) / (4.0 * PI * pow(denom, 1.5));
}
```

### Full Disney BRDF with Optimization

```typescript
// Analysis shows varied material usage
const analysis = {
  usedMaterials: [...],
  hasRoughness: true,
  roughnessRange: [0.1, 0.9],
  hasMetallic: true,
  metallicUniform: false,  // Varies per material
  hasClearcoat: true,
  clearcoatConstant: 0.1,  // Always same value
  subsurfaceUsed: false    // Never used
};

// Generates Disney with optimizations:
```
```glsl
// Batched material properties
struct MaterialProperties {
    vec3 albedo;
    float roughness;
    float metallic;
    // clearcoat compiled to constant 0.1
    // no subsurface fields
};

// Properties per material ID
const MaterialProperties props[NUM_MATERIALS] = MaterialProperties[](
    MaterialProperties(vec3(0.8, 0.2, 0.2), 0.3, 0.0),
    MaterialProperties(vec3(0.9, 0.9, 0.8), 0.1, 1.0),
    // ...
);

vec3 m_interact(Direction wi, Hit hit, vec2 xi, out Direction wo, out float pdf) {
    // Handle material interfaces
    if (is_dielectric(hit.material_from) || is_dielectric(hit.material_to)) {
        return interact_dielectric(wi, hit, xi, wo, pdf);
    }
    
    // Get surface material
    int mat_id = (hit.material_to == MATERIAL_AIR) ? 
                 hit.material_from : hit.material_to;
    
    MaterialProperties mp = props[mat_id];
    float alpha = mp.roughness * mp.roughness;
    
    // GGX importance sampling
    wo = sample_ggx_vndf(wi, hit.frame, alpha, xi);
    
    // Disney evaluation (simplified - no subsurface)
    float D = ggx_d(hit.n, wo, alpha);
    float G = ggx_g(wi, wo, hit.n, alpha);
    vec3 F = fresnel_schlick(mp.albedo, mp.metallic, dot(wi, hit.n));
    
    const float CLEARCOAT = 0.1;  // Compiled constant
    
    pdf = D * G / (4.0 * abs(g_dot(wi, hit.n, hit.p)));
    return mp.albedo * (1.0 - mp.metallic) / PI + F * D * G;
}
```

## Special Material Types

### Glass/Dielectric Materials

```glsl
vec3 interact_dielectric(Direction wi, Hit hit, vec2 xi, out Direction wo, out float pdf) {
    // Use precomputed IOR ratio from hit structure
    float eta = hit.ior_ratio;  // Scene already computed this
    
    float cos_theta_i = -g_dot(wi, hit.n, hit.p);
    float F = fresnel_dielectric(cos_theta_i, eta);
    
    if (xi.x < F) {
        // Reflection
        wo = reflect_using_frame(wi, hit.frame);
        pdf = F;
        return vec3(1.0);
    } else {
        // Refraction
        wo = refract_direction(wi, hit.n, eta, hit.p);
        pdf = 1.0 - F;
        return vec3(eta * eta);  // Radiance correction
    }
}
```

### Emissive Materials

```glsl
vec3 m_emission(Hit hit) {
    switch(hit.material_to) {  // Emission from the surface we hit
        case MATERIAL_LIGHT:
            return vec3(100.0);  // Constant emission
        case MATERIAL_HOT_METAL:
            return blackbody(2000.0);  // Temperature-based
    }
    return vec3(0);
}
```

### Two-Sided Materials

```glsl
vec3 m_interact(Direction wi, Hit hit, vec2 xi, out Direction wo, out float pdf) {
    // Check which material transition we're handling
    bool entering = (hit.material_from == MATERIAL_AIR);
    
    int surface_mat = entering ? hit.material_to : hit.material_from;
    
    // Different behavior for front/back
    switch(surface_mat) {
        case MATERIAL_LEAF_FRONT:
            return interact_leaf_front(wi, hit, xi, wo, pdf);
        case MATERIAL_LEAF_BACK:
            return interact_leaf_back(wi, hit, xi, wo, pdf);
    }
}
```

## Procedural Properties

When material properties are procedural:

```glsl
// Properties can be functions of position
vec3 get_albedo(int mat_id, Point p) {
    switch(mat_id) {
        case MATERIAL_MARBLE:
            return marble_pattern(p);
        case MATERIAL_WOOD:
            return wood_grain(p);
        default:
            return props[mat_id].albedo;  // Constant
    }
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

### 2. Constant Specialization
```glsl
// If all roughness values are 0.5
const float ROUGHNESS = 0.5;
const float ALPHA = 0.25;      // Precomputed
const float ALPHA2 = 0.0625;   // Precomputed
```

### 3. Sampling Strategy Selection
```typescript
if (!analysis.hasRoughness || maxRoughness < 0.1) {
  generateUniformSampling();
} else {
  generateGGXImportanceSampling();
}
```

### 4. Material Table Compression
```glsl
// Group materials with identical properties
const int material_group[NUM_MATERIALS] = int[](0, 0, 1, 0, 2, ...);
const MaterialProperties unique_props[3] = MaterialProperties[](...);

MaterialProperties get_props(int mat_id) {
    return unique_props[material_group[mat_id]];
}
```

## Random Sampling

Materials use automatic dimension tracking:

```glsl
// Old manual tracking - DON'T DO THIS
vec2 xi1 = sample_2d(pixel_id, sample_id, dim++);

// New automatic tracking - DO THIS
vec2 xi1 = next_2d();  // Automatically increments dimension
vec3 xi3 = next_3d();  // Takes 2 dimensions
```

## Hit Structure Interface

Materials receive complete hit information with material resolution:

```glsl
struct Hit {
    Point p;              // Hit point
    Direction n;          // Normal (outward facing)
    Direction incident;   // Incoming ray direction
    float t;              // Ray parameter
    vec2 uv;              // Texture coordinates
    
    // Precomputed helpers
    Frame frame;          // Orthonormal frame
    
    // Material interface (populated by Scene)
    int material_from;    // Material ray is traveling through
    int material_to;      // Material ray would enter
    float ior_ratio;      // ior_from / ior_to (precomputed)
    
    // Object identity (for debugging/effects)
    int object_id;        // Which object was hit
}
```

## Geometry-Agnostic Implementation

Materials must use geometry functions:

```glsl
// DON'T: Assume Euclidean space
float NdotL = dot(normal, light_dir);  // WRONG!

// DO: Use geometry module
float NdotL = g_dot(normal, light_dir, hit.p);  // Correct
```

## Material Compiler

```typescript
class MaterialCompiler {
  analyze(usedMaterialIds: MaterialID[]): MaterialAnalysis {
    const materials = usedMaterialIds.map(id => 
      this.materialLibrary.get(id)
    );
    
    return {
      hasRoughness: materials.some(m => m.surface?.roughness !== 1.0),
      hasMetallic: materials.some(m => m.surface?.metallic > 0),
      hasVolumes: materials.some(m => m.type === 'volume'),
      hasDielectrics: materials.some(m => m.surface?.ior !== undefined),
      // ... analyze all features
    };
  }
  
  compile(analysis: MaterialAnalysis): ModuleDescriptor {
    const functions = this.generateOptimizedBRDF(analysis);
    const uniforms = this.generateUniforms(analysis);
    const constants = this.generateMaterialConstants(analysis);
    const tables = this.generatePropertyTables(analysis);
    
    return {
      id: { kind: 'material', name: 'optimized_brdf', version: '1.0.0' },
      fragment: {
        constants: constants,
        functions: functions + tables,
        uniforms: uniforms,
      }
    };
  }
  
  generateMaterialConstants(analysis: MaterialAnalysis): string {
    return analysis.materials.map((mat, i) => 
      `const int ${mat.name} = ${i};`
    ).join('\n');
  }
}
```




## Volumetric and Tracing Types

### Delta Tracking for Heterogeneous Volumes

Delta tracking (also known as Woodcock tracking or ratio tracking) is a technique for efficiently sampling interactions in heterogeneous participating media. Instead of marching through the volume with small fixed steps, delta tracking uses a rejection sampling approach that naturally handles varying density.

The core idea is to define a "majorant" - an upper bound on the extinction coefficient throughout the volume. We then sample distances as if the medium had this constant maximum density, but at each sampled point, we randomly accept or reject the interaction based on the ratio of actual to maximum density. This transforms the problem from numerical integration (many small steps) to Monte Carlo sampling (fewer, strategically chosen points).

```glsl
// Efficient heterogeneous volume sampling with delta tracking
bool sample_volume_interaction(Ray ray, float max_t, int mat_id,
                               out vec3 scatter_p, out bool scattered) {
    // Get majorant (maximum possible density in volume)
    // This could be precomputed or analytically known
    float sigma_max = get_sigma_max_for_material(mat_id);
    
    // If majorant is zero, no scattering possible
    if (sigma_max < EPSILON) {
        return false;
    }
    
    float t = 0.0;
    
    while (t < max_t) {
        // Sample tentative interaction distance using majorant
        t += -log(max(next_1d(), EPSILON)) / sigma_max;
        
        if (t >= max_t) {
            // Escaped the volume without interaction
            return false;
        }
        
        vec3 p = ray.origin + ray.direction * t;
        
        // Evaluate actual medium properties at this point
        MediumProps props = evaluate_medium(p, mat_id);
        float sigma_t = props.sigma_s + props.sigma_a;
        
        // Russian roulette: accept/reject based on actual vs majorant
        float p_real = sigma_t / sigma_max;
        
        if (next_1d() < p_real) {
            // Real interaction! Determine if scatter or absorb
            scatter_p = p;
            float p_scatter = props.sigma_s / max(sigma_t, EPSILON);
            scattered = (next_1d() < p_scatter);
            return true;
        }
        // Null interaction - continue sampling
    }
    
    return false;
}
```

The efficiency gains come from several factors. First, delta tracking naturally adapts to density variation - in low density regions, the rejection rate is high so we skip through quickly, while in high density regions we accept more samples. Second, we never need to evaluate the medium at regular intervals, only at strategically sampled points. Third, the algorithm is unbiased and works correctly even with extreme density variations.

For homogeneous media, delta tracking degenerates to analytical sampling (the acceptance probability is always 1.0), making it a true generalization. For media with sparse high-density regions, like clouds with dense cores, delta tracking can be orders of magnitude faster than regular marching.

### Transport Strategy by Material Type

The material module must recognize that different material types require fundamentally different transport algorithms for efficiency. This is not a limitation to be worked around, but an intentional design choice that ensures each material type uses the most appropriate algorithm.

#### Surface Materials (Opaque and Metallic)

For opaque surfaces, transport is trivial - we intersect the surface, evaluate the BRDF, and scatter. There's no internal transport. The material module should flag these materials to avoid any volume transport checks:

```glsl
// Surface materials: evaluate BRDF and done
vec3 transport_surface(Ray ray, Hit hit, vec2 xi) {
    return m_interact_surface(ray.direction, hit, xi);
}
```

#### Clear Dielectrics (Glass, Water, Diamond)

Clear dielectrics with no scattering (sigma_s = 0) should use direct exit-finding. The key insight is that we know the ray will travel in a straight line to the exit, so we can find that exit point with one efficient march:

```glsl
// Clear dielectric: find exit directly
vec3 transport_clear_dielectric(Ray ray, Hit entry, vec2 xi) {
    // Determine if we refract into the material
    bool entering = (entry.material_from == MATERIAL_AIR);
    if (!compute_refraction(...)) {
        // Total internal reflection
        return transport_reflection(...);
    }
    
    // Find exit on far side
    Ray interior_ray = make_ray(entry.p, refracted_direction);
    Hit exit;
    find_exit_from_inside(interior_ray, entry.object_id, exit);
    
    // Apply Beer's law for absorption (if any)
    vec3 transmittance = exp(-get_absorption(entry.material_to) * exit.t);
    
    // Continue from exit
    return transmittance * transport_from_exit(exit, ...);
}
```

#### Participating Media (Fog, Smoke, Clouds)

For media with scattering, we use delta tracking (described above) or step-and-check approaches. The algorithm choice depends on homogeneity:

```glsl
// Participating media: scatter within volume
vec3 transport_participating(Ray ray, Hit entry, vec2 xi) {
    vec3 scatter_p;
    bool scattered;
    
    // Find next interaction point
    if (is_homogeneous(entry.material_to)) {
        // Analytical sampling for homogeneous
        float sigma_t = get_sigma_t(entry.material_to);
        float t = -log(xi.x) / sigma_t;
        // ... check if we exit first
    } else {
        // Delta tracking for heterogeneous
        sample_volume_interaction(ray, MAX_DIST, entry.material_to, 
                                scatter_p, scattered);
    }
    
    // Handle scatter or absorption
    if (scattered) {
        Direction wo = sample_phase_function(...);
        return continue_transport(scatter_p, wo, ...);
    } else {
        return vec3(0);  // Absorbed
    }
}
```

#### Subsurface Scattering Materials

Subsurface scattering requires finding where light exits after diffusing through the material. Instead of tracing every scatter event, we use diffusion approximations:

```glsl
// Subsurface scattering: sample exit point analytically
vec3 transport_subsurface(Ray ray, Hit entry, vec2 xi) {
    // Sample exit distance using diffusion profile
    float r = sample_diffusion_radius(material_props, xi.x);
    vec2 disk = sample_unit_disk(xi.y);
    
    // Project onto tangent plane and find exit
    vec3 projected_exit = entry.p + r * (disk.x * entry.frame.t + 
                                         disk.y * entry.frame.b);
    Hit exit = find_surface_above(projected_exit, entry.object_id);
    
    // Evaluate BSSRDF
    float distance = length(exit.p - entry.p);
    vec3 bssrdf = eval_diffusion_profile(distance, material_props);
    
    return bssrdf * continue_from_exit(exit, ...);
}
```


## Performance Notes

- **Precompute expensive procedural textures** when possible
- **Use importance sampling** to reduce variance
- **Consider LUTs** for complex BRDF evaluation
- **IOR ratios computed by Scene** - Materials just use them
- **Optimize for common cases** (constant albedo, roughness)
- **Batch property lookups** to improve cache coherence
- **Use simplified BRDFs** at distance (LOD)
- **Material IDs are cheap** - Just integers to pass around

## Validation Requirements

Materials must:
1. Handle all material IDs used in scene
2. Maintain energy conservation (albedo ≤ 1, Fresnel ≤ 1)
3. Properly normalize PDFs
4. Return unit directions for wo
5. Handle edge cases (grazing angles, total internal reflection)
6. Maintain reciprocity for non-delta materials
7. Use geometry module functions consistently
8. Never produce NaN or Inf values

## Design Principles

1. **Materials work with IDs, not objects** - Clean separation
2. **Scene handles material interfaces** - Materials just shade
3. **Optimize aggressively** - Only generate code for used features
4. **Procedural as first-class** - Not special cases
5. **Geometry agnostic** - Works in any coordinate system
6. **Energy conserving** - Physically plausible by default
