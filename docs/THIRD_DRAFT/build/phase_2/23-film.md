# Phase 2.3: Working Film - Detailed Plan

## Purpose & Scope

Phase 2.3 implements a film accumulator that progressively averages samples over multiple frames. This transforms our noisy single-sample path tracer into a converging renderer that approaches the correct solution through Monte Carlo integration.

**Core Goal**: Implement progressive sample accumulation using framebuffer ping-ponging to maintain running averages without CPU readback.

## File Structure & Responsibilities

### `src/photography/film/accumulator.glsl` - Progressive Accumulation

**Purpose**: Accumulate radiance samples over time, maintaining a running average that converges to the correct image.

## Core Mathematical Foundation

### Progressive Mean Calculation

For sample N+1, the running average is:
```
avg_new = (avg_old * N + sample_new) / (N + 1)
      = avg_old * (N/(N+1)) + sample_new * (1/(N+1))
```

This formulation avoids numerical overflow for large N.

## Core Implementation

### Film State Management

```glsl
// Film uniforms for accumulation state
uniform sampler2D u_film_previous;  // Previous accumulated result
uniform int u_film_sample_count;    // Current sample count
uniform bool u_film_reset;          // Reset accumulation flag

// Accumulate a new sample
vec3 film_accumulate(vec3 radiance, vec2 pixel) {
    // Get previous accumulated value
    vec2 uv = pixel / u_resolution;
    vec3 previous = texture(u_film_previous, uv).rgb;
    
    // Check for reset
    if (u_film_reset || u_film_sample_count == 0) {
        return radiance;  // First sample
    }
    
    // Progressive averaging
    float n = float(u_film_sample_count);
    vec3 accumulated = (previous * n + radiance) / (n + 1.0);
    
    return accumulated;
}

// Alternative stable formulation for large N
vec3 film_accumulate_stable(vec3 radiance, vec2 pixel) {
    vec2 uv = pixel / u_resolution;
    vec3 previous = texture(u_film_previous, uv).rgb;
    
    if (u_film_reset || u_film_sample_count == 0) {
        return radiance;
    }
    
    // More numerically stable for large sample counts
    float n = float(u_film_sample_count);
    float weight_old = n / (n + 1.0);
    float weight_new = 1.0 / (n + 1.0);
    
    return previous * weight_old + radiance * weight_new;
}
```

### Variance Tracking (For Adaptive Sampling Later)

```glsl
// Extended accumulator with variance estimation
uniform sampler2D u_film_variance_previous;  // Running variance

// Accumulate with variance tracking (Welford's algorithm)
vec3 film_accumulate_with_variance(vec3 radiance, vec2 pixel, out float variance) {
    vec2 uv = pixel / u_resolution;
    vec4 previous_data = texture(u_film_previous, uv);
    vec3 previous_mean = previous_data.rgb;
    vec4 variance_data = texture(u_film_variance_previous, uv);
    vec3 previous_m2 = variance_data.rgb;  // Sum of squared differences
    
    if (u_film_reset || u_film_sample_count == 0) {
        variance = 0.0;
        return radiance;
    }
    
    float n = float(u_film_sample_count + 1);
    
    // Welford's online algorithm
    vec3 delta = radiance - previous_mean;
    vec3 new_mean = previous_mean + delta / n;
    vec3 delta2 = radiance - new_mean;
    vec3 new_m2 = previous_m2 + delta * delta2;
    
    // Compute variance (for display/debugging)
    vec3 var = new_m2 / n;
    variance = (var.r + var.g + var.b) / 3.0;
    
    return new_mean;
}
```

### Handling Infinite and NaN Values

