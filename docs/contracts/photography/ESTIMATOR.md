# Estimator Module Contract

Estimators compute radiance along rays by simulating light transport.

## Required Functions

### estimate
```glsl
vec3 estimate(Ray ray)
```
Estimate radiance along the given ray.

**Parameters:**
- `ray`: Ray to trace (from camera)

**Returns:** RGB radiance value

**Note:** Function will be auto-prefixed to `e_estimate` in compiled shader.

## Optional Functions

### estimate_direct
```glsl
vec3 estimate_direct(Hit hit, Direction wo)
```
Compute only direct lighting contribution (for splitting techniques).

### estimate_indirect
```glsl
vec3 estimate_indirect(Hit hit, Direction wo)
```
Compute only indirect lighting contribution.

### get_pdf
```glsl
float get_pdf(Direction wi, Direction wo, Hit hit)
```
Return sampling PDF for multiple importance sampling.

## Available Functions

Estimators can use these functions from other modules (no prefixes needed - engine resolves them):

**From World/Geometry:**
- `geodesic(origin, direction, t)` → `g_geodesic`
- `dot(v1, v2, point)` → `g_dot`
- `parallel_transport(from, to)` → `g_parallel_transport`

**From World/Scene:**
- `intersect(ray, hit)` → `sc_intersect`
- `intersect_any(ray, max_t)` → `sc_intersect_any`

**From World/Material:**
- `eval_bsdf(wi, wo, hit)` → `m_eval_bsdf`
- `sample_bsdf(wi, hit, xi)` → `m_sample_bsdf`
- `pdf_bsdf(wi, wo, hit)` → `m_pdf_bsdf`

**From World/Lights:**
- `sample_light(point, xi)` → `l_sample_light`
- `eval_light(point, direction)` → `l_eval_light`

**From Infrastructure:**
- `sample_2d(pixel_id, sample_id, dimension)`
- `sample_sphere(pixel_id, sample_id, dimension)`
- `sample_hemisphere(normal, pixel_id, sample_id, dimension)`

## Common Parameters

```glsl
// You write:
uniform int max_bounces;      // → u_estimator_[name]_max_bounces
uniform float rr_threshold;   // → u_estimator_[name]_rr_threshold
```

Common estimator parameters:
- `max_bounces` (int): Maximum path length [1-100]
- `rr_threshold` (float): Russian roulette threshold [0-1]
- `nee_enabled` (bool): Use next event estimation
- `mis_enabled` (bool): Use multiple importance sampling

## Dimension Tracking

Track dimension locally to avoid correlation:

```glsl
vec3 estimate(Ray ray) {
  ivec2 pixel_id = ivec2(gl_FragCoord.xy);
  int dim = 0;  // Local dimension counter
  
  vec3 throughput = vec3(1.0);
  vec3 radiance = vec3(0.0);
  
  for (int bounce = 0; bounce < max_bounces; bounce++) {
    Hit hit;
    if (!intersect(ray, hit)) {
      // Sample environment
      break;
    }
    
    // Sample BSDF direction
    vec2 xi = sample_2d(pixel_id, u_frame_index, dim++);
    Direction wi = sample_bsdf(-ray.d, hit, xi);
    
    // Continue path
    throughput *= eval_bsdf(-ray.d, wi, hit);
    ray = Ray(hit.p, wi);
  }
  
  return radiance;
}
```

## Special Estimators

### Debug Visualization
Debug estimators return scene properties instead of radiance:

```glsl
// Normal visualization
vec3 estimate(Ray ray) {
  Hit hit;
  if (intersect(ray, hit)) {
    return hit.n * 0.5 + 0.5;  // Remap [-1,1] to [0,1]
  }
  return vec3(0.0);
}
```

Common debug modes:
- **Normals**: Surface normal direction
- **Depth**: Distance to first hit
- **UV**: Texture coordinates
- **MaterialID**: Different color per material
- **AO**: Ambient occlusion

## Implementation Example

```glsl
// path_tracer.glsl
uniform int max_bounces;

vec3 estimate(Ray ray) {
  ivec2 pixel_id = ivec2(gl_FragCoord.xy);
  int dim = 0;
  
  vec3 throughput = vec3(1.0);
  vec3 radiance = vec3(0.0);
  
  for (int bounce = 0; bounce < max_bounces; bounce++) {
    Hit hit;
    if (!intersect(ray, hit)) {
      // Sky/environment
      radiance += throughput * vec3(0.5, 0.7, 1.0);
      break;
    }
    
    // Direct lighting (NEE)
    if (bounce == 0) {
      vec2 xi_light = sample_2d(pixel_id, u_frame_index, dim++);
      LightSample ls = sample_light(hit.p, xi_light);
      
      if (!intersect_any(Ray(hit.p, ls.direction), ls.distance)) {
        float cos_theta = max(0.0, dot(ls.direction, hit.n, hit.p));
        radiance += throughput * eval_bsdf(-ray.d, ls.direction, hit) 
                   * ls.radiance * cos_theta / ls.pdf;
      }
    }
    
    // Sample next direction
    vec2 xi = sample_2d(pixel_id, u_frame_index, dim++);
    Direction wi = sample_bsdf(-ray.d, hit, xi);
    
    // Update throughput
    float cos_theta = max(0.0, dot(wi, hit.n, hit.p));
    throughput *= eval_bsdf(-ray.d, wi, hit) * cos_theta 
                  / pdf_bsdf(-ray.d, wi, hit);
    
    // Russian roulette
    if (bounce > 3) {
      float p = min(1.0, max_component(throughput));
      if (sample_1d(pixel_id, u_frame_index, dim++) > p) break;
      throughput /= p;
    }
    
    ray = Ray(hit.p, wi);
  }
  
  return radiance;
}
```

## Module ID Convention

```typescript
{
  id: {
    kind: "Estimator",
    name: "YourEstimatorName",  // "PathTracer", "Direct", etc.
    version: "1.0.0"
  }
}
```
