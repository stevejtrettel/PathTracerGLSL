# Lighting Module Contract

## Purpose
The Lighting Module provides sampling strategies for all light sources in the scene, whether they originated as explicit lights or as emissive materials. It maintains a unified array of lights with their sampling capabilities.

## Required Exports

### Sampling Functions

```glsl
// Sample a light source
LightSample lighting_sample(Point p, vec2 xi)
```
- Importance samples from all SAMPLABLE lights
- Returns position, direction, and radiance
- Includes PDF for MIS
- May return invalid sample (pdf = 0) if no samplable lights exist

```glsl
// Evaluate PDF for a given direction
float lighting_pdf(Point p, Direction wi)
```
- Returns probability of sampling direction wi
- Used for MIS weight calculation
- Only considers samplable lights
- Returns 0 if direction doesn't hit any samplable light

### Light Information

```glsl
// Get light data by ID
LightData lighting_get_light(int light_id)
```
- Returns light information for given ID
- Used by Transport when material has light_id >= 0
- Contains radiance and sampling capability info

```glsl
// Check if a light can be sampled
bool lighting_can_sample(int light_id)
```
- Returns true if light can be explicitly sampled
- Returns false for path-only lights (complex emissives)
- Used to determine MIS strategy

```glsl
// Number of light sources
int lighting_count()
```
- Total number of lights (including non-samplable)
- Used by Transport for allocation

### Environment Map

```glsl
// Environment map query
Spectrum lighting_environment(Direction dir)
```
- Returns environment radiance for direction
- Returns black if no environment map

```glsl
// Check if environment exists
bool lighting_has_environment()
```
- Used by Transport to decide sampling strategies

## Required Types

```glsl
struct LightSample {
  Point point;          // Point on light source
  Direction wi;         // Direction from shading point to light
  Spectrum radiance;    // Emitted radiance (already divided by distance²)
  float pdf;           // Probability density (includes selection probability)
  float distance;      // Distance to light point
}

struct LightData {
  vec3 radiance;       // Light intensity/color
  int sampling_type;   // SAMPLING_NONE, SAMPLING_POINT, SAMPLING_SPHERE, etc.
  vec4 param0;        // Position or other primary parameters
  vec4 param1;        // Additional parameters (radius, angles, etc.)
}
```

## Light Categories

The module handles lights regardless of their origin:
1. **Traditional lights** (point, directional, spot) - always samplable
2. **Area lights** (quad, sphere) - samplable with known geometry
3. **Complex emissive objects** (fractals, volumes) - tracked but not sampled

The key distinction is sampling capability, not source.

## Constants Provided

```glsl
#define NUM_LIGHTS         // Total lights (including non-samplable)
#define NUM_SAMPLABLE      // Number of samplable lights
#define HAS_ENVIRONMENT    // Whether environment map exists
```

## Sampling Strategy Constants

```glsl
#define SAMPLING_NONE         0
#define SAMPLING_POINT        1
#define SAMPLING_DIRECTIONAL  2
#define SAMPLING_SPHERE       3
#define SAMPLING_QUAD         4
#define SAMPLING_SPOT         5
#define SAMPLING_BBOX         6  // Future: approximate sampling
```

## Implementation Notes

### Light Selection
When multiple lights exist, selection uses power-based importance:
```glsl
// Power-based selection weights (precomputed)
const float light_powers[NUM_SAMPLABLE];
const float total_power;
```

### Light Data Layout
Lights are stored in a uniform array for efficient access:
```glsl
uniform LightData u_lights[NUM_LIGHTS];
```

### Samplable Subset
Only samplable lights participate in `lighting_sample()`:
```glsl
// Mapping from samplable index to light index
const int samplable_indices[NUM_SAMPLABLE];
```

## Example Implementation

```glsl
// Get light information
LightData lighting_get_light(int light_id) {
  if (light_id < 0 || light_id >= NUM_LIGHTS) {
    // Return invalid light
    LightData invalid;
    invalid.sampling_type = SAMPLING_NONE;
    invalid.radiance = vec3(0.0);
    return invalid;
  }
  return u_lights[light_id];
}

// Check sampling capability
bool lighting_can_sample(int light_id) {
  if (light_id < 0 || light_id >= NUM_LIGHTS) {
    return false;
  }
  return u_lights[light_id].sampling_type != SAMPLING_NONE;
}

// Sample a light
LightSample lighting_sample(Point p, vec2 xi) {
  if (NUM_SAMPLABLE == 0) {
    LightSample invalid;
    invalid.pdf = 0.0;
    return invalid;
  }
  
  // Select which light to sample
  int samplable_idx = select_light(xi.x);
  int light_id = samplable_indices[samplable_idx];
  
  // Dispatch to appropriate sampler
  LightData light = u_lights[light_id];
  LightSample sample;
  
  switch (light.sampling_type) {
    case SAMPLING_POINT:
      sample = sample_point_light(p, light, xi);
      break;
    case SAMPLING_SPHERE:
      sample = sample_sphere_light(p, light, xi);
      break;
    // ... other sampling strategies
  }
  
  // Account for selection probability
  sample.pdf *= selection_pdf(samplable_idx);
  
  return sample;
}
```

## Key Changes from Object-Based System

1. **No cross-referencing** - Materials directly reference light IDs
2. **Unified light array** - All lights (from any source) in one place
3. **Simple access pattern** - Direct array lookup by light_id
4. **Cleaner interface** - No object→light→sampling indirection

## Integration with Transport

Transport module uses lighting like this:
```glsl
// When hitting a surface
MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
if (props.light_id >= 0) {
  LightData light = lighting_get_light(props.light_id);
  
  if (lighting_can_sample(props.light_id)) {
    // MIS required - can be sampled
    float light_pdf = lighting_pdf(prev_point, ray.direction);
    float mis_weight = power_heuristic(bsdf_pdf, light_pdf);
    radiance += throughput * light.radiance * mis_weight;
  } else {
    // Path-only emissive
    radiance += throughput * light.radiance;
  }
}
```

## Terminology Note

While internally all light sources are treated uniformly, we maintain familiar terminology:
- "Light" = any source of illumination
- "Emissive" = materials that emit light (subset of lights)
- "Lighting" = the system that handles all light sources

This preserves standard graphics terminology while achieving the architectural benefits of unified light handling.
