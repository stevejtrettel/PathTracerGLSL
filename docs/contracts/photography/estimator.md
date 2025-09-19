# Estimator Contract

## Module Structure

```typescript
{
  id: {
    kind: 'estimator',
    name: string,              // 'pathtracer' | 'volumetric_pt' | 'debug'
    version: string
  },
  provides: ['estimator'],
  requires: ['geometry', 'scene', 'material', 'lights'],
  fragment: {
    functions: string,         // Transport implementation
    uniforms: string,         // Strategy parameters
    constants: string         // Configuration defines
  },
  config: {
    maxBounces: number,
    volumeStrategy: string,
    sssModel: string,
    neeStrategy: string
  }
}
```

## Required Functions

### estimate
```glsl
Spectrum estimate(Ray ray)
```
- Compute radiance along ray through light transport simulation
- Implements complete integration strategy
- Returns spectral radiance
- Note: Engine will auto-prefix to `e_estimate`

## Optional Functions

```glsl
Spectrum estimate_direct(Hit hit, Direction wo)   // Direct lighting
float get_pdf(Direction wi, Direction wo, Hit hit)  // For MIS
```
Note: Engine will auto-prefix these with `e_`

## Transport Types

```glsl
struct TransportState {
  Spectrum throughput;   // Path contribution weight  
  Spectrum radiance;     // Accumulated radiance
  int depth;            // Bounce count
  bool specular_path;   // For NEE decisions
}

struct TransportResult {
  vec3 p;               // Next ray origin
  Direction wo;         // Next ray direction
  Spectrum contribution; // Throughput multiplier
  Spectrum emission;    // Direct emission
  bool terminated;      // Path ended
}
```

## Main Transport Loop

```glsl
Spectrum estimate(Ray ray) {
  TransportState state;
  state.throughput = Spectrum(1.0);
  state.radiance = Spectrum(0.0);
  state.depth = 0;
  state.specular_path = true;
  
  for (int bounce = 0; bounce < MAX_BOUNCES; bounce++) {
    Hit hit;
    if (!sc_intersect(ray, hit)) {
      // Environment/sky
      state.radiance += state.throughput * environment_radiance(ray.direction);
      break;
    }
    
    // Dispatch based on material type
    TransportResult result = dispatch_transport(ray, hit, state);
    
    if (result.terminated) break;
    
    state.throughput *= result.contribution;
    state.radiance += result.emission;
    state.depth++;
    
    // Russian roulette
    if (bounce > RR_START_DEPTH) {
      float p_survive = min(1.0, luminance(state.throughput));
      if (next_1d() > p_survive) break;
      state.throughput /= p_survive;
    }
    
    ray = make_ray(result.p, result.wo);
  }
  
  return state.radiance;
}
```

## Transport Dispatch

```glsl
TransportResult dispatch_transport(Ray ray, Hit hit, TransportState state) {
  int type_to = material_types[hit.material_to];
  
  if (type_to & MAT_TYPE_PARTICIPATING) {
    return transport_enter_volume(ray, hit, state);
  } else if (type_to & MAT_TYPE_SUBSURFACE) {
    return transport_subsurface(ray, hit, state);
  } else {
    return transport_surface(ray, hit, state);
  }
}
```

## Surface Transport

```glsl
TransportResult transport_surface(Ray ray, Hit hit, TransportState state) {
  TransportResult result;
  result.p = hit.p;
  result.emission = Spectrum(0);
  result.terminated = false;
  
  // Next Event Estimation
  #if NEE_STRATEGY != NONE
  if (!state.specular_path) {
    result.emission = estimate_direct_lighting(hit, -ray.direction);
  }
  #endif
  
  // Sample BSDF direction
  Direction wo;
  float pdf;
  wo = m_sample(-ray.direction, hit, next_2d(), pdf);
  
  if (pdf < EPSILON) {
    result.terminated = true;
    return result;
  }
  
  // Evaluate BSDF
  Spectrum f = m_evaluate(-ray.direction, wo, hit);
  
  // Compute contribution: BSDF * cos(θ) / pdf
  float cos_theta = abs(g_dot(wo, hit.n, hit.p));
  result.contribution = f * cos_theta / pdf;
  result.wo = wo;
  
  return result;
}
```

