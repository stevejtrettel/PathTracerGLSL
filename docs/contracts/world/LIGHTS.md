# Lights Module Contract

## Purpose
Lights modules define sources of illumination and provide importance sampling strategies for efficient rendering. They work in any geometry by using geometric operations for solid angle calculations and light transport along geodesics.

## Module Descriptor
```typescript
{
  type: 'lights',
  id: string,                    // e.g., 'hdri_environment', 'area_lights'
  provides: ['lights'],
  requires: ['geometry'],         // For geodesic light transport
  uniforms: [],                   // Light-specific parameters
  resources: [],                  // Environment maps, IES profiles, etc.
  defines: {
    LIGHT_TYPE: 'analytic' | 'environment' | 'area' | 'mixed',
    NUM_LIGHTS?: number,           // For analytic lights
    HAS_ENVIRONMENT?: boolean,     // Environment map present
    SUPPORTS_MIS?: boolean         // Multiple importance sampling
  }
}
```

## Required Functions

### sample_light
Sample a light source with importance sampling.
```glsl
LightSample l_sample_light(Point p, vec2 xi)
```
- **p**: Point being shaded
- **xi**: Random numbers [0,1)²
- **returns**: Sampled light direction, radiance, and PDF
- **Note**: Should importance sample based on estimated contribution

### eval_light
Evaluate incoming radiance from a direction.
```glsl
vec3 l_eval_light(Point p, Direction wi)
```
- **p**: Point being shaded
- **wi**: Direction toward light
- **returns**: Incoming radiance from that direction
- **Note**: Returns vec3(0) if no light from that direction

### pdf_light
Probability density for sampling a direction.
```glsl
float l_pdf_light(Point p, Direction wi)
```
- **p**: Point being shaded
- **wi**: Direction toward light
- **returns**: PDF value for importance sampling
- **Note**: Must match distribution used in sample_light

## Optional Functions

### sample_emission
Sample an emission point on light sources (for bidirectional).
```glsl
EmissionSample l_sample_emission(vec2 xi1, vec2 xi2)
```
- **xi1**: Random numbers for position
- **xi2**: Random numbers for direction
- **returns**: Point, direction, radiance, and PDFs

### direct_light
Evaluate direct illumination from a specific light.
```glsl
vec3 l_direct_light(int light_id, Point p)
```
- **light_id**: Which light to evaluate
- **p**: Point being shaded
- **returns**: Unoccluded radiance from light

### light_count
Get the number of discrete lights.
```glsl
int l_light_count()
```
- **returns**: Number of analytic/area lights
- **Note**: Excludes environment map

### light_power
Get total power of all lights (for Russian roulette).
```glsl
float l_light_power()
```
- **returns**: Total emitted power
- **Note**: Used for path termination decisions

## Core Types

### Light Sample
```glsl
struct LightSample {
  Direction wi;         // Direction toward light
  float distance;       // Distance to light (inf for directional)
  vec3 radiance;        // Incoming radiance
  float pdf;            // Sampling PDF
  int light_id;         // Which light was sampled
  bool is_delta;        // True for point/directional lights
}
```

### Emission Sample
```glsl
struct EmissionSample {
  Point p;              // Emission point
  Direction n;          // Surface normal at emission
  Direction wo;         // Emission direction
  vec3 radiance;        // Emitted radiance
  float pdf_pos;        // Position sampling PDF
  float pdf_dir;        // Direction sampling PDF
}
```

### Light Types
```glsl
#define LIGHT_POINT 0
#define LIGHT_DIRECTIONAL 1  
#define LIGHT_SPOT 2
#define LIGHT_AREA 3
#define LIGHT_ENVIRONMENT 4
```

## Implementation Examples

### Point Light
```glsl
#define LIGHT_TYPE analytic
#define NUM_LIGHTS 1

uniform vec3 u_light_position;
uniform vec3 u_light_color;
uniform float u_light_intensity;

LightSample l_sample_light(Point p, vec2 xi) {
  LightSample ls;
  
  // Direction from p to light
  Direction to_light = u_light_position - p;
  ls.distance = length(to_light);
  ls.wi = normalize(to_light);
  
  // Inverse square falloff
  float falloff = 1.0 / (ls.distance * ls.distance);
  ls.radiance = u_light_color * u_light_intensity * falloff;
  
  // Delta light - probability is 1 (we always sample it)
  ls.pdf = 1.0;
  ls.is_delta = true;
  ls.light_id = 0;
  
  return ls;
}

vec3 l_eval_light(Point p, Direction wi) {
  // Delta light - only the exact direction has radiance
  return vec3(0.0);
}

float l_pdf_light(Point p, Direction wi) {
  // Delta light - zero probability for any direction
  return 0.0;
}
```

