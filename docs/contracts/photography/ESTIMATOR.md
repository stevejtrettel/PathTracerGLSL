# Estimator Module Contract

## Purpose

Estimators compute radiance along rays by simulating light transport. They own the integration strategy - how to march through volumes, when to sample lights, how to handle material transitions - while relying on other modules for scene queries and material properties.

## Core Architecture

### Transport State Management

```glsl
struct TransportState {
    vec3 throughput;      // Path contribution weight
    vec3 radiance;        // Accumulated radiance
    int depth;            // Current bounce depth
    bool specular_path;   // For NEE decisions
};

struct TransportResult {
    vec3 p;               // New position (may differ from hit.p for volumes)
    Direction wo;         // New direction
    vec3 contribution;    // Throughput multiplier
    vec3 emission;        // Direct emission to add
    bool terminated;      // Path ended?
};
```

### Required Functions

#### estimate
```glsl
vec3 estimate(Ray ray)
```
Main entry point - estimates radiance along the given ray.

**Parameters:**
- `ray`: Ray to trace (typically from camera)

**Returns:** RGB radiance value

**Note:** Function will be auto-prefixed to `e_estimate` in compiled shader.

### Optional Functions

#### estimate_direct
```glsl
vec3 estimate_direct(Hit hit, Direction wo)
```
Compute direct lighting at a hit point (for custom NEE strategies).

#### get_pdf
```glsl
float get_pdf(Direction wi, Direction wo, Hit hit)
```
Return sampling PDF for multiple importance sampling.

## Transport Architecture

### Main Estimation Loop

```glsl
vec3 estimate(Ray ray) {
    TransportState state;
    state.throughput = vec3(1.0);
    state.radiance = vec3(0.0);
    state.depth = 0;
    state.specular_path = true;
    
    for (int bounce = 0; bounce < max_bounces; bounce++) {
        Hit hit;
        if (!sc_intersect(ray, hit)) {
            state.radiance += state.throughput * environment_radiance(ray.direction);
            break;
        }
        
        // Handle emission
        if (is_emissive(hit.material_to)) {
            if (bounce == 0 || state.specular_path) {
                state.radiance += state.throughput * m_emission(hit);
            }
            break;
        }
        
        // Dispatch to appropriate transport strategy
        TransportResult result = dispatch_transport(ray, hit, state);
        
        if (result.terminated) break;
        
        // Update state
        state.throughput *= result.contribution;
        state.radiance += result.emission;
        state.depth++;
        state.specular_path = is_delta_material(hit.material_to);
        
        // Russian roulette (after a few bounces)
        if (bounce > rr_start_depth) {
            float p_survive = min(1.0, luminance(state.throughput));
            if (next_1d() > p_survive) break;
            state.throughput /= p_survive;
        }
        
        // Setup next ray
        ray = make_ray(result.p, result.wo);
    }
    
    return state.radiance;
}
```

### Transport Dispatch

```glsl
TransportResult dispatch_transport(Ray ray, Hit hit, TransportState state) {
    // Get material type flags
    int type_from = (hit.material_from >= 0) ? 
                    material_types[hit.material_from] : 0;
    int type_to = material_types[hit.material_to];
    
    // Check for volume entry
    if ((type_to & MAT_TYPE_PARTICIPATING) && 
        !(type_from & MAT_TYPE_PARTICIPATING)) {
        return transport_enter_volume(ray, hit, state);
    }
    
    // Check for subsurface scattering
    if (type_to & MAT_TYPE_SUBSURFACE) {
        return transport_subsurface(ray, hit, state);
    }
    
    // Default: surface transport
    return transport_surface(ray, hit, state);
}
```

## Transport Strategies

### Surface Transport

Standard surface scattering with optional next event estimation:

