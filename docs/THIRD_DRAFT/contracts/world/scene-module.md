
# Scene Module Contract

## Purpose
The Scene Module provides geometric queries and material properties for all objects in the scene, including visible lights that have been added as geometry. Materials directly track their associated lights through light_id.

## Required Exports

### Primary Functions

```glsl
// Find closest intersection along ray
bool scene_intersect(Ray ray, out Hit hit)
```
- Finds the closest surface intersection
- Fills complete Hit structure including material IDs
- Returns false if no intersection
- Must handle material interface correctly (material_from, material_to)

```glsl
// Test if ray hits anything (for shadows)
bool scene_intersect_any(Ray ray, float max_t)
```
- Returns true if any intersection exists before max_t
- Optimized for shadow rays (no Hit needed)
- Can use less conservative marching

### Material Queries

```glsl
// Get all material properties at a point
MaterialProperties scene_material_properties(int mat_id, Point p)
```
- Returns complete material properties including light_id
- Called by both Transport (for shading) and Lighting (for radiance)
- Must handle all material IDs including special light materials

```glsl
// Query material at a point (for volumes)
int scene_material_at(Point p)
```
- Returns material ID at given point
- Used for volume transport
- Returns MATERIAL_AIR if in empty space

### Scene Information

```glsl
// Bounding sphere for environment sampling
float scene_bounding_radius()
```
- Returns radius that contains all geometry
- Used by lighting for environment importance sampling

## Required Types

```glsl
struct MaterialProperties {
  vec3 albedo;
  float roughness;
  float metallic;
  float ior;
  vec3 emission;           // Emission color * intensity
  float emission_strength;  // Separate intensity for adjustment
  int light_id;            // NEW: -1 if non-emissive, else light index
  int flags;               // DIELECTRIC | PARTICIPATING | etc.
}

struct Hit {
  // Geometric data
  Point p;
  Normal n;
  vec2 uv;
  float t;
  
  // Material interface (no object_id!)
  int material_from;    // Material we're leaving
  int material_to;      // Material we're entering
  
  // Frame
  Frame frame;         // Orthonormal basis at hit point
}
```

## Special Material IDs

```glsl
#define MATERIAL_AIR 0      // Always reserved for air/vacuum
// Light materials get IDs starting from highest regular material + 1
```

## Constants Provided

```glsl
#define NUM_MATERIALS    // Total number of materials
#define MAX_LIGHT_ID     // Highest light ID referenced by materials
```

## Implementation Notes

### Material Property Packing
Materials with light_ids are packed efficiently in uniforms:
```glsl
uniform vec4 u_material_albedo_metallic[NUM_MATERIALS];
uniform vec4 u_material_emission_strength[NUM_MATERIALS];
uniform vec4 u_material_ior_roughness_light[NUM_MATERIALS];
// .x = ior, .y = roughness, .z = light_id, .w = flags
```

### Material Resolution at Interfaces
When a ray hits a surface, the module must correctly determine materials on both sides:
```glsl
// The hit point determines the interface
// material_from: what the ray was traveling through
// material_to: what the ray would enter if continuing
```

This is critical for:
- Fresnel calculations
- Refraction direction
- Nested dielectrics
- Volume boundaries

### Light ID Assignment
The Scene module doesn't generate light IDs - it receives them from the WorldCompiler:
- Non-emissive materials: `light_id = -1`
- Emissive materials: `light_id = [0, MAX_LIGHT_ID]`
- The mapping is consistent across all compiled modules

## Example Implementation

```glsl
MaterialProperties scene_material_properties(int mat_id, Point p) {
  MaterialProperties props;
  
  vec4 am = u_material_albedo_metallic[mat_id];
  props.albedo = am.rgb;
  props.metallic = am.a;
  
  vec4 es = u_material_emission_strength[mat_id];
  props.emission = es.rgb;
  props.emission_strength = es.a;
  
  vec4 irl = u_material_ior_roughness_light[mat_id];
  props.ior = irl.x;
  props.roughness = irl.y;
  props.light_id = int(irl.z);  // NEW: Direct light reference
  props.flags = int(irl.w);
  
  return props;
}
```

## Key Changes from Object-Based System

1. **No object tracking** - Hit struct is smaller and simpler
2. **Direct light access** - Materials know their light directly
3. **Removed SDF exports** - No need for per-object SDF evaluation
4. **Cleaner interface** - Scene only deals with geometry and materials

Now it's consistent - using "light" terminology throughout while maintaining the same architectural improvements.
