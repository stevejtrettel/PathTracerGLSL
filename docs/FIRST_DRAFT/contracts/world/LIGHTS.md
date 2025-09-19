# Lights Module Contract

## Purpose
Lights modules define sources of illumination and provide importance sampling strategies. Simple lights are hand-written, while complex lighting setups (environment maps, many lights with MIS) can be generated for optimization.

## Implementation Approach
**Hybrid**: Simple lights (point, directional) are hand-written. Complex setups (HDRI with importance sampling, multi-light MIS) are generated.

## Module Descriptor
```typescript
{
  id: {
    kind: 'lights',
    name: string,                // e.g., 'point_light', 'hdri_environment'
    version: string
  },
  provides: ['lights'],
  requires: ['geometry'],       // For geodesic light transport
  fragment: {
    functions: string,          // Hand-written or generated GLSL
    uniforms: string,          // Light parameters
    defines: {
      LIGHT_TYPE: 'analytic' | 'environment' | 'area' | 'mixed',
      NUM_LIGHTS?: number,     // For multi-light setups
      HAS_ENVIRONMENT?: boolean
    }
  },
  resources?: Array<{          // For environment maps
    name: string,
    type: 'texture2D',
    data?: ArrayBuffer        // Precomputed CDFs
  }>
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

### eval_light
Evaluate incoming radiance from a direction.
```glsl
vec3 l_eval_light(Point p, Direction wi)
```
- **p**: Point being shaded
- **wi**: Direction toward light
- **returns**: Incoming radiance from that direction

### pdf_light
Probability density for sampling a direction.
```glsl
float l_pdf_light(Point p, Direction wi)
```
- **p**: Point being shaded
- **wi**: Direction toward light
- **returns**: PDF value for importance sampling

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

## Hand-Written Examples

### Simple Point Light
```glsl
// Hand-written - too simple to benefit from generation
uniform vec3 u_light_position;
uniform vec3 u_light_color;
uniform float u_light_intensity;

LightSample l_sample_light(Point p, vec2 xi) {
  LightSample ls;
  
  Direction to_light = u_light_position - p;
  ls.distance = length(to_light);
  ls.wi = normalize(to_light);
  
  float falloff = 1.0 / (ls.distance * ls.distance);
  ls.radiance = u_light_color * u_light_intensity * falloff;
  ls.pdf = 1.0;
  ls.is_delta = true;
  
  return ls;
}

vec3 l_eval_light(Point p, Direction wi) {
  return vec3(0.0);  // Delta light
}

float l_pdf_light(Point p, Direction wi) {
  return 0.0;  // Delta light
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
  ls.distance = g_distance(p, light_p);  // Use geodesic distance
  ls.wi = normalize(to_light);
  
  // Check if we're facing the light
  float cos_light = g_dot(-ls.wi, u_area_light.normal, light_p);
  if (cos_light <= 0.0) {
    ls.radiance = vec3(0.0);
    ls.pdf = 0.0;
    return ls;
  }
  
  // Area to solid angle conversion (using metric)
  float area = length(u_area_light.edge1) * length(u_area_light.edge2);
  float solid_angle = area * cos_light / (ls.distance * ls.distance);
  
  ls.radiance = u_area_light.emission;
  ls.pdf = 1.0 / solid_angle;
  ls.is_delta = false;
  ls.light_id = 0;
  
  return ls;
}

vec3 l_eval_light(Point p, Direction wi) {
  // Check if wi hits the area light
  Ray ray;
  ray.origin = p;
  ray.direction = wi;
  
  // Intersect with light rectangle
  float t = intersect_rectangle(ray, u_area_light);
  if (t > 0.0) {
    return u_area_light.emission;
  }
  return vec3(0.0);
}

float l_pdf_light(Point p, Direction wi) {
  // Similar intersection test, return pdf if hit
  Ray ray;
  ray.origin = p;
  ray.direction = wi;
  
  float t = intersect_rectangle(ray, u_area_light);
  if (t > 0.0) {
    Point light_p = g_geodesic(p, wi, t);
    float cos_light = g_dot(-wi, u_area_light.normal, light_p);
    if (cos_light > 0.0) {
      float area = length(u_area_light.edge1) * length(u_area_light.edge2);
      float distance = g_distance(p, light_p);
      return (distance * distance) / (area * cos_light);
    }
  }
  return 0.0;
}
```

### Multiple Lights with MIS (Hand-Written)
```glsl
#define SUPPORTS_MIS true
#define NUM_LIGHTS 3