## Volume Transport

```glsl
TransportResult transport_enter_volume(Ray ray, Hit entry, TransportState state) {
  #if VOLUME_STRATEGY == DELTA_TRACKING
    return delta_track_volume(ray, entry, state);
  #elif VOLUME_STRATEGY == RAY_MARCHING
    return raymarch_volume(ray, entry, state);
  #elif VOLUME_STRATEGY == ANALYTICAL
    return analytical_volume(ray, entry, state);
  #endif
}
```

### Delta Tracking

```glsl
TransportResult delta_track_volume(Ray ray, Hit entry, TransportState state) {
  TransportResult result;
  
  int mat_id = entry.material_to;
  float sigma_max = m_sigma_max(mat_id);
  
  vec3 p = entry.p;
  Direction dir = refract_into_volume(ray.direction, entry);
  vec3 transmittance = vec3(1);
  
  while (true) {
    // Sample free path
    float t = -log(max(next_1d(), EPSILON)) / sigma_max;
    p = p + dir * t;
    
    // Check if still inside
    if (sc_classify_point(p, entry.object_id) != mat_id) {
      // Exit volume
      return handle_volume_exit(p, dir, transmittance, entry);
    }
    
    // Real vs null collision
    vec3 sigma_s = m_sigma_s(p, mat_id);
    vec3 sigma_a = m_sigma_a(p, mat_id);
    float sigma_t = length(sigma_s + sigma_a);
    float p_real = sigma_t / sigma_max;
    
    if (next_1d() < p_real) {
      // Real interaction
      transmittance *= exp(-sigma_a * t);
      
      // Scatter or absorb
      float p_scatter = length(sigma_s) / max(sigma_t, EPSILON);
      if (next_1d() < p_scatter) {
        // Sample phase function
        float phase_pdf;
        Direction wo = m_sample_phase(dir, p, mat_id, next_2d(), phase_pdf);
        
        result.p = p;
        result.wo = wo;
        result.contribution = transmittance * sigma_s / sigma_t;
        result.terminated = false;
        return result;
      } else {
        // Absorbed
        result.terminated = true;
        return result;
      }
    }
    // Null collision - continue
  }
}
```

## Direct Lighting

```glsl
Spectrum estimate_direct_lighting(Hit hit, Direction wo) {
  #if NEE_STRATEGY == MIS
    return direct_mis(hit, wo);
  #elif NEE_STRATEGY == LIGHT_ONLY
    return direct_light_sampling(hit, wo);
  #elif NEE_STRATEGY == BSDF_ONLY
    return direct_bsdf_sampling(hit, wo);
  #endif
}

Spectrum direct_mis(Hit hit, Direction wo) {
  Spectrum L = Spectrum(0);
  
  // Light sampling
  LightSample ls = l_sample_light(hit.p, next_2d());
  if (ls.pdf > 0 && !sc_intersect_any(make_shadow_ray(hit.p, ls.wi, ls.distance))) {
    Spectrum f = m_evaluate(wo, ls.wi, hit);
    float cos_theta = max(0, g_dot(ls.wi, hit.n, hit.p));
    float bsdf_pdf = m_pdf(wo, ls.wi, hit);
    
    float weight = power_heuristic(ls.pdf, bsdf_pdf);
    L += f * ls.radiance * cos_theta * weight / ls.pdf;
  }
  
  // BSDF sampling
  Direction wi;
  float pdf;
  wi = m_sample(wo, hit, next_2d(), pdf);
  
  if (pdf > 0) {
    Spectrum f = m_evaluate(wo, wi, hit);
    Spectrum Le = l_eval_light(hit.p, wi);
    float light_pdf = l_pdf_light(hit.p, wi);
    
    if (light_pdf > 0 && !sc_intersect_any(make_ray(hit.p, wi))) {
      float cos_theta = abs(g_dot(wi, hit.n, hit.p));
      float weight = power_heuristic(pdf, light_pdf);
      L += f * Le * cos_theta * weight / pdf;
    }
  }
  
  return L;
}

float power_heuristic(float pdf1, float pdf2) {
  float f = pdf1 * pdf1;
  float g = pdf2 * pdf2;
  return f / (f + g);
}
```