```glsl
TransportResult transport_surface(Ray ray, Hit hit, TransportState state) {
    TransportResult result;
    result.p = hit.p;
    result.emission = vec3(0);
    result.terminated = false;
    
    // Next Event Estimation (if enabled and not on delta surface)
    #if ENABLE_NEE
    if (!state.specular_path && !is_delta_material(hit.material_to)) {
        result.emission = estimate_direct_lighting(hit, -ray.direction, state);
    }
    #endif
    
    // Sample BSDF
    Direction wo;
    float pdf;
    vec3 f = m_interact(-ray.direction, hit, next_2d(), wo, pdf);
    
    if (pdf < EPSILON) {
        result.terminated = true;
        return result;
    }
    
    result.wo = wo;
    result.contribution = f;  // Already includes cos(theta) / pdf
    
    return result;
}
```

### Volume Transport

Participating media transport with configurable strategies:

```glsl
TransportResult transport_enter_volume(Ray ray, Hit entry, TransportState state) {
    #if VOLUME_STRATEGY == DELTA_TRACKING
        return delta_track_volume(ray, entry, state);
    #elif VOLUME_STRATEGY == RAY_MARCHING
        return raymarch_volume(ray, entry, state);
    #elif VOLUME_STRATEGY == ANALYTICAL_HOMOGENEOUS
        return analytical_homogeneous_volume(ray, entry, state);
    #else
        // Fallback: treat as clear medium
        return clear_medium_transport(ray, entry, state);
    #endif
}
```

#### Delta Tracking Implementation

```glsl
TransportResult delta_track_volume(Ray ray, Hit entry, TransportState state) {
    TransportResult result;
    result.emission = vec3(0);
    
    int mat_id = entry.material_to;
    float sigma_max = m_sigma_max(mat_id);
    
    // Handle refraction at entry
    vec3 current_p = entry.p;
    Direction current_dir;
    float ior_ratio = entry.ior_ratio;
    
    if (!refract_direction(ray.direction, entry.n, ior_ratio, current_dir)) {
        // Total internal reflection
        current_dir = reflect_direction(ray.direction, entry.n);
        result.p = current_p;
        result.wo = current_dir;
        result.contribution = vec3(1);  // Perfect reflection
        result.terminated = false;
        return result;
    }
    
    // Delta tracking through volume
    vec3 accumulated = vec3(1);
    float t_current = 0;
    
    while (true) {
        // Sample tentative free path
        t_current -= log(max(next_1d(), EPSILON)) / sigma_max;
        vec3 sample_p = current_p + current_dir * t_current;
        
        // Check if we've left the volume
        int material_at_p = sc_classify_point(sample_p, entry.object_id);
        if (material_at_p != mat_id) {
            // Find exact exit point
            float t_exit = bisect_exit(current_p, current_dir, t_current, entry.object_id);
            vec3 exit_p = current_p + current_dir * t_exit;
            
            // Apply Beer's law to exit
            vec3 sigma_a = m_sigma_a(exit_p, mat_id);
            accumulated *= exp(-sigma_a * t_exit);
            
            // Create exit hit
            Hit exit_hit = create_exit_hit(exit_p, current_dir, entry.object_id);
            
            // Handle boundary
            Direction wo;
            float pdf;
            vec3 f = m_interact(current_dir, exit_hit, next_2d(), wo, pdf);
            
            result.p = exit_p;
            result.wo = wo;
            result.contribution = accumulated * f;
            result.terminated = (pdf < EPSILON);
            return result;
        }
        
        // Evaluate actual medium properties
        vec3 sigma_s = m_sigma_s(sample_p, mat_id);
        vec3 sigma_a = m_sigma_a(sample_p, mat_id);
        float sigma_t = length(sigma_s + sigma_a);
        
        // Russian roulette: real vs null collision
        float p_real = sigma_t / sigma_max;
        
        if (next_1d() < p_real) {
            // Real interaction
            accumulated *= exp(-sigma_a * t_current);
            
            // Scatter or absorb?
            float p_scatter = length(sigma_s) / max(sigma_t, EPSILON);
            if (next_1d() < p_scatter) {
                // Scatter - sample phase function
                float phase_pdf;
                Direction wo = m_sample_phase(current_dir, sample_p, mat_id, 
                                            next_2d(), phase_pdf);
                accumulated *= sigma_s / sigma_t;
                
                // Continue from scatter point
                current_p = sample_p;
                current_dir = wo;
                t_current = 0;
            } else {
                // Absorbed
                result.terminated = true;
                return result;
            }
        }
        // Null collision - continue sampling
    }
}
```

