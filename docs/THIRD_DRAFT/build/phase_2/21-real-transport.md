# Phase 2.1: Real Transport - Detailed Plan

## Purpose & Scope

Phase 2.1 replaces our simple first-hit transport with actual path tracing that bounces rays through the scene. This transforms our renderer from a normal visualizer into a true global illumination solver, capable of rendering diffuse interreflection.

**Core Goal**: Implement recursive path tracing with Russian roulette termination, preparing for proper convergence with accumulation.

## File Structure & Responsibilities

### `src/photography/transport/pathtracer.glsl` - Path Tracing Transport

**Purpose**: Trace paths through the scene, bouncing at surfaces until termination. This is the heart of Monte Carlo rendering.

## Core Implementation Structure

### Random Number Generation

**Critical Decision**: GLSL has no built-in RNG, so we need to thread state through our path tracer.

```glsl
// Random number generator state (PCG-based)
uint transport_rng_state;

// Initialize RNG per pixel
void transport_init_rng(vec2 pixel, int frame) {
    // Combine pixel position and frame number for seed
    uint seed = uint(pixel.x) + uint(pixel.y) * 1920u;
    seed = seed * 1664525u + 1013904223u;  // LCG step
    seed ^= uint(frame) * 2654435761u;     // Mix in frame
    transport_rng_state = seed;
}

// Generate uniform random number in [0,1)
float transport_random() {
    // PCG RNG (good quality, fast)
    uint state = transport_rng_state;
    transport_rng_state = state * 747796405u + 2891336453u;
    uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return float((word >> 22u) ^ word) / 4294967295.0;
}

// Generate 2D random sample
vec2 transport_random2() {
    return vec2(transport_random(), transport_random());
}
```

**Why Thread State?**
- GLSL doesn't support static variables
- Can't pass RNG state as parameter (would break module interface)
- Global state is acceptable for single-threaded fragment shader
- Will need to init per pixel in main()

### Path Tracing Core

```glsl
// Configuration constants
#define MAX_BOUNCES 8
#define MIN_BOUNCES 3  // Before Russian roulette starts
#define RR_PROBABILITY 0.9  // Continue probability

// Main transport function
vec3 transport_trace(Ray ray) {
    vec3 radiance = vec3(0.0);
    vec3 throughput = vec3(1.0);
    
    // Path tracing loop
    for (int bounce = 0; bounce < MAX_BOUNCES; bounce++) {
        Hit hit;
        
        // Find intersection
        if (!scene_intersect(ray, hit)) {
            // Ray escaped - add environment contribution
            radiance += throughput * transport_environment(ray.direction);
            break;
        }
        
        // Add emission from hit surface (for area lights later)
        radiance += throughput * transport_get_emission(hit);
        
        // Russian roulette termination
        if (bounce >= MIN_BOUNCES) {
            float rr = transport_random();
            if (rr > RR_PROBABILITY) {
                break;  // Terminate path
            }
            // Boost throughput to maintain unbiased result
            throughput /= RR_PROBABILITY;
        }
        
        // Sample next direction from BRDF
        vec3 wi;
        float pdf;
        vec3 brdf = interaction_sample_brdf(
            hit, 
            -ray.direction,  // wo (outgoing = negative incident)
            transport_random2(),
            wi, 
            pdf
        );
        
        // Check for invalid sample
        if (pdf <= 0.0 || all(lessThanEqual(brdf, vec3(0.0)))) {
            break;
        }
        
        // Update throughput
        float cos_theta = abs(dot(wi, hit.n));
        throughput *= brdf * cos_theta / pdf;
        
        // Setup next ray
        ray.origin = hit.p + hit.n * 0.001;  // Offset to avoid self-intersection
        ray.direction = wi;
        ray.tmin = 0.0;
        ray.tmax = 10000.0;
        
        // Avoid fireflies from extreme throughput
        float max_component = max(max(throughput.r, throughput.g), throughput.b);
        if (max_component > 100.0) {
            throughput *= 100.0 / max_component;
        }
    }
    
    return radiance;
}
```

### Environment and Emission

```glsl
// Environment lighting (sky)
vec3 transport_environment(vec3 direction) {
    // Same gradient sky as Phase 1
    float t = 0.5 * (direction.y + 1.0);
    vec3 bottom = vec3(0.5, 0.7, 1.0);
    vec3 top = vec3(1.0, 1.0, 1.0);
    
    // Add sun disk for visual interest
    vec3 sun_dir = normalize(vec3(1.0, 1.0, 0.5));
    float sun_cos = dot(direction, sun_dir);
    if (sun_cos > 0.999) {
        return vec3(10.0, 9.0, 7.0);  // Bright sun
    }
    
    return mix(bottom, top, t);
}

// Get emission from surface (for emissive materials)
vec3 transport_get_emission(Hit hit) {
    // For now, no emissive surfaces
    // Will add in Phase 3 when we have material system
    return vec3(0.0);
}
```

### Path Tracing Helpers

