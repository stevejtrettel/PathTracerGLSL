# Photography Module Validation & Common Pitfalls

## Validation Checklists

### Camera Module Validation

#### Required Function Compliance
- [ ] `generate_ray(pixel, xi)` returns valid Ray
- [ ] Ray direction is normalized: `abs(length(ray.direction) - 1.0) < EPSILON`
- [ ] Ray origin is valid Point
- [ ] Ray tmin/tmax are set correctly

#### Antialiasing
- [ ] xi parameter affects ray generation
- [ ] Rays cover pixel area uniformly with random xi
- [ ] Jittering is within pixel bounds

#### Frame Consistency
```glsl
// Camera frame must be orthonormal
mat3 frame = u_camera_frame;
assert(abs(dot(frame[0], frame[1])) < EPSILON);  // right ⊥ up
assert(abs(dot(frame[0], frame[2])) < EPSILON);  // right ⊥ forward
assert(abs(dot(frame[1], frame[2])) < EPSILON);  // up ⊥ forward
assert(abs(length(frame[0]) - 1.0) < EPSILON);
assert(abs(length(frame[1]) - 1.0) < EPSILON);
assert(abs(length(frame[2]) - 1.0) < EPSILON);
```

#### Coverage Tests
```glsl
// Test corner pixels map correctly
Ray tl = c_generate_ray(vec2(0, 0), vec2(0.5));
Ray br = c_generate_ray(u_resolution - vec2(1), vec2(0.5));
// Verify expected field of view
```

### Estimator Module Validation

#### Energy Conservation
- [ ] Throughput never amplifies: `luminance(throughput) <= 1.0`
- [ ] Russian roulette preserves unbiased result
- [ ] Path contribution is non-negative
- [ ] No energy created at boundaries

#### Transport Correctness
```glsl
// Test path throughput
Spectrum throughput = Spectrum(1);
for (each bounce) {
    float pdf;
    Direction wo = m_sample(wi, hit, xi, pdf);
    Spectrum f = m_evaluate(wi, wo, hit);
    float cos_theta = abs(g_dot(wo, hit.n, hit.p));
    
    Spectrum contrib = f * cos_theta / pdf;
    assert(all(contrib >= Spectrum(0)));
    assert(luminance(contrib) <= 1.0 / pdf);  // Energy bound
    
    throughput *= contrib;
}
assert(all(throughput >= Spectrum(0)));
```

#### NEE Validation
- [ ] Shadow rays properly offset from surface
- [ ] MIS weights sum to 1: `w_light + w_bsdf = 1`
- [ ] Delta lights skip BSDF sampling in MIS
- [ ] Delta BSDFs skip NEE

#### Dimension Usage
```glsl
// Track dimension consumption
int start_dim = g_dimension_counter;
vec2 xi1 = next_2d();  // Uses 2 dimensions
vec2 xi2 = next_2d();  // Uses 2 more
assert(g_dimension_counter == start_dim + 4);
```

### Film Module Validation

#### Accumulation Correctness
- [ ] First frame (count=0) handled correctly
- [ ] Reset flag clears accumulation
- [ ] Numerical stability for high sample counts
- [ ] Incremental mean matches batch mean

#### Variance Tracking
```glsl
// Welford's algorithm validation
Radiance sum = Radiance(0);
Radiance sum_sq = Radiance(0);
for (int i = 0; i < N; i++) {
    Radiance sample = samples[i];
    sum += sample;
    sum_sq += sample * sample;
}
Radiance batch_mean = sum / N;
Radiance batch_var = sum_sq / N - batch_mean * batch_mean;

// Should match incremental computation
assert(distance(incremental_mean, batch_mean) < EPSILON);
assert(distance(incremental_var, batch_var) < EPSILON);
```

#### Resource Consistency
- [ ] Buffer dimensions match resolution
- [ ] Format supports HDR (float buffers)
- [ ] Ping-pong buffers don't alias
- [ ] UV coordinates in [0,1]

### Developer Module Validation

#### Output Range
- [ ] RGB values in [0,1]: `all(color >= RGB(0) && color <= RGB(1))`
- [ ] Gamma correction applied
- [ ] No NaN or Inf values

#### Tone Mapping Properties
```glsl
// Monotonicity: brighter input → brighter output
RGB c1 = d_develop(Radiance(1.0));
RGB c2 = d_develop(Radiance(2.0));
assert(luminance(c2) >= luminance(c1));

// Black preservation
RGB black = d_develop(Radiance(0));
assert(all(black == RGB(0)));

// Clipping at extremes
RGB bright = d_develop(Radiance(1e10));
assert(all(bright <= RGB(1)));
```

