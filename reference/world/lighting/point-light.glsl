// Point Light
// Point light source with inverse-square falloff
// Uniforms: u_light_position (vec3), u_light_radiance (vec3)

uniform vec3 u_light_position;
uniform vec3 u_light_radiance;

LightSample lighting_sample(Point p) {
    LightSample ls;
    vec3 light_vector = u_light_position - p;
    ls.distance = length(light_vector);
    ls.wi = normalize(light_vector);
    ls.position = u_light_position;
    ls.radiance = u_light_radiance / (ls.distance * ls.distance);
    return ls;
}
