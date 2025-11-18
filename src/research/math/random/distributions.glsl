// random.glsl - Sampling utility functions
// Assumes random(), random2(), random3() are available from RNG system

#define PI 3.14159265359
#define TWO_PI 6.28318530718

// ============ SPHERE SAMPLING ============

// Uniform point on unit sphere surface
vec3 sample_sphere_uniform(vec2 xi) {
    float z = 1.0 - 2.0 * xi.x;
    float r = sqrt(max(0.0, 1.0 - z * z));
    float phi = TWO_PI * xi.y;

    return vec3(
    r * cos(phi),
    r * sin(phi),
    z
    );
}

// ============ HEMISPHERE SAMPLING ============

// Uniform point on unit hemisphere (z > 0)
vec3 sample_hemisphere_uniform(vec2 xi) {
    float z = xi.x;
    float r = sqrt(max(0.0, 1.0 - z * z));
    float phi = TWO_PI * xi.y;

    return vec3(
    r * cos(phi),
    r * sin(phi),
    z
    );
}

// Cosine-weighted hemisphere sampling (for Lambertian BRDF)
vec3 sample_hemisphere_cosine(vec2 xi) {
    float z = sqrt(xi.x);  // cos(theta)
    float r = sqrt(1.0 - xi.x);  // sin(theta)
    float phi = TWO_PI * xi.y;

    return vec3(
    r * cos(phi),
    r * sin(phi),
    z
    );
}

// PDF for cosine-weighted hemisphere sampling
float pdf_hemisphere_cosine(float cos_theta) {
    return cos_theta / PI;
}

// ============ DISK SAMPLING ============

// Uniform point on unit disk
vec2 sample_disk_uniform(vec2 xi) {
    float r = sqrt(xi.x);
    float theta = TWO_PI * xi.y;
    return r * vec2(cos(theta), sin(theta));
}

// Concentric disk mapping (better stratification)
vec2 sample_disk_concentric(vec2 xi) {
    vec2 offset = 2.0 * xi - 1.0;

    if (offset.x == 0.0 && offset.y == 0.0) {
        return vec2(0.0);
    }

    float theta, r;
    if (abs(offset.x) > abs(offset.y)) {
        r = offset.x;
        theta = (PI / 4.0) * (offset.y / offset.x);
    } else {
        r = offset.y;
        theta = (PI / 2.0) - (PI / 4.0) * (offset.x / offset.y);
    }

    return r * vec2(cos(theta), sin(theta));
}

// ============ CONE SAMPLING ============

// Uniform sampling within a cone of angle theta_max
vec3 sample_cone_uniform(vec2 xi, float cos_theta_max) {
    float cos_theta = 1.0 - xi.x + xi.x * cos_theta_max;
    float sin_theta = sqrt(max(0.0, 1.0 - cos_theta * cos_theta));
    float phi = TWO_PI * xi.y;

    return vec3(
    sin_theta * cos(phi),
    sin_theta * sin(phi),
    cos_theta
    );
}

// ============ TRIANGLE SAMPLING ============

// Uniform point on triangle using barycentric coordinates
vec3 sample_triangle_uniform(vec2 xi) {
    float sqrt_xi = sqrt(xi.x);
    return vec3(
    1.0 - sqrt_xi,           // u
    sqrt_xi * (1.0 - xi.y),  // v
    sqrt_xi * xi.y           // w = 1 - u - v
    );
}

// ============ DISTRIBUTIONS ============

// Box-Muller transform for Gaussian distribution
vec2 sample_gaussian_2d(vec2 xi) {
    float r = sqrt(-2.0 * log(max(0.00001, xi.x)));
    float theta = TWO_PI * xi.y;
    return r * vec2(cos(theta), sin(theta));
}

// Exponential distribution
float sample_exponential(float xi, float lambda) {
    return -log(1.0 - xi) / lambda;
}

// ============ UTILITIES ============

// Build orthonormal basis from normal
void build_basis(vec3 n, out vec3 t, out vec3 b) {
    vec3 up = abs(n.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    t = normalize(cross(up, n));
    b = cross(n, t);
}

// Transform direction from local (z-up) to world coordinates
vec3 local_to_world(vec3 local_dir, vec3 n) {
    vec3 t, b;
    build_basis(n, t, b);
    return local_dir.x * t + local_dir.y * b + local_dir.z * n;
}

// Transform direction from world to local (z-up) coordinates
vec3 world_to_local(vec3 world_dir, vec3 n) {
    vec3 t, b;
    build_basis(n, t, b);
    return vec3(
    dot(world_dir, t),
    dot(world_dir, b),
    dot(world_dir, n)
    );
}

// Reflect vector around normal
vec3 reflect_vector(vec3 v, vec3 n) {
    return v - 2.0 * dot(v, n) * n;
}

// Refract vector through interface
vec3 refract_vector(vec3 v, vec3 n, float eta) {
    float cos_theta_i = -dot(v, n);
    float sin2_theta_i = max(0.0, 1.0 - cos_theta_i * cos_theta_i);
    float sin2_theta_t = eta * eta * sin2_theta_i;

    if (sin2_theta_t >= 1.0) {
        return vec3(0.0);  // Total internal reflection
    }

    float cos_theta_t = sqrt(1.0 - sin2_theta_t);
    return eta * v + (eta * cos_theta_i - cos_theta_t) * n;
}

// Fresnel reflectance (Schlick approximation)
float fresnel_schlick(float cos_theta, float f0) {
    return f0 + (1.0 - f0) * pow(1.0 - cos_theta, 5.0);
}

vec3 fresnel_schlick(float cos_theta, vec3 f0) {
    return f0 + (1.0 - f0) * pow(1.0 - cos_theta, 5.0);
}
