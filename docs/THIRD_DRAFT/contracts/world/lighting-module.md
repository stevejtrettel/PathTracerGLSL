
## Updated Lighting Module Contract

```markdown
# Lighting Module Contract

## Purpose
The Lighting Module provides light sampling strategies for all light sources, including emissive objects that have been added as lights. It maintains cross-reference data for MIS calculations.

## Required Exports

### Sampling Functions

```glsl
// Sample a light source
LightSample lighting_sample(Point p, vec2 xi)
```
- Importance samples from all SAMPLABLE lights
- Returns position, direction, and radiance
- Includes PDF for MIS
- May return invalid sample (pdf = 0) for complex emitters

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
// Number of light sources
int lighting_count()
```
- Total number of lights (including non-samplable emissives)
- Used by Transport for allocation

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

### NEW: MIS Helper Functions

```glsl
// Get light ID for an object (for MIS when hitting emissives)
int lighting_get_light_for_object(int obj_id)
```
- Maps object ID to light ID
- Returns -1 if object is not emissive
- Critical for MIS weight calculation

```glsl
// Check if a light can be sampled
bool lighting_can_sample_light(int light_id)
```
- Returns true if light can be explicitly sampled
- Returns false for path-only emissives
- Used to determine MIS strategy

## Required Types

```glsl
struct LightSample {
  Point point;          // Point on light source
  Direction wi;         // Direction from shading point to light
  Spectrum radiance;    // Emitted radiance (already divided by distance²)
  float pdf;           // Probability density (accounts for selection)
  float distance;      // Distance to light point
  int light_id;        // Which light was sampled
}
```

## Light Categories

The module internally handles three categories:
1. **Traditional lights** (point, directional, spot) - always samplable
2. **Area lights** (from simple emissive objects or visible lights) - samplable
3. **Complex emissives** (volumetrics, fractals) - tracked but not sampled

## Cross-Reference Tables

The module maintains internal tables for MIS:
```glsl
// Object to light mapping
const int OBJECT_TO_LIGHT[NUM_OBJECTS];

// Light samplability
const bool LIGHT_CAN_SAMPLE[NUM_LIGHTS];
```

## Constants Provided

```glsl
#define NUM_LIGHTS        // Total lights (including non-samplable)
#define NUM_SAMPLABLE     // Number of samplable lights
#define HAS_ENVIRONMENT   // Whether environment map exists
```


The key change is:

*Lighting Module**: Added MIS helper functions and clarified that only samplable lights are used in 
sampling/PDF functions

These contracts now properly support the cross-reference system for correct MIS implementation.
