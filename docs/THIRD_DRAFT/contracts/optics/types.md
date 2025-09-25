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
#define VOLUME_STRATEGY <?>     // DELTA_TRACKING | RAY_MARCHING
#define NEE_STRATEGY <?>        // MIS | LIGHT_ONLY | NONE
#define BRDF_MODEL <?>          // DISNEY | LAMBERT | GGX
#define PHASE_FUNCTION <?>      // HENYEY_GREENSTEIN | ISOTROPIC | RAYLEIGH

// Feature flags
#define ENABLE_NEE <?>          // 0 or 1
#define DEBUG_TRANSPORT <?>     // 0 or 1
#define PROFILE_TRANSPORT <?>   // 0 or 1
```

## Engine Uniforms

```glsl
// Resolution and frame info
uniform vec2 u_resolution;     // Screen dimensions
uniform int u_frame_index;     // Current frame number
uniform float u_time;          // Time in seconds

// Reset detection
uniform bool u_film_reset;     // True when parameters change
uniform int u_sample_count;    // Samples accumulated
```

## Manual Function Prefixes

Functions are manually prefixed by module kind:

| Module | Prefix | Example Functions |
|--------|--------|------------------|
| camera | `camera_` | `camera_generateRay()`, `camera_getFrame()` |
| transport | `transport_` | `transport_trace()`, `transport_direct()` |
| interaction | `interaction_` | `interaction_surface_shade()`, `interaction_volume_scatter()` |
| film | `film_` | `film_accumulate()`, `film_getVariance()` |
| developer | `developer_` | `developer_develop()`, `developer_getExposure()` |

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
vec3 sample_cosine_hemisphere(Frame frame, vec2 xi);
```

## Module Descriptor

```typescript
interface PhotographyModule {
  id: {
    kind: 'camera' | 'transport' | 'interaction' | 'film' | 'developer';
    name: string;
    version: string;
  };
  fragment: {
    functions: string;
    uniforms?: string;
    constants?: string;
  };
  parameters?: Array<{
    name: string;
    type: string;
    default: any;
    min?: number;
    max?: number;
  }>;
  // No provides/requires in modern system
}
```

## Material Properties Structure

Used by interaction modules to query material data:

```glsl
struct MaterialProperties {
  // Surface properties
  vec3 albedo;
  float roughness;
  float metallic;
  float ior;
  vec3 emission;
  float emission_intensity;
  
  // Volume properties
  vec3 sigma_scatter;
  vec3 sigma_absorb;
  float sigma_majorant;
  float phase_g;
  
  // Flags
  bool has_volume;
  bool is_emissive;
};
```

## Light Sampling Types

```glsl
struct LightSample {
  Direction wi;         // Direction toward light
  float distance;       // Distance to light
  Spectrum radiance;    // Incoming radiance
  float pdf;           // Probability density
  int light_id;        // Which light
  bool is_delta;       // Point/directional
};
```

## Transport State

```glsl
struct TransportState {
  Spectrum throughput;  // Path contribution weight  
  Spectrum radiance;    // Accumulated radiance
  int depth;           // Bounce count
  bool specular_path;  // For NEE decisions
  bool terminated;     // Path ended
};
```

## Validation Constants

```glsl
const float EPSILON = 0.0001;
const float MAX_DIST = 1e10;
const int MAX_STEPS = 256;
const int MAX_VOLUME_STEPS = 1024;

// Material IDs
const int MATERIAL_AIR = -1;  // Special ID for air/vacuum
```

## Photography Module Count

```glsl
const int NUM_PHOTOGRAPHY_MODULES = 5;  // camera, transport, interaction, film, developer
```


```
