# World Module Templates

Minimal, functional starting points for each World module type.

## Geometry Module Template

### Euclidean Geometry (Simplest Possible)

```glsl
// geometry/euclidean.glsl
typedef vec3 Point;
typedef vec3 Direction;

// Required: Follow geodesic (straight line in Euclidean)
Point geodesic(Point origin, Direction dir, float t) {
    return origin + dir * t;
}

// Required: Inner product at point p
float dot(Direction v1, Direction v2, Point p) {
    return dot(v1, v2);  // Standard GLSL dot, p unused in flat space
}

// Required: Parallel transport (identity in flat space)
Direction parallel_transport(Direction v, Point from, Point to) {
    return v;
}

// Required: Orthonormal frame at point p
Frame frame(Point p, Direction normal) {
    Direction n = normalize(normal);
    // Pick non-parallel vector for tangent
    Direction t = abs(n.y) < 0.999 ? vec3(0,1,0) : vec3(1,0,0);
    t = normalize(cross(n, t));
    Direction b = cross(n, t);
    return Frame(p, t, b, n);
}
```

### Module Descriptor

```typescript
const euclideanGeometry: ModuleDescriptor = {
    id: { kind: 'geometry', name: 'euclidean', version: '1.0.0' },
    provides: ['geometry'],
    requires: [],
    fragment: {
        functions: geometryGLSL,
        uniforms: '',
        defines: {
            POINT_TYPE: 'vec3',
            DIRECTION_TYPE: 'vec3',
            GEOMETRY_TYPE: 'EUCLIDEAN'
        }
    }
};
```

## Object Module Template

### Simple SDF Sphere

```glsl
// objects/sphere.glsl
float sphere_sdf(vec3 p) {
    return length(p) - 1.0;  // Unit sphere at origin
}

int classify_sphere(vec3 p) {
    return sphere_sdf(p) < 0.0 ? 0 : MATERIAL_AIR;
}

vec3 normal_sphere(vec3 p) {
    return normalize(p);  // Analytic normal for sphere
}
```

### Parametric SDF with Transform

```glsl
// objects/parametric_sphere.glsl
uniform vec3 u_sphere_center;
uniform float u_sphere_radius;
uniform int u_sphere_material;

float sphere_sdf(vec3 p) {
    return length(p - u_sphere_center) - u_sphere_radius;
}

int classify_sphere(vec3 p) {
    return sphere_sdf(p) < 0.0 ? u_sphere_material : MATERIAL_AIR;
}

vec3 normal_sphere(vec3 p) {
    return normalize(p - u_sphere_center);
}
```

### Multi-Region Object

```glsl
// objects/shell.glsl
float shell_eval(vec3 p, out int region) {
    float d = length(p) - 1.0;  // Base sphere
    
    if (abs(d) < 0.1) {
        region = 1;  // Shell
        return abs(d) - 0.1;
    } else if (d < -0.1) {
        region = 0;  // Core
        return d + 0.1;
    }
    
    region = -1;  // Outside
    return d;
}

int classify_shell(vec3 p) {
    int region;
    float d = shell_eval(p, region);
    
    switch(region) {
        case 0: return 2;  // Core material
        case 1: return 3;  // Shell material
        default: return MATERIAL_AIR;
    }
}
```

## Scene Module Template (Generated)

### Minimal Single Object Scene

```glsl
// scene/simple.glsl - Generated for one sphere
struct NearbyObjects {
    float dists[3];
    int ids[3];
    int count;
};

// Dispatch to object SDFs
float eval_object_sdf(int obj_id, vec3 p) {
    switch(obj_id) {
        case 0: return sphere_sdf(p);
    }
    return MAX_DIST;
}

// Dispatch to object materials
int get_object_material(int obj_id, vec3 p) {
    switch(obj_id) {
        case 0: return classify_sphere(p);
    }
    return MATERIAL_AIR;
}

// Dispatch to object normals
vec3 get_object_normal(int obj_id, vec3 p) {
    switch(obj_id) {
        case 0: return normal_sphere(p);
    }
    return vec3(0, 1, 0);
}

// Required: Ray-scene intersection
bool intersect(Ray ray, out Hit hit) {
    float t = ray.tmin;
    
    for (int i = 0; i < MAX_STEPS && t < ray.tmax; i++) {
        Point p = g_geodesic(ray.origin, ray.direction, t);
        float d = eval_object_sdf(0, p);
        
        if (d < EPSILON) {
            // Build complete hit
            hit.t = t;
            hit.p = p;
            hit.n = get_object_normal(0, p);
            hit.incident = ray.direction;
            hit.object_id = 0;
            hit.part_id = -1;
            hit.uv = vec2(0);
            
            // Material interface (simplified - no nearby tracking)
            hit.material_from = MATERIAL_AIR;
            hit.material_to = get_object_material(0, p);
            hit.ior_ratio = 1.0;  // Air to material
            
            // Precompute frame
            hit.frame = g_frame(hit.p, hit.n);
            
            return true;
        }
        
        t += d * 0.9;  // Conservative marching
    }
    
    return false;
}

// Required: Shadow test (can be less conservative)
bool intersect_any(Ray ray, float max_t) {
    float t = ray.tmin;
    
    for (int i = 0; i < MAX_STEPS && t < max_t; i++) {
        Point p = g_geodesic(ray.origin, ray.direction, t);
        float d = eval_object_sdf(0, p);
        
        if (d < EPSILON) return true;
        t += d * 0.95;  // Less conservative for shadows
    }
    
    return false;
}

// Required: Point containment
bool inside(Point p, int object_id) {
    if (object_id == -1 || object_id == 0) {
        return eval_object_sdf(0, p) < 0.0;
    }
    return false;
}

// Required: Material at point
int classify_point(Point p, int object_id) {
    if (object_id == -1 || object_id == 0) {
        return get_object_material(0, p);
    }
    return MATERIAL_AIR;
}
```

