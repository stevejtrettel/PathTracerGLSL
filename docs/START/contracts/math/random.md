# Random Number Generation System Documentation

## Overview

The path tracer's random number generation (RNG) system provides high-quality pseudo-random numbers for Monte Carlo sampling without the complexity of threading state through function calls. Each pixel maintains its own RNG state that automatically advances with each random number request, ensuring decorrelated samples across pixels, frames, and sequential calls within a single path.

## Architecture

### Core RNG State

The system uses a per-fragment mutable state variable:
```glsl
uint rng_seed;  // Per-fragment state, not globally shared
```

This exploits a key GLSL characteristic: "global" variables in fragment shaders are actually per-fragment. Each pixel's shader invocation gets its own independent copy of `rng_seed` that can be mutated throughout that pixel's execution.

### Wang Hash Function

The RNG uses Wang's integer hash for state advancement:
```glsl
uint wang_hash(uint seed) {
    seed = uint(seed ^ uint(61)) ^ uint(seed >> uint(16));
    seed *= uint(9);
    seed = seed ^ (seed >> 4);
    seed *= uint(0x27d4eb2d);
    seed = seed ^ (seed >> 15);
    return seed;
}
```

This hash provides good statistical properties with excellent avalanche behavior - small changes in input create large, well-distributed changes in output.

### Random Number Generation

```glsl
float random() {
    rng_seed = wang_hash(rng_seed);  // Advance state
    return float(rng_seed) / 4294967296.0;  // Convert to [0,1]
}

vec2 random2() {
    return vec2(random(), random());  // Two sequential randoms
}
```

Each call to `random()` advances the state, ensuring sequential calls return different values.

## Integration in ShaderCompiler

The `ShaderCompiler` class injects the RNG system into the compiled shader:

### 1. RNG System Injection
```typescript
private getRNGSystem(): string {
    return `
uint rng_seed;

uint wang_hash(uint seed) { ... }
float random() { ... }
vec2 random2() { ... }
vec3 random3() { ... }`;
}
```

### 2. Main Function Initialization
```glsl
void main() {
    vec2 pixel = gl_FragCoord.xy;
    
    // Initialize RNG seed once per pixel
    rng_seed = uint(uint(pixel.x) * uint(1973) + 
                   uint(pixel.y) * uint(9277) + 
                   uint(u_frame_index) * uint(26699)) | uint(1);
    
    // All subsequent random() calls use this seed
    Ray ray = camera_generateRay(pixel, random2());
    // ...
}
```

The seed combines:
- **Pixel coordinates**: Decorrelates adjacent pixels
- **Frame index**: Different random sequence each frame
- **Prime multipliers**: Reduces correlation patterns
- **OR with 1**: Ensures seed is never zero

## Sampling Utilities (random.glsl)

The `random.glsl` file provides sampling functions that use the RNG system:

```glsl
// Sphere sampling
vec3 sample_sphere_uniform(vec2 xi) {
    float z = 1.0 - 2.0 * xi.x;
    float r = sqrt(max(0.0, 1.0 - z * z));
    float phi = TWO_PI * xi.y;
    return vec3(r * cos(phi), r * sin(phi), z);
}

// Cosine-weighted hemisphere (for Lambertian)
vec3 sample_hemisphere_cosine(vec2 xi) {
    float z = sqrt(xi.x);
    float r = sqrt(1.0 - xi.x);
    float phi = TWO_PI * xi.y;
    return vec3(r * cos(phi), r * sin(phi), z);
}
```

These functions take `vec2 xi` parameters (two uniform random numbers in [0,1]) and transform them into specific distributions needed for path tracing.

## Module Usage Pattern

### Internal Generation Approach

Each module that needs randomness generates its own random numbers internally:

```glsl
// In lighting module
LightSample lighting_sample(Point p) {
    vec2 xi = random2();  // Generate internally
    vec3 light_point = sample_uniform_sphere(center, radius, xi);
    // ...
}

// In interaction module  
Direction interaction_surface_scatter(Direction wo, Hit hit, out float pdf) {
    vec2 xi = random2();  // Generate internally
    float cos_theta = sqrt(xi.y);
    // ...
}

// In transport module
for (int bounce = 0; bounce < MAX_BOUNCES; bounce++) {
    if (random() > p_survive) break;  // Russian roulette
    vec2 xi = random2();  // For BRDF sampling
    // ...
}
```

### Benefits of Internal Generation

1. **Clean Interfaces**: Functions don't need xi parameters
2. **Module Independence**: Each module manages its own randomness
3. **Automatic Decorrelation**: Sequential calls get different values
4. **No Dimension Tracking**: No need to manage which "dimension" of randomness is being used

## Design Tradeoffs

### Current Design Benefits

- **Simplicity**: Just call `random()` when needed
- **No State Threading**: No need to pass RNG state through call chains
- **Good Quality**: Wang hash provides sufficient quality for Monte Carlo
- **Fast**: Minimal computational overhead
- **Intuitive**: Matches CPU-style RNG mental model

### Limitations

- **No Reproducibility**: Can't replay exact random sequences for debugging
- **No Stratification**: Can't use quasi-random sequences (Sobol, Halton)
- **No Correlation Control**: Can't carefully decorrelate specific dimensions

### Future Extensibility

If exact reproducibility becomes necessary, the system could be refactored to:

1. **Dimension-Based System**: Each random number indexed by (pixel, frame, dimension)
2. **State Threading**: Pass `inout uint rng_state` through functions
3. **Quasi-Random Sequences**: Replace with Sobol or blue noise sampling

The current architecture prioritizes simplicity and ease of use over reproducibility, making it ideal for production rendering where convergence quality matters more than exact frame-to-frame reproducibility.

## Performance Characteristics

- **Memory**: Single uint32 per fragment (4 bytes)
- **Computation**: One hash operation per random number
- **Quality**: Period of 2^32 per pixel before repetition
- **Correlation**: Effectively decorrelated across pixels and frames

The system provides more than sufficient quality for path tracing convergence while maintaining minimal overhead and maximum simplicity.