#### Ray Marching Implementation

```glsl
TransportResult raymarch_volume(Ray ray, Hit entry, TransportState state) {
    // Fixed-step ray marching for dense media
    const float STEP_SIZE = 0.01;  // Configurable
    
    int mat_id = entry.material_to;
    vec3 current_p = entry.p;
    Direction current_dir = refract_into_medium(ray.direction, entry);
    vec3 accumulated = vec3(1);
    
    for (int step = 0; step < MAX_VOLUME_STEPS; step++) {
        current_p += current_dir * STEP_SIZE;
        
        // Check if still inside
        if (sc_classify_point(current_p, entry.object_id) != mat_id) {
            // Hit boundary
            return handle_volume_exit(current_p, current_dir, accumulated, entry);
        }
        
        // Accumulate extinction
        vec3 sigma_t = m_sigma_s(current_p, mat_id) + m_sigma_a(current_p, mat_id);
        vec3 transmittance = exp(-sigma_t * STEP_SIZE);
        
        // Russian roulette for scattering
        float p_scatter = 1.0 - luminance(transmittance);
        if (next_1d() < p_scatter) {
            // Scatter here
            return handle_volume_scatter(current_p, current_dir, accumulated, mat_id);
        }
        
        accumulated *= transmittance;
    }
    
    // Max steps reached
    TransportResult result;
    result.terminated = true;
    return result;
}
```

### Subsurface Transport

```glsl
TransportResult transport_subsurface(Ray ray, Hit entry, TransportState state) {
    #if SSS_MODEL == DIFFUSION
        return diffusion_subsurface(ray, entry, state);
    #elif SSS_MODEL == PHOTON_BEAM
        return photon_beam_subsurface(ray, entry, state);
    #elif SSS_MODEL == BRUTE_FORCE
        return brute_force_subsurface(ray, entry, state);
    #else
        // Fallback to diffuse
        return transport_surface(ray, entry, state);
    #endif
}

TransportResult diffusion_subsurface(Ray ray, Hit entry, TransportState state) {
    TransportResult result;
    result.emission = vec3(0);
    
    int mat_id = entry.material_to;
    
    // Sample exit radius using diffusion profile
    float r = sample_diffusion_radius(mat_id, next_1d());
    vec2 disk = sample_unit_disk(next_2d());
    
    // Project onto tangent plane
    vec3 projected_exit = entry.p + r * (disk.x * entry.frame.t + 
                                         disk.y * entry.frame.b);
    
    // Find actual surface point above projection
    Hit exit_hit = find_surface_exit(projected_exit, entry.object_id);
    
    if (exit_hit.object_id != entry.object_id) {
        // Couldn't find exit (shouldn't happen)
        result.terminated = true;
        return result;
    }
    
    // Evaluate BSSRDF
    float distance = length(exit_hit.p - entry.p);
    vec3 bssrdf = eval_diffusion_profile(distance, mat_id);
    
    // Sample exit direction
    Direction wo;
    float pdf;
    vec3 f = m_interact(exit_hit.n, exit_hit, next_2d(), wo, pdf);
    
    result.p = exit_hit.p;
    result.wo = wo;
    result.contribution = bssrdf * f;
    result.terminated = (pdf < EPSILON);
    
    return result;
}
```

## Direct Lighting Strategies

### Multiple Importance Sampling

