# Photography Pillar: Complete Specification

## Overview

Photography defines **how we observe and measure light**. It transforms the mathematical World into images through ray generation, light transport simulation, temporal accumulation, and output processing.

## Architecture

Photography provides four module types that work in sequence:

```
Pixel → [Camera] → Ray → [Estimator] → Radiance → [Film] → Accumulated → [Developer] → Output
```

## Module Types

### Camera
**Purpose**: Transform image coordinates to rays  
**Mathematical Role**: Defines the measurement operator

```glsl
// Required function (auto-prefixed to c_generate_ray)
Ray generate_ray(vec2 pixel, vec2 xi)
```

**Optimization**: Camera matrices are precomputed by the engine as uniforms, avoiding per-ray reconstruction of coordinate frames.

### Estimator
**Purpose**: Compute radiance along rays through light transport simulation  
**Mathematical Role**: Solve the rendering equation with chosen integration strategies

The Estimator owns the **transport strategy** - how to march through volumes, when to sample lights, how to handle material transitions. It relies on other modules for scene queries and material properties but decides the integration method.

**Core Architecture:**
```glsl
// Required function (auto-prefixed to e_estimate)
vec3 estimate(Ray ray)

// Main loop with transport dispatch
vec3 estimate(Ray ray) {
    TransportState state = init_transport();
    
    for (int bounce = 0; bounce < max_bounces; bounce++) {
        Hit hit;
        if (!sc_intersect(ray, hit)) {
            return state.radiance + state.throughput * environment(ray.direction);
        }
        
        // Dispatch to appropriate transport strategy based on material type
        TransportResult result = dispatch_transport(ray, hit, state);
        
        if (result.terminated) break;
        
        state.throughput *= result.contribution;
        state.radiance += result.emission;
        ray = make_ray(result.p, result.wo);
    }
    
    return state.radiance;
}
```

**Transport Strategies (Compile-Time Selectable):**

1. **Surface Transport**: Standard BRDF evaluation and sampling
2. **Volume Transport**: Configurable strategies for participating media
    - Delta tracking (unbiased, heterogeneous)
    - Ray marching (simple, controllable step size)
    - Analytical (homogeneous media only)
3. **Subsurface Transport**: Multiple models for translucent materials
    - Diffusion approximation (fast)
    - Photon beam diffusion (accurate)
    - Brute force path tracing (reference)

**Transport Dispatch:**
```glsl
TransportResult dispatch_transport(Ray ray, Hit hit, TransportState state) {
    // Get material type flags from Material module
    int type_to = material_types[hit.material_to];
    
    if (type_to & MAT_TYPE_PARTICIPATING) {
        // Estimator owns HOW to integrate through volume
        return transport_enter_volume(ray, hit, state);
    } else if (type_to & MAT_TYPE_SUBSURFACE) {
        return transport_subsurface(ray, hit, state);
    } else {
        return transport_surface(ray, hit, state);
    }
}
```

**Key Design Change**: The Estimator now explicitly owns transport strategy. Materials provide properties (sigma values, phase functions) but the Estimator decides whether to use delta tracking, ray marching, or analytical integration.

**Configuration System:**
```typescript
interface EstimatorConfig {
    // Transport strategies (compile-time selection)
    volumeStrategy: 'delta_tracking' | 'ray_marching' | 'analytical';
    sssModel: 'diffusion' | 'photon_beam' | 'brute_force';
    neeStrategy: 'mis' | 'light_only' | 'bsdf_only' | 'none';
    
    // Core settings
    maxBounces: number;
    rrStartDepth: number;
}
```

**Optimization**: Uses precomputed `hit.frame` from Scene and batched BSDF operations (`m_interact`) for surface interactions. Volume transport uses material properties (`m_sigma_s`, `m_sigma_a`, `m_sample_phase`) but implements integration strategy locally.

### Film
**Purpose**: Accumulate samples over time  
**Mathematical Role**: Temporal integration

