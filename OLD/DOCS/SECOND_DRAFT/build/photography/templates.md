# Photography Module Templates

Minimal, functional starting points for each Photography module type.

## Camera Module Template

### Pinhole Camera (Simplest)

```glsl
// camera/pinhole.glsl
Ray generate_ray(vec2 pixel, vec2 xi) {
    // Jittered pixel for antialiasing
    vec2 jittered = pixel + xi;
    
    // Normalized device coordinates
    vec2 ndc = (jittered - 0.5 * u_resolution) / u_resolution.y;
    
    // Generate ray direction using precomputed frame
    vec3 local_dir = vec3(ndc * u_camera_tan_fov, 1.0);
    vec3 world_dir = normalize(u_camera_frame * local_dir);
    
    Ray ray;
    ray.origin = u_camera_position;
    ray.direction = world_dir;
    ray.tmin = 0.0;
    ray.tmax = MAX_DIST;
    
    return ray;
}
```

### Thin Lens Camera (DOF)

```glsl
// camera/thin_lens.glsl
uniform float u_camera_thin_lens_aperture;
uniform float u_camera_thin_lens_focal_distance;

Ray generate_ray(vec2 pixel, vec2 xi) {
    // NDC coordinates
    vec2 ndc = (pixel + xi - 0.5 * u_resolution) / u_resolution.y;
    
    // Ray through lens center to focal plane
    vec3 focal_dir = vec3(ndc * u_camera_tan_fov, 1.0);
    vec3 focal_point = u_camera_position + 
                       normalize(u_camera_frame * focal_dir) * 
                       u_camera_thin_lens_focal_distance;
    
    // Sample point on lens
    vec2 lens_sample = sample_unit_disk(next_2d()) * 
                       u_camera_thin_lens_aperture;
    vec3 lens_pos = u_camera_position + 
                    u_camera_frame * vec3(lens_sample, 0.0);
    
    Ray ray;
    ray.origin = lens_pos;
    ray.direction = normalize(focal_point - lens_pos);
    ray.tmin = 0.0;
    ray.tmax = MAX_DIST;
    
    return ray;
}
```

### Orthographic Camera

```glsl
// camera/orthographic.glsl
uniform float u_camera_ortho_size;

Ray generate_ray(vec2 pixel, vec2 xi) {
    // Normalized device coordinates [-1, 1]
    vec2 ndc = (pixel + xi - 0.5 * u_resolution) / u_resolution;
    ndc = (ndc - 0.5) * 2.0;
    
    // Scale by orthographic size
    vec2 offset = ndc * u_camera_ortho_size;
    
    // Ray origin offset from camera position
    vec3 origin = u_camera_position + 
                  u_camera_frame * vec3(offset, 0.0);
    
    // Parallel rays along forward direction
    vec3 direction = u_camera_frame * vec3(0, 0, 1);
    
    Ray ray;
    ray.origin = origin;
    ray.direction = direction;
    ray.tmin = 0.0;
    ray.tmax = MAX_DIST;
    
    return ray;
}
```

### Module Descriptor

```typescript
const pinholeCamera: ModuleDescriptor = {
    id: { kind: 'camera', name: 'pinhole', version: '1.0.0' },
    provides: ['camera'],
    requires: [],
    fragment: {
        functions: cameraGLSL,
        uniforms: `
            uniform mat3 u_camera_frame;
            uniform vec3 u_camera_position;
            uniform float u_camera_tan_fov;
            uniform vec2 u_resolution;
        `
    }
};
```

## Estimator Module Template

### Simple Path Tracer (Minimal)

```glsl
// estimator/simple_pt.glsl
#define MAX_BOUNCES 5

Spectrum estimate(Ray ray) {
    Spectrum radiance = Spectrum(0);
    Spectrum throughput = Spectrum(1);
    
    for (int bounce = 0; bounce < MAX_BOUNCES; bounce++) {
        Hit hit;
        if (!sc_intersect(ray, hit)) {
            // Hit environment
            radiance += throughput * l_eval_light(ray.origin, ray.direction);
            break;
        }
        
        // Russian roulette after 3 bounces
        if (bounce > 2) {
            float p = min(1.0, luminance(throughput));
            if (next_1d() > p) break;
            throughput /= p;
        }
        
        // Sample next direction
        float pdf;
        Direction wo = m_sample(-ray.direction, hit, next_2d(), pdf);
        
        if (pdf < EPSILON) break;
        
        // Evaluate BRDF and continue
        Spectrum f = m_evaluate(-ray.direction, wo, hit);
        float cos_theta = abs(g_dot(wo, hit.n, hit.p));
        throughput *= f * cos_theta / pdf;
        
        // Next ray
        ray.origin = hit.p;
        ray.direction = wo;
        ray.tmin = EPSILON;
        ray.tmax = MAX_DIST;
    }
    
    return radiance;
}
```

