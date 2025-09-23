
##  Scene Module Contract


# Scene Module Contract

## Purpose
The Scene Module provides geometric queries and material properties for all objects in the scene, including visible lights that have been added as geometry. It must track object identities for MIS calculations.

## Required Exports

### Primary Functions

```glsl
// Find closest intersection along ray
bool scene_intersect(Ray ray, out Hit hit)
```
- Finds the closest surface intersection
- Fills complete Hit structure including material IDs and object ID
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
- Returns complete material properties including emission
- Called by both Transport (for shading) and Lighting (for emission)
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

### NEW: Object-Specific Functions

```glsl
// Evaluate SDF for specific object (for bbox light sampling)
float scene_evaluate_object_sdf(int obj_id, Point p)
```
- Returns SDF value for a specific object
- Used by lighting module for rejection sampling of complex emissives
- Returns MAX_DIST for invalid object IDs

```glsl
// Compute normal for specific object (for PDF calculation)
vec3 scene_compute_object_normal(int obj_id, Point p)
```
- Returns normal at point p for specific object
- Used by lighting module for solid angle PDF conversion
- Assumes p is on or near the object's surface

## Required Types

```glsl
struct MaterialProperties {
  vec3 albedo;
  float roughness;
  float metallic;
  float ior;
  vec3 emission;           // Emission color * intensity
  float emission_strength;  // Separate intensity for adjustment
  int flags;               // DIELECTRIC | PARTICIPATING | etc.
}

struct Hit {
  // Geometric data
  Point p;
  Normal n;
  vec2 uv;
  float t;
  
  // Material interface
  int material_from;    // Material we're leaving
  int material_to;      // Material we're entering
  
  // NEW: Object tracking for MIS
  int object_id;        // Which object was hit
  
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
#define NUM_OBJECTS      // Total number of objects in scene
#define NUM_MATERIALS    // Total number of materials
```

The key change is :

**Scene Module**: Added object_id to Hit struct and new functions for evaluating specific object SDFs (needed for bbox light sampling)

These contracts now properly support the cross-reference system for correct MIS implementation.
