# Camera Module Contract

Cameras transform image coordinates into rays for tracing.

## Required Functions

### generate_ray
```glsl
Ray generate_ray(vec2 pixel, vec2 xi)
```
Generate a ray from pixel coordinates with random offset for antialiasing.

**Parameters:**
- `pixel`: Pixel coordinates in screen space [0, resolution]
- `xi`: Random offset in [0,1]² for antialiasing/DOF

**Returns:** Ray in world space

**Note:** Function will be auto-prefixed to `c_generate_ray` in compiled shader.

## Optional Functions

### get_pdf
```glsl
float get_pdf(Ray ray)
```
Probability density of generating this ray (for bidirectional methods).

### get_frame
```glsl
Frame get_frame()
```
Camera coordinate frame in world space.

### get_focal_distance
```glsl
float get_focal_distance()
```
Focus distance for depth of field.

## Engine-Provided Camera Uniforms

The engine precomputes camera matrices for efficiency:

```glsl
// Precomputed by engine once per frame
uniform mat3 u_camera_frame;     // [right, up, forward] columns
uniform vec3 u_camera_position;  // Camera location
uniform float u_camera_tan_fov;  // tan(fov * 0.5) precomputed

// Additional camera parameters (if needed)
uniform vec3 u_camera_target;    // Look-at point
uniform float u_camera_aperture; // For depth of field
uniform float u_camera_focal_distance;
```

## Common Parameters

Parameters are declared without prefixes - engine adds them automatically:

```glsl
// You write:
uniform vec3 position;    // → u_camera_[name]_position
uniform vec3 target;      // → u_camera_[name]_target  
uniform vec3 up;          // → u_camera_[name]_up
uniform float fov;        // → u_camera_[name]_fov
```

Common camera parameters:
- `position` (vec3): Camera location in world space
- `target` (vec3): Look-at point
- `up` (vec3): Up vector for orientation
- `fov` (float): Field of view in degrees [10-170]
- `aperture` (float): Lens aperture for DOF [0-1]
- `focal_distance` (float): Focus distance

## Optimized Implementation Example

```glsl
// pinhole.glsl - Using precomputed matrices
Ray generate_ray(vec2 pixel, vec2 xi) {
  // Add jitter for antialiasing
  vec2 jittered = pixel + xi;
  
  // Normalize to [-1,1] with aspect ratio
  vec2 ndc = (jittered - 0.5 * u_resolution) / u_resolution.y;
  
  // Generate ray direction using precomputed frame
  vec3 local_dir = vec3(ndc * u_camera_tan_fov, 1.0);
  vec3 world_dir = normalize(u_camera_frame * local_dir);
  
  return Ray(u_camera_position, world_dir);
}
```

### Thin Lens Camera (with DOF)
```glsl
// thin_lens.glsl - Depth of field
Ray generate_ray(vec2 pixel, vec2 xi) {
  // Sample point on lens
  vec2 lens_xi = next_2d();  // Automatic dimension tracking
  vec2 lens_sample = sample_disk(lens_xi) * u_camera_aperture;
  
  // Compute ray to focal plane
  vec2 ndc = (pixel + xi - 0.5 * u_resolution) / u_resolution.y;
  vec3 focal_dir = vec3(ndc * u_camera_tan_fov, 1.0);
  vec3 focal_point = u_camera_position + 
                     normalize(u_camera_frame * focal_dir) * u_camera_focal_distance;
  
  // Ray from lens sample to focal point
  vec3 lens_pos = u_camera_position + 
                  u_camera_frame * vec3(lens_sample, 0.0);
  vec3 ray_dir = normalize(focal_point - lens_pos);
  
  return Ray(lens_pos, ray_dir);
}
```

## Random Sampling

Use automatic dimension tracking:
```glsl
// DON'T: Manual dimension tracking
int dim = 0;
vec2 xi1 = sample_2d(pixel_id, sample_id, dim++);

// DO: Automatic tracking
vec2 xi1 = next_2d();  // Automatically increments
vec2 xi2 = next_2d();  // Next dimension
```

## Module ID Convention

```typescript
{
  id: {
    kind: "Camera",
    name: "YourCameraName",  // "Pinhole", "ThinLens", etc.
    version: "1.0.0"
  }
}
```

## Available Infrastructure

Cameras have access to:
- Math functions from `math/core.glsl`
- Automatic sampling: `next_2d()`, `next_3d()`, etc.
- Types: `Ray`, `Point`, `Direction` (from Geometry)
- Engine uniforms: `u_resolution`, `u_frame_index`
- Precomputed camera matrices

## Implementation Notes

- Ray directions must be normalized
- Use precomputed `u_camera_frame` instead of rebuilding coordinate frame
- Use `u_camera_tan_fov` instead of computing tan(fov) per ray
- The `xi` parameter enables antialiasing - use it to jitter ray origins
- For depth of field, sample points on lens aperture using `next_2d()`
- Camera matrices are updated by engine when camera moves
