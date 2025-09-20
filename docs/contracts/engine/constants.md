# Engine Constants

## Purpose

This document defines all shared constants, GLSL utilities, shader templates, and fixed values used throughout the Engine subsystems.

## Module Prefix Mapping

```typescript
export const MODULE_PREFIX_MAP: Record<ModuleKind, string> = {
  'geometry': 'g_',
  'material': 'm_',
  'scene': 'sc_',
  'lights': 'l_',
  'camera': 'c_',
  'estimator': 'e_',
  'film': 'f_',
  'developer': 'd_',
};
```

## Texture Unit Assignments

```typescript
export const TEXTURE_UNITS = {
  // Film textures (0-7)
  FILM_RADIANCE_PREV: 0,
  FILM_VARIANCE_PREV: 1,
  FILM_SAMPLES_PREV: 2,
  FILM_RESERVED_3: 3,
  FILM_RESERVED_4: 4,
  FILM_RESERVED_5: 5,
  FILM_RESERVED_6: 6,
  FILM_RESERVED_7: 7,
  
  // Material textures (8-15)
  MATERIAL_ALBEDO: 8,
  MATERIAL_NORMAL: 9,
  MATERIAL_ROUGHNESS: 10,
  MATERIAL_METALNESS: 11,
  MATERIAL_EMISSION: 12,
  MATERIAL_RESERVED_13: 13,
  MATERIAL_RESERVED_14: 14,
  MATERIAL_RESERVED_15: 15,
  
  // Environment/IBL (16-19)
  ENVIRONMENT_MAP: 16,
  IRRADIANCE_MAP: 17,
  PREFILTER_MAP: 18,
  BRDF_LUT: 19,
  
  // General purpose (20-31)
  GENERAL_START: 20,
  GENERAL_END: 31,
};
```

## Engine Limits

```typescript
export const ENGINE_LIMITS = {
  MAX_RECIPES: 10,                    // Reasonable for eager compilation
  MAX_COMPILE_TIME: 5000,              // ms before timeout warning
  MAX_UNIFORM_UPDATES_PER_FRAME: 1000, // Sanity check
  MAX_TEXTURE_SIZE_DEFAULT: 4096,      // Conservative default
  MAX_VIEWPORT_DIMENSION: 8192,        // Maximum render dimension
  MIN_VIEWPORT_DIMENSION: 1,           // Minimum render dimension
  FRAME_HISTORY_SIZE: 60,              // For FPS calculation
};
```

## Default Values

```typescript
export const ENGINE_DEFAULTS = {
  VIEWPORT: { 
    x: 0, 
    y: 0, 
    width: 1920, 
    height: 1080 
  },
  CLEAR_COLOR: [0, 0, 0, 0] as [number, number, number, number],
  CLEAR_DEPTH: 1.0,
  CLEAR_STENCIL: 0,
  FILM_CLEAR_COLOR: [0, 0, 0, 0] as [number, number, number, number],
};
```

## Math Utilities (GLSL)

```typescript
export const MATH_UTILITIES = `
// ============ Math Constants ============
#define PI 3.14159265359
#define TWO_PI 6.28318530718
#define HALF_PI 1.57079632679
#define INV_PI 0.31830988618
#define INV_TWO_PI 0.15915494309
#define INV_FOUR_PI 0.07957747155
#define SQRT_TWO 1.41421356237
#define INV_SQRT_TWO 0.70710678118
#define EPSILON 0.0001
#define FLT_MAX 3.402823466e+38

// ============ Common Functions ============
float saturate(float x) {
  return clamp(x, 0.0, 1.0);
}

vec3 saturate(vec3 x) {
  return clamp(x, 0.0, 1.0);
}

float sq(float x) {
  return x * x;
}

float pow2(float x) {
  return x * x;
}

float pow3(float x) {
  return x * x * x;
}

float pow4(float x) {
  float x2 = x * x;
  return x2 * x2;
}

float pow5(float x) {
  float x2 = x * x;
  return x2 * x2 * x;
}

// ============ Random Number Generation ============
uint hash(uint x) {
  x ^= x >> 16;
  x *= 0x7feb352dU;
  x ^= x >> 15;
  x *= 0x846ca68bU;
  x ^= x >> 16;
  return x;
}

uint hash2(uint x, uint y) {
  return hash(x ^ hash(y));
}

uint hash3(uint x, uint y, uint z) {
  return hash(x ^ hash(y ^ hash(z)));
}

uint hash4(uint x, uint y, uint z, uint w) {
  return hash(x ^ hash(y ^ hash(z ^ hash(w))));
}

float random(uint seed) {
  return float(hash(seed)) / 4294967296.0;
}

vec2 random2(uint seed) {
  uint h1 = hash(seed);
  uint h2 = hash(h1);
  return vec2(float(h1) / 4294967296.0, float(h2) / 4294967296.0);
}

