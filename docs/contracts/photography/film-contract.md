# Film Module Contract

Films accumulate samples over multiple frames.

## Required Functions

### f_accumulate
```glsl
vec3 f_accumulate(vec3 new_sample, vec2 pixel)
```
Accumulate a new sample with history.

**Parameters:**
- `new_sample`: Current frame's radiance
- `pixel`: Pixel coordinates

**Returns:** Accumulated color

**Note:** The film has access to history via engine-provided textures.

## Engine-Provided Uniforms

```glsl
uniform sampler2D u_film_radiance;   // Previous accumulated radiance
uniform sampler2D u_film_variance;   // Variance estimate (optional use)
uniform isampler2D u_film_samples;   // Sample count per pixel
uniform sampler2D u_film_auxiliary;  // General purpose buffer
```

## Optional Functions

### f_compute_variance
```glsl
float f_compute_variance(vec2 pixel)
```
Compute variance for adaptive sampling.

### f_should_continue
```glsl
bool f_should_continue(vec2 pixel)
```
Decide if pixel needs more samples.

### f_get_weight
```glsl
float f_get_weight(int sample_count)
```
Weight for new sample (for special accumulation strategies).

## Implementation Examples

### Passthrough (No Accumulation)
```glsl
vec3 f_accumulate(vec3 new_sample, vec2 pixel) {
  return new_sample;  // For realtime rendering
}
```

### Simple Average
```glsl
vec3 f_accumulate(vec3 new_sample, vec2 pixel) {
  vec3 history = texture(u_film_radiance, pixel / u_resolution).rgb;
  float count = float(u_sample_count);
  return mix(history, new_sample, 1.0 / (count + 1.0));
}
```

### Exponential Moving Average
```glsl
vec3 f_accumulate(vec3 new_sample, vec2 pixel) {
  vec3 history = texture(u_film_radiance, pixel / u_resolution).rgb;
  float alpha = 0.1;  // Blend factor
  return mix(history, new_sample, alpha);
}
```

### Variance Tracking
```glsl
vec3 f_accumulate(vec3 new_sample, vec2 pixel) {
  vec2 uv = pixel / u_resolution;
  vec3 history = texture(u_film_radiance, uv).rgb;
  vec2 variance = texture(u_film_variance, uv).rg;
  
  float count = float(u_sample_count);
  vec3 new_mean = mix(history, new_sample, 1.0 / (count + 1.0));
  
  // Update variance (Welford's algorithm)
  vec3 delta = new_sample - history;
  vec2 new_variance = variance + delta.rg * delta.rg / (count + 1.0);
  
  // Store variance in auxiliary buffer
  // ...
  
  return new_mean;
}
```

## Module ID Convention

```typescript
id: { kind: "Film", name: "YourFilmName", version: "1.0.0" }
```

## Implementation Notes

- Films work with normalized pixel coordinates [0,1]
- History buffers persist between frames
- Sample count is managed by the engine
- Consider numerical stability for long accumulations