```glsl
vec3 estimate_direct_lighting(Hit hit, Direction wo_camera, TransportState state) {
    #if NEE_STRATEGY == MIS
        return direct_lighting_mis(hit, wo_camera);
    #elif NEE_STRATEGY == LIGHT_SAMPLING
        return direct_lighting_light_only(hit, wo_camera);
    #elif NEE_STRATEGY == BSDF_SAMPLING
        return direct_lighting_bsdf_only(hit, wo_camera);
    #else
        return vec3(0);  // No NEE
    #endif
}

vec3 direct_lighting_mis(Hit hit, Direction wo_camera) {
    vec3 L = vec3(0);
    
    // Light sampling
    LightSample ls = l_sample_light(hit.p, next_2d());
    if (ls.pdf > 0 && !sc_intersect_any(make_ray(hit.p, ls.direction), ls.distance)) {
        vec3 f = m_eval(wo_camera, ls.direction, hit);
        float cos_theta = max(0, g_dot(ls.direction, hit.n, hit.p));
        float bsdf_pdf = m_pdf(wo_camera, ls.direction, hit);
        
        float mis_weight = power_heuristic(ls.pdf, bsdf_pdf);
        L += f * ls.radiance * cos_theta * mis_weight / ls.pdf;
    }
    
    // BSDF sampling
    Direction wi_bsdf;
    float bsdf_pdf;
    vec3 f_bsdf = m_sample(wo_camera, hit, next_2d(), wi_bsdf, bsdf_pdf);
    
    if (bsdf_pdf > 0) {
        float light_pdf = l_pdf_light(hit.p, wi_bsdf);
        if (light_pdf > 0) {
            float mis_weight = power_heuristic(bsdf_pdf, light_pdf);
            vec3 Le = l_eval_light(hit.p, wi_bsdf);
            
            if (!sc_intersect_any(make_ray(hit.p, wi_bsdf), MAX_DIST)) {
                L += f_bsdf * Le * mis_weight;  // f_bsdf already includes cos/pdf
            }
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

## Configuration System

### Compile-Time Strategy Selection

```typescript
interface EstimatorConfig {
    // Core settings
    maxBounces: number;
    rrStartDepth: number;
    
    // Transport strategies
    volumeStrategy: 'delta_tracking' | 'ray_marching' | 'analytical_homogeneous';
    sssModel: 'diffusion' | 'photon_beam' | 'brute_force';
    
    // Lighting
    neeStrategy: 'mis' | 'light_only' | 'bsdf_only' | 'none';
    
    // Debug modes
    debugTransport: boolean;
    visualizeStrategies: boolean;
}
```

Generated preprocessor defines:
```glsl
#define MAX_BOUNCES 10
#define RR_START_DEPTH 3
#define VOLUME_STRATEGY DELTA_TRACKING
#define SSS_MODEL DIFFUSION
#define NEE_STRATEGY MIS
#define ENABLE_NEE 1
```

## Module Dependencies

### From Scene Module
- `sc_intersect(ray, hit)` → Find next surface
- `sc_intersect_any(ray, max_t)` → Shadow rays
- `sc_classify_point(p, obj_id)` → Point inside object test
- `sc_find_exit(p, dir, obj_id)` → Find volume exit

### From Material Module
**Surface Functions:**
- `m_interact(wi, hit, xi, wo, pdf)` → Sample BSDF
- `m_eval(wi, wo, hit)` → Evaluate BSDF
- `m_pdf(wi, wo, hit)` → BSDF PDF
- `m_emission(hit)` → Surface emission

**Volume Functions:**
- `m_sigma_s(p, mat_id)` → Scattering coefficient
- `m_sigma_a(p, mat_id)` → Absorption coefficient
- `m_sigma_max(mat_id)` → Majorant for delta tracking
- `m_sample_phase(wi, p, mat_id, xi, pdf)` → Phase function sampling
- `m_eval_phase(wi, wo, p, mat_id)` → Phase function evaluation

**Material Properties:**
- `material_types[mat_id]` → Type flags (participating, subsurface, etc.)
- `is_delta_material(mat_id)` → Perfect specular check

### From Light Module
- `l_sample_light(p, xi)` → Sample light direction
- `l_eval_light(p, dir)` → Evaluate light radiance
- `l_pdf_light(p, dir)` → Light sampling PDF

### From Infrastructure
- `next_1d()` → Next random float
- `next_2d()` → Next random vec2
- `environment_radiance(dir)` → Sky/IBL evaluation

## Research Extensions

### Custom Transport Strategies

Add new volume integration methods:
```glsl
// In estimator_extensions.glsl
TransportResult my_volume_method(Ray ray, Hit entry, TransportState state) {
    // Your experimental integration method
}

// Register in dispatch
#if VOLUME_STRATEGY == MY_METHOD
    return my_volume_method(ray, entry, state);
