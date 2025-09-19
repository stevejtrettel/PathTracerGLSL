# Geometry Contract

## Module Structure

```typescript
{
  id: {
    kind: 'geometry',
    name: string,              // 'euclidean' | 'spherical' | 'hyperbolic' | ...
    version: string
  },
  provides: ['geometry'],
  requires: [],                // Geometry depends on nothing
  fragment: {
    functions: string,         // GLSL implementation
    uniforms: string,         // Typically none
    defines: {
      POINT_TYPE: 'vec3' | 'vec4',
      DIRECTION_TYPE: 'vec3' | 'vec4',
      GEOMETRY_TYPE: string   // 'EUCLIDEAN' | 'HYPERBOLIC' | ...
    }
  }
}
```

## Type Definitions

All geometry modules must define:
```glsl
typedef vec3 Point;      // or vec4 for projective coordinates
typedef vec3 Direction;  // or vec4 for some geometries
```

## Required Functions

### geodesic
```glsl
Point geodesic(Point origin, Direction dir, float t)
```
- Compute point at parameter t along geodesic from origin in direction dir
- dir must be unit vector in tangent space at origin
- Returns Point on manifold
- Note: Engine will auto-prefix to `g_geodesic`

### dot
```glsl
float dot(Direction v1, Direction v2, Point p)
```
- Inner product of v1 and v2 using metric tensor at point p
- For Euclidean: standard dot(v1, v2)
- For curved: scaled by metric tensor
- Note: Engine will auto-prefix to `g_dot`

### parallel_transport
```glsl
Direction parallel_transport(Direction v, Point from, Point to)
```
- Transport vector v along geodesic from point 'from' to point 'to'
- Preserves vector magnitude and parallelism
- For Euclidean: returns v unchanged
- Note: Engine will auto-prefix to `g_parallel_transport`

### frame
```glsl
Frame frame(Point p, Direction normal)
```
- Construct orthonormal frame at point p with given normal
- normal will be normalized and used as Frame.n
- Frame.t and Frame.b are arbitrary but orthonormal
- Note: Engine will auto-prefix to `g_frame`

## Optional Functions

```glsl
float distance(Point p1, Point p2)          // Geodesic distance
Point exp_map(Point base, Direction tangent) // Exponential map
Direction log_map(Point from, Point to)      // Logarithm map
mat3[3] christoffel(Point p)                // Christoffel symbols
float curvature(Point p)                    // Scalar curvature
```
Note: Engine will auto-prefix these with `g_`

## Implementation Requirements

1. Geometry modules are hand-written (pure mathematics, no scene dependency)
2. All functions auto-prefixed with `g_` by engine
3. geodesic is the hot path (called per ray step)
4. Numerical stability required at manifold boundaries
5. Frame vectors must be unit and mutually orthogonal

## Euclidean Reference Implementation

```glsl
typedef vec3 Point;
typedef vec3 Direction;

Point geodesic(Point origin, Direction dir, float t) {
  return origin + dir * t;
}

float dot(Direction v1, Direction v2, Point p) {
  return dot(v1, v2);  // Standard GLSL dot
}

Direction parallel_transport(Direction v, Point from, Point to) {
  return v;
}

Frame frame(Point p, Direction normal) {
  Direction n = normalize(normal);
  Direction t = abs(n.x) < 0.9 ? vec3(1,0,0) : vec3(0,1,0);
  t = normalize(cross(n, t));
  Direction b = cross(n, t);
  return Frame(p, t, b, n);
}
```
