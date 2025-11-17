/**
 * Point Light Sampler
 *
 * A point light is a delta distribution - infinitely small point source.
 * No actual sampling is needed since there's only one direction to the light.
 *
 * Sampling: Delta distribution (deterministic)
 * PDF: 1.0 (delta distribution convention)
 * Falloff: Inverse square law (1/r²)
 */

import type { PointLight } from '../types.js';

export interface SamplerOptions {
  index: number;
  isSingleLight: boolean;
  useUniformAccessor?: boolean;  // Use lighting_get_light() for multi-light uniforms
}

/**
 * Generate GLSL sampler function for a point light
 */
export function generatePointLightSampler(light: PointLight, options: SamplerOptions): string {
  const { index, isSingleLight, useUniformAccessor = false } = options;

  // Different access patterns: single light uniforms, array access, or dynamic accessor
  let posAccess, radianceAccess;

  if (isSingleLight) {
    posAccess = 'u_light_position';
    radianceAccess = '(u_light_color * u_light_intensity)';
  } else if (useUniformAccessor) {
    posAccess = `lighting_get_light(${index}).param0.xyz`;
    radianceAccess = `lighting_get_light(${index}).radiance`;
  } else {
    posAccess = `u_lights[${index}].param0.xyz`;
    radianceAccess = `u_lights[${index}].radiance`;
  }

  const signature = isSingleLight ? 'Point p' : 'Point p, vec2 xi';

  return `
// Point light: ${light.id}
LightSample sample_light_${index}(${signature}) {
  LightSample ls;

  vec3 light_pos = ${posAccess};

  // Direction from surface point to light
  vec3 light_vector = light_pos - p;
  ls.distance = length(light_vector);
  ls.wi = normalize(light_vector);
  ls.position = light_pos;

  // Inverse square falloff: intensity falls off with 1/r²
  vec3 radiance = ${radianceAccess};
  ls.radiance = radiance / (ls.distance * ls.distance);

  // Delta distribution - PDF is 1.0 by convention
  // (The actual PDF would be a Dirac delta, but we use 1.0 in practice)
  ls.pdf = 1.0;

  return ls;
}
  `.trim();
}

/**
 * Generate uniforms for point light (single light mode only)
 */
export function generatePointLightUniforms(): string {
  return `
// Uniforms for point light
uniform vec3 u_light_position;
uniform vec3 u_light_color;
uniform float u_light_intensity;
  `.trim();
}

/**
 * Get parameters for point light (for UI controls)
 */
export function getPointLightParameters(light: PointLight) {
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
    }
  };
}

/**
 * Get uniform bindings for point light
 */
export function getPointLightUniformBindings(light: PointLight) {
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
    }
  ];
}

/**
 * Encode point light data for LightData struct
 */
export function encodePointLightData(light: PointLight) {
  const radiance: [number, number, number] = [
    light.color[0] * light.intensity,
    light.color[1] * light.intensity,
    light.color[2] * light.intensity
  ];

  return {
    radiance,
    samplingType: 1, // SAMPLING_POINT
    param0: [...light.position, 0] as [number, number, number, number],
    param1: [0, 0, 0, 0] as [number, number, number, number],
    param2: [0, 0, 0, 0] as [number, number, number, number]
  };
}