```glsl
// Sanitize radiance values before accumulation
vec3 film_sanitize_radiance(vec3 radiance) {
    // Check for NaN
    if (any(isnan(radiance))) {
        return vec3(0.0);
    }
    
    // Check for infinite values
    if (any(isinf(radiance))) {
        return vec3(0.0);
    }
    
    // Clamp extreme values (firefly suppression)
    float max_value = 10000.0;
    if (any(greaterThan(radiance, vec3(max_value)))) {
        // Preserve hue but clamp intensity
        float max_component = max(max(radiance.r, radiance.g), radiance.b);
        radiance *= max_value / max_component;
    }
    
    // Remove negative values (shouldn't happen with proper BRDF)
    return max(radiance, vec3(0.0));
}

// Robust accumulation with sanitization
vec3 film_accumulate_robust(vec3 radiance, vec2 pixel) {
    // Sanitize input
    radiance = film_sanitize_radiance(radiance);
    
    // Use stable accumulation
    return film_accumulate_stable(radiance, pixel);
}
```

## Resource Management Updates

### Engine Changes Required

The Engine needs to manage framebuffers for ping-pong rendering:

```typescript
// In Engine or ResourceManager
class FilmBuffers {
  current: WebGLFramebuffer   // Being written to
  previous: WebGLFramebuffer  // Being read from
  textures: {
    current: WebGLTexture
    previous: WebGLTexture
  }
  
  swap(): void {
    // Swap current and previous
    [this.current, this.previous] = [this.previous, this.current]
    [this.textures.current, this.textures.previous] = 
      [this.textures.previous, this.textures.current]
  }
  
  clear(): void {
    // Bind and clear framebuffers
  }
}
```

### Uniform Updates

```typescript
// In SimpleCompiler or UniformManager
interface FilmUniforms {
  u_film_previous: WebGLTexture      // Previous frame
  u_film_sample_count: number        // Current count
  u_film_reset: boolean              // Reset flag
  u_resolution: [number, number]     // Screen resolution
}

// Per frame update
function updateFilmUniforms(gl: WebGL2RenderingContext, program: WebGLProgram) {
  // Bind previous frame texture
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, filmBuffers.previous)
  gl.uniform1i(gl.getUniformLocation(program, 'u_film_previous'), 0)
  
  // Update sample count
  gl.uniform1i(gl.getUniformLocation(program, 'u_film_sample_count'), sampleCount)
  
  // Reset flag (true when camera moves, etc.)
  gl.uniform1i(gl.getUniformLocation(program, 'u_film_reset'), needsReset ? 1 : 0)
}
```

## Integration with Render Loop

### Modified Main Function

```glsl
void main() {
    vec2 pixel = gl_FragCoord.xy;
    
    // Initialize RNG for this pixel and frame
    transport_init_rng(pixel, u_film_sample_count);
    
    // Generate ray
    Ray ray = camera_generateRay(pixel, u_resolution);
    
    // Trace path
    vec3 radiance = transport_trace(ray);
    
    // Accumulate sample
    vec3 accumulated = film_accumulate_robust(radiance, pixel);
    
    // Develop to display color
    vec3 color = developer_develop(accumulated);
    
    fragColor = vec4(color, 1.0);
}
```

## Convergence Monitoring

```glsl
// Estimate convergence for adaptive sampling
float film_estimate_convergence(vec2 pixel) {
    // Compare variance to mean
    vec2 uv = pixel / u_resolution;
    vec3 mean = texture(u_film_previous, uv).rgb;
    vec3 variance = texture(u_film_variance_previous, uv).rgb;
    
    // Coefficient of variation
    float mean_luminance = dot(mean, vec3(0.299, 0.587, 0.114));
    float variance_luminance = dot(variance, vec3(0.299, 0.587, 0.114));
    
    if (mean_luminance <= 0.001) {
        return 1.0;  // Dark pixels are "converged"
    }
    
    float cv = sqrt(variance_luminance) / mean_luminance;
    
    // Map CV to convergence estimate [0,1]
    return 1.0 - min(cv, 1.0);
}

// Check if pixel needs more samples
bool film_needs_more_samples(vec2 pixel, float threshold) {
    return film_estimate_convergence(pixel) < threshold;
}
```

