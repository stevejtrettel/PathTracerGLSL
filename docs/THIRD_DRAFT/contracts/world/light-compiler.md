
# LightingCompiler

## Purpose
Takes a list of lights and produces a GLSL module with light sampling and PDF evaluation functions. The key challenge is handling both explicitly-defined lights and emissive objects that have been promoted to lights, while maintaining correct PDF calculations for MIS.

## The Compilation Challenge

The LightingCompiler must handle several types of lights:
1. **Traditional lights** (point, directional, spot) - always samplable
2. **Area lights** (quads, spheres) - always samplable  
3. **Emissive objects promoted to lights** - may or may not be samplable
4. **Environment maps** - sampled separately from other lights

The compiler must generate efficient sampling code while tracking which lights can actually be sampled for MIS calculations.

## Input Structure

```typescript
interface LightingCompilerInput {
  lights: CompilerLight[];
  environment?: EnvironmentMap;
  crossRef: CrossReferenceData;  // Critical for MIS
}
```

The `crossRef` data tells us:
- Which lights came from emissive objects
- Which lights can actually be sampled
- Mappings between object IDs and light IDs

## Output Structure

The compiler generates a GLSL module with these required functions:

```glsl
// Core sampling interface
LightSample lighting_sample(Point p, vec2 xi)
float lighting_pdf(Point p, Direction wi)
int lighting_count()

// Environment queries
Spectrum lighting_environment(Direction dir)
bool lighting_has_environment()

// MIS helpers (NEW)
int lighting_get_light_for_object(int obj_id)
bool lighting_can_sample_light(int light_id)
```

## Compilation Strategy

### Step 1: Separate Samplable from Non-Samplable

The first critical step is to separate lights we can actually sample from those we can't:

```typescript
compile(input: LightingCompilerInput): ModuleDescriptor {
  const samplableLights = input.lights.filter(l => l.canSample);
  const nonSamplableLights = input.lights.filter(l => !l.canSample);
  
  // Only samplable lights get sampling functions
  const samplers = samplableLights.map(l => this.generateSampler(l));
```

Why? Non-samplable lights (complex emissive SDFs) still need to be tracked for MIS, but we don't want to waste time trying to sample them.

### Step 2: Generate Individual Light Samplers

Each light type needs a specific sampling strategy. Here's why each is different:

#### Point Lights
Delta distribution - infinitely small, so PDF is technically infinite but we use 1.0:

```glsl
LightSample sample_point_${id}(Point p, vec2 xi) {
  LightSample ls;
  vec3 light_pos = vec3(${position});
  ls.wi = normalize(light_pos - p);
  ls.distance = length(light_pos - p);
  ls.point = light_pos;
  
  // Inverse square law built into radiance
  ls.radiance = vec3(${intensity}) / (ls.distance * ls.distance);
  ls.pdf = 1.0;  // Delta distribution
  
  return ls;
}
```

#### Sphere Area Lights
We sample the visible hemisphere for better efficiency:

```glsl
LightSample sample_sphere_${id}(Point p, vec2 xi) {
  vec3 center = vec3(${position});
  float radius = ${radius};
  
  // Build coordinate frame aligned with vector to sphere
  vec3 w = normalize(center - p);
  vec3 u, v;
  make_basis(w, u, v);
  
  // Sample hemisphere facing the point
  float z = 1.0 - 2.0 * xi.x;  // cos(theta)
  float r = sqrt(max(0.0, 1.0 - z*z));  // sin(theta)
  float phi = 2.0 * PI * xi.y;
  
  // Convert to world space
  vec3 local = vec3(r * cos(phi), r * sin(phi), z);
  vec3 point_on_sphere = center + radius * (u * local.x + v * local.y + w * local.z);
  
  LightSample ls;
  ls.point = point_on_sphere;
  ls.wi = normalize(point_on_sphere - p);
  ls.distance = length(point_on_sphere - p);
  ls.radiance = vec3(${intensity});
  
  // PDF in solid angle measure
  float cos_theta_max = sqrt(1.0 - (radius * radius) / dot(center - p, center - p));
  ls.pdf = 1.0 / (2.0 * PI * (1.0 - cos_theta_max));
  
  return ls;
}
```

