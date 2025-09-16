# Film Module Contract

Films accumulate samples over multiple frames to reduce noise.

## Required Functions

### accumulate
```glsl
vec3 accumulate(vec3 new_sample, vec2 pixel)
```
Combine new sample with accumulated history.

**Parameters:**
- `new_sample`: Current frame's radiance from estimator
- `pixel`: Pixel coordinates for history lookup

**Returns:** Accumulated color value

**Note:** Function will be auto-prefixed to `f_accumulate` in compiled shader.

## Optional Functions

### compute_variance
```glsl
float compute_variance(vec2 pixel)
```
Compute per-pixel variance for adaptive sampling.

### should_continue
```glsl
bool should_continue(vec2 pixel)
```
Determine if pixel needs more samples (for adaptive sampling).

### reset
```glsl
void reset(vec2 pixel)
```
Clear accumulation for this pixel (called on parameter changes).

## Engine-Provided Resources

Films have access to persistent buffers:

```glsl
// Previous frame's accumulated radiance
uniform sampler2D u_film_radiance;

// Variance estimate (if tracking)
uniform sampler2D u_film_variance;

// Sample count per pixel
uniform isampler2D u_film_samples;

// General purpose auxiliary buffer
uniform sampler2D u_film_auxiliary;

// Global sample count (same for all pixels)
uniform int u_sample_count;
```

## Common Parameters

```glsl
// You write:
uniform float alpha;           // → u_film_[name]_alpha
uniform float variance_clamp;  // → u_film_[name]_variance_clamp
```

Common film parameters:
- `alpha` (float): Blend factor for exponential average [0-1]
- `variance_clamp` (float): Maximum variance threshold
- `firefly_threshold` (float): Outlier rejection threshold

## Implementation Patterns

### Passthrough (No Accumulation)
For realtime rendering without accumulation:

```glsl
vec3 accumulate(vec3 new_sample, vec2 pixel) {
  return new_sample;
}
```

### Simple Average
Standard Monte Carlo accumulation:

```glsl
vec3 accumulate(vec3 new_sample, vec2 pixel) {
  vec2 uv = pixel / u_resolution;
  vec3 history = texture(u_film_radiance, uv).rgb;
  
  float count = float(u_sample_count);
  return mix(history, new_sample, 1.0 / (count + 1.0));
}
```

### Variance Tracking
Track variance for adaptive sampling:

```glsl
uniform sampler2D u_film_m2;  // Sum of squared differences

vec3 accumulate(vec3 new_sample, vec2 pixel) {
  vec2 uv = pixel / u_resolution;
  vec3 old_mean = texture(u_film_radiance, uv).rgb;
  vec3 old_m2 = texture(u_film_m2, uv).rgb;
  
  float count = float(u_sample_count);
  
  // Welford's online algorithm
  vec3 delta = new_sample - old_mean;
  vec3 new_mean = old_mean + delta / (count + 1.0);
  vec3 delta2 = new_sample - new_mean;
  vec3 new_m2 = old_m2 + delta * delta2;
  
  // Store M2 in auxiliary buffer for next frame
  // (Would need multi-target rendering)
  
  return new_mean;
}

float compute_variance(vec2 pixel) {
  vec2 uv = pixel / u_resolution;
  vec3 m2 = texture(u_film_m2, uv).rgb;
  float count = float(u_sample_count);
  
  if (count < 2.0) return 1.0;
  
  vec3 variance = m2 / (count - 1.0);
  return length(variance);
}
```

### Exponential Moving Average
Recent samples weighted more heavily:

```glsl
uniform float alpha;

vec3 accumulate(vec3 new_sample, vec2 pixel) {
  vec2 uv = pixel / u_resolution;
  vec3 history = texture(u_film_radiance, uv).rgb;
  
  // First frame has no history
  if (u_sample_count == 0) {
    return new_sample;
  }
  
  return mix(history, new_sample, alpha);
}
```

## Numerical Considerations

- For thousands of samples, consider numerical stability
- Use incremental mean updates rather than sum/count
- Clamp extreme values to prevent fireflies
- Consider using log-space accumulation for HDR

## Module ID Convention

```typescript
{
  id: {
    kind: "Film",
    name: "YourFilmName",  // "SimpleAverage", "Variance", etc.
    version: "1.0.0"
  }
}
```

## Available Infrastructure

Films have access to:
- Previous frame buffers via textures
- Math functions from `math/core.glsl`
- Engine uniforms: `u_resolution`, `u_sample_count`

## Implementation Notes

- Pixel coordinates are in screen space [0, resolution]
- Convert to UV coordinates [0,1] for texture lookups
- First frame (u_sample_count == 0) has no history
- Consider firefly rejection for outliers
- Variance tracking requires additional buffers