### Scene with Nearby Tracking

```glsl
// scene/multiple_objects.glsl - Generated for multiple objects
void track_object(inout NearbyObjects nearby, float dist, int obj_id) {
    if (dist < nearby.dists[2]) {
        nearby.dists[2] = dist;
        nearby.ids[2] = obj_id;
        
        // Bubble sort to maintain order
        if (dist < nearby.dists[1]) {
            swap(nearby.dists[2], nearby.dists[1]);
            swap(nearby.ids[2], nearby.ids[1]);
            
            if (dist < nearby.dists[0]) {
                swap(nearby.dists[1], nearby.dists[0]);
                swap(nearby.ids[1], nearby.ids[0]);
            }
        }
    }
}

NearbyObjects find_nearby(vec3 p) {
    NearbyObjects nearby;
    nearby.dists = float[3](MAX_DIST, MAX_DIST, MAX_DIST);
    nearby.ids = int[3](-1, -1, -1);
    nearby.count = 0;
    
    // Evaluate all objects
    for (int i = 0; i < NUM_OBJECTS; i++) {
        float d = eval_object_sdf(i, p);
        track_object(nearby, d, i);
    }
    
    // Count objects within boundary
    for(int i = 0; i < 3; i++) {
        if(abs(nearby.dists[i]) < BOUNDARY_THRESHOLD) {
            nearby.count++;
        }
    }
    
    return nearby;
}

int resolve_material(vec3 p, NearbyObjects nearby) {
    // Fast path: single object
    if(nearby.count <= 1) {
        if(nearby.ids[0] >= 0 && nearby.dists[0] < 0.0) {
            return get_object_material(nearby.ids[0], p);
        }
        return MATERIAL_AIR;
    }
    
    // Multiple objects: deepest wins
    int material = MATERIAL_AIR;
    float deepest = 0.0;
    
    for(int i = 0; i < nearby.count; i++) {
        if(nearby.dists[i] < 0.0) {
            float depth = -nearby.dists[i];
            if(depth > deepest) {
                deepest = depth;
                material = get_object_material(nearby.ids[i], p);
            }
        }
    }
    
    return material;
}
```

## Material Module Template

### Lambert BRDF (Simplest)

```glsl
// materials/lambert.glsl
struct MaterialParams {
    vec3 albedo;
};

// Material parameters for each MaterialID
const MaterialParams params[2] = MaterialParams[](
    MaterialParams(vec3(0.8, 0.8, 0.8)),  // ID 0: white
    MaterialParams(vec3(0.0, 0.0, 0.0))   // ID 1: black (unused)
);

// Required: Evaluate BRDF
Spectrum evaluate(Direction wi, Direction wo, Hit hit) {
    // Skip if both materials are air
    if (hit.material_to == MATERIAL_AIR && 
        hit.material_from == MATERIAL_AIR) {
        return Spectrum(0);
    }
    
    // Get surface material
    int mat_id = (hit.material_to == MATERIAL_AIR) ? 
                 hit.material_from : hit.material_to;
    
    // Lambert BRDF = albedo / π
    float cos_o = g_dot(wo, hit.n, hit.p);
    if (cos_o <= 0.0) return Spectrum(0);
    
    return Spectrum(params[mat_id].albedo / PI);
}

// Required: Sample BRDF direction
Direction sample(Direction wi, Hit hit, vec2 xi, out float pdf) {
    // Cosine-weighted hemisphere sampling
    float cos_theta = sqrt(xi.y);
    float sin_theta = sqrt(1.0 - xi.y);
    float phi = 2.0 * PI * xi.x;
    
    vec3 local = vec3(
        sin_theta * cos(phi),
        sin_theta * sin(phi),
        cos_theta
    );
    
    // Transform to world space using hit frame
    Direction wo = hit.frame.t * local.x + 
                   hit.frame.b * local.y + 
                   hit.frame.n * local.z;
    
    pdf = cos_theta / PI;
    return wo;
}

// Required: PDF of direction
float pdf(Direction wi, Direction wo, Hit hit) {
    float cos_o = g_dot(wo, hit.n, hit.p);
    return (cos_o > 0.0) ? cos_o / PI : 0.0;
}
```