### Path Tracer with NEE

```glsl
// estimator/pt_nee.glsl
#define MAX_BOUNCES 10
#define RR_START_DEPTH 3

Spectrum estimate(Ray ray) {
    Spectrum radiance = Spectrum(0);
    Spectrum throughput = Spectrum(1);
    bool specular_bounce = true;
    
    for (int bounce = 0; bounce < MAX_BOUNCES; bounce++) {
        Hit hit;
        if (!sc_intersect(ray, hit)) {
            radiance += throughput * l_eval_light(ray.origin, ray.direction);
            break;
        }
        
        // Direct lighting (skip for specular paths)
        if (!specular_bounce) {
            radiance += throughput * compute_direct_lighting(hit, -ray.direction);
        }
        
        // Russian roulette
        if (bounce >= RR_START_DEPTH) {
            float p = min(1.0, luminance(throughput));
            if (next_1d() > p) break;
            throughput /= p;
        }
        
        // Sample BSDF
        float pdf;
        Direction wo = m_sample(-ray.direction, hit, next_2d(), pdf);
        
        if (pdf < EPSILON) break;
        
        Spectrum f = m_evaluate(-ray.direction, wo, hit);
        float cos_theta = abs(g_dot(wo, hit.n, hit.p));
        throughput *= f * cos_theta / pdf;
        
        // Check if specular (for next iteration)
        specular_bounce = pdf > 100.0;  // Heuristic for delta/specular
        
        // Next ray
        ray = make_ray(hit.p, wo);
    }
    
    return radiance;
}

Spectrum compute_direct_lighting(Hit hit, Direction wo) {
    // Sample light
    LightSample ls = l_sample_light(hit.p, next_2d());
    if (ls.pdf <= 0.0) return Spectrum(0);
    
    // Shadow test
    Ray shadow_ray;
    shadow_ray.origin = hit.p + hit.n * EPSILON;
    shadow_ray.direction = ls.wi;
    shadow_ray.tmin = 0.0;
    shadow_ray.tmax = ls.distance - EPSILON;
    
    if (sc_intersect_any(shadow_ray, shadow_ray.tmax)) {
        return Spectrum(0);
    }
    
    // Evaluate BRDF
    Spectrum f = m_evaluate(wo, ls.wi, hit);
    float cos_theta = max(0.0, g_dot(ls.wi, hit.n, hit.p));
    
    return f * ls.radiance * cos_theta / ls.pdf;
}
```

### Debug Estimator

```glsl
// estimator/debug.glsl
uniform int u_debug_mode;

Spectrum estimate(Ray ray) {
    Hit hit;
    if (!sc_intersect(ray, hit)) {
        return Spectrum(0.2);  // Gray background
    }
    
    switch(u_debug_mode) {
        case 0:  // Normals
            return Spectrum(hit.n * 0.5 + 0.5);
            
        case 1:  // Material IDs
            float hue = float(hit.material_to) / 10.0;
            return hsv_to_rgb(hue, 1.0, 1.0);
            
        case 2:  // Object IDs
            return hash_color(hit.object_id);
            
        case 3:  // UV coordinates
            return Spectrum(hit.uv.x, hit.uv.y, 0.0);
            
        case 4:  // Depth
            float depth = hit.t / 10.0;
            return Spectrum(depth);
            
        default:
            return Spectrum(1, 0, 1);  // Magenta = error
    }
}

vec3 hash_color(int id) {
    // Generate unique color per ID
    float hue = fract(sin(float(id) * 43758.5453) * 2.0);
    return hsv_to_rgb(hue, 0.8, 1.0);
}
```

### Module Descriptor

```typescript
const pathTracer: ModuleDescriptor = {
    id: { kind: 'estimator', name: 'pathtracer', version: '1.0.0' },
    provides: ['estimator'],
    requires: ['geometry', 'scene', 'material', 'lights'],
    fragment: {
        functions: estimatorGLSL,
        uniforms: '',
        constants: `
            #define MAX_BOUNCES 10
            #define RR_START_DEPTH 3
            #define NEE_STRATEGY MIS
        `
    },
    config: {
        maxBounces: 10,
        volumeStrategy: 'none',
        sssModel: 'none',
        neeStrategy: 'mis'
    }
};
```

## Film Module Template

### Simple Accumulation

```glsl
// film/simple.glsl
Radiance accumulate(Spectrum new_sample, vec2 pixel) {
    // Handle reset
    if (u_film_reset || u_sample_count == 0) {
        return Radiance(new_sample);
    }
    
    // Get previous accumulation
    vec2 uv = pixel / u_resolution;
    Radiance history = texture(u_film_radiance, uv).rgb;
    
    // Incremental average
    float n = float(u_sample_count + 1);
    return history + (Radiance(new_sample) - history) / n;
}
```