## Testing Strategy

### Convergence Tests
```typescript
test('accumulation averages correctly', () => {
  // Render constant value multiple times
  // Should remain constant
})

test('variance decreases as 1/N', () => {
  // Measure variance over time
  // Should follow Monte Carlo convergence rate
})

test('reset clears accumulation', () => {
  // Accumulate, then reset
  // Next frame should be first sample
})
```

### Numerical Stability Tests
```typescript
test('handles large sample counts', () => {
  // Accumulate 10000+ samples
  // Should not overflow or lose precision
})

test('handles extreme values', () => {
  // Send NaN, Inf, negative values
  // Should sanitize correctly
})
```

### Visual Tests
```typescript
test('converges to ground truth', () => {
  // Simple scene with analytical solution
  // Should converge to known result
})

test('temporal stability', () => {
  // Static scene should converge smoothly
  // No flickering or popping
})
```

## Performance Considerations

### Texture Formats
```typescript
// Use float textures for accumulation
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 
              width, height, 0, gl.RGBA, gl.FLOAT, null)

// Fallback to RGBA16F if 32F not available
if (!gl.getExtension('EXT_color_buffer_float')) {
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, ...)
}
```

### Memory Requirements
- Need 2x framebuffers for ping-pong
- Optional variance buffer for adaptive sampling
- ~32MB for 1920x1080 with float32

## Success Criteria

Phase 2.3 is complete when:
1. Samples accumulate over time
2. Image converges to correct result
3. Reset clears accumulation properly
4. Numerical stability maintained
5. Variance tracking works (optional)
6. No flickering or temporal artifacts

## What We're NOT Doing in Phase 2.3

- Adaptive sampling (sample where needed)
- Temporal reprojection
- Motion vectors
- Temporal denoising
- Multi-layer accumulation
- Deep compositing
- AOVs (arbitrary output variables)
- Cryptomatte or object IDs
- Sample clamping strategies

## Connection to Phase 2.4

This accumulator provides:
- Progressive refinement
- Convergence monitoring
- Numerical stability
- Reset handling

Phase 2.4 will add:
- ParameterStore for camera/material values
- Reset triggers when parameters change
- RenderCoordinator to manage accumulation
- Progress tracking and reporting

Together, these create a complete progressive path tracer that refines the image over time.

## Common Implementation Pitfalls

```glsl
// WRONG: Accumulating in wrong color space
vec3 accumulated = pow(previous + radiance, vec3(2.2));  // No!

// WRONG: Not handling first sample
vec3 accumulated = (previous * n + radiance) / (n + 1.0);  // n could be 0!

// WRONG: Integer overflow in sample count
int n = u_film_sample_count * u_film_sample_count;  // Overflow!

// WRONG: Not clearing on reset
if (u_film_reset) accumulated = previous;  // Should be radiance!
```

## Debug Helpers

```glsl
// Visualize sample count
vec3 film_debug_sample_count(vec2 pixel) {
    float n = float(u_film_sample_count);
    
    // Color gradient based on samples
    if (n < 10.0) return vec3(1, 0, 0);      // Red: few samples
    if (n < 100.0) return vec3(1, 1, 0);     // Yellow: some samples
    if (n < 1000.0) return vec3(0, 1, 0);    // Green: many samples
    return vec3(0, 0, 1);                     // Blue: converged
}

// Visualize variance
vec3 film_debug_variance(vec2 pixel) {
    vec2 uv = pixel / u_resolution;
    vec3 variance = texture(u_film_variance_previous, uv).rgb;
    float v = (variance.r + variance.g + variance.b) / 3.0;
    
    // Heat map of variance
    return vec3(v * 10.0, 0.0, 1.0 - v * 10.0);
}
```

These debug modes help verify accumulation is working before adding the parameter system.
