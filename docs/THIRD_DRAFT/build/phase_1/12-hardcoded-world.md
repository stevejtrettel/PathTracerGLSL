# Phase 1.2: Hardcoded World - Detailed Plan

## Purpose & Scope

Phase 1.2 provides the World pillar modules as hand-written GLSL. These modules define the space (Euclidean geometry), the scene (a single hardcoded sphere), and the lighting (trivial white everywhere). This proves our module interface convention works before we build compilation infrastructure.

**Core Goal**: Implement minimal but correct World modules that the engine can concatenate and run.

## File Structure & Responsibilities

### `src/world/geometry/euclidean.glsl` - Euclidean Geometry

**Purpose**: Define the mathematical structure of flat 3D space. Even though GLSL has vec3 operations, we need geometry-specific functions for the path tracer.

**Core Functions**:
```glsl
// Constants for this geometry
#define GEOMETRY_EUCLIDEAN_PI 3.14159265359
#define GEOMETRY_EUCLIDEAN_INV_PI 0.31830988618

// Geodesic (straight line in Euclidean space)
vec3 geometry_geodesic(vec3 p, vec3 v, float t) {
    return p + t * v;
}

// Parallel transport (direction unchanged in Euclidean space)
vec3 geometry_parallel_transport(vec3 v, vec3 from_point, vec3 to_point) {
    return v;  // Directions don't change in flat space
}

// Build orthonormal frame from normal
void geometry_frame(vec3 n, out vec3 t, out vec3 b) {
    // Frisvad's method for robust frame construction
    if (n.z < -0.999) {
        t = vec3(0.0, -1.0, 0.0);
        b = vec3(-1.0, 0.0, 0.0);
    } else {
        float a = 1.0 / (1.0 + n.z);
        float b_term = -n.x * n.y * a;
        t = vec3(1.0 - n.x * n.x * a, b_term, -n.x);
        b = vec3(b_term, 1.0 - n.y * n.y * a, -n.y);
    }
}

// Dot product (same as built-in, but part of geometry interface)
float geometry_dot(vec3 a, vec3 b) {
    return dot(a, b);
}

// Distance between points
float geometry_distance(vec3 a, vec3 b) {
    return length(b - a);
}
```

**Why These Functions?**
- Other geometries (spherical, hyperbolic) transform these operations
- Provides abstraction layer for non-Euclidean rendering
- Frame construction is critical for shading
- Geodesics needed for ray marching

### `src/world/hardcoded/scene.glsl` - Hardcoded Sphere Scene

**Purpose**: Define a single sphere at the origin without any data structures or loops.

**Scene Definition**:
```glsl
// Scene contains one sphere
#define SCENE_SPHERE_CENTER vec3(0.0, 0.0, 0.0)
#define SCENE_SPHERE_RADIUS 1.0
#define SCENE_GROUND_Y -1.5

// Main intersection function
bool scene_intersect(Ray ray, inout Hit hit) {
    bool hit_anything = false;
    hit.t = ray.tmax;
    
    // Intersect sphere
    vec3 oc = ray.origin - SCENE_SPHERE_CENTER;
    float a = dot(ray.direction, ray.direction);
    float b = 2.0 * dot(oc, ray.direction);
    float c = dot(oc, oc) - SCENE_SPHERE_RADIUS * SCENE_SPHERE_RADIUS;
    float discriminant = b * b - 4.0 * a * c;
    
    if (discriminant > 0.0) {
        float t = (-b - sqrt(discriminant)) / (2.0 * a);
        if (t > ray.tmin && t < hit.t) {
            hit.t = t;
            hit.p = ray.origin + t * ray.direction;
            hit.n = normalize(hit.p - SCENE_SPHERE_CENTER);
            hit.id = 1;  // Sphere is object 1
            hit_anything = true;
        }
    }
    
    // Intersect ground plane
    if (ray.direction.y < 0.0) {
        float t = (SCENE_GROUND_Y - ray.origin.y) / ray.direction.y;
        if (t > ray.tmin && t < hit.t) {
            hit.t = t;
            hit.p = ray.origin + t * ray.direction;
            hit.n = vec3(0.0, 1.0, 0.0);
            hit.id = 2;  // Ground is object 2
            hit_anything = true;
        }
    }
    
    return hit_anything;
}

// Test if ray is occluded (for shadows)
bool scene_intersect_any(Ray ray) {
    // Simplified test, just check sphere
    vec3 oc = ray.origin - SCENE_SPHERE_CENTER;
    float a = dot(ray.direction, ray.direction);
    float b = 2.0 * dot(oc, ray.direction);
    float c = dot(oc, oc) - SCENE_SPHERE_RADIUS * SCENE_SPHERE_RADIUS;
    float discriminant = b * b - 4.0 * a * c;
    
    if (discriminant > 0.0) {
        float t = (-b - sqrt(discriminant)) / (2.0 * a);
        if (t > ray.tmin && t < ray.tmax) {
            return true;
        }
    }
    
    return false;
}

// Get material properties for hit point
void scene_get_material(Hit hit, out vec3 albedo, out float roughness) {
    if (hit.id == 1) {
        // Sphere: white-ish diffuse
        albedo = vec3(0.8, 0.8, 0.8);
        roughness = 1.0;
    } else if (hit.id == 2) {
        // Ground: gray diffuse
        albedo = vec3(0.5, 0.5, 0.5);
        roughness = 1.0;
    } else {
        // Default (shouldn't happen)
        albedo = vec3(1.0, 0.0, 1.0);  // Magenta for errors
        roughness = 1.0;
    }
}
```

