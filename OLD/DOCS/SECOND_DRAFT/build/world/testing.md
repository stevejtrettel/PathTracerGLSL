# World Module Validation & Common Pitfalls

## Validation Checklists

### Geometry Module Validation

#### Required Function Compliance
- [ ] `geodesic(origin, dir, t)` returns valid Point
- [ ] `dot(v1, v2, p)` returns scalar in [-1, 1] for unit vectors
- [ ] `parallel_transport(v, from, to)` preserves vector magnitude
- [ ] `frame(p, n)` returns orthonormal vectors

#### Mathematical Properties
- [ ] Geodesics are symmetric: `geodesic(a, normalize(b-a), dist(a,b)) ≈ b`
- [ ] Dot product is symmetric: `dot(v1, v2, p) == dot(v2, v1, p)`
- [ ] Frame vectors are orthonormal:
  ```glsl
  Frame f = g_frame(p, n);
  assert(abs(dot(f.t, f.b) < EPSILON));
  assert(abs(dot(f.t, f.n) < EPSILON));
  assert(abs(dot(f.b, f.n) < EPSILON));
  assert(abs(length(f.t) - 1.0) < EPSILON);
  assert(abs(length(f.b) - 1.0) < EPSILON);
  assert(abs(length(f.n) - 1.0) < EPSILON);
  ```

#### Edge Cases
- [ ] Frame construction works for all normal directions
- [ ] Frame construction handles n = (0,1,0) and n = (0,-1,0)
- [ ] Parallel transport handles zero-length paths
- [ ] Geodesic handles negative t values correctly

### Object Module Validation

#### SDF Properties
- [ ] Distance is continuous everywhere
- [ ] Gradient exists almost everywhere
- [ ] Sign changes at surface (negative inside, positive outside)
- [ ] Distance approaches 0 at surface

#### Classification Consistency
- [ ] `classify_object(p)` returns valid MaterialID or MATERIAL_AIR
- [ ] Classification matches SDF sign:
  ```glsl
  if (object_sdf(p) < 0) {
    assert(classify_object(p) != MATERIAL_AIR);
  }
  ```
- [ ] Material IDs are in valid range [0, NUM_MATERIALS-1] or MATERIAL_AIR

#### Normal Validation
- [ ] Normals are unit vectors: `abs(length(normal) - 1.0) < EPSILON`
- [ ] Normals point outward (away from negative SDF region)
- [ ] Analytic normals match numerical gradient (if provided)

### Scene Module Validation

#### Hit Structure Completeness
```glsl
// Every field must be populated
void validate_hit(Hit hit) {
    assert(hit.t >= 0.0);
    assert(is_valid_point(hit.p));
    assert(abs(length(hit.n) - 1.0) < EPSILON);
    assert(abs(length(hit.incident) - 1.0) < EPSILON);
    assert(hit.object_id >= 0);
    assert(hit.material_from == MATERIAL_AIR || 
           (hit.material_from >= 0 && hit.material_from < NUM_MATERIALS));
    assert(hit.material_to == MATERIAL_AIR || 
           (hit.material_to >= 0 && hit.material_to < NUM_MATERIALS));
    assert(hit.ior_ratio > 0.0);
    assert(is_orthonormal_frame(hit.frame));
}
```

#### Material Interface Resolution
- [ ] Material transitions are consistent:
  ```glsl
  // Test both sides of surface
  vec3 p_in = hit.p - hit.n * EPSILON;
  vec3 p_out = hit.p + hit.n * EPSILON;
  assert(classify_point(p_in) == hit.material_from);
  assert(classify_point(p_out) == hit.material_to);
  ```
- [ ] IOR ratio matches material table:
  ```glsl
  float expected = material_iors[hit.material_from] / 
                  material_iors[hit.material_to];
  assert(abs(hit.ior_ratio - expected) < EPSILON);
  ```

#### Marching Convergence
- [ ] Conservative factor prevents tunneling
- [ ] Converges to surface within MAX_STEPS
- [ ] Shadow rays can use less conservative factor
- [ ] No infinite loops on grazing angles

#### Nearby Object Tracking
- [ ] Maximum 3 objects tracked
- [ ] Objects sorted by distance
- [ ] Count reflects objects within BOUNDARY_THRESHOLD
- [ ] Handles single object case efficiently

### Material Module Validation

