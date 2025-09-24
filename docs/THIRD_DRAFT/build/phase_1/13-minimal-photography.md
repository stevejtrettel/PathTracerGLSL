# Phase 1.3: Minimal Photography - Detailed Plan

## Purpose & Scope

Phase 1.3 implements the Photography pillar modules that transform rays into pixels. These modules orchestrate the actual rendering: generating rays, tracing them through the scene, shading intersections, and producing final colors. This completes our minimal renderer.

**Core Goal**: Implement Photography modules that visualize surface normals as colors, proving the entire pipeline works.

## File Structure & Responsibilities

### `src/photography/camera/pinhole.glsl` - Ray Generation

**Purpose**: Transform pixel coordinates into world-space rays using a pinhole camera model.

**Core Implementation**:
```glsl
// Camera configuration (hardcoded for now)
#define CAMERA_POSITION vec3(0.0, 0.0, 5.0)
#define CAMERA_TARGET vec3(0.0, 0.0, 0.0)
#define CAMERA_UP vec3(0.0, 1.0, 0.0)
#define CAMERA_FOV 60.0  // degrees
#define CAMERA_NEAR 0.001
#define CAMERA_FAR 1000.0

// Generate ray from pixel coordinates
Ray camera_generateRay(vec2 pixel, vec2 resolution) {
    // Compute camera basis vectors
    vec3 forward = normalize(CAMERA_TARGET - CAMERA_POSITION);
    vec3 right = normalize(cross(forward, CAMERA_UP));
    vec3 up = cross(right, forward);
    
    // Convert FOV to focal length
    float fov_radians = CAMERA_FOV * GEOMETRY_EUCLIDEAN_PI / 180.0;
    float focal_length = 1.0 / tan(fov_radians * 0.5);
    
    // Map pixel to [-1, 1] NDC
    vec2 ndc = (2.0 * pixel - resolution) / resolution.y;
    // Note: dividing by resolution.y keeps aspect ratio correct
    
    // Compute ray direction in camera space
    vec3 ray_dir_camera = normalize(vec3(ndc.x, ndc.y, -focal_length));
    
    // Transform to world space
    vec3 ray_dir_world = ray_dir_camera.x * right + 
                         ray_dir_camera.y * up + 
                         -ray_dir_camera.z * forward;
    
    // Construct ray
    Ray ray;
    ray.origin = CAMERA_POSITION;
    ray.direction = normalize(ray_dir_world);
    ray.tmin = CAMERA_NEAR;
    ray.tmax = CAMERA_FAR;
    
    return ray;
}

// Get camera position (for other modules if needed)
vec3 camera_getPosition() {
    return CAMERA_POSITION;
}

// Get camera forward direction
vec3 camera_getForward() {
    return normalize(CAMERA_TARGET - CAMERA_POSITION);
}
```

**Key Design Decisions**:
- Hardcoded camera parameters (no uniforms yet)
- Classic pinhole model (no DOF)
- Proper aspect ratio handling
- NDC coordinates with Y-up convention
- Camera at (0,0,5) looking at origin

### `src/photography/transport/simple.glsl` - Ray Tracing

**Purpose**: Trace rays through the scene. For Phase 1, just find the first intersection.

**Core Implementation**:
```glsl
// Trace a ray and return radiance
vec3 transport_trace(Ray ray) {
    Hit hit;
    
    // Find closest intersection
    if (scene_intersect(ray, hit)) {
        // Hit something - pass to interaction for shading
        return interaction_surface_shade(hit, -ray.direction);
    } else {
        // Miss - return sky color
        return transport_miss_shader(ray.direction);
    }
}

// Background/sky color for missed rays
vec3 transport_miss_shader(vec3 direction) {
    // Simple gradient sky
    float t = 0.5 * (direction.y + 1.0);
    vec3 bottom = vec3(0.5, 0.7, 1.0);  // Light blue
    vec3 top = vec3(1.0, 1.0, 1.0);     // White
    return mix(bottom, top, t);
}

// Check if point can see another point (for shadows later)
bool transport_visibility(vec3 from, vec3 to) {
    vec3 dir = to - from;
    float dist = length(dir);
    
    Ray shadow_ray;
    shadow_ray.origin = from;
    shadow_ray.direction = dir / dist;
    shadow_ray.tmin = 0.001;  // Small offset to avoid self-intersection
    shadow_ray.tmax = dist - 0.001;
    
    return !scene_intersect_any(shadow_ray);
}
```

**Why This Design?**
- Simplest possible transport (no bounces)
- Still follows the interface for later expansion
- Includes miss shader for visual reference
- Visibility function ready for shadows
- Clean separation of concerns

### `src/photography/interaction/debug_normal.glsl` - Debug Shading

**Purpose**: Visualize surface normals as RGB colors for debugging geometry.