```glsl
// Required function (auto-prefixed to f_accumulate)
vec3 accumulate(vec3 new_sample, vec2 pixel)
```

### Developer
**Purpose**: Transform HDR radiance to display  
**Mathematical Role**: Tone mapping and color grading

```glsl
// Required function (auto-prefixed to d_develop)
vec3 develop(vec3 radiance)
```

## Orchestration

The engine generates this main orchestration:

```glsl
void main() {
  vec2 pixel = gl_FragCoord.xy;
  
  // Camera (using automatic dimension tracking)
  vec2 xi = next_2d();  // Automatic dimension increment
  Ray ray = c_generate_ray(pixel, xi);
  
  // Estimator (now with explicit transport handling)
  vec3 radiance = e_estimate(ray);
  
  // Film  
  vec3 accumulated = f_accumulate(radiance, pixel);
  
  // Developer
  vec3 color = d_develop(accumulated);
  
  gl_FragColor = vec4(color, 1.0);
}
```

## Cross-Module Communication

Photography modules use functions from World:

**From Geometry:**
- `g_geodesic(origin, direction, t)` - Ray marching in curved space
- `g_dot(v1, v2, p)` - Metric-aware dot product
- `g_frame(p, n)` - Orthonormal frame construction

**From Scene:**
- `sc_intersect(ray, hit)` - Find intersections (returns hit with precomputed frame)
- `sc_intersect_any(ray, max_t)` - Shadow ray tests
- `sc_classify_point(p, obj_id)` - Point inside object test (for volume transport)

**From Materials (Surface):**
- `m_interact(wi, hit, xi, wo, pdf)` - Batched material sampling and evaluation
- `m_eval(wi, wo, hit)` - Material evaluation (for MIS)
- `m_pdf(wi, wo, hit)` - Material PDF (for MIS)
- `m_emission(hit)` - Surface emission

**From Materials (Volume) - Properties Only:**
- `m_sigma_s(p, mat_id)` - Scattering coefficient
- `m_sigma_a(p, mat_id)` - Absorption coefficient
- `m_sigma_max(mat_id)` - Majorant for delta tracking
- `m_sample_phase(wi, p, mat_id, xi, pdf)` - Phase function sampling
- `material_types[mat_id]` - Type flags for dispatch

**From Lights:**
- `l_sample_light(p, xi)` - Light sampling
- `l_eval_light(p, wi)` - Light evaluation
- `l_pdf_light(p, wi)` - Light PDF

## Transport Strategy Details

### Volume Transport Implementation

The Estimator implements volume integration strategies, using material properties but owning the algorithm:

```glsl
// Delta tracking - Estimator's implementation
TransportResult delta_track_volume(Ray ray, Hit entry, TransportState state) {
    int mat_id = entry.material_to;
    float sigma_max = m_sigma_max(mat_id);  // Get property from Material
    
    // Estimator implements the integration algorithm
    vec3 current_p = entry.p;
    Direction current_dir = refract_into_medium(ray.direction, entry);
    
    while (true) {
        // Sample tentative free path
        float t = -log(next_1d()) / sigma_max;
        vec3 sample_p = current_p + current_dir * t;
        
        // Check if still inside (using Scene module)
        if (sc_classify_point(sample_p, entry.object_id) != mat_id) {
            // Handle exit...
        }
        
        // Get properties from Material module
        vec3 sigma_s = m_sigma_s(sample_p, mat_id);
        vec3 sigma_a = m_sigma_a(sample_p, mat_id);
        
        // Estimator decides how to use these properties
        // ... delta tracking logic ...
    }
}
```

### Research-Friendly Architecture

Different estimators can implement different strategies:

```glsl
// research_estimator.glsl - Experimental volume integration
#define VOLUME_STRATEGY MY_EXPERIMENTAL_METHOD

TransportResult my_experimental_volume_method(Ray ray, Hit entry, TransportState state) {
    // Your novel integration strategy
    // Still uses m_sigma_s, m_sigma_a from Materials
    // But implements integration differently
}
```

