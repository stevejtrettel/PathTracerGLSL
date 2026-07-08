// Math utilities
// Provides: PI, TWO_PI, EPSILON, luminance(), build_basis(), local_to_world()

#define PI 3.14159265359
#define TWO_PI 6.28318530718
#define EPSILON 0.001

float luminance(vec3 c) {
    // Rec.709 coefficients (linear light). The Rec.601 set (0.299/0.587/0.114)
    // belongs to gamma-encoded SD video, not linear radiance.
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

void build_basis(vec3 n, out vec3 t, out vec3 b) {
    vec3 up = abs(n.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    t = normalize(cross(up, n));
    b = cross(n, t);
}

// Local shading space convention: Z-up (normal direction). cos_theta = local_dir.z
vec3 local_to_world(vec3 local_dir, vec3 n, vec3 t, vec3 b) {
    return local_dir.x * t + local_dir.y * b + local_dir.z * n;
}