### Variance Tracking Film

```glsl
// film/variance.glsl
Radiance accumulate(Spectrum new_sample, vec2 pixel) {
    vec2 uv = pixel / u_resolution;
    
    if (u_film_reset || u_sample_count == 0) {
        // First sample - initialize
        return Radiance(new_sample);
    }
    
    // Welford's online algorithm
    Radiance old_mean = texture(u_film_radiance, uv).rgb;
    Radiance old_m2 = texture(u_film_variance, uv).rgb;
    
    float n = float(u_sample_count + 1);
    
    Radiance delta = Radiance(new_sample) - old_mean;
    Radiance new_mean = old_mean + delta / n;
    Radiance delta2 = Radiance(new_sample) - new_mean;
    Radiance new_m2 = old_m2 + delta * delta2;
    
    // Store M2 in variance buffer (via MRT)
    // Actual variance = M2 / (n - 1)
    
    return new_mean;
}

float compute_variance(vec2 pixel) {
    vec2 uv = pixel / u_resolution;
    Radiance m2 = texture(u_film_variance, uv).rgb;
    float n = float(u_sample_count);
    
    if (n < 2.0) return 1.0;
    
    Radiance variance = m2 / (n - 1.0);
    return length(variance);
}
```

### Exponential Moving Average

```glsl
// film/ema.glsl
uniform float u_film_ema_alpha;  // Blend factor

Radiance accumulate(Spectrum new_sample, vec2 pixel) {
    if (u_film_reset || u_sample_count == 0) {
        return Radiance(new_sample);
    }
    
    vec2 uv = pixel / u_resolution;
    Radiance history = texture(u_film_radiance, uv).rgb;
    
    // Exponential blend
    return mix(history, Radiance(new_sample), u_film_ema_alpha);
}
```

### Module Descriptor

```typescript
const simpleFilm: ModuleDescriptor = {
    id: { kind: 'film', name: 'simple', version: '1.0.0' },
    provides: ['film'],
    requires: [],
    fragment: {
        functions: filmGLSL,
        uniforms: `
            uniform sampler2D u_film_radiance;
            uniform int u_sample_count;
            uniform bool u_film_reset;
            uniform vec2 u_resolution;
        `
    },
    resources: [
        { name: 'radiance', type: 'texture2D', format: 'rgba32f' }
    ]
};

const varianceFilm: ModuleDescriptor = {
    id: { kind: 'film', name: 'variance', version: '1.0.0' },
    provides: ['film'],
    requires: [],
    fragment: {
        functions: varianceGLSL,
        uniforms: `
            uniform sampler2D u_film_radiance;
            uniform sampler2D u_film_variance;
            uniform int u_sample_count;
            uniform bool u_film_reset;
        `
    },
    resources: [
        { name: 'radiance', type: 'texture2D', format: 'rgba32f' },
        { name: 'variance', type: 'texture2D', format: 'rgba32f' }
    ]
};
```

## Developer Module Template

### Simple Gamma Correction

```glsl
// developer/gamma_only.glsl
RGB develop(Radiance radiance) {
    // Clamp and gamma correct
    vec3 color = clamp(vec3(radiance), 0.0, 1.0);
    return RGB(pow(color, vec3(1.0/2.2)));
}
```

### Reinhard Tone Mapper

```glsl
// developer/reinhard.glsl
uniform float u_developer_reinhard_white_point;

RGB develop(Radiance radiance) {
    float L_white = u_developer_reinhard_white_point * 
                   u_developer_reinhard_white_point;
    
    vec3 numerator = vec3(radiance) * 
                    (1.0 + vec3(radiance) / L_white);
    vec3 color = numerator / (1.0 + vec3(radiance));
    
    return RGB(pow(color, vec3(1.0/2.2)));
}
```

### ACES Filmic

```glsl
// developer/aces.glsl
RGB develop(Radiance radiance) {
    // ACES input matrix
    mat3 aces_input = mat3(
        0.59719, 0.35458, 0.04823,
        0.07600, 0.90834, 0.01566,
        0.02840, 0.13383, 0.83777
    );
    
    // ACES output matrix  
    mat3 aces_output = mat3(
        1.60475, -0.53108, -0.07367,
        -0.10208, 1.10813, -0.00605,
        -0.00327, -0.07276, 1.07602
    );
    
    vec3 x = aces_input * vec3(radiance);
    
    // RRT and ODT fit
    vec3 a = x * (x + 0.0245786) - 0.000090537;
    vec3 b = x * (0.983729 * x + 0.4329510) + 0.238081;
    vec3 color = aces_output * (a / b);
    
    return RGB(pow(clamp(color, 0.0, 1.0), vec3(1.0/2.2)));
}
```

