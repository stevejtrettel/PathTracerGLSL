/**
 * Sphere Light Sampler
 *
 * Samples a spherical area light with uniform distribution over the surface.
 *
 * Sampling: Uniform distribution over sphere surface using spherical coordinates
 * PDF: Solid angle measure accounting for the projected area
 */

import type { SphereLight } from '../types.js';

export interface SamplerOptions {
  index: number;
  isSingleLight: boolean;
}

/**
 * Generate GLSL sampler function for a sphere light
 */
export function generateSphereLightSampler(light: SphereLight, options: SamplerOptions): string {
  const { index, isSingleLight } = options;

  // Single light: access uniforms directly. Multi-light: always use lighting_get_light()
  const centerAccess = isSingleLight ? 'u_light_position' : `lighting_get_light(${index}).param0.xyz`;
  const radiusAccess = isSingleLight ? 'u_light_radius' : `lighting_get_light(${index}).param0.w`;
  const radianceAccess = isSingleLight ? '(u_light_color * u_light_intensity)' : `lighting_get_light(${index}).radiance`;
  const signature = isSingleLight ? 'Point p' : 'Point p, vec2 xi';
  const randomGen = isSingleLight ? 'vec2 xi = random2();' : '';

  return `
// Sphere light: ${light.id}
LightSample sample_light_${index}(${signature}) {
  LightSample ls;

  ${randomGen}
  vec3 center = ${centerAccess};
  float radius = ${radiusAccess};

  // Sample point uniformly on sphere surface using spherical coordinates
  // z ∈ [-1, 1] gives uniform distribution over sphere
  float z = 1.0 - 2.0 * xi.x;
  float r = sqrt(max(0.0, 1.0 - z * z));
  float phi = 2.0 * PI * xi.y;

  // Convert to Cartesian coordinates
  vec3 local_dir = vec3(r * cos(phi), r * sin(phi), z);
  vec3 light_point = center + radius * local_dir;

  // Direction from shading point to light sample
  vec3 to_light = light_point - p;
  float distance = length(to_light);
  ls.wi = to_light / distance;
  ls.distance = distance;
  ls.position = light_point;

  // Check if sample faces the shading point
  // Normal at sampled point points outward from sphere center
  vec3 light_normal = (light_point - center) / radius;
  float cos_light = dot(-ls.wi, light_normal);

  // Backface culling - sphere doesn't emit from inside
  if (cos_light <= 0.0) {
    ls.radiance = vec3(0.0);
    ls.pdf = 1.0;
    return ls;
  }

  // PDF conversion from uniform area sampling to solid angle
  // Surface area of sphere = 4πr²
  float sphere_area = 4.0 * PI * radius * radius;
  float pdf_area = 1.0 / sphere_area;

  // Convert area measure to solid angle measure
  // pdf_solid_angle = pdf_area × (distance² / cos_theta)
  ls.pdf = pdf_area * distance * distance / cos_light;

  ls.radiance = ${radianceAccess};

  return ls;
}
  `.trim();
}

/**
 * Generate uniforms for sphere light (single light mode only)
 */
export function generateSphereLightUniforms(): string {
  return `
// Uniforms for sphere light
uniform vec3 u_light_position;
uniform float u_light_radius;
uniform vec3 u_light_color;
uniform float u_light_intensity;
  `.trim();
}

/**
 * Get parameters for sphere light (for UI controls)
 */
export function getSphereLightParameters(light: SphereLight) {
  return {
    'light.color': {
      type: 'color' as const,
      default: light.color,
      name: 'Light Color'
    },
    'light.intensity': {
      type: 'float' as const,
      default: light.intensity,
      range: [0, 200],
      step: 1,
      name: 'Light Intensity'
    },
    'light.position': {
      type: 'vec3' as const,
      default: light.position,
      name: 'Light Position'
    },
    'light.radius': {
      type: 'float' as const,
      default: light.radius,
      range: [0.1, 5],
      step: 0.1,
      name: 'Light Radius'
    }
  };
}

/**
 * Get uniform bindings for sphere light
 */
export function getSphereLightUniformBindings(light: SphereLight) {
  return [
    {
      uniform: 'u_light_color',
      parameters: ['light.color'],
      type: 'vec3',
      compute: (params: any) => params['light.color'] || light.color
    },
    {
      uniform: 'u_light_intensity',
      parameters: ['light.intensity'],
      type: 'float',
      compute: (params: any) => params['light.intensity'] || light.intensity
    },
    {
      uniform: 'u_light_position',
      parameters: ['light.position'],
      type: 'vec3',
      compute: (params: any) => params['light.position'] || light.position
    },
    {
      uniform: 'u_light_radius',
      parameters: ['light.radius'],
      type: 'float',
      compute: (params: any) => params['light.radius'] || light.radius
    }
  ];
}

/**
 * Encode sphere light data for LightData struct
 */
export function encodeSphereLightData(light: SphereLight) {
  const radiance: [number, number, number] = [
    light.color[0] * light.intensity,
    light.color[1] * light.intensity,
    light.color[2] * light.intensity
  ];

  return {
    radiance,
    samplingType: 3, // SAMPLING_SPHERE
    param0: [...light.position, light.radius] as [number, number, number, number],
    param1: [0, 0, 0, 0] as [number, number, number, number],
    param2: [0, 0, 0, 0] as [number, number, number, number]
  };
}
