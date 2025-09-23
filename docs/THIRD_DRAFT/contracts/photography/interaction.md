
# Interaction Contract

## Module Structure

```typescript
{
  id: {
    kind: 'interaction',
    name: string,              // 'disney' | 'lambert' | 'debug_normal'
    version: string
  },
  fragment: {
    functions: string,         // Light-matter interaction implementation
    constants?: string         // Configuration defines
  }
}
```

## Purpose

Interaction modules implement the physics of light-matter interaction. They bridge between material properties (from World) and transport algorithms (in Photography), computing how light behaves when it encounters surfaces and volumes.

## Required Functions

### Surface Interaction

```glsl
// Evaluate BRDF/BSDF for given directions
Spectrum interaction_surface_shade(vec3 wi, vec3 wo, Hit hit)

// Sample outgoing direction given incident  
vec3 interaction_surface_scatter(vec3 wi, Hit hit, vec2 xi, out float pdf)

// Probability density of direction pair
float interaction_surface_pdf(vec3 wi, vec3 wo, Hit hit)

// Surface emission
Spectrum interaction_surface_emit(Hit hit)
```

### Volume Interaction

```glsl
// Evaluate phase function and handle extinction
Spectrum interaction_volume_shade(vec3 wi, vec3 wo, vec3 p, int mat_id, float distance)

// Sample scattering direction
vec3 interaction_volume_scatter(vec3 wi, vec3 p, int mat_id, vec2 xi, out float pdf)

// Phase function PDF
float interaction_volume_pdf(vec3 wi, vec3 wo, vec3 p, int mat_id)

// Volume emission (beers law)
Spectrum interaction_volume_emit(vec3 p, int mat_id, float distance)
```

Note: `interaction_volume_shade` takes distance to handle Beer's law extinction along the segment.

## Material Property Interface

Interaction modules expect these functions from the material module:

```glsl
// Efficient batched query
struct MaterialProperties {
  vec3 albedo;
  float roughness;
  float metallic;
  float ior;
  vec3 emission;
  float emission_intensity;
  // Volume properties if applicable
  vec3 sigma_scatter;
  vec3 sigma_absorb;
  float phase_g;  // Asymmetry parameter
};

MaterialProperties material_get_properties(int mat_id, vec3 p)
```

## Implementation: Debug Normal

Simplest possible interaction for visualization:

```glsl
Spectrum interaction_surface_shade(vec3 wi, vec3 wo, Hit hit) {
  return Spectrum(hit.n * 0.5 + 0.5);
}

vec3 interaction_surface_scatter(vec3 wi, Hit hit, vec2 xi, out float pdf) {
  // Uniform hemisphere for completeness
  vec3 wo = sample_uniform_hemisphere(hit.frame, xi);
  pdf = 1.0 / (2.0 * PI);
  return wo;
}

float interaction_surface_pdf(vec3 wi, vec3 wo, Hit hit) {
  return 1.0 / (2.0 * PI);
}

Spectrum interaction_surface_emit(Hit hit) {
  return Spectrum(0);
}
```

## Implementation: Lambert Diffuse

```glsl
Spectrum interaction_surface_shade(vec3 wi, vec3 wo, Hit hit) {
  MaterialProperties mp = material_get_properties(hit.material_to, hit.p);
  
  float cos_o = max(0, dot(wo, hit.n));
  return Spectrum(mp.albedo / PI) * cos_o;
}

vec3 interaction_surface_scatter(vec3 wi, Hit hit, vec2 xi, out float pdf) {
  // Cosine-weighted hemisphere sampling
  float cos_theta = sqrt(xi.y);
  float sin_theta = sqrt(1.0 - xi.y);
  float phi = 2.0 * PI * xi.x;
  
  vec3 wo = hit.frame.t * sin_theta * cos(phi) + 
            hit.frame.b * sin_theta * sin(phi) + 
            hit.frame.n * cos_theta;
  
  pdf = cos_theta / PI;
  return wo;
}

float interaction_surface_pdf(vec3 wi, vec3 wo, Hit hit) {
  float cos_o = dot(wo, hit.n);
  return (cos_o > 0.0) ? cos_o / PI : 0.0;
}

Spectrum interaction_surface_emit(Hit hit) {
  MaterialProperties mp = material_get_properties(hit.material_to, hit.p);
  return Spectrum(mp.emission * mp.emission_intensity);
}
```

## Implementation: Disney BRDF