#### BRDF Properties
- [ ] Energy conservation: `evaluate(wi, wo, hit) <= 1/π` for Lambert
- [ ] Reciprocity: `evaluate(wi, wo, hit) == evaluate(wo, wi, hit)`
- [ ] Non-negative: `evaluate(wi, wo, hit) >= 0`
- [ ] PDF normalization:
  ```glsl
  // Integrate to 1 over hemisphere
  float integral = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    vec2 xi = hammersley(i, SAMPLES);
    float pdf;
    Direction wo = m_sample(wi, hit, xi, pdf);
    integral += 1.0 / pdf;
  }
  assert(abs(integral / SAMPLES - 1.0) < 0.1);
  ```

#### Sampling Validation
- [ ] Sampled directions are unit vectors
- [ ] PDF > 0 for valid samples
- [ ] PDF == 0 implies terminated path
- [ ] Importance sampling matches BRDF:
  ```glsl
  Direction wo = m_sample(wi, hit, xi, pdf);
  Spectrum f = m_evaluate(wi, wo, hit);
  float pdf_check = m_pdf(wi, wo, hit);
  assert(abs(pdf - pdf_check) < EPSILON);
  ```

#### MaterialID Handling
- [ ] Handles all MaterialIDs in scene
- [ ] Handles MATERIAL_AIR correctly
- [ ] Parameter lookup doesn't go out of bounds

### Lights Module Validation

#### Light Sampling
- [ ] `wi` directions are normalized
- [ ] `distance` is positive (finite for local, infinite for env)
- [ ] `radiance` is non-negative
- [ ] `pdf` > 0 unless `is_delta` is true
- [ ] Delta lights have `eval_light() == 0`

#### PDF Consistency
```glsl
// For non-delta lights
LightSample ls = l_sample_light(p, xi);
float pdf_check = l_pdf_light(p, ls.wi);
assert(abs(ls.pdf - pdf_check) < EPSILON);
```

#### Environment Map
- [ ] Importance sampling CDF sums to 1
- [ ] UV mapping is correct (direction ↔ texture coordinates)
- [ ] PDF accounts for solid angle distortion

## Common Pitfalls & Solutions

### Geometry Pitfalls

**Pitfall**: Frame construction fails for certain normals
```glsl
// BAD: Fails when n parallel to (1,0,0)
Direction t = normalize(cross(vec3(1,0,0), n));

// GOOD: Choose non-parallel vector
Direction t = abs(n.x) < 0.9 ? vec3(1,0,0) : vec3(0,1,0);
t = normalize(cross(n, t));
```

**Pitfall**: Forgetting to use geometry functions
```glsl
// BAD: Using standard dot in curved space
float cos_theta = dot(v1, v2);

// GOOD: Using geometry-aware dot
float cos_theta = g_dot(v1, v2, p);
```

### Object Pitfalls

**Pitfall**: SDF discontinuities at CSG operations
```glsl
// BAD: Max creates C0 discontinuity
float d = max(sphere_sdf(p), -box_sdf(p));

// GOOD: Use smooth operations near boundaries
float d = smooth_intersection(sphere_sdf(p), -box_sdf(p), 0.1);
```

**Pitfall**: Numerical gradient instability
```glsl
// BAD: Epsilon too small causes numerical errors
const float eps = 1e-10;
vec3 normal = normalize(vec3(
    sdf(p + vec3(eps,0,0)) - sdf(p - vec3(eps,0,0)),
    sdf(p + vec3(0,eps,0)) - sdf(p - vec3(0,eps,0)),
    sdf(p + vec3(0,0,eps)) - sdf(p - vec3(0,0,eps))
));

// GOOD: Appropriate epsilon
const float eps = 0.0001;
```

### Scene Pitfalls

**Pitfall**: Surface penetration due to aggressive marching
```glsl
// BAD: Can overshoot thin features
t += d;  // No safety factor

// GOOD: Conservative marching
t += d * 0.9;  // Prevents penetration
```

**Pitfall**: Material resolution at boundaries without nearby tracking
```glsl
// BAD: Checking all objects at every boundary
for (int i = 0; i < 100; i++) {
    check_object(i);
}

// GOOD: Only check nearby objects
NearbyObjects nearby = find_nearby(p);
for (int i = 0; i < nearby.count && i < 3; i++) {
    check_object(nearby.ids[i]);
}
```

**Pitfall**: Incomplete Hit structure
```glsl
// BAD: Forgetting to set fields
Hit hit;
hit.p = p;
hit.n = normal;
// Missing: frame, ior_ratio, material_from/to, etc.

// GOOD: Complete initialization
hit.frame = g_frame(hit.p, hit.n);
hit.ior_ratio = material_iors[hit.material_from] / 
                material_iors[hit.material_to];
```

### Material Pitfalls

