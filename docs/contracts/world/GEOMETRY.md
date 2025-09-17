# Geometry Module Contract

## Purpose
Geometry modules define the differential geometric structure of space. These are typically hand-written as they represent fundamental mathematical operations that don't benefit from build-time optimization.

## Implementation Approach
**Hand-written GLSL**: These modules are mathematical constants that don't vary with scene content. The implementations are pure mathematics.

## Module Descriptor
```typescript
{
  id: {
    kind: 'geometry',
    name: string,                // e.g., 'euclidean', 'hyperbolic', 'spherical'
    version: string
  },
  provides: ['geometry'],
  requires: [],                  // Geometry depends on nothing
  fragment: {
    functions: string,           // Mathematical operations
    uniforms: string,           // Usually none or minimal
    defines: {
      POINT_TYPE?: 'vec3' | 'vec4',     // Point representation
      DIRECTION_TYPE?: 'vec3' | 'vec4',  // Direction representation
      GEOMETRY_TYPE: string              // e.g., 'EUCLIDEAN', 'HYPERBOLIC'
    }
  }
}
```

## Required Type Definitions

All geometry modules must define:
```glsl
// The representation of points in this geometry
typedef vec3 Point;    // or vec4 for projective coordinates

// The representation of directions/vectors
typedef vec3 Direction;  // or vec4 for some geometries
```

## Required Functions

### geodesic
Compute position along a geodesic (straight line in the geometry).
```glsl
Point g_geodesic(Point origin, Direction dir, float t)
```
- **origin**: Starting point
- **dir**: Direction of travel (unit vector in tangent space)
- **t**: Parameter along geodesic
- **returns**: Point at parameter t along geodesic

### dot
Inner product using the metric tensor at a point.
```glsl
float g_dot(Direction v1, Direction v2, Point p)
```
- **v1, v2**: Vectors to compute inner product
- **p**: Point where metric is evaluated
- **returns**: Inner product value
- **Note**: In Euclidean space this is standard dot product

### parallel_transport
Transport a vector along a geodesic maintaining parallelism.
```glsl
Direction g_parallel_transport(Direction v, Point from, Point to)
```
- **v**: Vector to transport
- **from**: Starting point
- **to**: Ending point
- **returns**: Transported vector at ending point

### frame
Construct orthonormal frame at a point given a normal.
```glsl
Frame g_frame(Point p, Direction normal)
```
- **p**: Point where frame is constructed
- **normal**: Normal vector (will be orthonormalized)
- **returns**: Orthonormal frame with tangent, bitangent, normal

## Optional Functions

### distance
Compute geodesic distance between points.
```glsl
float g_distance(Point p1, Point p2)
```

### exp_map
Exponential map from tangent space to manifold.
```glsl
Point g_exp_map(Point base, Direction tangent)
```

### log_map
Logarithm map from manifold to tangent space.
```glsl
Direction g_log_map(Point from, Point to)
```

### christoffel
Christoffel symbols of the second kind.
```glsl
mat3[3] g_christoffel(Point p)
```

### curvature
Scalar curvature at a point.
```glsl
float g_curvature(Point p)
```

## Frame Structure

```glsl
struct Frame {
  Point base;      // Point where frame is valid
  Direction t;     // Tangent (orthonormal)
  Direction b;     // Bitangent (orthonormal)
  Direction n;     // Normal (orthonormal)
}
```

## Implementation Examples

### Euclidean Geometry
```glsl
// Simple hand-written implementation
typedef vec3 Point;
typedef vec3 Direction;

Point g_geodesic(Point origin, Direction dir, float t) {
  return origin + dir * t;  // Straight lines
}

float g_dot(Direction v1, Direction v2, Point p) {
  return dot(v1, v2);  // Standard dot product everywhere
}

Direction g_parallel_transport(Direction v, Point from, Point to) {
  return v;  // No change in flat space
}

Frame g_frame(Point p, Direction normal) {
  Direction n = normalize(normal);
  Direction t = abs(n.x) < 0.9 ? 
    vec3(1,0,0) : vec3(0,1,0);
  t = normalize(cross(n, t));
  Direction b = cross(n, t);
  
  return Frame(p, t, b, n);
}
```

### Hyperbolic Geometry (Poincaré Ball)
```glsl
typedef vec3 Point;
typedef vec3 Direction;

Point g_geodesic(Point origin, Direction dir, float t) {
  // Geodesics are circular arcs orthogonal to boundary
  float r2 = dot(origin, origin);
  float k = sqrt(1.0 - r2);  // Curvature factor
  
  // Parallel transport direction to origin
  Direction v = dir * k;
  
  // Move along geodesic in Poincaré ball
  Point p = origin + v * tanh(t/2.0);
  return p / (1.0 + dot(p, p) * 0.5);
}

float g_dot(Direction v1, Direction v2, Point p) {
  // Conformal metric
  float r2 = dot(p, p);
  float scale = 4.0 / ((1.0 - r2) * (1.0 - r2));
  return dot(v1, v2) * scale;
}
```

### Spherical Geometry
```glsl
typedef vec3 Point;  // Points on unit sphere
typedef vec3 Direction;  // Tangent vectors

Point g_geodesic(Point origin, Direction dir, float t) {
  // Great circles
  Direction tangent = normalize(dir - dot(dir, origin) * origin);
  return cos(t) * origin + sin(t) * tangent;
}

float g_dot(Direction v1, Direction v2, Point p) {
  // Project to tangent space then standard dot
  v1 = v1 - dot(v1, p) * p;
  v2 = v2 - dot(v2, p) * p;
  return dot(v1, v2);
}
```

## Why Not Generated?

Geometry modules are not generated because:

1. **Mathematical Constants**: The operations are fixed by mathematics
2. **No Scene Dependency**: Same regardless of what objects exist
3. **Already Optimal**: Hand-written implementations are already minimal
4. **Research Focus**: These are often what researchers modify directly

## Special Considerations

### Numerical Stability
```glsl
// Handle edge cases in curved geometries
Point g_geodesic_stable(Point origin, Direction dir, float t) {
  if (t < EPSILON) return origin;  // Avoid numerical issues
  
  // Clamp to valid domain
  Point result = g_geodesic(origin, dir, t);
  return clamp_to_manifold(result);
}
```

### Coordinate Charts
Some geometries may need multiple coordinate charts:
```glsl
// For manifolds requiring multiple patches
int g_chart_id(Point p);
Point g_change_chart(Point p, int from_chart, int to_chart);
```

## Performance Notes

- Geodesic computation is the hottest path (called per ray march step)
- Consider caching frame computation when possible
- In Euclidean space, many operations can be inlined by compiler
- For complex geometries, consider lookup tables for expensive operations

## Validation Requirements

Geometry modules must:
1. Maintain unit vectors where expected
2. Preserve orthonormality in frames
3. Handle edge cases (points at infinity, singularities)
4. Provide stable numerical computation
5. Define consistent Point and Direction types
