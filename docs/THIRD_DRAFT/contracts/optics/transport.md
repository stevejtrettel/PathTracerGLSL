You're right about volume emission - it should be integrated along the path with Beer's law, which is what that `(1.0 - transmittance) / extinction` term does in the volume shade function.

Now let's update the transport documentation (formerly estimator):

---

# Transport Contract

## Module Structure

```typescript
{
  id: {
    kind: 'transport',
    name: string,              // 'pathtracer' | 'volumetric' | 'debug'
    version: string
  },
  fragment: {
    functions: string,         // Transport implementation
    uniforms?: string,         // Strategy parameters
    constants?: string         // Configuration defines
  },
  config?: {
    maxBounces: number,
    volumeStrategy: string,    // 'delta_tracking' | 'ray_marching'
    neeStrategy: string        // 'mis' | 'light_only' | 'none'
  }
}
```

## Required Functions

### Main Entry Point

```glsl
Spectrum transport_trace(Ray ray)
```
- Computes radiance along ray through light transport simulation
- Implements complete integration strategy
- Returns spectral radiance

## Optional Functions

```glsl
Spectrum transport_direct(Hit hit, vec3 wo)    // Direct lighting only
bool transport_occluded(vec3 p, vec3 dir, float dist)  // Shadow test
```

## Transport State

```glsl
struct TransportState {
  Spectrum throughput;   // Path contribution weight  
  Spectrum radiance;     // Accumulated radiance
  int depth;            // Bounce count
  bool specular_path;   // For NEE decisions
}
```

## Main Transport Loop

```glsl
Spectrum transport_trace(Ray ray) {
  TransportState state;
  state.throughput = Spectrum(1.0);
  state.radiance = Spectrum(0.0);
  state.depth = 0;
  state.specular_path = true;
  
  for (int bounce = 0; bounce < MAX_BOUNCES; bounce++) {
    Hit hit;
    if (!scene_intersect(ray, hit)) {
      // Environment/sky
      state.radiance += state.throughput * lights_eval_environment(ray.direction);
      break;
    }
    
    // Add surface emission
    state.radiance += state.throughput * interaction_surface_emit(hit);
    
    // Check for volume
    if (material_has_volume(hit.material_to)) {
      state = transport_volume(ray, hit, state);
      if (state.terminated) break;
    } else {
      state = transport_surface(ray, hit, state);
      if (state.terminated) break;
    }
    
    // Russian roulette
    if (bounce > RR_START_DEPTH) {
      float p_survive = min(1.0, luminance(state.throughput));
      if (next_1d() > p_survive) break;
      state.throughput /= p_survive;
    }
  }
  
  return state.radiance;
}
```

## Surface Transport

```glsl
TransportState transport_surface(Ray ray, Hit hit, TransportState state) {
  // Next Event Estimation
  #if NEE_STRATEGY != NONE
  if (!state.specular_path) {
    state.radiance += state.throughput * estimate_direct_lighting(hit, -ray.direction);
  }
  #endif
  
  // Sample next direction using interaction module
  float pdf;
  vec3 wo = interaction_surface_scatter(-ray.direction, hit, next_2d(), pdf);
  
  if (pdf < EPSILON) {
    state.terminated = true;
    return state;
  }
  
  // Evaluate BSDF using interaction module
  Spectrum f = interaction_surface_shade(-ray.direction, wo, hit);
  
  // Update throughput
  float cos_theta = abs(geometry_dot(wo, hit.n, hit.p));
  state.throughput *= f * cos_theta / pdf;
  
  // Update ray
  ray = make_ray(hit.p, wo);
  state.depth++;
  
  return state;
}
```

## Volume Transport

```glsl
TransportState transport_volume(Ray ray, Hit entry, TransportState state) {
  #if VOLUME_STRATEGY == DELTA_TRACKING
    return delta_track_volume(ray, entry, state);
  #elif VOLUME_STRATEGY == RAY_MARCHING
    return raymarch_volume(ray, entry, state);
  #endif
}
```

### Delta Tracking

```glsl
TransportState delta_track_volume(Ray ray, Hit entry, TransportState state) {
  int mat_id = entry.material_to;
  MaterialProperties mp = material_get_properties(mat_id, entry.p);
  float sigma_max = mp.sigma_majorant;
  
  vec3 p = entry.p;
  vec3 dir = ray.direction;
  float segment_distance = 0;
  
  while (true) {
    // Sample free path
    float t = -log(max(next_1d(), EPSILON)) / sigma_max;
    p = p + dir * t;
    segment_distance += t;
    
    // Check if still inside volume
    if (scene_classify_point(p, entry.object_id) != mat_id) {
      // Exited volume - apply extinction for final segment
      Spectrum extinction = interaction_volume_shade(dir, dir, p, mat_id, segment_distance);
      state.throughput *= extinction;
      
      // Continue from exit point
      ray = make_ray(p, dir);
      return state;
    }
    
    // Get local properties
    mp = material_get_properties(mat_id, p);
    vec3 sigma_t = mp.sigma_scatter + mp.sigma_absorb;
    float p_real = length(sigma_t) / sigma_max;
    
    if (next_1d() < p_real) {
      // Real interaction
      
      // Apply extinction and emission for segment
      Spectrum segment_contribution = interaction_volume_shade(
        dir, dir, p, mat_id, segment_distance
      );
      state.radiance += state.throughput * segment_contribution;
      
      // Reset segment distance
      segment_distance = 0;
      
      // Scatter or absorb
      float p_scatter = length(mp.sigma_scatter) / max(length(sigma_t), EPSILON);
      if (next_1d() < p_scatter) {
        // Sample new direction using interaction
        float phase_pdf;
        vec3 wo = interaction_volume_scatter(dir, p, mat_id, next_2d(), phase_pdf);
        
        // Update throughput (just scattering albedo, phase is in shade)
        state.throughput *= mp.sigma_scatter / sigma_t;
        
        dir = wo;
        state.depth++;
      } else {
        // Absorbed
        state.terminated = true;
        return state;
      }
    }
    // Null collision - continue marching
  }
}
```

