# Phase 0: Mathematical Foundation - Detailed Plan

## Purpose & Scope

Phase 0 establishes the minimal mathematical operations needed for path tracing. We're building a thin layer that serves two distinct purposes:

1. **CPU-side math** - Scene setup, parameter validation, camera controls
2. **GPU-side utilities** - Sampling patterns and helper functions that augment GLSL's built-in math

Key insight: GLSL already provides vec3, mat4, and basic operations. We're NOT reimplementing those on the GPU. Instead, we're providing:
- CPU-side equivalents for scene preparation
- GPU-side sampling utilities GLSL lacks

## File Structure & Responsibilities

### `src/math/vec3.ts` - CPU Vector Operations

**Purpose**: Provide TypeScript vector math matching GLSL's vec3 semantics for scene setup and camera manipulation.

**Core Operations Needed**:
```typescript
// Type definition
type vec3 = [number, number, number];

// Construction
create(x, y, z): vec3
fromValues(arr): vec3
copy(v): vec3

// Arithmetic (mutating and non-mutating versions)
add(a, b, out?): vec3
subtract(a, b, out?): vec3
multiply(a, b, out?): vec3
scale(v, s, out?): vec3
negate(v, out?): vec3

// Geometric operations
dot(a, b): number
cross(a, b, out?): vec3
length(v): number
normalize(v, out?): vec3
distance(a, b): number

// Utilities
lerp(a, b, t, out?): vec3
equals(a, b, epsilon?): boolean
```

**Why These?**
- Scene setup needs vector math for positioning objects
- Camera controls need vector operations for orbit/pan/zoom
- Parameter validation needs distance/length checks
- Must match GLSL semantics for consistency

**Design Decisions**:
- Use arrays not objects (better performance, matches GLSL)
- Optional `out` parameter for mutation (avoid allocations in hot paths)
- Simple functional style, no classes

### `src/math/mat4.ts` - CPU Matrix Operations

**Purpose**: Handle transformations for camera and object placement.

**Core Operations Needed**:
```typescript
// Type definition  
type mat4 = Float32Array;  // 16 elements, column-major like GLSL

// Construction
create(): mat4
identity(out?): mat4
fromTranslation(v, out?): mat4
fromRotation(angle, axis, out?): mat4
fromScale(v, out?): mat4

// Composition
multiply(a, b, out?): mat4
translate(m, v, out?): mat4
rotate(m, angle, axis, out?): mat4
scale(m, v, out?): mat4

// Camera specific
lookAt(eye, center, up, out?): mat4
perspective(fovy, aspect, near, far, out?): mat4
ortho(left, right, bottom, top, near, far, out?): mat4

// Application
transformVec3(m, v, out?): vec3
transformVec4(m, v, out?): vec4

// Utilities
invert(m, out?): mat4
transpose(m, out?): mat4
determinant(m): number
```

**Why These?**
- Camera needs lookAt + perspective
- Scene objects need TRS transformations
- Must match GLSL column-major layout
- Used only on CPU for setup, GPU uses built-in matrices

### `src/math/sampling.ts` - CPU Sampling Utilities

**Purpose**: Generate sample patterns for experiments and initial random seeds.

**Core Functions Needed**:
```typescript
// Basic samplers
uniform1D(): number                    // [0, 1)
uniform2D(): [number, number]          // Unit square
uniformDisk(): [number, number]        // Unit disk (for lens)
uniformSphere(): vec3                  // Unit sphere surface
uniformHemisphere(normal): vec3        // Oriented hemisphere

// Sequences
halton(index, base): number            // Quasi-random sequence
sobol2D(index): [number, number]      // 2D low-discrepancy
stratified2D(i, j, nx, ny): [number, number]  // Stratified sampling

// Utilities
cosineHemisphere(u1, u2, normal): vec3  // Cosine-weighted hemisphere
concentricDisk(u1, u2): [number, number] // Shirley's concentric mapping
sphericalToCartesian(theta, phi): vec3   // Spherical coords
```

