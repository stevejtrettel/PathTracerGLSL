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
**Purpose**: Compute radiance along rays  
**Mathematical Role**: Solve the rendering equation

```glsl
// Required function (auto-prefixed to e_estimate)
vec3 estimate(Ray ray)
```

**Optimization**: Uses precomputed `hit.frame` from Scene and batched BSDF operations (`m_interact`) for efficiency.

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
- `sc_intersect(ray, hit)` - Scene queries (returns hit with precomputed frame)
- `m_interact(wi, hit, xi, wo, pdf)` - Batched material sampling and evaluation
- `m_eval(wi, wo, hit)` - Material evaluation (for MIS)
- `m_pdf(wi, wo, hit)` - Material PDF (for MIS)
- `l_sample_light()` - Light sampling

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
// Efficient path - single batched call
float pdf;
Direction wo;
vec3 contribution = m_interact(wi, hit, xi, wo, pdf);
// Returns BSDF * cos(θ) / pdf in one operation

// MIS path - separate calls when needed
vec3 bsdf_value = m_eval(wi, wo, hit);
float bsdf_pdf = m_pdf(wi, wo, hit);
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

## Performance Optimizations

1. **Precomputed camera matrices**: Saves ~10 operations per ray
2. **Precomputed hit frames**: Avoids redundant `g_frame()` calls
3. **Automatic dimension tracking**: Prevents correlation bugs
4. **Batched BSDF operations**: Single call vs three separate calls
5. **Optimized shadow rays**: Early-exit intersection tests

## Key Architecture Decisions

- **Clean naming**: Write `accumulate()`, engine produces `f_accumulate()`
- **Sampling as infrastructure**: Not a swappable module, but always available
- **Geometry defines types**: Point and Direction come from geometry
- **Mathematical interfaces**: Estimator computes radiance along rays
- **Automatic dimension tracking**: Engine manages sample dimensions