## Direct Lighting

```glsl
Spectrum estimate_direct_lighting(Hit hit, vec3 wo) {
  #if NEE_STRATEGY == MIS
    return direct_mis(hit, wo);
  #elif NEE_STRATEGY == LIGHT_ONLY
    return direct_light_sampling(hit, wo);
  #endif
}

Spectrum direct_mis(Hit hit, vec3 wo) {
  Spectrum L = Spectrum(0);
  
  // Light sampling
  LightSample ls = lights_sample_light(hit.p, next_2d());
  if (ls.pdf > 0 && !scene_intersect_any(make_shadow_ray(hit.p, ls.wi, ls.distance))) {
    Spectrum f = interaction_surface_shade(wo, ls.wi, hit);
    float cos_theta = max(0, geometry_dot(ls.wi, hit.n, hit.p));
    float bsdf_pdf = interaction_surface_pdf(wo, ls.wi, hit);
    
    float weight = power_heuristic(ls.pdf, bsdf_pdf);
    L += f * ls.radiance * cos_theta * weight / ls.pdf;
  }
  
  // BSDF sampling
  float pdf;
  vec3 wi = interaction_surface_scatter(wo, hit, next_2d(), pdf);
  
  if (pdf > 0) {
    Spectrum f = interaction_surface_shade(wo, wi, hit);
    Spectrum Le = lights_eval_light(hit.p, wi);
    float light_pdf = lights_pdf_light(hit.p, wi);
    
    if (light_pdf > 0 && !scene_intersect_any(make_ray(hit.p, wi))) {
      float cos_theta = abs(geometry_dot(wi, hit.n, hit.p));
      float weight = power_heuristic(pdf, light_pdf);
      L += f * Le * cos_theta * weight / pdf;
    }
  }
  
  return L;
}
```

## Configuration

Compile-time configuration via defines:

```glsl
// Core settings
#define MAX_BOUNCES 10
#define RR_START_DEPTH 3

// Transport strategies
#define VOLUME_STRATEGY DELTA_TRACKING
#define NEE_STRATEGY MIS
```

## Module Dependencies

### From Scene
- `scene_intersect(ray, hit)` - Surface intersection
- `scene_intersect_any(ray)` - Occlusion test
- `scene_classify_point(p, obj_id)` - Volume containment

### From Interaction
**Surface:**
- `interaction_surface_shade(wi, wo, hit)` - BRDF evaluation
- `interaction_surface_scatter(wi, hit, xi, pdf)` - Direction sampling
- `interaction_surface_pdf(wi, wo, hit)` - PDF query
- `interaction_surface_emit(hit)` - Emission

**Volume:**
- `interaction_volume_shade(wi, wo, p, mat_id, distance)` - Phase + extinction
- `interaction_volume_scatter(wi, p, mat_id, xi, pdf)` - Phase sampling
- `interaction_volume_pdf(wi, wo, p, mat_id)` - Phase PDF
- `interaction_volume_emit(p, mat_id)` - Volume emission

### From Lights
- `lights_sample_light(p, xi)` - Light sampling
- `lights_eval_light(p, wi)` - Environment evaluation
- `lights_pdf_light(p, wi)` - Light PDF

### From Material
- `material_get_properties(mat_id, p)` - Batched property query
- `material_has_volume(mat_id)` - Type check

## Debug Transport

```glsl
// Simple shading for preview
Spectrum transport_trace(Ray ray) {
  Hit hit;
  if (!scene_intersect(ray, hit)) {
    return lights_eval_environment(ray.direction);
  }
  
  // Just shade the surface
  return interaction_surface_shade(-ray.direction, vec3(0), hit) +
         interaction_surface_emit(hit);
}
```

## Performance Notes

1. Transport strategies compile-time selected (no runtime branches)
2. Batch material queries through `material_get_properties()`
3. Conservative marching factor (0.9) for reliability
4. Early termination via Russian roulette
5. Shadow rays can use scene_intersect_any() for early exit

## Validation

1. Transport owns integration algorithms only
2. All light-matter physics delegated to interaction module
3. Ray directions must be normalized
4. Russian roulette must preserve unbiased result
5. Volume transport handles entry, scattering, and exit
6. Energy conservation maintained throughout

---

The key changes from the old estimator:
1. Renamed to `transport_trace()`
2. All BSDF/phase evaluation goes through `interaction_*` functions
3. Material property queries batched through `material_get_properties()`
4. Manual prefixing throughout
5. Cleaner separation of concerns
