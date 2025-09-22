# Photography Types Contract

## Core Types

```glsl
// Spectral representation (will extend for spectral rendering)
typedef vec3 Spectrum;

// Accumulated radiance in film (may differ from Spectrum in spectral rendering)
typedef vec3 Radiance;

// RGB output for display
typedef vec3 RGB;
```

## Ray Structure

```glsl
struct Ray {
  Point origin;
  Direction direction;  // Must be unit vector
  float tmin;          // Default: 0.0
  float tmax;          // Default: MAX_DIST
}

// Helper constructor
Ray make_ray(Point origin, Direction dir) {
  Ray r;
  r.origin = origin;
  r.direction = normalize(dir);
  r.tmin = 0.0;
  r.tmax = MAX_DIST;
  return r;
}

Ray make_shadow_ray(Point origin, Direction dir, float max_t) {
  Ray r;
  r.origin = origin;
  r.direction = normalize(dir);
  r.tmin = EPSILON;  // Avoid self-intersection
  r.tmax = max_t;
  return r;
}
```

## Module Configuration

```glsl
// Compile-time configuration flags
#define MAX_BOUNCES <?> 
#define RR_START_DEPTH <?>

// Strategy selection (compile-time)
#define VOLUME_STRATEGY <?>     // DELTA_TRACKING | RAY_MARCHING | ANALYTICAL
#define SSS_MODEL <?>          // DIFFUSION | PHOTON_BEAM | BRUTE_FORCE
#define NEE_STRATEGY <?>       // MIS | LIGHT_ONLY | BSDF_ONLY | NONE

// Feature flags
#define ENABLE_NEE <?>         // 0 or 1
#define DEBUG_TRANSPORT <?>    // 0 or 1
#define PROFILE_TRANSPORT <?>  // 0 or 1
```

## Engine Uniforms

```glsl
// Resolution and frame info
uniform vec2 u_resolution;     // Screen dimensions
uniform int u_frame_index;     // Current frame number
uniform float u_time;          // Time in seconds

// Reset detection
uniform bool u_parameters_changed;  // True when parameters change
```

## Module Prefixes

Functions are auto-prefixed by module type:

| Module | Prefix | Example |
|--------|--------|---------|
| Camera | `c_` | `c_generate_ray` |
| Estimator | `e_` | `e_estimate` |
| Film | `f_` | `f_accumulate` |
| Developer | `d_` | `d_develop` |

## Random Sampling Interface

Provided by math/sampling.glsl:

```glsl
// Automatic dimension tracking
float next_1d();        // Next random float [0,1)
vec2 next_2d();        // Next random vec2 [0,1)²
vec3 next_3d();        // Next random vec3 [0,1)³

// Sampling helpers (from math/)
vec2 sample_unit_disk(vec2 xi);
vec3 sample_unit_sphere(vec2 xi);
vec3 sample_hemisphere(vec2 xi, vec3 normal);
```

## Module Descriptor

```typescript
interface PhotographyModule {
  id: {
    kind: 'camera' | 'estimator' | 'film' | 'developer';
    name: string;
    version: string;
  };
  provides: string[];
  requires: string[];
  fragment: {
    functions: string;
    uniforms?: string;
    constants?: string;
  };
  parameters?: Array<{
    name: string;
    type: string;
    default: any;
    uniform: boolean;
  }>;
}
```

## Validation Constants

```glsl
const float EPSILON = 0.0001;
const float MAX_DIST = 1e10;
const int MAX_STEPS = 256;
const int MAX_VOLUME_STEPS = 1024;
```
