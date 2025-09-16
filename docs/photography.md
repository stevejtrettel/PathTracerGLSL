
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

### Estimator
**Purpose**: Compute radiance along rays  
**Mathematical Role**: Solve the rendering equation

```glsl
// Required function (auto-prefixed to e_estimate)
vec3 estimate(Ray ray)
```

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
  
  // Camera
  vec2 xi = sample_2d(ivec2(pixel), u_frame_index, 0);
  Ray ray = c_generate_ray(pixel, xi);
  
  // Estimator
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
- `g_geodesic(origin, direction, t)` - Ray marching
- `sc_intersect(ray, hit)` - Scene queries
- `m_eval(wi, wo, hit)` - Material evaluation
- `m_sample(wi, hit, xi)` - Material sampling
- `l_sample_light()` - Light sampling

## Dimension Tracking

For uncorrelated random samples:

```glsl
vec3 estimate(Ray ray) {
  int dim = 0;  // Local dimension counter
  
  vec2 xi1 = sample_2d(pixel_id, sample_id, dim++);
  vec3 dir = sample_hemisphere(normal, pixel_id, sample_id, dim++);
  vec2 xi2 = sample_2d(pixel_id, sample_id, dim++);
  
  // Each call increments dimension
}
```

## File Structure

```
photography/
├── contracts/           # Module specifications
├── cameras/            # Ray generation
├── estimators/         # Light transport algorithms  
├── films/              # Accumulation strategies
├── developers/         # Output processing
├── configurations/     # Pre-built combinations
└── templates/          # Boilerplate for new modules
```

Now I'll create the contract files as artifacts:Perfect! I've created a complete documentation package with:

## Created Documents:

1. **System Overview** - Complete architecture with our decisions:
    - Math as universal infrastructure (including sampling)
    - Five pillars clearly defined
    - Auto-prefixing strategy
    - Module communication patterns

2. **Photography Overview** - Fully revised with:
    - Four module types (Camera, Estimator, Film, Developer)
    - Correct interfaces (Estimator takes Ray, not pixel)
    - Orchestration handled by engine-generated main()
    - Local dimension tracking for sampling

3. **Photography Contracts** (4 files):
    - **CAMERA_CONTRACT.md** - Ray generation
    - **ESTIMATOR_CONTRACT.md** - Radiance calculation
    - **FILM_CONTRACT.md** - Accumulation strategies
    - **DEVELOPER_CONTRACT.md** - Output processing

4. **System-Level Contract**:
    - **MODULE_DESCRIPTOR.md** - Universal module interface

## Key Architecture Decisions Captured:

- **Clean naming**: Write `accumulate()`, engine produces `f_accumulate()`
- **Sampling as infrastructure**: Not a swappable module, but always available
- **Geometry defines types**: Point and Direction come from geometry
- **Mathematical interfaces**: Estimator computes radiance along rays
- **Local dimension tracking**: Each function tracks its own dimension counter

