# Phase 2.2: Lambert Interaction - Detailed Plan

## Purpose & Scope

Phase 2.2 implements a physically correct Lambert (diffuse) BRDF with proper importance sampling. This replaces our debug normal visualization with real light-matter interaction, enabling energy-conserving diffuse bounces that form the foundation of global illumination.

**Core Goal**: Implement Lambert BRDF with cosine-weighted hemisphere sampling for efficient, unbiased diffuse reflection.

## File Structure & Responsibilities

### `src/photography/interaction/lambert.glsl` - Lambertian BRDF

**Purpose**: Model perfectly diffuse surfaces that scatter light equally in all directions (within the hemisphere).

## Core Mathematical Foundation

### Lambert BRDF Theory

The Lambert BRDF is constant:
```
f_lambert = albedo / π
```

The rendering equation integral for diffuse surfaces:
```
L_o = ∫ f_lambert * L_i * cos(θ) dω
    = (albedo/π) * ∫ L_i * cos(θ) dω
```

For importance sampling, we sample proportional to cos(θ) to reduce variance.

## Core Implementation

### BRDF Evaluation

```glsl
// Constants
#define LAMBERT_INV_PI 0.31830988618

// Evaluate Lambert BRDF for given directions
vec3 interaction_evaluate_brdf(Hit hit, vec3 wi, vec3 wo) {
    // Check if both directions are in same hemisphere
    if (!interaction_same_hemisphere(wi, wo, hit.n)) {
        return vec3(0.0);
    }
    
    // Get material properties from scene
    vec3 albedo;
    float roughness;  // Ignored for Lambert
    scene_get_material(hit, albedo, roughness);
    
    // Lambert BRDF = albedo / π
    return albedo * LAMBERT_INV_PI;
}
```

### Importance Sampling

```glsl
// Sample Lambert BRDF with cosine-weighted hemisphere sampling
vec3 interaction_sample_brdf(Hit hit, vec3 wo, vec2 u, out vec3 wi, out float pdf) {
    // Get material properties
    vec3 albedo;
    float roughness;  // Ignored for Lambert
    scene_get_material(hit, albedo, roughness);
    
    // Build local coordinate frame
    vec3 n = hit.n;
    vec3 t, b;
    geometry_frame(n, t, b);
    
    // Sample cosine-weighted hemisphere (Malley's method)
    vec3 local_wi = interaction_sample_cosine_hemisphere(u);
    
    // Transform to world space
    wi = local_wi.x * t + local_wi.y * b + local_wi.z * n;
    
    // Ensure wi is in correct hemisphere
    if (dot(wi, n) <= 0.0) {
        pdf = 0.0;
        return vec3(0.0);
    }
    
    // PDF for cosine-weighted sampling = cos(θ) / π
    pdf = dot(wi, n) * LAMBERT_INV_PI;
    
    // Return BRDF value (albedo / π)
    return albedo * LAMBERT_INV_PI;
}
```

### PDF Evaluation

```glsl
// Evaluate PDF for given directions
float interaction_pdf_brdf(Hit hit, vec3 wi, vec3 wo) {
    // Check hemisphere
    if (!interaction_same_hemisphere(wi, wo, hit.n)) {
        return 0.0;
    }
    
    // Cosine-weighted PDF = cos(θ) / π
    return max(0.0, dot(wi, hit.n)) * LAMBERT_INV_PI;
}
```

### Sampling Helpers

```glsl
// Sample cosine-weighted hemisphere using concentric disk mapping
vec3 interaction_sample_cosine_hemisphere(vec2 u) {
    // Malley's method: uniform disk -> cosine hemisphere
    vec2 d = interaction_concentric_disk(u);
    
    // Project to hemisphere
    float z = sqrt(max(0.0, 1.0 - d.x*d.x - d.y*d.y));
    
    return vec3(d.x, d.y, z);
}

// Shirley's concentric disk mapping
vec2 interaction_concentric_disk(vec2 u) {
    // Map [0,1]² to [-1,1]²
    vec2 offset = 2.0 * u - 1.0;
    
    // Handle center
    if (offset.x == 0.0 && offset.y == 0.0) {
        return vec2(0.0);
    }
    
    // Apply concentric mapping
    float theta, r;
    if (abs(offset.x) > abs(offset.y)) {
        r = offset.x;
        theta = (GEOMETRY_EUCLIDEAN_PI / 4.0) * (offset.y / offset.x);
    } else {
        r = offset.y;
        theta = (GEOMETRY_EUCLIDEAN_PI / 2.0) - (GEOMETRY_EUCLIDEAN_PI / 4.0) * (offset.x / offset.y);
    }
    
    return r * vec2(cos(theta), sin(theta));
}

// Check if directions are in same hemisphere
bool interaction_same_hemisphere(vec3 wi, vec3 wo, vec3 n) {
    return dot(wi, n) * dot(wo, n) > 0.0;
}
```

### Utility Functions

