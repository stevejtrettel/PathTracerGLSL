# LightingCompiler

## Purpose
Takes a list of lights and produces a GLSL module with light sampling and PDF evaluation functions. The compiler handles both explicitly-defined lights and lights created from emissive materials, maintaining correct PDF calculations for MIS.

## Input Structure

```typescript
interface LightingCompilerInput {
  lights: CompilerLight[];
  environment?: EnvironmentMap;
}

interface CompilerLight {
  id: string;
  radiance: vec3;
  sampling: LightSampling | null;  // null = path-only
  source: 'explicit_light' | 'emissive_material' | 'visible_light';
}
```

The key distinction: lights either can be sampled (`sampling !== null`) or can't (`sampling === null`).

## Output Structure

The compiler generates a GLSL module with these required functions:

```glsl
// Core sampling interface
LightSample lighting_sample(Point p, vec2 xi)
float lighting_pdf(Point p, Direction wi)

// Light information
LightData lighting_get_light(int light_id)
bool lighting_can_sample(int light_id)
int lighting_count()

// Environment queries
Spectrum lighting_environment(Direction dir)
bool lighting_has_environment()
```

## Compilation Strategy

### Step 1: Separate Samplable from Path-Only

```typescript
compile(input: LightingCompilerInput): ModuleDescriptor {
  const samplableLights = input.lights.filter(l => l.sampling !== null);
  const samplableIndices = samplableLights.map(l => input.lights.indexOf(l));
  
  // Generate samplers only for lights we can sample
  const samplers = samplableLights.map(l => this.generateSampler(l));
  
  return this.buildModule(input.lights, samplers, samplableIndices);
}
```

### Step 2: Generate Light Data Array

All lights (samplable or not) get entries in the uniform array:

```glsl
// Generated uniform array
uniform LightData u_lights[NUM_LIGHTS] = LightData[](
  LightData(vec3(100, 100, 100), SAMPLING_POINT, vec4(5, 5, 5, 0), vec4(0)),
  LightData(vec3(50, 20, 5), SAMPLING_NONE, vec4(0), vec4(0)),  // Path-only emissive
  LightData(vec3(10, 10, 10), SAMPLING_SPHERE, vec4(0, 3, 0, 0.5), vec4(0))
);
```

### Step 3: Generate Individual Samplers

Each samplable light type gets a specific sampling function:

#### Point Light
```glsl
LightSample sample_point_${index}(Point p, vec2 xi) {
  vec3 light_pos = u_lights[${index}].param0.xyz;
  
  LightSample ls;
  ls.point = light_pos;
  ls.wi = normalize(light_pos - p);
  ls.distance = length(light_pos - p);
  ls.radiance = u_lights[${index}].radiance / (ls.distance * ls.distance);
  ls.pdf = 1.0;  // Delta distribution
  
  return ls;
}
```

#### Sphere Light
```glsl
LightSample sample_sphere_${index}(Point p, vec2 xi) {
  vec3 center = u_lights[${index}].param0.xyz;
  float radius = u_lights[${index}].param0.w;
  
  // Sample visible hemisphere
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
  ls.radiance = u_lights[${index}].radiance;
  
  // PDF in solid angle measure
  float cos_theta_max = sqrt(1.0 - (radius * radius) / dot(center - p, center - p));
  ls.pdf = 1.0 / (2.0 * PI * (1.0 - cos_theta_max));
  
  return ls;
}
```

### Step 4: Light Selection

For multiple lights, implement importance sampling:

```glsl
// Precomputed at compile time
const int samplable_indices[NUM_SAMPLABLE] = int[](${samplableIndices.join(', ')});
const float light_powers[NUM_SAMPLABLE] = float[](
  ${samplableLights.map(l => luminance(l.radiance)).join(', ')}
);
const float total_power = ${totalPower};

int select_light(float xi) {
  float r = xi * total_power;
  float cumulative = 0.0;
  
  for (int i = 0; i < NUM_SAMPLABLE; i++) {
    cumulative += light_powers[i];
    if (r <= cumulative) return i;
  }
  
  return NUM_SAMPLABLE - 1;
}
```

### Step 5: Main Sampling Function

