# Types Contract

## Geometric Types

```glsl
// Defined by Geometry module - may be vec3 or vec4
typedef <?> Point;
typedef <?> Direction;

struct Frame {
  Point base;      // Evaluation point
  Direction t;     // Tangent (unit, orthogonal to n)
  Direction b;     // Bitangent (unit, orthogonal to t and n)
  Direction n;     // Normal (unit)
}

struct Ray {
  Point origin;
  Direction direction;  // Unit vector
  float tmin;          // Default: 0.0
  float tmax;          // Default: MAX_DIST
}
```

## Hit Structure

```glsl
struct Hit {
  // Geometric data
  Point p;              // Intersection point
  Direction n;          // Surface normal (outward)
  Direction incident;   // Ray direction that created hit
  float t;              // Ray parameter at intersection
  vec2 uv;              // Texture coordinates [0,1]²
  
  // Precomputed by Scene
  Frame frame;          // Orthonormal basis at hit
  float ior_ratio;      // material_iors[material_from] / material_iors[material_to]
  
  // Object identity
  int object_id;        // Scene object index
  int part_id;          // Sub-part for compound objects (-1 if none)
  
  // Material interface (Scene responsibility)
  int material_from;    // Material ray exits (may be MATERIAL_AIR)
  int material_to;      // Material ray enters (may be MATERIAL_AIR)
}
```

## Material Types

```glsl
// Material IDs are indices into parameter tables for the single material module
typedef int MaterialID;

// Reserved ID
const int MATERIAL_AIR = -1;

// Material type flags (bit flags)
const int MAT_TYPE_OPAQUE = 1;
const int MAT_TYPE_DIELECTRIC = 2;
const int MAT_TYPE_PARTICIPATING = 4;
const int MAT_TYPE_SUBSURFACE = 8;
const int MAT_TYPE_EMISSIVE = 16;

// Properties structure (material-module-specific)
struct MaterialProperties {
  // Defined by specific material module
  // All materials in scene use same structure
}
```

## Light Types

```glsl
struct LightSample {
  Direction wi;         // Direction toward light (from hit point)
  float distance;       // Distance to light (inf for env/directional)
  Spectrum radiance;    // Incoming radiance if not occluded
  float pdf;            // Probability density (solid angle measure)
  int light_id;         // Which light was sampled
  bool is_delta;        // True for point/directional (zero area)
}

struct EmissionSample {
  Point p;              // Point on emissive surface
  Direction n;          // Surface normal at emission
  Direction wo;         // Emission direction
  Spectrum radiance;    // Emitted radiance
  float pdf_pos;        // Area measure PDF for position
  float pdf_dir;        // Solid angle PDF for direction
}
```

## Nearby Object Tracking

```glsl
struct NearbyObjects {
  float dists[3];      // Distances to 3 closest objects
  int ids[3];          // Object IDs (-1 if none)
  int count;           // Number within BOUNDARY_THRESHOLD
}
```

## Constants

```glsl
const float MAX_DIST = 1e10;
const float EPSILON = 0.0001;
const float BOUNDARY_THRESHOLD = 0.01;
const int MAX_STEPS = 256;
```

## Validation

1. Point/Direction types must be consistent across all modules
2. Frame vectors must be unit length and mutually orthogonal
3. Hit.material_from and Hit.material_to must be valid MaterialIDs or MATERIAL_AIR
4. Hit.ior_ratio must equal material_iors[material_from] / material_iors[material_to]
5. NearbyObjects.count ≤ 3
6. LightSample.pdf > 0 unless is_delta is true
