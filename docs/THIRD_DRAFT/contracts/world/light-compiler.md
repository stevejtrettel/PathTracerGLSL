# LightingCompiler

## Purpose
Takes a list of lights, produces a GLSL module with light sampling and PDF evaluation functions.

## Input

```typescript
interface LightingCompilerInput {
  lights: CompilerLight[];
  environment?: EnvironmentMap;
}

interface CompilerLight {
  id: string;
  type: 'point' | 'directional' | 'spot' | 'area' | 'bbox';
  
  intensity: vec3;
  
  // Type-specific parameters
  position?: vec3;
  direction?: vec3;
  radius?: number;         // Sphere area lights
  vertices?: vec3[];       // Quad area lights
  bounds?: AABB;          // Bbox fallback sampling
  angle?: number;         // Spot light cone
}

interface EnvironmentMap {
  type: 'constant' | 'hdri';
  value?: vec3;
  path?: string;
  intensity: number;
}
```

## Output

A GLSL module with these exported functions:

```glsl
// Required exports
LightSample lighting_sample(Point p, vec2 xi)
float lighting_pdf(Point p, Direction wi)
int lighting_count()
Spectrum lighting_environment(Direction dir)
bool lighting_has_environment()
```

## Compilation Strategy

### 1. Light Sampler Generation

Generate specific sampler for each light type:

**Point Light**
```glsl
LightSample sample_point_${id}(Point p, vec2 xi) {
  LightSample ls;
  vec3 light_pos = vec3(${position});
  ls.wi = normalize(light_pos - p);
  ls.distance = length(light_pos - p);
  ls.point = light_pos;
  ls.radiance = vec3(${intensity}) / (ls.distance * ls.distance);
  ls.pdf = 1.0;  // Delta distribution
  return ls;
}
```

**Area Light (Sphere)**
```glsl
LightSample sample_sphere_${id}(Point p, vec2 xi) {
  vec3 center = vec3(${position});
  float radius = ${radius};
  
  // Sample point on visible hemisphere
  vec3 w = normalize(center - p);
  vec3 u, v;
  make_basis(w, u, v);
  
  float z = 1.0 - 2.0 * xi.x;
  float r = sqrt(max(0.0, 1.0 - z*z));
  float phi = 2.0 * PI * xi.y;
  vec3 local = vec3(r * cos(phi), r * sin(phi), z);
  
  vec3 point_on_sphere = center + radius * (u * local.x + v * local.y + w * local.z);
  
  LightSample ls;
  ls.point = point_on_sphere;
  ls.wi = normalize(point_on_sphere - p);
  ls.distance = length(point_on_sphere - p);
  ls.radiance = vec3(${intensity});
  ls.pdf = ls.distance * ls.distance / (2.0 * PI * radius * radius);
  
  return ls;
}
```

**Bbox Fallback (Complex Emitters)**
```glsl
LightSample sample_bbox_${id}(Point p, vec2 xi) {
  // Sample uniformly from bounding box
  vec3 bbox_min = vec3(${bounds.min});
  vec3 bbox_max = vec3(${bounds.max});
  
  vec3 sample_point = mix(bbox_min, bbox_max, vec3(xi, random()));
  
  // Check if point is actually on surface (expensive)
  if (abs(object_${id}_sdf(sample_point)) > 0.01) {
    // Not on surface, return invalid sample
    LightSample ls;
    ls.pdf = 0.0;
    return ls;
  }
  
  // Valid sample
  LightSample ls;
  ls.point = sample_point;
  ls.wi = normalize(sample_point - p);
  ls.distance = length(sample_point - p);
  ls.radiance = vec3(${intensity});
  
  // PDF is 1/surface_area (approximate)
  vec3 size = bbox_max - bbox_min;
  float approx_area = 2.0 * (size.x*size.y + size.y*size.z + size.z*size.x);
  ls.pdf = ls.distance * ls.distance / approx_area;
  
  return ls;
}
```

### 2. Light Selection

Choose light based on power or uniform probability:

**Power-based selection**
```glsl
// Precomputed power array
const float light_powers[NUM_LIGHTS] = float[](
  ${lights.map(l => luminance(l.intensity)).join(', ')}
);
const float total_power = ${sum(light_powers)};

int select_light(vec2 xi) {
  float r = xi.x * total_power;
  float cumulative = 0.0;
  
  for (int i = 0; i < NUM_LIGHTS; i++) {
    cumulative += light_powers[i];
    if (r <= cumulative) return i;
  }
  
  return NUM_LIGHTS - 1;
}
```