vec3 random3(uint seed) {
  uint h1 = hash(seed);
  uint h2 = hash(h1);
  uint h3 = hash(h2);
  return vec3(
    float(h1) / 4294967296.0,
    float(h2) / 4294967296.0,
    float(h3) / 4294967296.0
  );
}

// Stratified sampling
vec2 sample_2d(ivec2 pixel, int index, int dimension) {
  uint seed = hash4(uint(pixel.x), uint(pixel.y), uint(index), uint(dimension));
  return random2(seed);
}

vec3 sample_3d(ivec2 pixel, int index, int dimension) {
  uint seed = hash4(uint(pixel.x), uint(pixel.y), uint(index), uint(dimension));
  return random3(seed);
}

float sample_1d(ivec2 pixel, int index, int dimension) {
  uint seed = hash4(uint(pixel.x), uint(pixel.y), uint(index), uint(dimension));
  return random(seed);
}

// ============ Sampling Functions ============
vec3 sample_hemisphere(vec2 xi, vec3 n) {
  // Uniform hemisphere sampling
  float theta = acos(1.0 - xi.x);
  float phi = TWO_PI * xi.y;
  
  vec3 dir = vec3(
    sin(theta) * cos(phi),
    sin(theta) * sin(phi),
    cos(theta)
  );
  
  // Transform to world space aligned with normal
  vec3 up = abs(n.y) < 0.999 ? vec3(0, 1, 0) : vec3(1, 0, 0);
  vec3 tangent = normalize(cross(up, n));
  vec3 bitangent = cross(n, tangent);
  
  return tangent * dir.x + bitangent * dir.y + n * dir.z;
}

vec3 sample_cosine_hemisphere(vec2 xi, vec3 n) {
  // Cosine-weighted hemisphere sampling
  float theta = acos(sqrt(1.0 - xi.x));
  float phi = TWO_PI * xi.y;
  
  vec3 dir = vec3(
    sin(theta) * cos(phi),
    sin(theta) * sin(phi),
    cos(theta)
  );
  
  vec3 up = abs(n.y) < 0.999 ? vec3(0, 1, 0) : vec3(1, 0, 0);
  vec3 tangent = normalize(cross(up, n));
  vec3 bitangent = cross(n, tangent);
  
  return tangent * dir.x + bitangent * dir.y + n * dir.z;
}

vec3 sample_sphere(vec2 xi) {
  float theta = acos(1.0 - 2.0 * xi.x);
  float phi = TWO_PI * xi.y;
  
  return vec3(
    sin(theta) * cos(phi),
    sin(theta) * sin(phi),
    cos(theta)
  );
}

vec2 sample_disk(vec2 xi) {
  float r = sqrt(xi.x);
  float theta = TWO_PI * xi.y;
  return vec2(r * cos(theta), r * sin(theta));
}

vec2 sample_triangle(vec2 xi) {
  float sqrt_xi = sqrt(xi.x);
  return vec2(1.0 - sqrt_xi, xi.y * sqrt_xi);
}

// ============ Coordinate System ============
void make_coordinate_system(vec3 n, out vec3 t, out vec3 b) {
  vec3 up = abs(n.y) < 0.999 ? vec3(0, 1, 0) : vec3(1, 0, 0);
  t = normalize(cross(up, n));
  b = cross(n, t);
}

vec3 world_to_local(vec3 v, vec3 n, vec3 t, vec3 b) {
  return vec3(dot(v, t), dot(v, b), dot(v, n));
}

vec3 local_to_world(vec3 v, vec3 n, vec3 t, vec3 b) {
  return t * v.x + b * v.y + n * v.z;
}`;
```

## Shader Templates

### Standard Main Template

```typescript
export const STANDARD_MAIN_TEMPLATE = `
void main() {
  vec2 pixel = gl_FragCoord.xy;
  ivec2 pixel_id = ivec2(pixel);
  
  // Antialiasing offset
  vec2 xi = sample_2d(pixel_id, u_frame_index, 0);
  
  // Generate camera ray
  Ray ray = {{GENERATE_RAY}}(pixel, xi);
  
  // Estimate radiance
  vec3 radiance = {{ESTIMATE}}(ray);
  
  // Accumulate in film
  vec3 accumulated = {{ACCUMULATE}}(radiance, pixel);
  
  // Develop to display color
  vec3 color = {{DEVELOP}}(accumulated);
  
  fragColor = vec4(color, 1.0);
}`;
```

### Debug Main Template

```typescript
export const DEBUG_MAIN_TEMPLATE = `
void main() {
  vec2 pixel = gl_FragCoord.xy;
  ivec2 pixel_id = ivec2(pixel);
  
  // No antialiasing in debug mode
  vec2 xi = vec2(0.5);
  
  // Generate camera ray
  Ray ray = {{GENERATE_RAY}}(pixel, xi);
  
  // Debug visualization (normals, depth, etc.)
  vec3 debug_value = {{ESTIMATE}}(ray);
  
  // Direct output, no accumulation
  vec3 color = {{DEVELOP}}(debug_value);
  
  fragColor = vec4(color, 1.0);
}`;
```

