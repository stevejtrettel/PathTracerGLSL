// Quad Area Light
// Rectangular area light with uniform sampling and proper solid-angle PDF
// Uniforms: u_quad_center (vec3), u_quad_edge1 (vec3), u_quad_edge2 (vec3), u_quad_radiance (vec3)
// Depends on: random2()

uniform vec3 u_quad_center;
uniform vec3 u_quad_edge1;
uniform vec3 u_quad_edge2;
uniform vec3 u_quad_radiance;

LightSample lighting_sample(Point p) {
    LightSample ls;
    vec2 xi = random2();

    vec3 light_point = u_quad_center +
                      (xi.x - 0.5) * u_quad_edge1 +
                      (xi.y - 0.5) * u_quad_edge2;

    vec3 quad_normal = normalize(cross(u_quad_edge1, u_quad_edge2));

    vec3 to_light = light_point - p;
    float distance = length(to_light);
    ls.wi = to_light / distance;
    ls.distance = distance;
    ls.position = light_point;

    float cos_light = dot(-ls.wi, quad_normal);
    if (cos_light <= 0.0) {
        ls.radiance = vec3(0.0);
        ls.pdf = 1.0;
        return ls;
    }

    float area = length(cross(u_quad_edge1, u_quad_edge2));
    ls.pdf = (distance * distance) / (area * cos_light);
    ls.radiance = u_quad_radiance;

    return ls;
}
