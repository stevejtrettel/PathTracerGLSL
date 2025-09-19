# Lights Contract

## Module Structure

```typescript
{
  id: {
    kind: 'lights',
    name: string,              // 'point' | 'hdri' | 'area'
    version: string
  },
  provides: ['lights'],
  requires: ['geometry'],      // For geodesic light transport
  fragment: {
    functions: string,         // Sampling and evaluation
    uniforms: string,         // Light parameters
    constants: string,        // Light type flags
  },
  resources?: Array<{         // For environment maps
    name: string,
    type: 'texture2D',
    data?: ArrayBuffer        // Precomputed CDFs
  }>
}
```

## Required Functions

### sample_light
```glsl
LightSample sample_light(Point p, vec2 xi)
```
- **p**: Point being shaded
- **xi**: Random numbers [0,1)²
- **returns**: Sampled light direction, radiance, and PDF
- Note: Engine will auto-prefix to `l_sample_light`

### eval_light
```glsl
Spectrum eval_light(Point p, Direction wi)
```
- **p**: Point being shaded
- **wi**: Direction toward light
- **returns**: Incoming radiance from that direction
- Note: Engine will auto-prefix to `l_eval_light`

### pdf_light
```glsl
float pdf_light(Point p, Direction wi)
```
- **p**: Point being shaded
- **wi**: Direction toward light
- **returns**: PDF value for importance sampling
- Note: Engine will auto-prefix to `l_pdf_light`

## Optional Functions

```glsl
EmissionSample sample_emission(vec2 xi1, vec2 xi2)  // For bidirectional
Spectrum direct_light(int light_id, Point p)        // Specific light eval
int light_count()                                    // Number of lights
float light_power()                                  // Total power
```
Note: Engine will auto-prefix these with `l_`

## Implementation: Point Light

```glsl
uniform vec3 u_light_position;
uniform vec3 u_light_color;
uniform float u_light_intensity;

LightSample sample_light(Point p, vec2 xi) {
  LightSample ls;
  
  Direction to_light = u_light_position - p;
  ls.distance = length(to_light);
  ls.wi = normalize(to_light);
  
  float falloff = 1.0 / (ls.distance * ls.distance);
  ls.radiance = Spectrum(u_light_color * u_light_intensity * falloff);
  ls.pdf = 1.0;
  ls.is_delta = true;
  ls.light_id = 0;
  
  return ls;
}

Spectrum eval_light(Point p, Direction wi) {
  return Spectrum(0.0);  // Delta light
}

float pdf_light(Point p, Direction wi) {
  return 0.0;  // Delta light
}
```

## Implementation: Area Light

```glsl
struct AreaLight {
  Point corner;
  Direction edge1;
  Direction edge2;
  Direction normal;
  vec3 emission;
};

uniform AreaLight u_area_light;

LightSample sample_light(Point p, vec2 xi) {
  LightSample ls;
  
  // Sample point on rectangle
  Point light_p = u_area_light.corner + 
                  xi.x * u_area_light.edge1 + 
                  xi.y * u_area_light.edge2;
  
  Direction to_light = light_p - p;
  ls.distance = g_distance(p, light_p);
  ls.wi = normalize(to_light);
  
  // Check visibility
  float cos_light = g_dot(-ls.wi, u_area_light.normal, light_p);
  if (cos_light <= 0.0) {
    ls.radiance = Spectrum(0.0);
    ls.pdf = 0.0;
    return ls;
  }
  
  // Area to solid angle conversion
  float area = length(u_area_light.edge1) * length(u_area_light.edge2);
  float solid_angle = area * cos_light / (ls.distance * ls.distance);
  
  ls.radiance = Spectrum(u_area_light.emission);
  ls.pdf = 1.0 / solid_angle;
  ls.is_delta = false;
  ls.light_id = 0;
  
  return ls;
}

Spectrum eval_light(Point p, Direction wi) {
  // Ray-rectangle intersection
  Ray ray = make_ray(p, wi);
  float t = intersect_rectangle(ray, u_area_light);
  
  if (t > 0.0) {
    return Spectrum(u_area_light.emission);
  }
  return Spectrum(0.0);
}

float pdf_light(Point p, Direction wi) {
  Ray ray = make_ray(p, wi);
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

## Implementation: Environment Map

```glsl
uniform sampler2D u_environment_map;
uniform sampler2D u_environment_cdf;  // Precomputed importance sampling
uniform float u_environment_intensity;