### Environment Map
```glsl
#define LIGHT_TYPE environment
#define HAS_ENVIRONMENT true

uniform sampler2D u_environment_map;
uniform sampler2D u_environment_cdf;  // For importance sampling
uniform float u_environment_intensity;

LightSample l_sample_light(Point p, vec2 xi) {
  LightSample ls;
  
  // Importance sample the environment map
  vec2 uv = sample_environment_importance(xi);
  
  // Convert UV to direction (spherical coordinates)
  float theta = uv.y * PI;
  float phi = uv.x * 2.0 * PI;
  
  ls.wi = vec3(
    sin(theta) * cos(phi),
    cos(theta),
    sin(theta) * sin(phi)
  );
  
  // Look up environment radiance
  ls.radiance = texture(u_environment_map, uv).rgb * u_environment_intensity;
  
  // PDF includes Jacobian for spherical mapping
  float sin_theta = max(0.0001, sin(theta));
  float map_pdf = texture(u_environment_cdf, uv).a;
  ls.pdf = map_pdf / (2.0 * PI * PI * sin_theta);
  
  ls.distance = 1e10;  // Infinite distance
  ls.is_delta = false;
  ls.light_id = -1;    // Environment
  
  return ls;
}

vec3 l_eval_light(Point p, Direction wi) {
  // Convert direction to UV
  vec2 uv = direction_to_uv(wi);
  return texture(u_environment_map, uv).rgb * u_environment_intensity;
}

float l_pdf_light(Point p, Direction wi) {
  vec2 uv = direction_to_uv(wi);
  float theta = uv.y * PI;
  float sin_theta = max(0.0001, sin(theta));
  float map_pdf = texture(u_environment_cdf, uv).a;
  return map_pdf / (2.0 * PI * PI * sin_theta);
}
```

### Area Light
```glsl
#define LIGHT_TYPE area

struct AreaLight {
  Point corner;         // Corner of rectangular light
  Direction edge1;      // First edge vector
  Direction edge2;      // Second edge vector
  Direction normal;     // Normal direction
  vec3 emission;        // Emitted radiance
};

uniform AreaLight u_area_light;

LightSample l_sample_light(Point p, vec2 xi) {
  LightSample ls;
  
  // Sample point on rectangle
  Point light_p = u_area_light.corner + 
                  xi.x * u_area_light.edge1 + 
                  xi.y * u_area_light.edge2;
  
  // Direction from p to sampled point
  Direction to_light = light_p - p;
  ls.distance = length(to_light);
  ls.wi = normalize(to_light);
  
  // Check if we're facing the light
  float cos_light = g_dot(-ls.wi, u_area_light.normal, light_p);
  if (cos_light <= 0.0) {
    ls.radiance = vec3(0.0);
    ls.pdf = 0.0;
    return ls;
  }
  
  // Area to solid angle conversion
  float area = length(u_area_light.edge1) * length(u_area_light.edge2);
  float solid_angle = area * cos_light / (ls.distance * ls.distance);
  
  ls.radiance = u_area_light.emission;
  ls.pdf = 1.0 / solid_angle;
  ls.is_delta = false;
  ls.light_id = 0;
  
  return ls;
}
```

### Multiple Lights with MIS
```glsl
#define SUPPORTS_MIS true

LightSample l_sample_light(Point p, vec2 xi) {
  // Choose which light to sample
  float light_probs[MAX_LIGHTS];
  compute_light_probabilities(p, light_probs);
  
  int light_id = sample_discrete(light_probs, xi.x);
  float light_prob = light_probs[light_id];
  
  // Remap xi.x for reuse
  xi.x = (xi.x - light_prob) / light_prob;
  
  // Sample the chosen light
  LightSample ls = sample_specific_light(light_id, p, xi);
  
  // Adjust PDF for light selection
  ls.pdf *= light_prob;
  ls.light_id = light_id;
  
  return ls;
}

// For MIS weight calculation
float l_pdf_light_mis(Point p, Direction wi, int sampled_light) {
  float pdf_sum = 0.0;
  
  for (int i = 0; i < l_light_count(); i++) {
    float prob = light_probabilities[i];
    float pdf = pdf_specific_light(i, p, wi);
    pdf_sum += prob * pdf;
  }
  
  return pdf_sum;
}
```

## Geometry-Agnostic Implementation

Lights must work in any geometry:
```glsl
// DON'T: Assume Euclidean distance
float distance = length(light_pos - p);  // WRONG in curved space!

// DO: Use geodesic distance
float distance = g_distance(p, light_pos);  // Correct

// DON'T: Assume straight-line visibility
bool visible = dot(to_light, normal) > 0;  // WRONG!

// DO: Consider geodesic bending
Ray ray;
ray.origin = p;
ray.direction = initial_direction_to(light_pos, p);
bool visible = !sc_intersect_any(ray, distance);
```

### Solid Angle in Curved Space
```glsl
// Compute solid angle using the metric
float solid_angle_curved(Point p, AreaLight light) {
  // Sample several points on light
  float total = 0.0;
  const int N = 16;
  
  for (int i = 0; i < N; i++) {
    vec2 uv = hammersley(i, N);
    Point light_p = sample_light_surface(light, uv);
    
    // Direction in curved space
    Direction wi = initial_direction_to(light_p, p);
    
    // Use metric for angle computation
    float cos_theta = g_dot(wi, light.normal, light_p);
    float d2 = g_distance(p, light_p);
    d2 = d2 * d2;
    
    total += max(0.0, cos_theta) / d2;
  }
  
  return total * light.area / float(N);
}
```

## Validation Requirements
The engine validates that lights modules:
1. Return valid (non-negative) radiance values
2. Return normalized direction vectors
3. Provide consistent PDFs (integral = 1)
4. Match sampling distribution with PDF
5. Handle edge cases (light behind surface)

## Performance Notes
- Precompute CDFs for environment importance sampling
- Use hierarchical sample warping for large area lights
- Consider light trees for many lights
- Cache light selection probabilities per region
- Use LOD for distant environment maps
