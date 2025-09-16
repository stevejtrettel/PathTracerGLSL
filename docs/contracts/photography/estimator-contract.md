# Estimator Module Contract

Estimators calculate radiance by tracing paths through the scene.

## Required Functions

### e_estimate
```glsl
vec3 e_estimate(vec2 pixel)
```
Main integration function - estimates radiance for a pixel.

**Parameters:**
- `pixel`: Pixel coordinates

**Returns:** RGB radiance

**Example:**
```glsl
vec3 e_estimate(vec2 pixel) {
  // Get samples from sampler
  vec2 xi = s_sample_2d(ivec2(pixel), u_frame_index, 0);
  
  // Generate ray from camera
  Ray ray = c_generate_ray(pixel, xi);
  
  // Trace path and accumulate radiance
  vec3 radiance = trace_path(ray);
  
  return radiance;
}
```

## Optional Functions

### e_estimate_direct
```glsl
vec3 e_estimate_direct(Hit hit, vec3 wo)
```
Separate direct lighting calculation (for splitting techniques).

### e_estimate_indirect
```glsl
vec3 e_estimate_indirect(Hit hit, vec3 wo)  
```
Separate indirect lighting calculation.

### e_get_pdf
```glsl
float e_get_pdf(vec3 wi, vec3 wo, Hit hit)
```
PDF for importance sampling (for MIS).

## Available Functions from Other Modules

Estimators typically use:
- `c_generate_ray()` - from Camera
- `s_sample_*()` - from Sampler
- `s_intersect()` - from Scene (World)
- `m_eval()`, `m_sample()` - from Material (World)
- `g_geodesic()` - from Geometry (World)

## Common Parameters

- `max_bounces` (int): Path length
- `rr_threshold` (float): Russian roulette threshold
- `nee_samples` (int): Next event estimation samples

## Special Estimators

### Debug Estimators
Debug estimators visualize scene properties instead of computing radiance:

```glsl
// Normal visualization
vec3 e_estimate(vec2 pixel) {
  Ray ray = c_generate_ray(pixel, vec2(0.5));
  Hit hit;
  if (s_intersect(ray, hit)) {
    return hit.n * 0.5 + 0.5;  // Remap [-1,1] to [0,1]
  }
  return vec3(0);
}
```

### Common Debug Modes
- **Normals**: Visualize surface normals
- **Depth**: Distance to first hit
- **UV**: Texture coordinates
- **Material ID**: Different colors per material
- **Curvature**: Geometric curvature

## Module ID Convention

```typescript
id: { kind: "Estimator", name: "YourEstimatorName", version: "1.0.0" }
```

## Implementation Notes

- Use sampler for all random decisions to maintain determinism
- Track dimension counter to avoid correlation
- Consider early termination with Russian roulette
- Handle edge cases (no intersection, zero contribution)