### Simple Glass Material

```glsl
// materials/glass.glsl
struct MaterialParams {
    float ior;
};

const MaterialParams params[2] = MaterialParams[](
    MaterialParams(1.5),   // ID 0: glass
    MaterialParams(1.0)    // ID 1: unused
);

Spectrum evaluate(Direction wi, Direction wo, Hit hit) {
    return Spectrum(0);  // Delta BSDF
}

Direction sample(Direction wi, Hit hit, vec2 xi, out float pdf) {
    float eta = hit.ior_ratio;  // Precomputed by Scene
    float cos_theta_i = -g_dot(wi, hit.n, hit.p);
    
    // Fresnel
    float F = fresnel_dielectric(cos_theta_i, eta);
    
    if (xi.x < F) {
        // Reflection
        pdf = F;
        return reflect(wi, hit.n);
    } else {
        // Refraction
        pdf = 1.0 - F;
        Direction wo = refract(wi, hit.n, eta);
        pdf *= eta * eta;  // Radiance change
        return wo;
    }
}

float pdf(Direction wi, Direction wo, Hit hit) {
    return 0.0;  // Delta distribution
}
```

## Lights Module Template

### Constant Sky (Simplest)

```glsl
// lights/constant_sky.glsl
uniform vec3 u_sky_color;

// Required: Sample light
LightSample sample_light(Point p, vec2 xi) {
    LightSample ls;
    
    // Uniform sphere sampling
    float cos_theta = 1.0 - 2.0 * xi.x;
    float sin_theta = sqrt(max(0.0, 1.0 - cos_theta * cos_theta));
    float phi = 2.0 * PI * xi.y;
    
    ls.wi = vec3(sin_theta * cos(phi), 
                 cos_theta, 
                 sin_theta * sin(phi));
    ls.distance = 1e10;
    ls.radiance = Spectrum(u_sky_color);
    ls.pdf = 1.0 / (4.0 * PI);
    ls.is_delta = false;
    ls.light_id = 0;
    
    return ls;
}

// Required: Evaluate radiance from direction
Spectrum eval_light(Point p, Direction wi) {
    return Spectrum(u_sky_color);
}

// Required: PDF of direction
float pdf_light(Point p, Direction wi) {
    return 1.0 / (4.0 * PI);
}
```

### Simple Point Light

```glsl
// lights/point.glsl
uniform vec3 u_light_position;
uniform vec3 u_light_color;
uniform float u_light_intensity;

LightSample sample_light(Point p, vec2 xi) {
    LightSample ls;
    
    vec3 to_light = u_light_position - p;
    ls.distance = length(to_light);
    ls.wi = normalize(to_light);
    
    float falloff = 1.0 / (ls.distance * ls.distance);
    ls.radiance = Spectrum(u_light_color * u_light_intensity * falloff);
    ls.pdf = 1.0;
    ls.is_delta = true;
    ls.light_id = 0;
    
    return ls;
}

Spectrum eval_light(Point p, Direction wi) {
    return Spectrum(0.0);  // Delta light
}

float pdf_light(Point p, Direction wi) {
    return 0.0;  // Delta light
}
```

## Complete Minimal World Assembly

```typescript
// Assembling a complete, functional World
const minimalWorld: WorldDescriptor = {
    geometry: euclideanGeometry,
    objects: [sphereObject],
    scene: compiledScene,
    material: lambertMaterial,
    lights: constantSky,
    
    metadata: {
        materialIds: [0],
        hasVolumes: false,
        hasDielectrics: false,
        objectCount: 1
    }
};

// Build pipeline
const worldCompiler = new WorldCompiler();
const compiledWorld = worldCompiler.compile(minimalWorld);

// Validation
const validator = new WorldValidator();
const result = validator.validate(compiledWorld);
if (!result.valid) {
    console.error('World validation failed:', result.errors);
}
```

## Tips for Starting

1. **Start with Euclidean geometry** - It's the simplest and most debuggable
2. **Use a single sphere** - Easiest SDF to verify
3. **Use Lambert material** - No complex BRDFs to debug
4. **Use constant sky light** - No sampling complexity
5. **Skip nearby tracking initially** - Add it when you have multiple objects
6. **Add features incrementally** - Get basics working first

## Common Gotchas

- Remember functions will be auto-prefixed (write `geodesic`, not `g_geodesic`)
- Material IDs start at 0, MATERIAL_AIR is -1
- Hit structure must be completely filled
- Conservative marching factor (0.9) prevents surface penetration
- Frame vectors must be orthonormal
- All directions must be normalized