```glsl
LightSample lighting_sample(Point p, vec2 xi) {
  if (NUM_SAMPLABLE == 0) {
    LightSample ls;
    ls.pdf = 0.0;
    return ls;
  }
  
  // Select which light to sample
  int samplable_idx = select_light(xi.x);
  int light_id = samplable_indices[samplable_idx];
  
  // Dispatch to specific sampler
  LightSample ls;
  switch(light_id) {
    ${this.generateSamplerDispatch(samplableLights)}
  }
  
  // Account for selection probability
  ls.pdf *= light_powers[samplable_idx] / total_power;
  
  return ls;
}
```

### Step 6: Light Information Functions

Simple, direct access to light data:

```glsl
LightData lighting_get_light(int light_id) {
  if (light_id < 0 || light_id >= NUM_LIGHTS) {
    return LightData(vec3(0), SAMPLING_NONE, vec4(0), vec4(0));
  }
  return u_lights[light_id];
}

bool lighting_can_sample(int light_id) {
  if (light_id < 0 || light_id >= NUM_LIGHTS) return false;
  return u_lights[light_id].sampling_type != SAMPLING_NONE;
}

int lighting_count() {
  return NUM_LIGHTS;
}
```

## Optimization Strategies

### Single Light Optimization
When there's only one samplable light:

```glsl
LightSample lighting_sample(Point p, vec2 xi) {
  return sample_${lightType}_0(p, xi);  // Direct call, no selection
}
```

### No Samplable Lights
When only path-tracing finds lights:

```glsl
LightSample lighting_sample(Point p, vec2 xi) {
  LightSample ls;
  ls.pdf = 0.0;  // No sampling possible
  return ls;
}

float lighting_pdf(Point p, Direction wi) {
  return 0.0;  // Can't sample any lights
}
```

### Compile-Time Constants
When all lights share properties:

```glsl
#if ALL_LIGHTS_SAME_COLOR
  #define LIGHT_COLOR vec3(${sharedColor})
#endif
```

## Complete Example Output

For a scene with 1 point light and 1 non-samplable emissive:

```glsl
// ============================================
// Generated by LightingCompiler
// 2 lights total, 1 samplable
// ============================================

#define NUM_LIGHTS 2
#define NUM_SAMPLABLE 1

// Light data array
uniform LightData u_lights[2] = LightData[](
  LightData(vec3(100, 100, 100), SAMPLING_POINT, vec4(5, 5, 5, 0), vec4(0)),
  LightData(vec3(50, 20, 5), SAMPLING_NONE, vec4(0), vec4(0))
);

// Samplable light indices
const int samplable_indices[1] = int[](0);
const float light_powers[1] = float[](100.0);
const float total_power = 100.0;

// Point light sampler
LightSample sample_point_0(Point p, vec2 xi) {
  vec3 light_pos = u_lights[0].param0.xyz;
  
  LightSample ls;
  ls.point = light_pos;
  ls.wi = normalize(light_pos - p);
  ls.distance = length(light_pos - p);
  ls.radiance = u_lights[0].radiance / (ls.distance * ls.distance);
  ls.pdf = 1.0;
  
  return ls;
}

// Main sampling function (single light optimization)
LightSample lighting_sample(Point p, vec2 xi) {
  return sample_point_0(p, xi);
}

// PDF evaluation
float lighting_pdf(Point p, Direction wi) {
  return 0.0;  // Point light is delta, can't be hit randomly
}

// Light information
LightData lighting_get_light(int light_id) {
  if (light_id < 0 || light_id >= 2) {
    return LightData(vec3(0), SAMPLING_NONE, vec4(0), vec4(0));
  }
  return u_lights[light_id];
}

bool lighting_can_sample(int light_id) {
  if (light_id < 0 || light_id >= 2) return false;
  return u_lights[light_id].sampling_type != SAMPLING_NONE;
}

int lighting_count() { return 2; }
bool lighting_has_environment() { return false; }
```

## Why This Design?

1. **Direct access**: Light data accessed by simple array lookup
2. **Clean separation**: Samplable vs non-samplable handled elegantly
3. **No indirection**: No object mapping or cross-reference needed
4. **Optimization-friendly**: Single light, no lights, etc. handled efficiently
5. **MIS-ready**: Path-only lights tracked for correct MIS weights

The compiler focuses solely on lights and their sampling strategies, without concern for where they came from or which objects they correspond to.