#### Gamma Correction
```glsl
// Verify gamma is applied
vec3 linear = vec3(0.5);
vec3 corrected = pow(linear, vec3(1.0/2.2));
assert(corrected.x > 0.72 && corrected.x < 0.74);  // ~0.73
```

## Common Pitfalls & Solutions

### Camera Pitfalls

**Pitfall**: Forgetting to normalize ray direction
```glsl
// BAD: Direction not normalized
ray.direction = u_camera_frame * local_dir;

// GOOD: Always normalize
ray.direction = normalize(u_camera_frame * local_dir);
```

**Pitfall**: Incorrect aspect ratio handling
```glsl
// BAD: Dividing by resolution.x stretches image
vec2 ndc = (pixel - 0.5 * u_resolution) / u_resolution.x;

// GOOD: Divide by resolution.y for correct aspect
vec2 ndc = (pixel - 0.5 * u_resolution) / u_resolution.y;
```

**Pitfall**: Not using xi for antialiasing
```glsl
// BAD: Ignoring xi parameter
vec2 ndc = pixel / u_resolution;

// GOOD: Add jitter for antialiasing
vec2 jittered = pixel + xi;
vec2 ndc = jittered / u_resolution;
```

### Estimator Pitfalls

**Pitfall**: Dimension correlation from reuse
```glsl
// BAD: Manual dimension tracking
int dim = 0;
vec2 xi1 = sample_2d(pixel, sample, dim); dim += 2;
vec2 xi2 = sample_2d(pixel, sample, dim); dim += 2;
// Easy to miscount!

// GOOD: Automatic tracking
vec2 xi1 = next_2d();
vec2 xi2 = next_2d();
```

**Pitfall**: Russian roulette bias
```glsl
// BAD: Terminating without compensation
if (next_1d() > p_survive) break;

// GOOD: Compensate throughput
if (next_1d() > p_survive) break;
throughput /= p_survive;
```

**Pitfall**: Shadow ray self-intersection
```glsl
// BAD: Ray starts exactly on surface
Ray shadow = make_ray(hit.p, light_dir);

// GOOD: Offset along normal
Ray shadow = make_ray(hit.p + hit.n * EPSILON, light_dir);
```

**Pitfall**: Wrong incident direction sign
```glsl
// BAD: Using ray.direction directly
Spectrum f = m_evaluate(ray.direction, wo, hit);

// GOOD: Negate for incident direction
Spectrum f = m_evaluate(-ray.direction, wo, hit);
```

**Pitfall**: MIS weight calculation
```glsl
// BAD: Balance heuristic (less robust)
float weight = pdf1 / (pdf1 + pdf2);

// GOOD: Power heuristic (more robust)
float weight = (pdf1 * pdf1) / (pdf1 * pdf1 + pdf2 * pdf2);
```

### Film Pitfalls

**Pitfall**: Not checking reset flag first
```glsl
// BAD: Reading old buffer before reset check
vec2 uv = pixel / u_resolution;
Radiance history = texture(u_film_radiance, uv).rgb;
if (u_film_reset) return new_sample;  // Wasted texture read!

// GOOD: Check reset first
if (u_film_reset || u_sample_count == 0) {
    return Radiance(new_sample);
}
vec2 uv = pixel / u_resolution;
Radiance history = texture(u_film_radiance, uv).rgb;
```

**Pitfall**: Numerical instability in averaging
```glsl
// BAD: Catastrophic cancellation for large N
float N = 10000.0;
mean = mean * (N - 1) / N + new_sample / N;

// GOOD: Incremental update
mean = mean + (new_sample - mean) / N;
```

**Pitfall**: UV coordinate errors
```glsl
// BAD: Forgetting to normalize
vec2 uv = pixel;  // Wrong! Goes beyond [0,1]

// GOOD: Normalize by resolution
vec2 uv = pixel / u_resolution;
```

### Developer Pitfalls

**Pitfall**: Forgetting gamma correction
```glsl
// BAD: Linear values to display
return RGB(clamp(radiance, 0.0, 1.0));

// GOOD: Apply gamma correction
return RGB(pow(clamp(radiance, 0.0, 1.0), vec3(1.0/2.2)));
```

**Pitfall**: Tone mapping before clamping
```glsl
// BAD: Can produce values > 1
vec3 color = radiance / (radiance + 1.0);
return RGB(pow(color, vec3(1.0/2.2)));  // Can exceed 1!

// GOOD: Clamp after tone mapping
vec3 color = radiance / (radiance + 1.0);
return RGB(pow(clamp(color, 0.0, 1.0), vec3(1.0/2.2)));
```

**Pitfall**: Wrong gamma value
```glsl
// BAD: Common incorrect values
vec3 corrected = pow(color, vec3(2.2));     // Backwards!
vec3 corrected = pow(color, vec3(1.0/2.0)); // Wrong gamma
vec3 corrected = sqrt(color);               // Gamma 2.0, not 2.2

// GOOD: Standard sRGB gamma
vec3 corrected = pow(color, vec3(1.0/2.2));
```