// For MIS weight calculation
float balance_heuristic(float pdf_a, float pdf_b) {
  return pdf_a / (pdf_a + pdf_b);
}

float power_heuristic(float pdf_a, float pdf_b, float beta) {
  float pa = pow(pdf_a, beta);
  float pb = pow(pdf_b, beta);
  return pa / (pa + pb);
}

LightSample l_sample_light(Point p, vec2 xi) {
  // Choose which light to sample based on power
  float light_powers[NUM_LIGHTS];
  light_powers[0] = compute_light_power(0, p);
  light_powers[1] = compute_light_power(1, p);
  light_powers[2] = compute_light_power(2, p);
  
  float total_power = light_powers[0] + light_powers[1] + light_powers[2];
  float light_probs[NUM_LIGHTS];
  light_probs[0] = light_powers[0] / total_power;
  light_probs[1] = light_powers[1] / total_power;
  light_probs[2] = light_powers[2] / total_power;
  
  // Sample discrete distribution
  int light_id = 0;
  float cdf = light_probs[0];
  if (xi.x > cdf) {
    light_id = 1;
    cdf += light_probs[1];
    if (xi.x > cdf) {
      light_id = 2;
    }
  }
  
  // Remap xi.x for reuse
  float light_prob = light_probs[light_id];
  xi.x = (xi.x - (light_id > 0 ? cdf - light_prob : 0.0)) / light_prob;
  
  // Sample the chosen light
  LightSample ls = sample_specific_light(light_id, p, xi);
  
  // Adjust PDF for light selection
  ls.pdf *= light_prob;
  ls.light_id = light_id;
  
  return ls;
}

// For MIS: probability of sampling direction wi from ANY light
float l_pdf_light_mis(Point p, Direction wi, int sampled_light) {
  float pdf_sum = 0.0;
  
  for (int i = 0; i < NUM_LIGHTS; i++) {
    float prob = compute_light_probability(i, p);
    float pdf = pdf_specific_light(i, p, wi);
    pdf_sum += prob * pdf;
  }
  
  return pdf_sum;
}
```

## Generated Examples

### Environment Map with Importance Sampling
```typescript
// Build time: analyze HDRI and generate sampling code
const hdri = loadHDRI('sunset.exr');
const analysis = analyzeEnvironmentMap(hdri);

const module = EnvironmentLightCompiler.compile(hdri, analysis);
// Generates:
```
```glsl
// Generated with precomputed CDFs
uniform sampler2D u_environment_map;
uniform sampler2D u_environment_cdf;  // Precomputed at build time
uniform float u_environment_intensity;

// Generated importance sampling (optimized for this specific HDRI)
vec2 sample_environment_optimized(vec2 xi) {
  // Binary search through precomputed CDF
  float v = texture(u_environment_cdf, vec2(0.5, xi.y)).x;
  
  // Optimized horizontal search for this HDRI's distribution
  float u = xi.x;
  // ... specialized sampling code based on HDRI analysis
  
  return vec2(u, v);
}

LightSample l_sample_light(Point p, vec2 xi) {
  LightSample ls;
  
  // Use generated importance sampling
  vec2 uv = sample_environment_optimized(xi);
  
  // Convert to direction
  float theta = uv.y * PI;
  float phi = uv.x * 2.0 * PI;
  ls.wi = vec3(sin(theta) * cos(phi), cos(theta), sin(theta) * sin(phi));
  
  // Sample radiance
  ls.radiance = texture(u_environment_map, uv).rgb * u_environment_intensity;
  
  // PDF from precomputed distribution
  float sin_theta = max(0.0001, sin(theta));
  float map_pdf = texture(u_environment_cdf, uv).a;
  ls.pdf = map_pdf / (2.0 * PI * PI * sin_theta);
  
  ls.distance = 1e10;
  ls.is_delta = false;
  
  return ls;
}
```

### Multiple Lights with MIS
```typescript
// Build time: analyze light configuration
const lights = [
  new AreaLight(...),
  new PointLight(...),
  new SpotLight(...)
];

