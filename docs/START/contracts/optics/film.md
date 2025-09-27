# Film Contract

## Module Structure

```typescript
{
  id: {
    kind: 'film',
    name: string,              // 'simple' | 'variance' | 'adaptive'
    version: string
  },
  fragment: {
    functions: string,         // Accumulation implementation
    uniforms: string          // Film parameters
  },
  resources: Array<{
    name: string,             // Buffer name
    type: 'texture2D',
    format: 'rgba32f' | 'rgba16f' | 'r32i'
  }>
}
```

## Required Functions

### accumulate
```glsl
Radiance film_accumulate(Spectrum new_sample, vec2 pixel)
```
- **new_sample**: Current frame's spectral radiance from estimator
- **pixel**: Screen coordinates [0, u_resolution]
- **returns**: Accumulated radiance
- Handles reset when `u_film_reset` is true
- Note: Engine will auto-prefix to `f_accumulate`

## Optional Functions

```glsl
float film_compute_variance(vec2 pixel)      // Per-pixel variance
bool film_should_continue(vec2 pixel)        // Adaptive sampling
void film_reset(vec2 pixel)                  // Clear accumulation
Radiance film_get_auxiliary(vec2 pixel)      // Access aux buffers
```

## Engine Resources

```glsl
// Previous frame buffers (persistent)
uniform sampler2D u_film_radiance;     // Accumulated color
uniform sampler2D u_film_variance;     // Variance estimate
uniform isampler2D u_film_samples;     // Sample count per pixel
uniform sampler2D u_film_auxiliary;    // General purpose

// Engine state
uniform int u_sample_count;            // Global sample count
uniform bool u_film_reset;             // Parameter change flag
```

## Implementation: Simple Average

```glsl
Radiance accumulate(Spectrum new_sample, vec2 pixel) {
  if (u_film_reset || u_sample_count == 0) {
    return Radiance(new_sample);  // Convert Spectrum to Radiance
  }
  
  vec2 uv = pixel / u_resolution;
  Radiance history = texture(u_film_radiance, uv).rgb;
  
  float count = float(u_sample_count);
  return mix(history, Radiance(new_sample), 1.0 / (count + 1.0));
}
```

## Implementation: Variance Tracking

```glsl
// Using Welford's online algorithm
Radiance accumulate(Spectrum new_sample, vec2 pixel) {
  vec2 uv = pixel / u_resolution;
  
  if (u_film_reset || u_sample_count == 0) {
    // Store initial mean in radiance, zero in variance
    return Radiance(new_sample);
  }
  
  Radiance old_mean = texture(u_film_radiance, uv).rgb;
  Radiance old_m2 = texture(u_film_variance, uv).rgb;
  
  float count = float(u_sample_count);
  
  // Update mean and M2
  Radiance delta = Radiance(new_sample) - old_mean;
  Radiance new_mean = old_mean + delta / (count + 1.0);
  Radiance delta2 = Radiance(new_sample) - new_mean;
  Radiance new_m2 = old_m2 + delta * delta2;
  
  // Store M2 in auxiliary (requires MRT)
  // Variance = M2 / (count - 1)
  
  return new_mean;
}

float compute_variance(vec2 pixel) {
  vec2 uv = pixel / u_resolution;
  Radiance m2 = texture(u_film_variance, uv).rgb;
  float count = float(u_sample_count);
  
  if (count < 2.0) return 1.0;
  
  Radiance variance = m2 / (count - 1.0);
  return length(variance);
}
```

## Implementation: Exponential Average

```glsl
uniform float u_film_ema_alpha;  // Blend factor [0,1]

Radiance accumulate(Spectrum new_sample, vec2 pixel) {
  if (u_film_reset || u_sample_count == 0) {
    return Radiance(new_sample);
  }
  
  vec2 uv = pixel / u_resolution;
  Radiance history = texture(u_film_radiance, uv).rgb;
  
  return mix(history, Radiance(new_sample), u_film_ema_alpha);
}
```

## Implementation: Firefly Rejection

```glsl
uniform float u_film_firefly_threshold;

Radiance accumulate(Spectrum new_sample, vec2 pixel) {
  if (u_film_reset || u_sample_count == 0) {
    return Radiance(new_sample);
  }
  
  vec2 uv = pixel / u_resolution;
  Radiance history = texture(u_film_radiance, uv).rgb;
  
  // Reject outliers
  float lum = luminance(Radiance(new_sample));
  float history_lum = luminance(history);
  
  Radiance sample_radiance = Radiance(new_sample);
  if (lum > u_film_firefly_threshold * history_lum) {
    // Clamp outlier
    sample_radiance *= (u_film_firefly_threshold * history_lum / lum);
  }
  
  float count = float(u_sample_count);
  return mix(history, sample_radiance, 1.0 / (count + 1.0));
}
```

## Implementation: Adaptive Sampling

```glsl
uniform float u_film_variance_threshold;

vec3 f_accumulate(vec3 new_sample, vec2 pixel) {
  // Standard accumulation
  vec3 result = accumulate_with_variance(new_sample, pixel);
  
  // Mark pixel as converged in auxiliary buffer
  if (f_compute_variance(pixel) < u_film_variance_threshold) {
    // Store convergence flag
  }
  
  return result;
}

bool f_should_continue(vec2 pixel) {
  return f_compute_variance(pixel) >= u_film_variance_threshold;
}
```

## Reset Handling

Films must handle parameter changes:

```glsl
vec3 f_accumulate(vec3 new_sample, vec2 pixel) {
  // Always check reset flag first
  if (u_film_reset) {
    // Clear all buffers and start fresh
    return new_sample;
  }
  
  // Normal accumulation...
}
```

## Resource Manifest

Films declare required buffers:

```typescript
{
  resources: [
    { name: "radiance", type: "texture2D", format: "rgba32f" },
    { name: "variance", type: "texture2D", format: "rgba32f" },
    { name: "samples", type: "texture2D", format: "r32i" }
  ]
}
```

## Numerical Stability

For high sample counts:

```glsl
// Use incremental mean update
vec3 incremental_mean(vec3 old_mean, vec3 new_sample, float n) {
  return old_mean + (new_sample - old_mean) / n;
}

// Avoid catastrophic cancellation
vec3 stable_variance(vec3 m2, float n) {
  return (n > 1.0) ? m2 / (n - 1.0) : vec3(0);
}
```

## Common Parameters

| Parameter | Type | Range | Description |
|-----------|------|-------|-------------|
| alpha | float | [0, 1] | EMA blend factor |
| variance_clamp | float | [0, ∞] | Max variance |
| firefly_threshold | float | [1, 100] | Outlier ratio |
| convergence_threshold | float | [0, 1] | Variance threshold |

## Performance Notes

1. Check `u_film_reset` before any texture reads
2. Convert pixel to UV once: `pixel / u_resolution`
3. Use mix() for blending (optimized on GPU)
4. Consider numerical stability for 1000+ samples
5. Firefly rejection prevents bright pixel artifacts

## Validation

1. Handle `u_film_reset` flag correctly
2. First frame (u_sample_count == 0) has no history
3. Pixel coordinates in [0, u_resolution]
4. UV coordinates in [0, 1]
5. Variance non-negative
6. Accumulated values remain finite