## Subsurface Transport

```glsl
TransportResult transport_subsurface(Ray ray, Hit entry, TransportState state) {
  #if SSS_MODEL == DIFFUSION
    return diffusion_sss(ray, entry, state);
  #elif SSS_MODEL == PHOTON_BEAM
    return photon_beam_sss(ray, entry, state);
  #elif SSS_MODEL == BRUTE_FORCE
    return brute_force_sss(ray, entry, state);
  #endif
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
#define SSS_MODEL DIFFUSION
#define NEE_STRATEGY MIS
```

## Module Dependencies

### From Scene
- `sc_intersect(ray, hit)` - Surface intersection
- `sc_intersect_any(ray, max_t)` - Shadow rays
- `sc_classify_point(p, obj_id)` - Volume containment

### From Materials
**Surface:**
- `m_evaluate(wi, wo, hit)` - Evaluate BSDF
- `m_sample(wi, hit, xi, pdf)` - Sample BSDF direction
- `m_pdf(wi, wo, hit)` - BSDF PDF
- `m_emission(hit)` - Surface emission

**Volume (properties only):**
- `m_sigma_s(p, mat_id)` - Scattering coefficient
- `m_sigma_a(p, mat_id)` - Absorption coefficient
- `m_sigma_max(mat_id)` - Majorant
- `m_sample_phase(wi, p, mat_id, xi, pdf)` - Phase function

**Type flags:**
- `material_types[mat_id]` - Material type bits

### From Lights
- `l_sample_light(p, xi)` - Light sampling
- `l_eval_light(p, wi)` - Light evaluation
- `l_pdf_light(p, wi)` - Light PDF

## Debug Estimators

```glsl
// Normal visualization
Spectrum estimate(Ray ray) {
  Hit hit;
  if (sc_intersect(ray, hit)) {
    return Spectrum(hit.n * 0.5 + 0.5);
  }
  return Spectrum(0);
}

// Material ID visualization
Spectrum estimate(Ray ray) {
  Hit hit;
  if (sc_intersect(ray, hit)) {
    return Spectrum(hash_color(hit.material_to));
  }
  return Spectrum(0);
}

// Transport strategy visualization
#if DEBUG_TRANSPORT
Spectrum estimate(Ray ray) {
  Hit hit;
  if (!sc_intersect(ray, hit)) return Spectrum(0);
  
  int type = material_types[hit.material_to];
  if (type & MAT_TYPE_PARTICIPATING) return Spectrum(1,0,0);  // Red
  if (type & MAT_TYPE_SUBSURFACE) return Spectrum(0,1,0);    // Green
  if (type & MAT_TYPE_DIELECTRIC) return Spectrum(0,0,1);    // Blue
  return Spectrum(0.5);  // Gray
}
#endif
```

## Performance Notes

1. Transport strategies compile-time selected (no runtime branches)
2. Material types checked via bit flags (single memory access)
3. Order dispatch by frequency (surface > volume > SSS)
4. Use conservative marching factor (0.9) for reliability
5. Early termination via Russian roulette
6. Shadow rays can use less conservative stepping

## Validation

1. Estimator owns transport algorithm, Materials provide properties only
2. Ray directions must be normalized
3. Russian roulette must preserve unbiased result
4. Volume transport handles entry, scattering, and exit
5. NEE respects delta materials (no direct lighting)
6. Energy conservation maintained throughout
