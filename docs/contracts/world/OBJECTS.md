
# Objects System Documentation

## Overview

The objects system defines all geometric entities that exist in our rendered worlds. Objects are mathematical and procedural definitions written in GLSL that get compiled into shaders. This system is designed for maximum flexibility in a research renderer, allowing different mathematical representations to coexist and be optimized at compile time.

## Core Philosophy

Objects aren't inherently "SDF objects" or "analytic objects" - they're geometric objects that can provide various mathematical representations. A sphere might provide both an SDF formulation and an analytic ray intersection. The compiler analyzes what each object provides and how it's used in the scene, then generates the optimal tracing strategy.

## Directory Structure

```
src/
└── world/
    └── objects/
        ├── sdf/
        │   ├── tracing.glsl           # Sphere marching implementation
        │   ├── operations.glsl        # CSG operations
        │   ├── primitives/            # Basic shapes
        │   │   ├── sphere.glsl        # Euclidean only (default)
        │   │   ├── sphere/            # Multi-geometry (when needed)
        │   │   │   ├── euclidean.glsl
        │   │   │   └── hyperbolic.glsl
        │   │   ├── box.glsl
        │   │   ├── cylinder.glsl
        │   │   └── torus.glsl
        │   ├── fractals/              # Mathematical fractals
        │   │   ├── mandelbulb.glsl
        │   │   ├── menger.glsl
        │   │   └── julia.glsl
        │   └── compound/              # Built via CSG
        │       ├── teacup.glsl
        │       └── gear.glsl
        │
        ├── isosurface/               # Implicit surfaces
        │   ├── tracing.glsl         # Gradient/specialized tracing
        │   ├── metaballs.glsl
        │   ├── clouds.glsl
        │   └── harmonic.glsl       # For specialized methods
        │
        ├── analytic/                # Direct ray intersection
        │   ├── sphere.glsl
        │   ├── plane.glsl
        │   └── triangle.glsl
        │
        └── mesh/                    # Mesh handling code
            ├── loader.glsl         # BVH traversal
            └── interpolation.glsl  # Normal/UV interpolation

assets/                             # External data (not in src/)
├── meshes/
│   ├── bunny.obj
│   └── dragon.ply
└── hdri/
    └── sunset.hdr
```

## Object Capabilities

Objects provide mathematical functions based on what makes sense for their representation. The compiler determines which functions to use based on scene context.

### Core Functions

```glsl
// DISTANCE FUNCTIONS (provide at least one)
float sdf(vec3 p, ...params);           // Signed distance
float find_t(Ray ray, ...params);       // Analytic ray intersection
float density(vec3 p, ...params);       // Isosurface value

// REQUIRED DERIVED PROPERTIES
vec3 normal(vec3 p, ...params);         // Surface normal
bool inside(vec3 p, ...params);         // Interior test

// OPTIONAL PROPERTIES
vec2 uv(vec3 p, ...params);            // Texture coordinates
void bounds(out vec3 min, out vec3 max, ...params);  // AABB
vec3 gradient(vec3 p, ...params);       // For isosurfaces
vec3 sample_surface(vec2 xi, ...params); // For area lights
float sample_pdf(...params);            // Sampling probability
```

### Capability Rules

1. **Every object must enable interior testing** - Either through SDF (sdf < 0) or explicit inside() function
2. **Every object must provide normals** - Either analytically or via gradient estimation
3. **Objects provide what's natural** - Spheres can provide both SDF and analytic intersection
4. **Compiler chooses optimal path** - Based on usage context

## Multi-Representation Objects

Many objects naturally support multiple representations:

```glsl
// primitives/sphere.glsl - Can provide multiple methods

// For CSG operations and general use
float sdf(vec3 p, vec3 center, float radius) {
    return length(p - center) - radius;
}

// For fast standalone intersection
float find_t(Ray ray, vec3 center, float radius) {
    vec3 oc = ray.origin - center;
    float b = dot(oc, ray.dir);
    float c = dot(oc, oc) - radius * radius;
    float d = b * b - c;
    if (d < 0.0) return -1.0;
    return -b - sqrt(d);
}

// Analytic normal (faster than gradient)
vec3 normal(vec3 p, vec3 center, float radius) {
    return normalize(p - center);
}

// Explicit inside test (though sdf < 0 would work too)
bool inside(vec3 p, vec3 center, float radius) {
    return length(p - center) < radius;
}
```

## Compilation Strategy

The compiler analyzes scene usage and generates optimal code:

### Example Scene
```typescript
{
    objects: [
        { name: "hero_sphere", type: "sphere", usage: "standalone" },
        { name: "csg_sphere1", type: "sphere", usage: "csg_union" },
        { name: "mandelbulb", type: "fractal" }
    ]
}
```