**Pitfall**: Not checking material interface
```glsl
// BAD: Assuming we're always hitting a surface
Spectrum f = evaluate_brdf(wi, wo, hit.material_to);

// GOOD: Handle air interfaces
if (hit.material_to == MATERIAL_AIR && 
    hit.material_from == MATERIAL_AIR) {
    return Spectrum(0);  // No surface
}
int mat_id = (hit.material_to == MATERIAL_AIR) ? 
             hit.material_from : hit.material_to;
```

**Pitfall**: Importance sampling mismatch
```glsl
// BAD: Sampling doesn't match PDF
Direction wo = uniform_hemisphere(xi);
pdf = 1.0 / (2.0 * PI);  // Wrong for cosine-weighted!

// GOOD: Consistent sampling and PDF
Direction wo = cosine_weighted_hemisphere(xi);
pdf = cos_theta / PI;
```

**Pitfall**: Forgetting radiance change for refraction
```glsl
// BAD: Not accounting for IOR change
pdf = 1.0 - fresnel;

// GOOD: Scale by IOR ratio squared
pdf = (1.0 - fresnel) * eta * eta;
```

### Lights Pitfalls

**Pitfall**: Shadow ray self-intersection
```glsl
// BAD: Ray starts exactly on surface
Ray shadow_ray = make_ray(hit.p, light_dir);

// GOOD: Offset along normal
Ray shadow_ray = make_ray(hit.p + hit.n * EPSILON, light_dir);
```

**Pitfall**: Environment map sampling without importance
```glsl
// BAD: Uniform sampling of bright HDR environment
vec2 uv = xi;
Direction wi = uv_to_direction(uv);
pdf = 1.0 / (4.0 * PI);

// GOOD: Importance sample based on luminance
vec2 uv = sample_environment_cdf(xi);
Direction wi = uv_to_direction(uv);
pdf = compute_environment_pdf(uv);
```

## Unit Testing Strategies

### Test Ray Marching
```glsl
// Test: Sphere at origin with radius 1
Ray ray = make_ray(vec3(0, 0, -5), vec3(0, 0, 1));
Hit hit;
bool found = sc_intersect(ray, hit);
assert(found);
assert(abs(hit.t - 4.0) < 0.01);  // Should hit at z=-1
assert(distance(hit.p, vec3(0, 0, -1)) < 0.01);
```

### Test Material Consistency
```glsl
// Test: Sampling matches evaluation
for (int i = 0; i < 1000; i++) {
    vec2 xi = random_vec2();
    float pdf;
    Direction wo = m_sample(wi, hit, xi, pdf);
    
    Spectrum f1 = m_evaluate(wi, wo, hit);
    float pdf2 = m_pdf(wi, wo, hit);
    
    assert(abs(pdf - pdf2) < EPSILON);
    assert(all(f1 >= Spectrum(0)));
}
```

### Test Conservation of Energy
```glsl
// Test: BRDF doesn't amplify energy
float total = 0.0;
for (int i = 0; i < SAMPLE_COUNT; i++) {
    Direction wo = sample_hemisphere(hammersley(i, SAMPLE_COUNT));
    Spectrum f = m_evaluate(wi, wo, hit);
    total += luminance(f) * dot(wo, hit.n);
}
total *= 2.0 * PI / SAMPLE_COUNT;
assert(total <= 1.0);  // Must not exceed 1
```

## Performance Validation

### Measure Marching Efficiency
```glsl
// Count steps to convergence
int step_count = 0;
for (int i = 0; i < MAX_STEPS; i++) {
    step_count++;
    // ... marching code
    if (converged) break;
}
// Log average steps per ray
```

### Profile Material Resolution
```glsl
// Track nearby object usage
int single_object_cases = 0;
int multi_object_cases = 0;
// ... in resolve_material
if (nearby.count <= 1) single_object_cases++;
else multi_object_cases++;
// Should see 90%+ single object cases
```

## Debug Helpers

### Visualize Normals
```glsl
Spectrum debug_normals(Hit hit) {
    return Spectrum(hit.n * 0.5 + 0.5);
}
```

### Visualize Material IDs
```glsl
Spectrum debug_materials(Hit hit) {
    float hue = float(hit.material_to) / float(NUM_MATERIALS);
    return hsv_to_rgb(hue, 1.0, 1.0);
}
```

### Visualize Convergence
```glsl
Spectrum debug_steps(int steps) {
    float t = float(steps) / float(MAX_STEPS);
    return Spectrum(t, 1.0 - t, 0.0);  // Red = many steps
}
```