**Core Implementation**:
```glsl
// Shade a surface point (normal visualization)
vec3 interaction_surface_shade(Hit hit, vec3 wo) {
    // Transform normal from [-1,1] to [0,1] for RGB visualization
    vec3 normal_color = hit.n * 0.5 + 0.5;
    
    // Optional: Add slight shading based on view angle
    float facing = max(0.0, dot(hit.n, wo));
    float shade = 0.5 + 0.5 * facing;
    
    return normal_color * shade;
}

// BRDF evaluation (not used in Phase 1, but part of interface)
vec3 interaction_evaluate_brdf(Hit hit, vec3 wi, vec3 wo) {
    // Placeholder for interface compatibility
    return vec3(0.0);
}

// BRDF sampling (not used in Phase 1)
vec3 interaction_sample_brdf(Hit hit, vec3 wo, vec2 u, out vec3 wi, out float pdf) {
    // Placeholder
    wi = vec3(0.0, 1.0, 0.0);
    pdf = 1.0;
    return vec3(0.0);
}

// PDF evaluation (not used in Phase 1)
float interaction_pdf_brdf(Hit hit, vec3 wi, vec3 wo) {
    // Placeholder
    return 1.0;
}
```

**Visualization Strategy**:
- X component → Red channel
- Y component → Green channel
- Z component → Blue channel
- Normals pointing right are reddish
- Normals pointing up are greenish
- Normals pointing toward camera are bluish

### `src/photography/film/simple.glsl` - Pixel Storage

**Purpose**: Pass through colors without accumulation. This is the simplest possible film.

**Core Implementation**:
```glsl
// No accumulation state needed for simple film

// "Accumulate" a sample (just pass through)
vec3 film_accumulate(vec3 radiance, vec2 pixel) {
    // In Phase 1, no accumulation - just return the radiance
    return radiance;
}

// Get current accumulated value (not used in Phase 1)
vec3 film_get_accumulated(vec2 pixel) {
    // Placeholder for interface
    return vec3(0.0);
}

// Reset accumulation (not used in Phase 1)
void film_reset(vec2 pixel) {
    // Placeholder for interface
}

// Get sample count (not used in Phase 1)
float film_get_sample_count(vec2 pixel) {
    return 1.0;  // Always 1 for simple film
}
```

**Why No Accumulation Yet?**
- Keeps Phase 1 simple
- No need for framebuffers or textures
- Can verify rendering works without convergence
- Will add accumulation in Phase 2

### `src/photography/developer/linear.glsl` - Output Processing

**Purpose**: Convert radiance to display RGB. For Phase 1, just clamp to [0,1].

**Core Implementation**:
```glsl
// Simple linear developer - just clamp
vec3 developer_develop(vec3 radiance) {
    // Clamp to valid range
    vec3 clamped = clamp(radiance, 0.0, 1.0);
    
    // Optional: Apply gamma for display
    float gamma = 2.2;
    vec3 corrected = pow(clamped, vec3(1.0 / gamma));
    
    return corrected;
}

// Get exposure value (not used in Phase 1)
float developer_get_exposure() {
    return 1.0;
}

// Set white point (not used in Phase 1)
void developer_set_white_point(float white) {
    // Placeholder for interface
}
```

**Tone Mapping Decisions**:
- No HDR tone mapping yet
- Simple clamp prevents invalid colors
- Gamma correction for proper display
- Will add real tone mapping in Phase 4

## Module Orchestration

The main() function in the compiled shader will call these in sequence:

```glsl
void main() {
    vec2 pixel = gl_FragCoord.xy;
    
    // 1. Generate ray from pixel
    Ray ray = camera_generateRay(pixel, u_resolution);
    
    // 2. Trace ray through scene
    vec3 radiance = transport_trace(ray);
    
    // 3. "Accumulate" in film (pass through for now)
    vec3 accumulated = film_accumulate(radiance, pixel);
    
    // 4. Develop to display color
    vec3 color = developer_develop(accumulated);
    
    fragColor = vec4(color, 1.0);
}
```

## Testing Strategy

### Camera Tests
```typescript
test('rays point toward sphere at origin')
test('ray directions are normalized')
test('FOV affects ray spread correctly')
test('aspect ratio preserved')
```

### Transport Tests
```typescript
test('finds sphere intersection')
test('returns sky color for misses')
test('respects tmin/tmax')
```

### Interaction Tests
```typescript
test('normals map to correct colors')
test('facing ratio affects brightness')
test('normal colors in [0,1] range')
```

### Integration Test
```typescript
test('sphere shows normal colors', () => {
  // Render frame
  // Read center pixel (should hit sphere)
  // Verify color matches expected normal
  // Read corner pixel (should show sky)
})
```

## Success Criteria

Phase 1.3 is complete when:
1. Camera generates proper rays
2. Transport finds intersections
3. Normals visualized as colors
4. Sky gradient visible for missed rays
5. Sphere appears with normal coloring
6. No GLSL compilation errors

## What We're NOT Doing in Phase 1.3

- Path tracing (no bounces)
- Real materials or BRDFs
- Importance sampling
- Multiple importance sampling
- Accumulation/convergence
- Real tone mapping
- Motion blur or DOF
- Camera controls
- Uniform parameters

## Connection to Phase 1.4

These Photography modules complete the rendering pipeline:
- Camera defines the view
- Transport finds what we see
- Interaction colors it
- Film stores it
- Developer prepares it for display

Phase 1.4 will wire everything together in a simple app that:
- Loads all modules
- Compiles the shader
- Runs the render loop
- Displays our normal-shaded sphere

This proves our architecture works end-to-end before we add real path tracing in Phase 2.
