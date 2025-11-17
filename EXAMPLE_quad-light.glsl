/**
 * Quad/Area Light Sampler
 *
 * Samples a rectangular area light with uniform distribution.
 * The quad is defined by a center point and two edge vectors.
 *
 * Sampling: Uniform over the quad surface
 * PDF: Solid angle measure (distance² / (area × cos_theta))
 *
 * Template Variables:
 *   {{LIGHT_ID}} - Light identifier string
 *   {{INDEX}} - Light index number
 *   {{SIGNATURE}} - Function signature (Point p) or (Point p, vec2 xi)
 *   {{RANDOM_GEN}} - Random number generation (if single light)
 *   {{CENTER_ACCESS}} - How to access center (u_light_center or u_lights[i].param0.xyz)
 *   {{EDGE1_ACCESS}} - How to access edge1
 *   {{EDGE2_ACCESS}} - How to access edge2
 *   {{RADIANCE_ACCESS}} - How to access radiance
 */

// Quad light: {{LIGHT_ID}}
LightSample sample_light_{{INDEX}}({{SIGNATURE}}) {
  LightSample ls;

  {{RANDOM_GEN}}
  vec3 center = {{CENTER_ACCESS}};
  vec3 edge1 = {{EDGE1_ACCESS}};
  vec3 edge2 = {{EDGE2_ACCESS}};

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
  //
  // Derivation:
  //   dω = (dA · cos_θ) / r²
  //   where dω is solid angle, dA is area element, θ is angle between normal and direction
  //
  // For uniform area sampling: pdf_area = 1/A
  // Converting to solid angle: pdf_ω = pdf_area · (r² / cos_θ)
  ls.pdf = (distance * distance) / (area * cos_light);

  ls.radiance = {{RADIANCE_ACCESS}};

  return ls;
}