**Why These?**
- Initial RNG seeds from CPU
- Parameter sweep patterns
- Testing/debugging sample distributions
- Some patterns easier to verify on CPU first

### `src/shared/types.ts` - Shared Type Definitions

**Purpose**: Define core types used across CPU and GPU boundaries.

**Essential Types**:
```typescript
// Math types
export type vec2 = [number, number];
export type vec3 = [number, number, number];
export type vec4 = [number, number, number, number];
export type mat3 = Float32Array;  // 9 elements
export type mat4 = Float32Array;  // 16 elements

// Ray (matches GLSL struct)
export interface Ray {
  origin: vec3;
  direction: vec3;
  tmin: number;
  tmax: number;
}

// AABB for spatial queries
export interface AABB {
  min: vec3;
  max: vec3;
}

// Color (distinguishing from vec3 for clarity)
export type RGB = vec3;
export type RGBA = vec4;
```

## GPU-Side Considerations

### `src/glsl/math_common.glsl` - GLSL Sampling Functions

**Purpose**: Sampling utilities that GLSL doesn't provide natively.

```glsl
// These will be included in the shader via string concatenation

// Random number generation (PCG or similar)
uint pcg_hash(uint seed) {
    // PCG hash implementation
}

float random(inout uint seed) {
    // Generate [0, 1) from hash
}

vec2 random2(inout uint seed) {
    // Generate 2D sample
}

// Sampling patterns (pure functions taking u1, u2)
vec3 sample_cosine_hemisphere(vec2 u, vec3 n) {
    // Malley's method
}

vec2 sample_concentric_disk(vec2 u) {
    // Shirley's mapping
}

vec3 sample_sphere(vec2 u) {
    // Uniform sphere
}

// Utilities
vec3 orthonormal_basis(vec3 n, out vec3 t, out vec3 b) {
    // Build frame from normal
}

float power_heuristic(float pdf_a, float pdf_b) {
    // MIS weight
}
```

## Key Design Principles

1. **Minimal Surface Area**: Only what we actually use in the path tracer
2. **CPU/GPU Symmetry**: Similar APIs where it makes sense
3. **No Redundancy**: Don't reimplement GLSL built-ins
4. **Performance Aware**: Optional output parameters to avoid allocations
5. **Type Safety**: Strong typing for vec3 vs RGB vs positions

## Testing Strategy

### CPU Math Tests
```typescript
// Test vec3 operations match GLSL semantics
test('cross product follows right-hand rule')
test('normalize handles zero vector')
test('matrix multiplication order matches GLSL')
```

### Sampling Tests
```typescript
// Verify distributions
test('uniform hemisphere covers hemisphere')
test('cosine hemisphere follows cosine distribution')
test('stratified sampling has correct variance reduction')
```

### GPU Validation
```typescript
// Render test patterns to verify GPU sampling
test('white furnace test converges to 1.0')
test('cosine hemisphere integrates to pi')
```

## What We're NOT Doing in Phase 0

- Complex quaternion math (add if needed later)
- Arbitrary precision (Float32 is enough)
- SIMD optimizations (premature at this stage)
- Full linear algebra library (just what path tracer needs)
- Color space conversions (that's for developer module)

## Success Criteria

Phase 0 is complete when:
1. Can create and transform vectors/matrices on CPU
2. Can generate random samples on CPU for testing
3. Have type definitions that match between CPU/GPU
4. Basic tests pass for mathematical correctness
5. Foundation ready for Phase 1's renderer

## Connection to Phase 1

This foundation enables:
- **Camera setup**: Use lookAt matrix for view
- **Ray generation**: Transform from screen to world space
- **Object placement**: Position sphere in scene
- **Random sampling**: Seeds for GPU RNG
- **Type safety**: Shared types for CPU/GPU communication

The key is keeping it minimal - just enough math to get a sphere on screen in Phase 1, then expand as needed.