#endif
```

### Debug Visualizations

```glsl
// Visualize which transport strategy was used
#if DEBUG_TRANSPORT
vec3 estimate(Ray ray) {
    Hit hit;
    if (!sc_intersect(ray, hit)) return vec3(0);
    
    int type = material_types[hit.material_to];
    
    if (type & MAT_TYPE_PARTICIPATING) {
        return vec3(1, 0, 0);  // Red for volumes
    } else if (type & MAT_TYPE_SUBSURFACE) {
        return vec3(0, 1, 0);  // Green for SSS
    } else if (type & MAT_TYPE_DIELECTRIC) {
        return vec3(0, 0, 1);  // Blue for glass
    } else {
        return vec3(0.5);      // Gray for diffuse/metal
    }
}
#endif
```

### Performance Profiling

```glsl
// Count transport strategy usage
#if PROFILE_TRANSPORT
uniform int u_surface_count;
uniform int u_volume_count;
uniform int u_sss_count;

TransportResult dispatch_transport(Ray ray, Hit hit, TransportState state) {
    int type = material_types[hit.material_to];
    
    if (type & MAT_TYPE_PARTICIPATING) {
        atomicAdd(u_volume_count, 1);
    } else if (type & MAT_TYPE_SUBSURFACE) {
        atomicAdd(u_sss_count, 1);
    } else {
        atomicAdd(u_surface_count, 1);
    }
    
    // ... normal dispatch
}
#endif
```

## Common Estimator Implementations

### Simple Path Tracer
```glsl
// path_tracer.glsl - Basic unidirectional path tracing
uniform int max_bounces;

vec3 estimate(Ray ray) {
    // Uses default transport strategies
    return estimate_with_config(ray);
}
```

### Volumetric Path Tracer
```glsl
// volumetric_pt.glsl - Optimized for participating media
#define VOLUME_STRATEGY DELTA_TRACKING
#define SSS_MODEL DIFFUSION
#define NEE_STRATEGY MIS

vec3 estimate(Ray ray) {
    // Specialized for scenes with heavy volume use
    // Could increase volume sampling quality
    return estimate_with_config(ray);
}
```

### Debug Estimators
```glsl
// normal_visualizer.glsl
vec3 estimate(Ray ray) {
    Hit hit;
    if (sc_intersect(ray, hit)) {
        return hit.n * 0.5 + 0.5;
    }
    return vec3(0);
}

// material_id_visualizer.glsl
vec3 estimate(Ray ray) {
    Hit hit;
    if (sc_intersect(ray, hit)) {
        return hash_color(hit.material_to);
    }
    return vec3(0);
}

// volume_density_visualizer.glsl
vec3 estimate(Ray ray) {
    // Ray march and accumulate density
    float accumulated_density = 0;
    float t = 0;
    
    for (int i = 0; i < 100; i++) {
        vec3 p = ray.origin + ray.direction * t;
        int mat_id = sc_classify_point(p, -1);
        
        if (mat_id >= 0 && (material_types[mat_id] & MAT_TYPE_PARTICIPATING)) {
            accumulated_density += length(m_sigma_t(p, mat_id)) * 0.01;
        }
        
        t += 0.1;
        if (t > 10.0) break;
    }
    
    return vec3(accumulated_density);
}
```

## Implementation Notes

- **Transport strategies are compile-time selected** for performance
- **Volume transport owns the full path through the medium** including entry, scattering, and exit
- **Material module provides properties only**, not transport algorithms
- **NEE is optional and configurable** per estimator
- **Debug modes compile to different shaders** rather than runtime branches

## Performance Considerations

- Order transport checks by frequency (surface > volume > SSS)
- Use bit flags for material type checks (single memory access)
- Compile out unused transport strategies
- Consider separate estimators for volume-heavy vs surface-heavy scenes
- Profile which transport paths are taken to optimize accordingly

## Module ID Convention

```typescript
{
  id: {
    kind: "estimator",
    name: "YourEstimatorName",  // "PathTracer", "VolumetricPT", etc.
    version: "1.0.0"
  }
}
```
