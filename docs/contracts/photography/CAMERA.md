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

## Implementation Example

```glsl
// pinhole.glsl
uniform vec3 position;
uniform vec3 target;
uniform vec3 up;
uniform float fov;

Ray generate_ray(vec2 pixel, vec2 xi) {
  // Add jitter for antialiasing
  vec2 jittered = pixel + xi;
  
  // Normalize to [-1,1] with aspect ratio
  vec2 ndc = (jittered - 0.5 * u_resolution) / u_resolution.y;
  
  // Build camera frame
  vec3 forward = normalize(target - position);
  vec3 right = normalize(cross(up, forward));
  vec3 up_fixed = cross(forward, right);
  
  // Generate ray
  float tan_fov = tan(radians(fov) * 0.5);
  vec3 direction = normalize(
    forward + (right * ndc.x + up_fixed * ndc.y) * tan_fov
  );
  
  return Ray(position, direction);
}
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
- Sampling functions: `sample_2d()`, `sample_disk()`, etc.
- Types: `Ray`, `Point`, `Direction` (from Geometry)
- Engine uniforms: `u_resolution`, `u_frame_index`

## Implementation Notes

- Ray directions must be normalized
- Consider aspect ratio when computing ray directions
- The `xi` parameter enables antialiasing - use it to jitter ray origins
- For depth of field, sample points on lens aperture
- Camera matrices can be precomputed from position/target/up
