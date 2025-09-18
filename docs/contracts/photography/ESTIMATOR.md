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
- `intersect(ray, hit)` → `sc_intersect` (returns Hit with precomputed frame)
- `intersect_any(ray, max_t)` → `sc_intersect_any`

**From World/Material (Batched operations):**
- `interact(wi, hit, xi, wo, pdf)` → `m_interact` (samples and evaluates in one call)
- `eval(wi, wo, hit)` → `m_eval` (for MIS)
- `pdf(wi, wo, hit)` → `m_pdf` (for MIS)

**From World/Lights:**
- `sample_light(point, xi)` → `l_sample_light`
- `eval_light(point, direction)` → `l_eval_light`
- `pdf_light(point, direction)` → `l_pdf_light`

**From Infrastructure (Automatic dimension tracking):**
- `next_1d()` - Get next random float
- `next_2d()` - Get next random vec2
- `next_3d()` - Get next random vec3

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

## Random Sampling

Use automatic dimension tracking:

```glsl
vec3 estimate(Ray ray) {
  vec3 throughput = vec3(1.0);
  vec3 radiance = vec3(0.0);
  
  for (int bounce = 0; bounce < max_bounces; bounce++) {
    Hit hit;
    if (!intersect(ray, hit)) {
      // Sample environment
      break;
    }
    
    // Use automatic dimension tracking
    vec2 xi = next_2d();  // Automatically increments
    
    // Use batched BSDF operation
    Direction wo;
    float pdf;
    vec3 contribution = interact(-ray.d, hit, xi, wo, pdf);
    
    // Continue path
    throughput *= contribution;  // Already includes BSDF * cos / pdf
    ray = Ray(hit.p, wo);
  }
  
  return radiance;
}
```

## Efficient Material Interaction

Use batched operations when possible:

```glsl
// EFFICIENT: Single batched call for sampling
Direction wo;
float pdf;
vec3 contribution = interact(wi, hit, next_2d(), wo, pdf);
throughput *= contribution;  // Includes BSDF * cos(θ) / pdf

// ONLY when needed for MIS: Separate evaluation
vec3 bsdf_value = eval(wi, wo, hit);
float bsdf_pdf = pdf(wi, wo, hit);
```

## Using Precomputed Frame

The Hit structure includes a precomputed frame:

```glsl
vec3 estimate(Ray ray) {
  Hit hit;
  if (!intersect(ray, hit)) {
    return environment_radiance(ray.d);
  }
  
  // Use precomputed frame - no need to call g_frame()
  Frame frame = hit.frame;
  
  // Local space operations
  vec3 local_wi = world_to_local(-ray.d, frame);
  // ...
}
```

## Special Estimators

### Debug Visualization
Debug estimators return scene properties instead of radiance:

```glsl
// Normal visualization using precomputed frame
vec3 estimate(Ray ray) {
  Hit hit;
  if (intersect(ray, hit)) {
    // Could also visualize frame axes
    // return hit.frame.t * 0.5 + 0.5;  // Tangent
    return hit.n * 0.5 + 0.5;  // Normal
  }
  return vec3(0.0);
}
```

Common debug modes:
- **Normals**: Surface normal direction
- **Frame**: Tangent/bitangent/normal as RGB
- **Depth**: Distance to first hit
- **UV**: Texture coordinates
- **MaterialID**: Different color per material
- **AO**: Ambient occlusion

## Implementation Example

```glsl
// path_tracer.glsl - Optimized implementation
uniform int max_bounces;

vec3 estimate(Ray ray) {
  vec3 throughput = vec3(1.0);
  vec3 radiance = vec3(0.0);
  
  for (int bounce = 0; bounce < max_bounces; bounce++) {
    Hit hit;
    if (!intersect(ray, hit)) {
      // Sky/environment
      radiance += throughput * vec3(0.5, 0.7, 1.0);
      break;
    }
    
    // Direct lighting (NEE) - skip for delta materials
    if (bounce == 0 && !is_delta(hit)) {
      LightSample ls = sample_light(hit.p, next_2d());
      
      if (!intersect_any(Ray(hit.p, ls.direction), ls.distance)) {
        // Use separate eval for MIS
        vec3 bsdf = eval(-ray.d, ls.direction, hit);
        float cos_theta = max(0.0, dot(ls.direction, hit.n, hit.p));
        radiance += throughput * bsdf * ls.radiance * cos_theta / ls.pdf;
      }
    }
    
    // Sample next direction - batched operation
    Direction wo;
    float pdf;
    vec3 contribution = interact(-ray.d, hit, next_2d(), wo, pdf);
    
    if (pdf == 0.0) break;
    
    // Update throughput (contribution already includes cos term)
    throughput *= contribution;
    
    // Russian roulette
    if (bounce > 3) {
      float p = min(1.0, max_component(throughput));
      if (next_1d() > p) break;
      throughput /= p;
    }
    
    ray = Ray(hit.p, wo);
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

## Implementation Notes

- Use `hit.frame` instead of computing `g_frame(hit.p, hit.n)`
- Use `next_2d()` instead of manual dimension tracking
- Use `interact()` for batched material sampling when possible
- Only use separate `eval()` and `pdf()` when needed for MIS
- Check `is_delta()` before sampling lights (skip NEE for perfect mirrors)