```glsl
// Offset ray origin to avoid self-intersection
vec3 transport_offset_origin(vec3 p, vec3 n, vec3 dir) {
    // Offset along normal based on ray direction
    float sign = dot(dir, n) > 0.0 ? 1.0 : -1.0;
    return p + n * (0.001 * sign);
}

// Check if direction is in hemisphere
bool transport_same_hemisphere(vec3 wi, vec3 wo, vec3 n) {
    return dot(wi, n) * dot(wo, n) > 0.0;
}

// Fresnel reflectance (Schlick approximation)
vec3 transport_fresnel_schlick(vec3 f0, float cos_theta) {
    return f0 + (vec3(1.0) - f0) * pow(1.0 - cos_theta, 5.0);
}
```

## Integration with Other Modules

### Interface with Interaction Module

The path tracer expects these functions from interaction:
```glsl
// Sample BRDF and return direction
vec3 interaction_sample_brdf(Hit hit, vec3 wo, vec2 u, out vec3 wi, out float pdf)

// Evaluate BRDF for given directions  
vec3 interaction_evaluate_brdf(Hit hit, vec3 wi, vec3 wo)

// Evaluate PDF for given directions
float interaction_pdf_brdf(Hit hit, vec3 wi, vec3 wo)
```

### RNG Initialization in Main

The compiled shader's main() will need modification:
```glsl
void main() {
    vec2 pixel = gl_FragCoord.xy;
    
    // Initialize RNG for this pixel
    transport_init_rng(pixel, u_frame_index);
    
    // Generate ray
    Ray ray = camera_generateRay(pixel, u_resolution);
    
    // Trace path
    vec3 radiance = transport_trace(ray);
    
    // Rest of pipeline...
}
```

## Key Design Decisions

### Why Russian Roulette?
- Unbiased termination (paths can theoretically be infinite)
- Better than hard cutoff at MAX_BOUNCES
- Preserves energy correctly
- Standard Monte Carlo practice

### Why MIN_BOUNCES Before RR?
- Ensures minimum path length for good quality
- Captures important direct + indirect light
- Reduces variance from early termination
- Common practice is 3-5 bounces

### Why Throughput Clamping?
- Prevents firefly artifacts
- Slightly biased but improves convergence
- Can be tuned based on scene brightness
- Alternative: path regularization

### Self-Intersection Handling
- Offset ray origins along normal
- Critical to prevent shadow acne
- Offset amount scene-dependent
- Could use adaptive offset later

## Testing Strategy

### Unit Tests (via Inspection)
```typescript
test('RNG produces uniform distribution')
test('RNG state advances correctly')
test('Russian roulette is unbiased')
test('Path termination occurs eventually')
```

### Visual Tests
```typescript
test('white furnace test', () => {
  // Sphere inside white emissive sphere
  // Should converge to uniform white
})

test('diffuse interreflection visible', () => {
  // Cornell box with colored walls
  // Should show color bleeding
})

test('no fireflies', () => {
  // Bright light source
  // Check max pixel value is reasonable
})
```

### Convergence Tests
```typescript
test('variance decreases with samples', () => {
  // Render multiple frames
  // Measure pixel variance
  // Should decrease as 1/N
})
```

## Performance Considerations

### Optimization Opportunities (Not for Phase 2)
- Importance sampling (Phase 4)
- Next event estimation (Phase 4)
- MIS for better convergence
- Adaptive sampling
- Path regularization

### Current Performance Targets
- ~5-10ms per frame for simple scenes
- 8 bounces maximum reasonable
- Should handle 100+ samples without issues

## Success Criteria

Phase 2.1 is complete when:
1. Paths bounce multiple times
2. Russian roulette terminates paths
3. No infinite loops or hangs
4. Diffuse interreflection visible
5. Converges to expected result
6. RNG produces good random sequences

## What We're NOT Doing in Phase 2.1

- Next event estimation (direct light sampling)
- Multiple importance sampling
- Bidirectional path tracing
- Metropolis sampling
- Adaptive sampling
- Importance sampling (still using cosine)
- Complex materials (just diffuse)
- Volume scattering
- Spectral rendering

## Connection to Phase 2.2

This path tracer provides:
- The recursive bouncing framework
- RNG infrastructure
- Termination strategy
- Throughput tracking

Phase 2.2 will provide:
- Lambert BRDF implementation
- Proper cosine-weighted sampling
- Material evaluation functions

Together they create our first real global illumination renderer. The normal-colored sphere will transform into a properly lit diffuse sphere with realistic shading.

## Debug Helpers

```glsl
// Visualize bounce count
vec3 transport_debug_bounces(Ray ray) {
    vec3 colors[8] = vec3[8](
        vec3(1,0,0), vec3(0,1,0), vec3(0,0,1),
        vec3(1,1,0), vec3(1,0,1), vec3(0,1,1),
        vec3(1,1,1), vec3(0.5,0.5,0.5)
    );
    
    // Trace and count bounces
    int bounces = 0;
    for (int i = 0; i < MAX_BOUNCES; i++) {
        Hit hit;
        if (!scene_intersect(ray, hit)) break;
        bounces++;
        // Setup next ray...
    }
    
    return colors[min(bounces, 7)];
}
```

This debug mode helps verify paths are bouncing correctly before adding accumulation.
