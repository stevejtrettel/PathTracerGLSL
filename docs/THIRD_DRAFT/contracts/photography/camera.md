# Camera Contract

## Module Structure

```typescript
{
  id: {
    kind: 'camera',
    name: string,              // 'pinhole' | 'thin_lens' | 'orthographic'
    version: string
  },
  fragment: {
    functions: string,         // Ray generation implementation
    uniforms: string          // Camera parameters
  },
  parameters: Array<{
    name: string,             // Without prefix (engine adds c_[name]_)
    type: string,
    default: any,
    uniform: boolean
  }>
}
```

## Required Functions

### generate_ray
```glsl
Ray camera_generate_ray(vec2 pixel, vec2 xi)
```
- **pixel**: Screen coordinates [0, u_resolution]
- **xi**: Random offset [0,1]² for antialiasing
- **returns**: Ray in world space
- Direction must be normalized
- Note: Engine will auto-prefix to `c_generate_ray`

## Optional Functions

```glsl
float camera_get_pdf(Ray ray)                    // For bidirectional methods
Frame camera_get_frame()                          // Camera coordinate frame  
float camera_get_focal_distance()                 // Focus distance
vec2 camera_get_aperture()                       // Lens dimensions
```

## Engine-Provided Uniforms

```glsl
// Precomputed once per frame by engine
uniform mat3 u_camera_frame;       // [right, up, forward] columns
uniform vec3 u_camera_position;    // Camera world position
uniform float u_camera_tan_fov;    // tan(fov * 0.5)

// Resolution (from engine)
uniform vec2 u_resolution;         // Screen dimensions

// Module-specific (examples if we need them)
uniform vec3 u_camera_[name]_target;
uniform float u_camera_[name]_aperture;
uniform float u_camera_[name]_focal_distance;
```

## Implementation: Pinhole

```glsl
Ray generate_ray(vec2 pixel, vec2 xi) {
  // Jittered pixel for antialiasing
  vec2 jittered = pixel + xi;
  
  // NDC coordinates with aspect ratio
  vec2 ndc = (jittered - 0.5 * u_resolution) / u_resolution.y;
  
  // Generate ray using precomputed frame
  vec3 local_dir = vec3(ndc * u_camera_tan_fov, 1.0);
  vec3 world_dir = normalize(u_camera_frame * local_dir);
  
  return make_ray(u_camera_position, world_dir);
}
```

## Implementation: Thin Lens

```glsl
uniform float u_camera_thin_lens_aperture;
uniform float u_camera_thin_lens_focal_distance;

Ray generate_ray(vec2 pixel, vec2 xi) {
  // NDC coordinates
  vec2 ndc = (pixel + xi - 0.5 * u_resolution) / u_resolution.y;
  
  // Ray to focal plane
  vec3 focal_dir = vec3(ndc * u_camera_tan_fov, 1.0);
  vec3 focal_point = u_camera_position + 
                     normalize(u_camera_frame * focal_dir) * 
                     u_camera_thin_lens_focal_distance;
  
  // Sample lens
  vec2 lens_sample = sample_unit_disk(next_2d()) * u_camera_thin_lens_aperture;
  vec3 lens_pos = u_camera_position + 
                  u_camera_frame * vec3(lens_sample, 0.0);
  
  return make_ray(lens_pos, normalize(focal_point - lens_pos));
}
```

## Implementation: Orthographic

```glsl
uniform float u_camera_ortho_size;

Ray generate_ray(vec2 pixel, vec2 xi) {
  // Normalized device coordinates
  vec2 ndc = (pixel + xi - 0.5 * u_resolution) / u_resolution;
  ndc = (ndc - 0.5) * 2.0;  // [-1, 1]
  
  // Scale by orthographic size
  vec2 offset = ndc * u_camera_ortho_size;
  
  // Ray origin offset from camera position
  vec3 origin = u_camera_position + 
                u_camera_frame * vec3(offset, 0.0);
  
  // Parallel rays along forward direction
  vec3 direction = u_camera_frame * vec3(0, 0, 1);
  
  return make_ray(origin, direction);
}
```

## Common Parameters

| Parameter | Type | Range | Description |
|-----------|------|-------|-------------|
| position | vec3 | - | Camera location |
| target | vec3 | - | Look-at point |
| up | vec3 | - | Up vector |
| fov | float | [10, 170] | Field of view (degrees) |
| aperture | float | [0, 1] | Lens aperture size |
| focal_distance | float | [0.1, ∞] | Focus distance |

## Performance Notes

1. Use precomputed `u_camera_frame` instead of rebuilding
2. Use precomputed `u_camera_tan_fov` instead of tan(fov)
3. Ray directions must be normalized once
4. Use xi parameter for antialiasing (don't ignore it)
5. Sample lens with next_2d() for DOF

## Validation

1. Ray direction must be unit vector
2. Ray origin must be valid Point
3. xi parameter must affect ray generation
4. Camera frame vectors must be orthonormal
5. FOV must be in valid range