## Random Sampling

Random dimensions are automatically tracked by the engine infrastructure:

```glsl
// Old manual tracking (deprecated)
int dim = 0;
vec2 xi1 = sample_2d(pixel_id, sample_id, dim++);
vec2 xi2 = sample_2d(pixel_id, sample_id, dim++);

// New automatic tracking (recommended)
vec2 xi1 = next_2d();  // Automatically increments dimension
vec2 xi2 = next_2d();  // Next dimension
vec3 xi3 = next_3d();  // Takes 2 dimensions
```

The engine manages the dimension counter internally, preventing correlation bugs.

## Camera Matrix Precomputation

The engine precomputes camera matrices once per frame:

```glsl
// Engine provides these uniforms
uniform mat3 u_camera_frame;     // [right, up, forward] columns
uniform vec3 u_camera_position;  
uniform float u_camera_tan_fov;  // Precomputed tan(fov/2)
```

This eliminates redundant coordinate frame construction for every ray.

## Efficient Material Interaction

Materials provide batched operations for common paths:

```glsl
// Efficient path - single batched call for surfaces
float pdf;
Direction wo;
vec3 contribution = m_interact(wi, hit, xi, wo, pdf);
// Returns BSDF * cos(θ) / pdf in one operation

// Volume properties - Estimator queries as needed
vec3 sigma_s = m_sigma_s(p, mat_id);  // Just properties
// Estimator decides how to integrate using these
```

## File Structure

```
photography/
├── contracts/           # Module specifications
├── cameras/            # Ray generation
├── estimators/         # Light transport algorithms
│   ├── core/          # Base implementations
│   ├── strategies/    # Pluggable transport strategies
│   │   ├── volumes/   # Delta tracking, ray marching, etc.
│   │   └── subsurface/# Diffusion models, etc.
│   └── experimental/  # Research implementations
├── films/              # Accumulation strategies
├── developers/         # Output processing
├── configurations/     # Pre-built combinations
└── templates/          # Boilerplate for new modules
```

## Performance Optimizations

1. **Precomputed camera matrices**: Saves ~10 operations per ray
2. **Precomputed hit frames**: Avoids redundant `g_frame()` calls
3. **Automatic dimension tracking**: Prevents correlation bugs
4. **Batched BSDF operations**: Single call vs three separate calls
5. **Optimized shadow rays**: Early-exit intersection tests
6. **Compile-time transport selection**: No runtime branching for strategies
7. **Efficient material dispatch**: Bit flags for type checking

## Key Architecture Decisions

- **Clean naming**: Write `accumulate()`, engine produces `f_accumulate()`
- **Sampling as infrastructure**: Not a swappable module, but always available
- **Geometry defines types**: Point and Direction come from geometry
- **Mathematical interfaces**: Estimator computes radiance along rays
- **Automatic dimension tracking**: Engine manages sample dimensions
- **Transport ownership**: Estimator owns integration strategy, Materials provide properties
- **Compile-time strategies**: Volume/SSS methods selected at shader compilation

## Estimator Research Extensions

The new architecture makes it easy to experiment with different transport strategies:

```typescript
// Configure different estimators for comparison
const configs = [
    { name: "delta_tracking", volumeStrategy: "delta_tracking" },
    { name: "ray_marching", volumeStrategy: "ray_marching" },
    { name: "analytical", volumeStrategy: "analytical_homogeneous" }
];

// Each compiles to a different shader for A/B testing
```

Debug visualizations can show which transport was used:

```glsl
#if DEBUG_TRANSPORT
    if (type & MAT_TYPE_PARTICIPATING) return vec3(1,0,0);  // Red for volumes
    if (type & MAT_TYPE_SUBSURFACE) return vec3(0,1,0);     // Green for SSS
    return vec3(0,0,1);  // Blue for surfaces
#endif
```
