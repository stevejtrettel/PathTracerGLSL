// Sphere Area Light
// Spherical area light with uniform surface sampling and solid-angle PDF
// Uniforms: u_sphere_light_position (vec3), u_sphere_light_radius (float), u_sphere_light_radiance (vec3)
// Depends on: random2()

#define PI 3.14159265359
#define TWO_PI 6.28318530718

uniform vec3 u_sphere_light_position;
uniform float u_sphere_light_radius;
uniform vec3 u_sphere_light_radiance;

vec3 sample_uniform_sphere(vec3 center, float radius, vec2 xi) {
    float z = 1.0 - 2.0 * xi.x;
    float r = sqrt(max(0.0, 1.0 - z * z));
    float phi = TWO_PI * xi.y;
    vec3 direction = vec3(r * cos(phi), r * sin(phi), z);
    return center + radius * direction;
}

LightSample lighting_sample(Point p) {
    LightSample ls;
    vec2 xi = random2();

    vec3 light_point = sample_uniform_sphere(
        u_sphere_light_position,
        u_sphere_light_radius,
        xi
    );

    vec3 to_light = light_point - p;
    float distance = length(to_light);
    ls.wi = to_light / distance;
    ls.distance = distance;
    ls.position = light_point;

    vec3 light_normal = (light_point - u_sphere_light_position) / u_sphere_light_radius;
    float cos_light = dot(-ls.wi, light_normal);

    if (cos_light <= 0.0) {
        ls.radiance = vec3(0.0);
        ls.pdf = 1.0;
        return ls;
    }

    float sphere_area = 4.0 * PI * u_sphere_light_radius * u_sphere_light_radius;
    float pdf_area = 1.0 / sphere_area;
    ls.pdf = pdf_area * distance * distance / cos_light;
    ls.radiance = u_sphere_light_radiance;

    return ls;
}