### Generated Code
```glsl
Hit trace_scene(Ray ray) {
    Hit closest = no_hit();
    
    // Standalone sphere: use fast analytic test
    float t = find_t_sphere(ray, hero_sphere_params);
    if (t > 0.0 && t < closest.t) {
        closest = make_sphere_hit(ray, t);
    }
    
    // CSG and fractal: combined SDF marching
    float scene_sdf(vec3 p) {
        float d = sdf_sphere(p, csg_sphere1_params);
        d = op_union(d, sdf_sphere(p, csg_sphere2_params));
        d = min(d, sdf_mandelbulb(p));
        return d;
    }
    Hit sdf_hit = march(ray, scene_sdf);
    
    return closest_hit(closest, sdf_hit);
}
```

## Object Types

### SDF Objects
- Provide signed distance function
- Support CSG operations
- Enable sphere marching
- Examples: primitives, fractals, compound objects

### Isosurface Objects
- Define implicit surface where f(p) = 0
- May provide gradient for optimization
- Support specialized tracing methods
- Examples: metaballs, density fields, harmonic functions

### Analytic Objects
- Provide closed-form ray intersection
- Fastest possible intersection
- Limited to mathematically simple shapes
- Examples: spheres, planes, triangles

### Mesh Objects
- Reference external data in assets/
- Use BVH or other acceleration structures
- Handle arbitrary complexity
- Examples: scanned models, artistic creations

## Multi-Geometry Support

Objects can exist in different geometric spaces. The system uses "Euclidean as default":

### Single Geometry (Common Case)
```
primitives/
├── box.glsl          # Euclidean only
├── torus.glsl        # Euclidean only
└── teapot.glsl       # Euclidean only
```

### Multi-Geometry Objects
```
primitives/sphere/
├── euclidean.glsl    # Standard sphere
├── hyperbolic.glsl   # Hyperbolic sphere
└── spherical.glsl    # Spherical geometry sphere
```

### Resolution
The compiler resolves objects based on the scene's geometric space, defaulting to Euclidean and checking for specialized versions when needed.

## CSG Operations

Geometry-agnostic operations that work with any SDF:

```glsl
// operations.glsl
float op_union(float d1, float d2) { 
    return min(d1, d2); 
}

float op_subtract(float d1, float d2) { 
    return max(d1, -d2); 
}

float op_intersect(float d1, float d2) { 
    return max(d1, d2); 
}

float op_smooth_union(float d1, float d2, float k) {
    float h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
    return mix(d2, d1, h) - k * h * (1.0 - h);
}
```

## Compound Objects

Built from primitives using CSG:

```glsl
// compound/teacup.glsl
float sdf(vec3 p) {
    // Body
    float body = sdf_cylinder(p, vec3(0), 0.5, 1.0);
    
    // Handle
    float handle = sdf_torus(p - vec3(0.6, 0.3, 0), 0.2, 0.05);
    
    // Combine and hollow out
    float exterior = op_union(body, handle);
    float interior = sdf_cylinder(p, vec3(0, 0.1, 0), 0.45, 0.9);
    
    return op_subtract(exterior, interior);
}
```

## Scene Integration

The scene combines all object types efficiently:

```glsl
Hit trace_scene(Ray ray) {
    // 1. Fast analytic tests
    Hit hit = test_analytic_objects(ray);
    
    // 2. Combined SDF marching
    hit = min_hit(hit, march_combined_sdfs(ray));
    
    // 3. Specialized isosurface tracing
    hit = min_hit(hit, trace_isosurfaces(ray));
    
    // 4. Mesh BVH traversal
    hit = min_hit(hit, trace_meshes(ray));
    
    return hit;
}
```

## Volume Support

All objects are treated as volumes (supporting interior testing) for simplicity. This enables:
- Glass and refraction
- Volumetric effects
- Subsurface scattering
- CSG operations

Objects that lack inside testing will fail gracefully with error materials rather than crashing.

## Best Practices

1. **Start with SDF** - Get it working first, optimize later
2. **Add analytic intersection** - For common primitives when used standalone
3. **Provide analytic normals** - When the math is simple
4. **Document parameters** - Clear parameter names and ranges
5. **Credit sources** - For algorithms from papers or other artists
6. **Use consistent naming** - sdf(), normal(), inside() across all objects

## Future Extensions

The system is designed to accommodate:
- New geometric spaces (projective, conformal)
- New representations (voxels, point clouds, NURBS)
- Specialized tracing methods (harmonic functions, neural SDFs)
- Dynamic objects (animated, procedural)

Each extension would add new subdirectories under objects/ with their own tracing strategies, maintaining the pattern of objects providing capabilities and the compiler choosing optimal strategies.