#### Bounding Box Sampling (Approximate)
For complex emissive objects, we use rejection sampling:

```glsl
LightSample sample_bbox_${id}(Point p, vec2 xi) {
  vec3 bbox_min = vec3(${bounds.min});
  vec3 bbox_max = vec3(${bounds.max});
  
  // Rejection sampling with limited attempts
  const int MAX_ATTEMPTS = ${config.bboxSampleAttempts ?? 32};
  
  for (int attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Random point in bounding box
    vec3 candidate = mix(bbox_min, bbox_max, vec3(xi, random()));
    
    // Check if actually on the emissive surface
    float sdf_value = object_${sourceObjectId}_sdf(candidate);
    
    if (abs(sdf_value) < 0.01) {  // On surface
      LightSample ls;
      ls.point = candidate;
      ls.wi = normalize(candidate - p);
      ls.distance = length(candidate - p);
      ls.radiance = vec3(${intensity});
      
      // Approximate PDF based on solid angle
      vec3 size = bbox_max - bbox_min;
      float approx_area = 2.0 * (size.x*size.y + size.y*size.z + size.z*size.x);
      
      // Convert from area to solid angle measure
      vec3 normal = normalize(object_${sourceObjectId}_normal(candidate));
      float cos_theta = abs(dot(normal, -ls.wi));
      ls.pdf = (ls.distance * ls.distance) / (approx_area * cos_theta);
      
      return ls;
    }
    
    // Generate new random numbers for next attempt
    xi = vec2(random(), random());
  }
  
  // Failed to find point on surface
  LightSample ls;
  ls.pdf = 0.0;  // Invalid sample
  return ls;
}
```

### Step 3: Light Selection Strategy

How do we choose which light to sample? Two main strategies:

#### Power-Based Selection (Better for Varied Intensities)
```glsl
// Precomputed at compile time
const float light_powers[NUM_SAMPLABLE] = float[](
  ${samplableLights.map(l => luminance(l.intensity)).join(', ')}
);
const float total_power = ${sum(light_powers)};

int select_light(vec2 xi) {
  float r = xi.x * total_power;
  float cumulative = 0.0;
  
  for (int i = 0; i < NUM_SAMPLABLE; i++) {
    cumulative += light_powers[i];
    if (r <= cumulative) return i;
  }
  
  return NUM_SAMPLABLE - 1;
}

float light_selection_pdf(int light_id) {
  return light_powers[light_id] / total_power;
}
```

#### Uniform Selection (Simpler, Good for Similar Powers)
```glsl
int select_light(vec2 xi) {
  return min(int(xi.x * float(NUM_SAMPLABLE)), NUM_SAMPLABLE - 1);
}

float light_selection_pdf(int light_id) {
  return 1.0 / float(NUM_SAMPLABLE);
}
```

### Step 4: Main Sampling Function

This ties everything together:

```glsl
LightSample lighting_sample(Point p, vec2 xi) {
  // No lights to sample?
  if (NUM_SAMPLABLE == 0) {
    LightSample ls;
    ls.pdf = 0.0;
    return ls;
  }
  
  // Select which light to sample
  int light_index = select_light(xi);
  
  // Dispatch to specific sampler
  LightSample ls;
  switch(light_index) {
    case 0: ls = sample_${light0.type}_0(p, xi); break;
    case 1: ls = sample_${light1.type}_1(p, xi); break;
    // ... generated for each light
  }
  
  // Account for light selection probability
  ls.pdf *= light_selection_pdf(light_index);
  ls.light_id = light_index;
  
  return ls;
}
```

### Step 5: PDF Evaluation for MIS

This is crucial for MIS - given a direction, what's the probability we would have sampled it?

```glsl
float lighting_pdf(Point p, Direction wi) {
  float total_pdf = 0.0;
  
  // Check each samplable light
  for (int i = 0; i < NUM_SAMPLABLE; i++) {
    float light_pdf = 0.0;
    
    // Would this direction hit this light?
    if (light_intersects(i, p, wi)) {
      // Compute PDF for this specific light
      light_pdf = compute_light_pdf(i, p, wi);
    }
    
    // Weight by selection probability
    total_pdf += light_pdf * light_selection_pdf(i);
  }
  
  return total_pdf;
}
```