```glsl
Spectrum interaction_surface_shade(vec3 wi, vec3 wo, Hit hit) {
  MaterialProperties mp = material_get_properties(hit.material_to, hit.p);
  
  // Handle special materials
  if (hit.material_to == MATERIAL_AIR) return Spectrum(0);
  
  // Dielectric handling
  if (mp.ior != 1.0 && mp.metallic < 0.01) {
    return shade_dielectric(wi, wo, hit, mp.ior);
  }
  
  // Disney diffuse + specular
  float alpha = mp.roughness * mp.roughness;
  vec3 h = normalize(wi + wo);
  
  float D = ggx_distribution(dot(hit.n, h), alpha);
  float G = ggx_geometry(wi, wo, hit.n, alpha);
  vec3 F = fresnel_schlick(mp.albedo, mp.metallic, dot(wi, h));
  
  vec3 diffuse = mp.albedo * (1.0 - mp.metallic) / PI;
  vec3 specular = F * D * G / (4.0 * abs(dot(wi, hit.n)) * abs(dot(wo, hit.n)));
  
  return Spectrum(diffuse + specular);
}

vec3 interaction_surface_scatter(vec3 wi, Hit hit, vec2 xi, out float pdf) {
  MaterialProperties mp = material_get_properties(hit.material_to, hit.p);
  
  // Special case: perfect specular
  if (mp.roughness < 0.001) {
    pdf = 1.0;
    return reflect(-wi, hit.n);
  }
  
  // Special case: glass
  if (mp.ior != 1.0 && mp.metallic < 0.01) {
    return scatter_dielectric(wi, hit, mp.ior, xi, pdf);
  }
  
  // GGX importance sampling
  float alpha = mp.roughness * mp.roughness;
  vec3 h = sample_ggx_vndf(wi, hit.frame, alpha, xi);
  vec3 wo = reflect(-wi, h);
  
  // Compute PDF
  float D = ggx_distribution(dot(hit.n, h), alpha);
  float G1 = ggx_g1(wi, hit.n, alpha);
  pdf = D * G1 / (4.0 * abs(dot(wi, hit.n)));
  
  return wo;
}
```

## Volume Interaction with Beer's Law

```glsl
Spectrum interaction_volume_shade(vec3 wi, vec3 wo, vec3 p, int mat_id, float distance) {
  MaterialProperties mp = material_get_properties(mat_id, p);
  
  // Phase function evaluation
  float phase = henyey_greenstein(dot(wi, wo), mp.phase_g);
  
  // Beer's law extinction along the segment
  vec3 extinction = mp.sigma_scatter + mp.sigma_absorb;
  vec3 transmittance = exp(-extinction * distance);
  
  // Integrated emission along segment (assuming constant)
  vec3 emission_contrib = mp.emission * mp.emission_intensity * 
                          (1.0 - transmittance) / max(extinction, vec3(0.001));
  
  return Spectrum(mp.sigma_scatter * phase * transmittance + emission_contrib);
}

vec3 interaction_volume_scatter(vec3 wi, vec3 p, int mat_id, vec2 xi, out float pdf) {
  MaterialProperties mp = material_get_properties(mat_id, p);
  
  // Sample Henyey-Greenstein phase function
  float g = mp.phase_g;
  float cos_theta = 0;
  
  if (abs(g) < 0.001) {
    // Isotropic
    cos_theta = 1.0 - 2.0 * xi.x;
  } else {
    // Henyey-Greenstein sampling
    float sqr = (1.0 - g * g) / (1.0 - g + 2.0 * g * xi.x);
    cos_theta = (1.0 + g * g - sqr * sqr) / (2.0 * g);
  }
  
  // Generate direction
  float sin_theta = sqrt(max(0, 1.0 - cos_theta * cos_theta));
  float phi = 2.0 * PI * xi.y;
  
  // Build frame around wi
  vec3 u, v;
  make_orthonormal_basis(wi, u, v);
  
  vec3 wo = sin_theta * cos(phi) * u + 
            sin_theta * sin(phi) * v + 
            cos_theta * wi;
  
  pdf = henyey_greenstein(cos_theta, g);
  return wo;
}
```

## Special Materials

### Perfect Specular (Delta)
```glsl
vec3 scatter_dielectric(vec3 wi, Hit hit, float ior, vec2 xi, out float pdf) {
  float eta = hit.ior_ratio;  // Precomputed n1/n2
  float cos_i = -dot(wi, hit.n);
  float F = fresnel_dielectric(cos_i, eta);
  
  if (xi.x < F) {
    // Reflection
    pdf = F;
    return reflect(-wi, hit.n);
  } else {
    // Refraction
    pdf = 1.0 - F;
    vec3 wo = refract(-wi, hit.n, eta);
    pdf *= eta * eta;  // Radiance correction
    return wo;
  }
}
```

### Subsurface Scattering
```glsl
// Could be handled as a special case in shade/scatter
// Or delegated to transport for more complex models
```

## Module Variants

Different interaction modules for different use cases:

| Module Name | Purpose | Properties Used |
|------------|---------|----------------|
| `debug_normal` | Visualization | None |
| `debug_albedo` | Preview | albedo only |
| `lambert` | Simple diffuse | albedo |
| `disney` | Production | all surface properties |
| `glass` | Dielectrics | ior, roughness |
| `volumetric_hg` | Clouds/smoke | sigma_*, phase_g |

## Performance Notes

1. Query material properties once per interaction
2. Precompute expensive values (alpha = roughness²)
3. Use efficient sampling strategies
4. Special-case perfect specular (delta distributions)
5. Consider separate modules for simple vs complex materials

## Validation

1. Energy conservation: albedo ≤ 1, Fresnel ≤ 1
2. PDF normalization over hemisphere/sphere
3. Reciprocity: shade(wi, wo) == shade(wo, wi) for non-delta
4. Non-negative emission
5. Proper handling of material boundaries (air interfaces)