### Debug Visualizations

```glsl
// developer/debug_viz.glsl
uniform int u_developer_viz_mode;

RGB develop(Radiance radiance) {
    float lum = dot(vec3(radiance), vec3(0.2126, 0.7152, 0.0722));
    
    switch(u_developer_viz_mode) {
        case 0:  // Normal tone mapping
            return RGB(pow(vec3(radiance) / (vec3(radiance) + 1.0), 
                          vec3(1.0/2.2)));
            
        case 1:  // False color by luminance
            if (lum < 0.001) return RGB(0, 0, 0);
            if (lum < 0.01) return RGB(0, 0, 1);
            if (lum < 0.1) return RGB(0, 1, 1);
            if (lum < 1.0) return RGB(0, 1, 0);
            if (lum < 10.0) return RGB(1, 1, 0);
            if (lum < 100.0) return RGB(1, 0.5, 0);
            return RGB(1, 0, 0);
            
        case 2:  // Zebra stripes for over/under exposure
            vec3 color = vec3(radiance) / (vec3(radiance) + 1.0);
            float pattern = sin(gl_FragCoord.x * 0.5 + 
                              gl_FragCoord.y * 0.5) * 0.5 + 0.5;
            
            if (lum < 0.01) {  // Underexposed
                color = mix(color, vec3(0, 0, 1), pattern * 0.5);
            } else if (lum > 10.0) {  // Overexposed
                color = mix(color, vec3(1, 0, 0), pattern * 0.5);
            }
            
            return RGB(pow(color, vec3(1.0/2.2)));
            
        default:
            return RGB(vec3(radiance));
    }
}
```

### Module Descriptor

```typescript
const gammaDeveloper: ModuleDescriptor = {
    id: { kind: 'developer', name: 'gamma_only', version: '1.0.0' },
    provides: ['developer'],
    requires: [],
    fragment: {
        functions: developerGLSL,
        uniforms: ''
    }
};

const acesDeveloper: ModuleDescriptor = {
    id: { kind: 'developer', name: 'aces', version: '1.0.0' },
    provides: ['developer'],
    requires: [],
    fragment: {
        functions: acesGLSL,
        uniforms: ''
    }
};
```

## Complete Minimal Photography Assembly

```typescript
// Assembling a complete Photography pipeline
const minimalPhotography: PhotographyDescriptor = {
    camera: pinholeCamera,
    estimator: simplePathTracer,
    film: simpleFilm,
    developer: gammaDeveloper,
    
    metadata: {
        hasVolumes: false,
        maxBounces: 5,
        filmResources: {
            radiance: { format: 'rgba32f', count: 1 }
        }
    }
};

// Main function generated by engine
const mainFunction = `
void main() {
    vec2 pixel = gl_FragCoord.xy;
    
    // Camera: generate ray
    vec2 xi = next_2d();
    Ray ray = c_generate_ray(pixel, xi);
    
    // Estimator: compute radiance
    Spectrum radiance = e_estimate(ray);
    
    // Film: accumulate
    Radiance accumulated = f_accumulate(radiance, pixel);
    
    // Developer: tone map
    RGB color = d_develop(accumulated);
    
    gl_FragColor = vec4(color, 1.0);
}
`;
```

## Tips for Starting

1. **Start with pinhole camera** - No DOF complexity
2. **Use simple path tracer** - Skip NEE initially
3. **Use simple film** - Just averaging, no variance
4. **Use gamma developer** - Simplest tone mapping
5. **Add features incrementally**:
    - First: Get basic path tracing working
    - Then: Add Russian roulette
    - Then: Add next event estimation
    - Then: Add variance tracking
    - Finally: Add advanced tone mapping

## Common Integration Points

### Camera → Estimator
```glsl
// Camera provides ray
Ray ray = c_generate_ray(pixel, xi);
// Estimator uses it
Spectrum radiance = e_estimate(ray);
```

### Estimator → World
```glsl
// Estimator queries scene
Hit hit;
if (!sc_intersect(ray, hit)) { /* ... */ }

// Estimator queries materials
Spectrum f = m_evaluate(wi, wo, hit);
Direction wo = m_sample(wi, hit, xi, pdf);

// Estimator queries lights
LightSample ls = l_sample_light(hit.p, xi);
```

### Film Buffer Management
```glsl
// Read previous frame
Radiance history = texture(u_film_radiance, uv).rgb;

// Update and return new value
return mix(history, new_sample, blend_factor);
```