### 3. Main Sampling Function

```glsl
LightSample lighting_sample(Point p, vec2 xi) {
  // Select light
  int light_id = select_light(xi);
  
  // Sample selected light
  LightSample ls;
  switch(light_id) {
    case 0: ls = sample_${light0.type}_0(p, xi); break;
    case 1: ls = sample_${light1.type}_1(p, xi); break;
    // ...
  }
  
  // Adjust PDF for light selection
  ls.pdf *= light_powers[light_id] / total_power;
  ls.light_id = light_id;
  
  return ls;
}
```

### 4. PDF Evaluation

```glsl
float lighting_pdf(Point p, Direction wi) {
  float total_pdf = 0.0;
  
  // Check each light
  for (int i = 0; i < NUM_LIGHTS; i++) {
    float light_pdf = 0.0;
    
    switch(light_types[i]) {
      case LIGHT_POINT:
      case LIGHT_DIRECTIONAL:
        // Delta lights: PDF is 0 for arbitrary directions
        light_pdf = 0.0;
        break;
        
      case LIGHT_AREA:
        // Check if direction hits this light
        if (ray_intersects_light(p, wi, i)) {
          light_pdf = compute_area_pdf(p, wi, i);
        }
        break;
    }
    
    // Weight by selection probability
    total_pdf += light_pdf * light_powers[i] / total_power;
  }
  
  return total_pdf;
}
```

### 5. Environment Sampling

If environment map exists:

```glsl
LightSample sample_environment(vec2 xi) {
  // Simple uniform sphere sampling (can be improved with importance)
  float z = 1.0 - 2.0 * xi.x;
  float r = sqrt(max(0.0, 1.0 - z*z));
  float phi = 2.0 * PI * xi.y;
  
  Direction wi = vec3(r * cos(phi), r * sin(phi), z);
  
  LightSample ls;
  ls.wi = wi;
  ls.distance = MAX_DIST;
  ls.radiance = lighting_environment(wi);
  ls.pdf = 1.0 / (4.0 * PI);
  
  return ls;
}

Spectrum lighting_environment(Direction dir) {
  #ifdef HAS_ENVIRONMENT
    // Sample from texture or constant
    return texture(u_environment_map, dir_to_uv(dir)).rgb * env_intensity;
  #else
    return vec3(0);
  #endif
}
```

## Optimization Strategies

### Single Light
If only one light exists, skip selection:
```glsl
LightSample lighting_sample(Point p, vec2 xi) {
  return sample_${light.type}_0(p, xi);  // Direct call
}
```

### No Area Lights
Skip PDF evaluation code if only delta lights exist.

### Uniform Power
If all lights have similar power, use uniform selection (cheaper).

### Precomputed CDFs
For many lights, precompute cumulative distribution functions.

## Example Output

For 1 point light + 1 sphere area light:

```glsl
// Light samplers
LightSample sample_point_0(Point p, vec2 xi) {
  vec3 pos = vec3(0, 5, 0);
  LightSample ls;
  ls.wi = normalize(pos - p);
  ls.distance = length(pos - p);
  ls.point = pos;
  ls.radiance = vec3(100, 100, 100) / (ls.distance * ls.distance);
  ls.pdf = 1.0;
  return ls;
}

LightSample sample_sphere_1(Point p, vec2 xi) {
  // ... sphere sampling code
}

// Light selection (power-based)
const float light_powers[2] = float[](100.0, 50.0);
const float total_power = 150.0;

// Main sampler
LightSample lighting_sample(Point p, vec2 xi) {
  float r = xi.x * total_power;
  
  LightSample ls;
  if (r < 100.0) {
    ls = sample_point_0(p, xi);
    ls.pdf *= 100.0 / 150.0;
    ls.light_id = 0;
  } else {
    ls = sample_sphere_1(p, xi);
    ls.pdf *= 50.0 / 150.0;
    ls.light_id = 1;
  }
  
  return ls;
}

int lighting_count() { return 2; }
bool lighting_has_environment() { return false; }
```

The compiler generates efficient sampling code without knowing whether lights came from the scene or were explicitly defined.
