# Camera Module Contract

Cameras generate rays from image coordinates.

## Required Functions

### c_generate_ray
```glsl
Ray c_generate_ray(vec2 pixel, vec2 xi)
```
Generate a ray from pixel coordinates with random offset.

**Parameters:**
- `pixel`: Pixel coordinates in screen space [0, resolution]
- `xi`: Random offset in [0,1]² for antialiasing

**Returns:** Ray in world space

**Example:**
```glsl
Ray c_generate_ray(vec2 pixel, vec2 xi) {
  vec2 ndc = ((pixel + xi) - 0.5 * u_resolution) / u_resolution.y;
  vec3 direction = normalize(forward + (right * ndc.x + up * ndc.y) * tan_fov);
  return Ray(position, direction);
}
```

## Optional Functions

### c_get_pdf
```glsl
float c_get_pdf(Ray ray)
```
Probability density of generating this ray (for bidirectional methods).

### c_get_frame
```glsl
Frame c_get_frame()
```
Camera coordinate frame.

### c_get_focal_distance
```glsl
float c_get_focal_distance()
```
Focus distance (for DOF visualization).

## Common Parameters

- `position` (vec3): Camera location
- `target` (vec3): Look-at point
- `up` (vec3): Up vector
- `fov` (float): Field of view in degrees
- `aperture` (float): Lens aperture for DOF
- `focal_distance` (float): Focus distance

## Module ID Convention

```typescript
id: { kind: "Camera", name: "YourCameraName", version: "1.0.0" }
```

## Implementation Notes

- Rays should have normalized directions
- Consider aspect ratio when generating rays
- xi parameter enables antialiasing via random sampling
- Camera matrices can be computed from position/target/up