```glsl
// Reflect vector around normal
vec3 interaction_reflect(vec3 v, vec3 n) {
    return -v + 2.0 * dot(v, n) * n;
}

// Fresnel reflectance for dielectrics (Schlick approximation)
// Included for future use when adding specular materials
float interaction_fresnel_dielectric(float cos_theta_i, float eta_i, float eta_t) {
    float c = cos_theta_i;
    if (c < 0.0) {
        float temp = eta_i;
        eta_i = eta_t;
        eta_t = temp;
        c = -c;
    }
    
    float r0 = (eta_i - eta_t) / (eta_i + eta_t);
    r0 = r0 * r0;
    
    return r0 + (1.0 - r0) * pow(1.0 - c, 5.0);
}

// Get hemisphere orientation (for transmission later)
float interaction_hemisphere_sign(vec3 w, vec3 n) {
    return dot(w, n) > 0.0 ? 1.0 : -1.0;
}
```

## Why Cosine-Weighted Sampling?

### Uniform Hemisphere Sampling (Bad)
```glsl
// DON'T DO THIS - High variance!
vec3 bad_sample_uniform() {
    // Uniform hemisphere: PDF = 1/(2π)
    // BRDF * cos(θ) / PDF = (albedo/π) * cos(θ) * 2π
    // Variance proportional to cos(θ) variation!
}
```

### Cosine-Weighted Sampling (Good)
```glsl
// DO THIS - Low variance!
// Sample proportional to cos(θ)
// PDF = cos(θ)/π
// BRDF * cos(θ) / PDF = (albedo/π) * cos(θ) / (cos(θ)/π) = albedo
// Constant! No variance from geometry term!
```

The importance sampling eliminates the geometric cos(θ) term from the Monte Carlo estimator, dramatically reducing variance.

## Integration with Path Tracer

The path tracer in Phase 2.1 will call these functions:

```glsl
// In transport_trace():
vec3 brdf = interaction_sample_brdf(hit, -ray.direction, random2(), wi, pdf);

// The returned wi is already importance sampled
// The PDF accounts for the cosine weighting
// Throughput update becomes simple:
throughput *= brdf * abs(dot(wi, hit.n)) / pdf;
// Which simplifies to approximately: throughput *= albedo
```

## Material Override for Testing

```glsl
// Debug mode: override materials for testing
#ifdef DEBUG_WHITE_MATERIALS
vec3 interaction_debug_white_material() {
    return vec3(0.8, 0.8, 0.8);  // 80% reflectance
}
#endif
```

## Testing Strategy

### Mathematical Validation
```typescript
test('BRDF is energy conserving', () => {
  // Integrate BRDF over hemisphere
  // Should be <= 1 for physical validity
})

test('PDF integrates to 1', () => {
  // Monte Carlo integration of PDF
  // Should equal 1.0 within tolerance
})

test('Sampling matches PDF', () => {
  // Generate samples, build histogram
  // Compare to analytical PDF
})
```

### Visual Validation
```typescript
test('White furnace test', () => {
  // Sphere inside uniform white environment
  // Should converge to white
})

test('Diffuse interreflection', () => {
  // Cornell box with colored walls
  // Red wall should tint white floor
})

test('Energy conservation', () => {
  // Closed box with light
  // Total energy should be stable
})
```

### Convergence Tests
```typescript
test('Variance reduction vs uniform', () => {
  // Compare convergence rate
  // Cosine-weighted should be ~2x faster
})
```

## Performance Considerations

### Current Implementation
- Single material evaluation per intersection
- No texture lookups (flat colors)
- Analytical sampling (no rejection)
- Minimal branching

### Future Optimizations (Not Phase 2)
- Material batching
- Texture caching
- BRDF precomputation
- Specialized samplers per material

## Success Criteria

Phase 2.2 is complete when:
1. Lambert BRDF evaluates correctly
2. Cosine-weighted sampling works
3. PDF computation is accurate
4. Energy is conserved
5. Diffuse interreflection visible
6. Variance is lower than uniform sampling

## What We're NOT Doing in Phase 2.2

- Specular reflection (mirrors)
- Glossy materials (rough conductors)
- Transmission (glass)
- Subsurface scattering
- Anisotropic materials
- Layered materials
- Textures or normal maps
- Fresnel for conductors
- Microfacet models

## Connection to Phase 2.3

This Lambert implementation provides:
- Proper BRDF evaluation
- Importance sampling framework
- PDF computation pattern
- Material query interface

Phase 2.3 will add:
- Film accumulation for convergence
- Multi-sample integration
- Variance tracking

Together with the path tracer from 2.1, we now have true global illumination with proper energy conservation and importance sampling.

## Common Bugs to Avoid

```glsl
// BUG: Forgetting to check hemisphere
if (dot(wi, n) <= 0.0) return vec3(0.0);  // Critical!

// BUG: Wrong PDF normalization
pdf = cos_theta;  // WRONG - missing 1/π

// BUG: Not building proper frame
// Must use robust method for frame construction

// BUG: Using wrong coordinate system
// wi must be in world space, not local
```

## Debug Visualization

```glsl
// Visualize sampling pattern
vec3 interaction_debug_sampling(Hit hit, int samples) {
    vec3 accumulated = vec3(0.0);
    
    for (int i = 0; i < samples; i++) {
        vec2 u = vec2(float(i) / float(samples), fract(float(i) * 0.618));
        vec3 wi;
        float pdf;
        interaction_sample_brdf(hit, hit.n, u, wi, pdf);
        accumulated += wi;
    }
    
    return accumulated / float(samples);
}
```

This debug mode helps verify the sampling distribution is correct before integrating with the path tracer.