### Realtime Main Template

```typescript
export const REALTIME_MAIN_TEMPLATE = `
void main() {
  vec2 pixel = gl_FragCoord.xy;
  ivec2 pixel_id = ivec2(pixel);
  
  // Temporal antialiasing offset
  vec2 xi = sample_2d(pixel_id, u_frame_index, 0);
  
  // Generate camera ray
  Ray ray = {{GENERATE_RAY}}(pixel, xi);
  
  // Fast estimation for realtime
  vec3 radiance = {{ESTIMATE}}(ray);
  
  // Temporal accumulation with motion vectors
  vec3 accumulated = {{ACCUMULATE}}(radiance, pixel);
  
  // Fast tonemapping
  vec3 color = {{DEVELOP}}(accumulated);
  
  fragColor = vec4(color, 1.0);
}`;
```

## Vertex Shader

```typescript
export const STANDARD_VERTEX_SHADER = `
#version 300 es
precision highp float;

in vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;
```

## Full-Screen Triangle Vertices

```typescript
export const FULLSCREEN_TRIANGLE_VERTICES = new Float32Array([
  -1, -1,  // Bottom-left
   3, -1,  // Bottom-right (extends beyond viewport)  
  -1,  3   // Top-left (extends beyond viewport)
]);
```

## Type Guards

```typescript
export const TYPE_GUARDS = {
  isModuleKind(value: string): value is ModuleKind {
    return ['geometry', 'material', 'scene', 'lights', 
            'camera', 'estimator', 'film', 'developer'].includes(value);
  },
  
  isGLSLType(value: string): value is GLSLType {
    return ['float', 'vec2', 'vec3', 'vec4',
            'int', 'ivec2', 'ivec3', 'ivec4',
            'bool', 'mat3', 'mat4',
            'sampler2D', 'samplerCube'].includes(value);
  },
  
  isTextureFormat(value: number): boolean {
    const formats = [
      0x1907, // RGB
      0x1908, // RGBA
      0x8815, // RGB32F
      0x8814, // RGBA32F
      0x881B, // RGB16F
      0x881A, // RGBA16F
      0x822E, // R32F
      0x8230, // RG32F
      0x8235, // R32I
    ];
    return formats.includes(value);
  }
};
```

## Error Messages

```typescript
export const ERROR_MESSAGES = {
  WEBGL2_NOT_AVAILABLE: 'WebGL2 is required but not available in this browser',
  CONTEXT_LOST: 'WebGL context was lost',
  NO_HDR_SUPPORT: 'HDR rendering requested but float render targets not available',
  SHADER_COMPILE_FAILED: 'Shader compilation failed - check console for details',
  PROGRAM_LINK_FAILED: 'Program linking failed - shaders may be incompatible',
  MODULE_NOT_FOUND: 'Module not found in registry',
  RECIPE_NOT_COMPILED: 'Recipe must be compiled before selection',
  INVALID_STATE: 'Operation not allowed in current engine state',
  FRAMEBUFFER_INCOMPLETE: 'Framebuffer is incomplete - check attachments',
};
```

## WebGL Constants (Convenience)

```typescript
export const GL = {
  // Clear bits
  COLOR_BUFFER_BIT: 0x00004000,
  DEPTH_BUFFER_BIT: 0x00000100,
  STENCIL_BUFFER_BIT: 0x00000400,
  
  // Features
  BLEND: 0x0BE2,
  CULL_FACE: 0x0B44,
  DEPTH_TEST: 0x0B71,
  SCISSOR_TEST: 0x0C11,
  STENCIL_TEST: 0x0B90,
  
  // Primitive types
  TRIANGLES: 0x0004,
  TRIANGLE_STRIP: 0x0005,
  
  // Shader types
  VERTEX_SHADER: 0x8B31,
  FRAGMENT_SHADER: 0x8B30,
  
  // Status
  COMPILE_STATUS: 0x8B81,
  LINK_STATUS: 0x8B82,
  VALIDATE_STATUS: 0x8B83,
  
  // Framebuffer status
  FRAMEBUFFER_COMPLETE: 0x8CD5,
};
```

## Validation Patterns

```typescript
export const VALIDATION = {
  UNIFORM_NAME_PATTERN: /^u_[a-z]+_[a-z]+_[a-z_]+$/,
  MODULE_NAME_PATTERN: /^[a-z][a-z0-9_]*$/,
  PARAMETER_PATH_PATTERN: /^[a-z]+\.[a-z][a-zA-Z0-9_]*$/,
  
  isValidUniformName(name: string): boolean {
    return this.UNIFORM_NAME_PATTERN.test(name);
  },
  
  isValidModuleName(name: string): boolean {
    return this.MODULE_NAME_PATTERN.test(name);
  },
  
  isValidParameterPath(path: string): boolean {
    return this.PARAMETER_PATH_PATTERN.test(path);
  }
};
```