**Key Design Decisions**:
- No arrays or loops (truly hardcoded)
- Analytic sphere intersection
- Simple ground plane for reference
- Material properties embedded (no material system yet)
- Object IDs for debugging

### `src/world/hardcoded/lighting.glsl` - Trivial Lighting

**Purpose**: Provide the absolute minimum lighting module interface. Just returns white light from everywhere.

**Implementation**:
```glsl
// Ambient white light everywhere
#define LIGHTING_AMBIENT_COLOR vec3(1.0, 1.0, 1.0)
#define LIGHTING_AMBIENT_INTENSITY 1.0

// Sample a light direction (uniform sphere for now)
vec3 lighting_sample_direction(vec3 p, vec2 u) {
    // Uniform sphere sampling
    float phi = 2.0 * GEOMETRY_EUCLIDEAN_PI * u.x;
    float cos_theta = 1.0 - 2.0 * u.y;
    float sin_theta = sqrt(max(0.0, 1.0 - cos_theta * cos_theta));
    
    return vec3(
        sin_theta * cos(phi),
        sin_theta * sin(phi),
        cos_theta
    );
}

// Evaluate light arriving from direction
vec3 lighting_evaluate(vec3 p, vec3 wi) {
    // Constant white light from all directions
    return LIGHTING_AMBIENT_COLOR * LIGHTING_AMBIENT_INTENSITY;
}

// PDF for light sampling (uniform)
float lighting_pdf(vec3 p, vec3 wi) {
    // Uniform sphere PDF
    return GEOMETRY_EUCLIDEAN_INV_PI * 0.25;  // 1/(4*pi)
}

// Direct lighting evaluation (for NEE later)
vec3 lighting_sample_direct(vec3 p, vec2 u, out vec3 wi, out float pdf) {
    wi = lighting_sample_direction(p, u);
    pdf = lighting_pdf(p, wi);
    return lighting_evaluate(p, wi);
}

// Check if point can see light
bool lighting_is_visible(vec3 p, vec3 light_dir) {
    // For now, always visible (no shadows in Phase 1)
    return true;
}
```

**Why This Approach?**
- Simplest possible lighting (ambient)
- Still follows the interface needed later
- No area lights or point lights yet
- Allows testing without black scenes
- Will be replaced with real lighting in Phase 2

## Module Registration

These modules will be registered with the engine as:

```typescript
// In main.ts or test file
engine.registerModule({
  kind: 'geometry',
  name: 'euclidean',
  source: EUCLIDEAN_GLSL_SOURCE
});

engine.registerModule({
  kind: 'scene',
  name: 'hardcoded_sphere',
  source: SCENE_GLSL_SOURCE
});

engine.registerModule({
  kind: 'lighting',
  name: 'white_ambient',
  source: LIGHTING_GLSL_SOURCE
});
```

## Testing Strategy

### Geometry Tests
```glsl
// Test in fragment shader
test('frame construction is orthonormal')
test('parallel transport preserves length')
test('geodesic is straight line')
```

### Scene Tests
```glsl
// Render tests
test('sphere visible at origin')
test('ground plane visible below')
test('intersection returns correct normals')
test('no intersection beyond tmax')
```

### Lighting Tests
```glsl
// Validation
test('PDF integrates to 1')
test('lighting evaluation is non-negative')
test('sample direction is normalized')
```

## Success Criteria

Phase 1.2 is complete when:
1. All modules compile without GLSL errors
2. Functions follow KIND_ prefixing convention
3. Sphere intersection works correctly
4. Basic material properties returned
5. Ambient lighting provides illumination
6. Ready for Photography modules to use

## What We're NOT Doing in Phase 1.2

- Compiling scenes from descriptions
- Multiple objects or materials
- Real lighting (point, area, HDRI)
- Shadows or occlusion
- BVH or acceleration structures
- Textures or procedural materials
- Volume rendering
- Motion or animation

## Connection to Phase 1.3

These World modules provide:
- A scene for rays to intersect
- Materials for shading (even if trivial)
- Lighting to evaluate
- Geometric operations for transport

Phase 1.3's Photography modules will:
- Generate rays (camera)
- Intersect the scene (transport)
- Shade the intersection (interaction)
- Output final color (film/developer)

The hardcoded sphere with normal visualization will prove our entire pipeline works end-to-end.