### Step 6: Cross-Reference Table Generation

This is the key innovation for handling emissive objects correctly:

```glsl
// Generated from crossRef data
const int OBJECT_TO_LIGHT[${numObjects}] = int[](
  ${generateObjectToLightTable()}
);

const bool LIGHT_CAN_SAMPLE[${numLights}] = bool[](
  ${lights.map(l => l.canSample).join(', ')}
);

// MIS helper: "I hit object X, what light is it?"
int lighting_get_light_for_object(int obj_id) {
  if (obj_id < 0 || obj_id >= ${numObjects}) return -1;
  return OBJECT_TO_LIGHT[obj_id];
}

// MIS helper: "Can I sample light Y?"
bool lighting_can_sample_light(int light_id) {
  if (light_id < 0 || light_id >= ${numLights}) return false;
  return LIGHT_CAN_SAMPLE[light_id];
}
```

## Optimization Strategies

### Single Light Optimization
When there's only one light, skip selection entirely:

```glsl
// Generated when NUM_SAMPLABLE == 1
LightSample lighting_sample(Point p, vec2 xi) {
  return sample_${light.type}_0(p, xi);  // Direct call, no selection
}
```

### No Area Lights Optimization
If only point/directional lights exist, simplify PDF calculation:

```glsl
// Delta lights never contribute to direction PDF
float lighting_pdf(Point p, Direction wi) {
  return 0.0;  // Can't hit delta lights randomly
}
```

### Environment Map Integration

Environment sampling is separate from light sampling for efficiency:

```glsl
LightSample lighting_sample_environment(Point p, vec2 xi) {
  // Importance sample the environment map
  vec2 uv = sample_environment_map(xi);
  Direction wi = uv_to_direction(uv);
  
  LightSample ls;
  ls.wi = wi;
  ls.distance = MAX_DIST;
  ls.radiance = texture(u_environment_map, uv).rgb * u_env_intensity;
  ls.pdf = environment_pdf(wi);
  
  return ls;
}
```

## Complete Example Output

For a scene with 1 point light, 1 sphere area light, and 1 non-samplable emissive:

```glsl
// ============================================
// Generated by LightingCompiler
// 2 samplable lights, 1 non-samplable tracked
// ============================================

#define NUM_LIGHTS 3
#define NUM_SAMPLABLE 2

// Individual samplers (only for samplable)
LightSample sample_point_0(Point p, vec2 xi) {
  // ... point sampling code
}

LightSample sample_sphere_1(Point p, vec2 xi) {
  // ... sphere sampling code
}

// Light selection (power-based)
const float light_powers[2] = float[](100.0, 50.0);
const float total_power = 150.0;

// Cross-reference tables for MIS
const int OBJECT_TO_LIGHT[5] = int[](-1, -1, 2, -1, -1);  // Object 2 is emissive
const bool LIGHT_CAN_SAMPLE[3] = bool[](true, true, false);  // Light 2 can't be sampled

// Main sampling function
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

// MIS helpers
int lighting_get_light_for_object(int obj_id) {
  if (obj_id < 0 || obj_id >= 5) return -1;
  return OBJECT_TO_LIGHT[obj_id];
}

bool lighting_can_sample_light(int light_id) {
  if (light_id < 0 || light_id >= 3) return false;
  return LIGHT_CAN_SAMPLE[light_id];
}

// Required exports
int lighting_count() { return 3; }
bool lighting_has_environment() { return false; }
```

## Why This Design?

1. **Separation of samplable/non-samplable**: Don't waste cycles on lights we can't sample
2. **Cross-reference tables**: Enable correct MIS weights in the Transport module
3. **Flexible sampling strategies**: Support exact, approximate, and no sampling
4. **Optimization opportunities**: Single light, no area lights, etc.
5. **Clean interface**: Transport doesn't need to know about light implementation details

