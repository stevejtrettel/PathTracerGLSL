/**
 * Quad/Area Light Sampler - Conditional Compilation Version
 *
 * Uses @if/@else/@endif directives that are processed by template system
 *
 * Conditional Blocks:
 *   @if SINGLE_LIGHT - true when compiling for single light mode
 *   @if MULTI_LIGHT - true when compiling for multiple lights
 */

// Quad light: {{LIGHT_ID}}

// @if SINGLE_LIGHT
// Single light mode: direct uniform access, generate random numbers internally
LightSample sample_light_{{INDEX}}(Point p) {
  LightSample ls;

  // Generate random numbers for sampling
  vec2 xi = random2();

  // Access uniforms directly
  vec3 center = u_light_center;
  vec3 edge1 = u_light_edge1;
  vec3 edge2 = u_light_edge2;

// @else
// Multiple lights mode: array access, random numbers passed in
LightSample sample_light_{{INDEX}}(Point p, vec2 xi) {
  LightSample ls;

  // Access light data from array
  vec3 center = u_lights[{{INDEX}}].param0.xyz;
  vec3 edge1 = u_lights[{{INDEX}}].param1.xyz;
  vec3 edge2 = u_lights[{{INDEX}}].param2.xyz;
// @endif

  // ========== Common Sampling Code ==========
  // (This part is the same regardless of single/multi-light mode)

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

// @if SINGLE_LIGHT
  // Single light: compute radiance from uniforms
  ls.radiance = u_light_color * u_light_intensity;
// @else
  // Multiple lights: radiance pre-computed in array
  ls.radiance = u_lights[{{INDEX}}].radiance;
// @endif

  return ls;
}