## Integration Pitfalls

**Pitfall**: Function name conflicts
```glsl
// BAD: User writes prefixed function
float c_generate_ray(...) { }  // Will become c_c_generate_ray!

// GOOD: Write unprefixed
float generate_ray(...) { }  // Becomes c_generate_ray
```

**Pitfall**: Module dependency violations
```glsl
// BAD: Camera accessing scene functions
Ray generate_ray(vec2 pixel, vec2 xi) {
    if (sc_intersect(...)) { }  // Camera shouldn't know about scene!
}

// GOOD: Camera only generates rays
Ray generate_ray(vec2 pixel, vec2 xi) {
    // Just compute ray, no scene queries
}
```

## Unit Testing Strategies

### Test Ray Generation
```glsl
// Test: Center pixel shoots through camera target
vec2 center = u_resolution * 0.5;
Ray ray = c_generate_ray(center, vec2(0.5));
// Ray should point toward target
```

### Test Energy Conservation
```glsl
// Test: Path tracing doesn't amplify
for (int test = 0; test < 1000; test++) {
    Ray ray = generate_random_ray();
    Spectrum radiance = e_estimate(ray);
    assert(luminance(radiance) <= 100.0);  // Reasonable bound
}
```

### Test Film Convergence
```glsl
// Test: Accumulation converges to expected value
Spectrum constant = Spectrum(0.5);
Radiance accumulated = Radiance(0);
for (int i = 0; i < 1000; i++) {
    accumulated = f_accumulate(constant, pixel);
}
assert(distance(accumulated, Radiance(0.5)) < 0.01);
```

### Test Tone Mapper Invertibility
```glsl
// For some tone mappers, test round-trip
Radiance original = Radiance(0.5);
RGB developed = d_develop(original);
Radiance reconstructed = inverse_develop(developed);
assert(distance(original, reconstructed) < 0.1);
```

## Performance Validation

### Measure Ray Efficiency
```glsl
// Count rays per pixel
int primary_rays = 0;
int shadow_rays = 0;
int total_rays = 0;

// In estimator
primary_rays++;
for (each shadow test) shadow_rays++;
total_rays = primary_rays + shadow_rays;

// Log rays per pixel for optimization
```

### Profile Dimension Usage
```glsl
// Track random number consumption
int dims_per_pixel = 0;
// After one pixel
dims_per_pixel = g_dimension_counter;
// Verify against expected usage
```

### Validate Convergence Rate
```glsl
// Measure variance reduction
float initial_variance = compute_variance_at(100);
float later_variance = compute_variance_at(1000);
float reduction = initial_variance / later_variance;
assert(reduction > 8.0);  // Should reduce ~10x
```

## Debug Helpers

### Visualize Random Sampling
```glsl
// Show first two dimensions as colors
RGB debug_dimensions() {
    vec2 xi = next_2d();
    return RGB(xi.x, xi.y, 0.0);
}
```

### Visualize Ray Directions
```glsl
// Color by ray direction
RGB debug_ray_dir(Ray ray) {
    return RGB(ray.direction * 0.5 + 0.5);
}
```

### Visualize Accumulation
```glsl
// Show sample count as brightness
RGB debug_samples() {
    float t = float(u_sample_count) / 1000.0;
    return RGB(t);
}
```

### Visualize Variance
```glsl
// Red = high variance
RGB debug_variance(vec2 pixel) {
    float var = f_compute_variance(pixel);
    return RGB(var, 0.0, 0.0);
}
```

## Complete Pipeline Validation

### End-to-End Test
```glsl
// Test: White furnace test
// Uniform white environment should produce white image
Spectrum test_furnace() {
    // Override lights to return white
    // Run path tracer
    // All pixels should converge to ~white
}

// Test: Energy conservation
// No path should amplify energy
Spectrum test_conservation() {
    // Bright light in scene
    // No pixel should exceed light brightness
}

// Test: Reciprocity
// Reversing ray direction should give same result
void test_reciprocity() {
    // For diffuse surfaces and symmetric paths
}
```

## Common Integration Issues

### Issue: Modules not communicating
- Check prefixing is correct
- Verify provides/requires match
- Ensure compilation order is right

### Issue: Reset not working
- Film checks `u_film_reset` flag
- Parameter changes trigger reset
- Sample count resets to 0

### Issue: Dimensions corrupted
- Check all modules use next_*d() functions
- No manual dimension tracking
- Reset between pixels

### Issue: Black or NaN output
- Check for division by zero in PDFs
- Verify all directions normalized
- Check for negative radiance values
- Ensure gamma correction applied
