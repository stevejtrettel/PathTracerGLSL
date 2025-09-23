

# Lighting Module Contract

## Purpose
The Lighting Module provides light sampling strategies for all light sources, including emissive objects that have been added as lights.

## Required Exports

### Sampling Functions

```glsl
// Sample a light source
LightSample lighting_sample(Point p, vec2 xi)
```
- Importance samples from all available lights
- Returns position, direction, and radiance
- Includes PDF for MIS
- May return invalid sample (pdf = 0) for complex emitters

```glsl
// Evaluate PDF for a given direction
float lighting_pdf(Point p, Direction wi)
```
- Returns probability of sampling direction wi
- Used for MIS weight calculation
- Returns 0 if direction doesn't hit any light

### Light Information

```glsl
// Number of light sources
int lighting_count()
```
- Total number of lights (including emissive objects)
- Used by Transport for sampling strategies

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
  float pdf;           // Probability density
  float distance;      // Distance to light point
  int light_id;        // Which light was sampled
}
```

## Light Types (Internal)

The module internally handles different light types:
- Point lights (no geometry, delta distribution)
- Directional lights (infinite distance)
- Area lights (from emissive objects or visible lights)
- Environment map (infinite sphere)

---

# Cross-Module Dependencies

## Scene → Lighting
None. Scene doesn't know about Lighting.

## Lighting → Scene
Lighting may query Scene for:
- Bounding box of emissive objects (for sampling)
- Material properties to get emission values

## Transport → Both
Transport uses both modules:
```glsl
// From Scene
scene_intersect(ray, hit)
scene_material_properties(hit.material_to, hit.p)

// From Lighting
lighting_sample(hit.p, xi)
lighting_pdf(hit.p, wo)
```

## Material ID Consistency
Both modules must agree on material IDs:
- Regular materials: 1 to N
- Light materials: N+1 to M
- MATERIAL_AIR: always 0