const module = MultiLightCompiler.compile(lights);
// Generates optimized selection and sampling:
```
```glsl
// Generated with precomputed light selection probabilities
const float light_powers[3] = float[](10.0, 5.0, 8.0);
const float total_power = 23.0;

// Generated specialized sampling for this light configuration
LightSample l_sample_light(Point p, vec2 xi) {
  // Light selection optimized for power distribution
  float cdf[3] = float[](
    10.0/23.0,
    15.0/23.0,
    1.0
  );
  
  int light_id = 0;
  if (xi.x > cdf[0]) light_id = 1;
  if (xi.x > cdf[1]) light_id = 2;
  
  // Remap xi for reuse
  float pdf_select = (light_id == 0) ? cdf[0] : 
                     (light_id == 1) ? (cdf[1] - cdf[0]) :
                     (1.0 - cdf[1]);
  xi.x = (xi.x - (light_id > 0 ? cdf[light_id-1] : 0.0)) / pdf_select;
  
  // Sample selected light (generated per-light code)
  LightSample ls;
  switch(light_id) {
    case 0: ls = sample_area_light_0(p, xi); break;
    case 1: ls = sample_point_light_1(p, xi); break;
    case 2: ls = sample_spot_light_2(p, xi); break;
  }
  
  ls.pdf *= pdf_select;
  ls.light_id = light_id;
  
  return ls;
}

// Generated MIS evaluation
float l_pdf_light(Point p, Direction wi) {
  float pdf = 0.0;
  
  // Check each light's contribution (unrolled loop)
  pdf += (10.0/23.0) * pdf_area_light_0(p, wi);
  pdf += (5.0/23.0) * pdf_point_light_1(p, wi);
  pdf += (8.0/23.0) * pdf_spot_light_2(p, wi);
  
  return pdf;
}
```

## Generation Strategies

### Build-Time Analysis
```typescript
class LightCompiler {
  static analyzeEnvironment(hdri: HDRImage): EnvironmentAnalysis {
    return {
      luminanceDistribution: computeLuminance(hdri),
      primaryDirection: findPrimaryLight(hdri),
      contrast: computeContrast(hdri),
      shouldUseImportanceSampling: true
    };
  }
  
  static generateCDF(hdri: HDRImage): Float32Array {
    // Precompute CDFs for importance sampling
    // This expensive computation happens once at build time
  }
  
  static optimizeLightSelection(lights: Light[]): string {
    // Generate optimal light selection code
    // based on power, distance heuristics
  }
}
```

### When to Generate vs Hand-Write

**Generate when:**
- Environment maps (need CDFs)
- Many lights (optimize selection)
- Complex area lights (optimize sampling)
- IES profiles (preprocess data)

**Hand-write when:**
- Simple analytic lights
- Research on new light types
- Learning/debugging

## Optimization Examples

### Precomputed CDFs
```typescript
// At build time
const cdf = computeEnvironmentCDF(hdri);
const cdfTexture = packCDFToTexture(cdf);

// Generates:
uniform sampler2D u_environment_cdf;  // No runtime CDF building
```

### Unrolled Light Loops
```glsl
// Instead of:
for (int i = 0; i < num_lights; i++) {
  pdf += light_prob[i] * evaluate_light(i, wi);
}