vec2 sample_environment_uv(vec2 xi) {
  // Use precomputed CDF for importance sampling
  float v = texture(u_environment_cdf, vec2(0.5, xi.y)).x;
  
  // Binary search in horizontal CDF
  // ... implementation details ...
  
  return vec2(u, v);
}

LightSample sample_light(Point p, vec2 xi) {
  LightSample ls;
  
  // Sample direction
  vec2 uv = sample_environment_uv(xi);
  float theta = uv.y * PI;
  float phi = uv.x * 2.0 * PI;
  
  ls.wi = vec3(sin(theta) * cos(phi), 
               cos(theta), 
               sin(theta) * sin(phi));
  
  ls.radiance = Spectrum(texture(u_environment_map, uv).rgb * 
                         u_environment_intensity);
  
  // PDF from precomputed distribution
  float sin_theta = max(0.0001, sin(theta));
  float map_pdf = texture(u_environment_cdf, uv).a;
  ls.pdf = map_pdf / (2.0 * PI * PI * sin_theta);
  
  ls.distance = 1e10;
  ls.is_delta = false;
  
  return ls;
}

Spectrum eval_light(Point p, Direction wi) {
  // Convert direction to UV
  float theta = acos(wi.y);
  float phi = atan(wi.z, wi.x) + PI;
  vec2 uv = vec2(phi / (2.0 * PI), theta / PI);
  
  return Spectrum(texture(u_environment_map, uv).rgb * 
                 u_environment_intensity);
}

float pdf_light(Point p, Direction wi) {
  float theta = acos(wi.y);
  float phi = atan(wi.z, wi.x) + PI;
  vec2 uv = vec2(phi / (2.0 * PI), theta / PI);
  
  float sin_theta = max(0.0001, sin(theta));
  float map_pdf = texture(u_environment_cdf, uv).a;
  return map_pdf / (2.0 * PI * PI * sin_theta);
}
```

## Multiple Lights with MIS

```glsl
// For multiple lights, select based on power
LightSample sample_light(Point p, vec2 xi) {
  // Light selection probabilities
  float light_powers[NUM_LIGHTS];
  compute_light_powers(light_powers, p);
  
  float total_power = 0.0;
  for (int i = 0; i < NUM_LIGHTS; i++) {
    total_power += light_powers[i];
  }
  
  // Select light
  float cdf = 0.0;
  int light_id = 0;
  for (int i = 0; i < NUM_LIGHTS; i++) {
    float prob = light_powers[i] / total_power;
    cdf += prob;
    if (xi.x < cdf) {
      light_id = i;
      xi.x = (xi.x - (cdf - prob)) / prob;  // Remap
      break;
    }
  }
  
  // Sample selected light
  LightSample ls = sample_specific_light(light_id, p, xi);
  ls.pdf *= light_powers[light_id] / total_power;
  ls.light_id = light_id;
  
  return ls;
}
```

## Generation Strategies

### Environment Map Analysis

```typescript
class EnvironmentCompiler {
  compile(hdri: HDRImage): ModuleDescriptor {
    // Precompute importance sampling CDFs
    const cdf = this.computeLuminanceCDF(hdri);
    
    return {
      id: { kind: 'lights', name: 'hdri', version: '1.0.0' },
      fragment: {
        functions: this.generateSamplingCode(cdf),
        uniforms: 'uniform sampler2D u_environment_map;'
      },
      resources: [
        { name: 'environment_cdf', type: 'texture2D', data: cdf }
      ]
    };
  }
}
```

### When to Generate vs Hand-Write

**Generate when:**
- Environment maps (need CDFs)
- Many lights (>5) for optimal selection
- Complex area lights
- IES profiles

**Hand-write when:**
- Simple analytic lights (point, directional)
- Research on new light types
- Small numbers of lights

## Geometry-Agnostic Implementation

Lights must work in any geometry:

```glsl
// Use geometry functions for all operations
float distance = g_distance(p, light_pos);  // Not length()!
float cos_theta = g_dot(wi, normal, p);     // Not dot()!
```

## Validation

1. LightSample.radiance is non-negative Spectrum
2. PDF values integrate to 1 over solid angle
3. Delta lights have pdf = 0 for eval_light
4. Directions are unit vectors
5. Distance is finite for area/point, infinite for env/directional
6. Use geometry module for all geometric operations
