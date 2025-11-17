/**
 * Quad Light Sampler - Single Light Mode
 *
 * Pure GLSL file for single quad light with no templating needed.
 * This version uses uniforms directly and generates random numbers internally.
 *
 * Uniforms Expected:
 *   uniform vec3 u_light_center;
 *   uniform vec3 u_light_edge1;
 *   uniform vec3 u_light_edge2;
 *   uniform vec3 u_light_color;
 *   uniform float u_light_intensity;
 */

// Quad light sampler (single light mode)
LightSample lighting_sample(Point p) {
  LightSample ls;

  // Generate random numbers for sampling
  vec2 xi = random2();

  // Access light parameters from uniforms
  vec3 center = u_light_center;
  vec3 edge1 = u_light_edge1;
  vec3 edge2 = u_light_edge2;

  // Sample point on quad
  // xi is [0,1]², shift to [-0.5, 0.5]² to center the sampling
  vec3 light_point = center + (xi.x - 0.5) * edge1 + (xi.y - 0.5) * edge2;

  // Quad normal (perpendicular to the plane)
  vec3 quad_normal = normalize(cross(edge1, edge2));

  // Direction from shading point to light sample
  vec3 to_light = light_point - p;
  float distance = length(to_light);
  ls.wi = to_light / distance;
  ls.distance = distance;
  ls.position = light_point;

  // Check if light sample faces the shading point
  // (backface culling - light doesn't emit from back side)
  float cos_light = dot(-ls.wi, quad_normal);
  if (cos_light <= 0.0) {
    ls.radiance = vec3(0.0);
    ls.pdf = 1.0;
    return ls;
  }

  // Quad area = |edge1 × edge2|
  float area = length(cross(edge1, edge2));

  // PDF conversion from area measure to solid angle measure
  // pdf_solid_angle = pdf_area × (distance² / cos_theta)
  ls.pdf = (distance * distance) / (area * cos_light);

  // Compute radiance from color and intensity
  ls.radiance = u_light_color * u_light_intensity;

  return ls;
}

// Helper function to get light data (for compatibility)
LightData lighting_get_light(int light_id) {
  if (light_id != 0) {
    return LightData(vec3(0.0), SAMPLING_NONE, vec4(0.0), vec4(0.0), vec4(0.0));
  }

  return LightData(
    u_light_color * u_light_intensity,
    SAMPLING_QUAD,
    vec4(u_light_center, 0.0),
    vec4(u_light_edge1, 0.0),
    vec4(u_light_edge2, 0.0)
  );
}