// Generate:
pdf += 0.435 * evaluate_light_0(wi);
pdf += 0.217 * evaluate_light_1(wi);
pdf += 0.348 * evaluate_light_2(wi);
```

### Specialized Sampling
```typescript
// If environment is mostly dark with bright sun
if (analysis.hasStrongDirectional) {
  // Generate two-tier sampling:
  // 80% sample sun direction, 20% sample rest
  generateSunImportanceSampling(analysis.sunDirection);
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

### Light Transport Along Geodesics
```glsl
// For point lights in curved space
LightSample l_sample_curved_point_light(Point p, vec2 xi) {
  LightSample ls;
  
  // Initial direction to light (tangent space)
  Direction initial_dir = compute_initial_direction(p, u_light_position);
  
  // Trace geodesic to light
  float t = 0.0;
  Point current = p;
  Direction dir = initial_dir;
  
  for (int i = 0; i < MAX_GEODESIC_STEPS; i++) {
    float dt = min(0.1, g_distance(current, u_light_position));
    current = g_geodesic(current, dir, dt);
    
    // Update direction via parallel transport
    dir = g_parallel_transport(dir, current - dt * dir, current);
    
    t += dt;
    if (g_distance(current, u_light_position) < EPSILON) break;
  }
  
  ls.distance = t;
  ls.wi = initial_dir;  // Direction to start geodesic
  ls.radiance = u_light_color * u_light_intensity / (t * t);
  ls.pdf = 1.0;
  ls.is_delta = true;
  
  return ls;
}
```

## Validation Requirements

Generated light modules must ensure:
1. **Valid radiance**: Return non-negative values
2. **Normalized directions**: All direction vectors unit length
3. **PDF consistency**: PDFs integrate to 1 over solid angle
4. **Sampling match**: Sampling distribution matches PDF
5. **Edge cases**: Handle lights behind surface (return zero)
6. **Delta consistency**: Delta lights have pdf=0 for eval_light
7. **Distance validity**: Finite for area/point, infinite for directional/env
8. **Energy conservation**: No energy created or destroyed

## Performance Notes

- **Precompute CDFs** for environment importance sampling
- **Use hierarchical sampling** for large area lights
- **Consider light trees** for many lights
- **Cache light probabilities** per region
- **Use LOD** for distant environment maps
- **Batch light evaluation** when possible
- **Use MIS** to reduce variance with multiple lights
- **Avoid redundant geodesic computation** in curved spaces
- **Store precomputed basis functions** for complex IES profiles

## Implementation Strategies

### When to Generate
Generate light modules when:
- **Environment maps**: Need importance sampling CDFs
- **Many lights** (>5): Optimize selection strategy
- **Complex distributions**: IES profiles, measured data
- **Specific optimizations**: Known scene characteristics

### When to Hand-Write
Hand-write when:
- **Simple analytic lights**: Point, directional, simple area
- **Research focus**: Novel light types being developed
- **Learning/debugging**: Need to understand implementation
- **Performance not critical**: Prototype or test scenes

## Multiple Importance Sampling

For combining light and BSDF sampling:
```glsl
// In estimator - combine light and BSDF sampling
vec3 direct_lighting_mis(Point p, Direction wo, Hit hit) {
  vec3 total = vec3(0);
  
  // Light sampling
  LightSample ls = l_sample_light(p, sample_2d());
  if (ls.pdf > 0 && !sc_intersect_any(ray_to_light)) {
    vec3 bsdf = m_eval(wo, ls.wi, hit);
    float bsdf_pdf = m_pdf(wo, ls.wi, hit);
    
    // MIS weight using power heuristic
    float weight = power_heuristic(ls.pdf, bsdf_pdf, 2.0);
    total += ls.radiance * bsdf * abs(g_dot(ls.wi, hit.n, p)) * weight / ls.pdf;
  }
  
  // BSDF sampling
  Direction wi;
  float bsdf_pdf;
  vec3 bsdf_value = m_sample(wo, hit, sample_2d(), wi, bsdf_pdf);
  if (bsdf_pdf > 0) {
    vec3 radiance = l_eval_light(p, wi);
    float light_pdf = l_pdf_light(p, wi);
    
    // MIS weight
    float weight = power_heuristic(bsdf_pdf, light_pdf, 2.0);
    total += radiance * bsdf_value * weight;
  }
  
  return total;
}
```

## Debug Features

Generated lights can include debug features:
```glsl
#ifdef DEBUG_LIGHTS
uniform bool u_debug_light_sampling;
uniform bool u_debug_pdf_values;

LightSample l_sample_light_debug(Point p, vec2 xi) {
  LightSample ls = l_sample_light(p, xi);
  
  if (u_debug_light_sampling) {
    // Visualize sampling distribution
    ls.radiance = heat_map(ls.pdf);
  }
  
  if (u_debug_pdf_values) {
    // Encode PDF in color
    ls.radiance = vec3(ls.pdf, ls.pdf, ls.pdf);
  }
  
  return ls;
}
#endif
```
