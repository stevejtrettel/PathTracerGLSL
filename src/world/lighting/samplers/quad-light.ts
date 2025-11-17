/**
 * Quad/Area Light Sampler
 *
 * Samples a rectangular area light with uniform distribution.
 * The quad is defined by a center point and two edge vectors.
 *
 * Sampling: Uniform over the quad surface
 * PDF: Solid angle measure (distance² / (area × cos_theta))
 */

import type { QuadLight } from '../types.js';

export interface SamplerOptions {
  index: number;
  isSingleLight: boolean;
  useUniformAccessor?: boolean;  // Use lighting_get_light() for multi-light uniforms
}

/**
 * Generate GLSL sampler function for a quad light
 */
export function generateQuadLightSampler(light: QuadLight, options: SamplerOptions): string {
  const { index, isSingleLight, useUniformAccessor = false } = options;

  // Different access patterns: single light uniforms, array access, or dynamic accessor
  let centerAccess, edge1Access, edge2Access, radianceAccess;

  if (isSingleLight) {
    centerAccess = 'u_light_center';
    edge1Access = 'u_light_edge1';
    edge2Access = 'u_light_edge2';
    radianceAccess = '(u_light_color * u_light_intensity)';
  } else if (useUniformAccessor) {
    centerAccess = `lighting_get_light(${index}).param0.xyz`;
    edge1Access = `lighting_get_light(${index}).param1.xyz`;
    edge2Access = `lighting_get_light(${index}).param2.xyz`;
    radianceAccess = `lighting_get_light(${index}).radiance`;
  } else {
    centerAccess = `u_lights[${index}].param0.xyz`;
    edge1Access = `u_lights[${index}].param1.xyz`;
    edge2Access = `u_lights[${index}].param2.xyz`;
    radianceAccess = `u_lights[${index}].radiance`;
  }

  // Function signature depends on whether we're in single or multi-light mode
  const signature = isSingleLight ? 'Point p' : 'Point p, vec2 xi';
  const randomGen = isSingleLight ? 'vec2 xi = random2();' : '';

  return `
// Quad light: ${light.id}
LightSample sample_light_${index}(${signature}) {
  LightSample ls;

  ${randomGen}
  vec3 center = ${centerAccess};
  vec3 edge1 = ${edge1Access};
  vec3 edge2 = ${edge2Access};

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

  ls.radiance = ${radianceAccess};

  return ls;
}
  `.trim();
}

/**
 * Generate uniforms for quad light (single light mode only)
 */
export function generateQuadLightUniforms(): string {
  return `
// Uniforms for quad light
uniform vec3 u_light_center;
uniform vec3 u_light_edge1;
uniform vec3 u_light_edge2;
uniform vec3 u_light_color;
uniform float u_light_intensity;
  `.trim();
}

/**
 * Get parameters for quad light (for UI controls)
 */
export function getQuadLightParameters(light: QuadLight) {
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
    'light.center': {
      type: 'vec3' as const,
      default: light.center,
      name: 'Light Center'
    },
    'light.width': {
      type: 'float' as const,
      default: light.width,
      range: [0.1, 10],
      step: 0.1,
      name: 'Light Width'
    },
    'light.height': {
      type: 'float' as const,
      default: light.height,
      range: [0.1, 10],
      step: 0.1,
      name: 'Light Height'
    },
    'light.direction1': {
      type: 'vec3' as const,
      default: light.direction1,
      name: 'Width Direction'
    },
    'light.direction2': {
      type: 'vec3' as const,
      default: light.direction2,
      name: 'Height Direction'
    }
  };
}

/**
 * Get uniform bindings for quad light
 */
export function getQuadLightUniformBindings(light: QuadLight) {
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
      uniform: 'u_light_center',
      parameters: ['light.center'],
      type: 'vec3',
      compute: (params: any) => params['light.center'] || light.center
    },
    {
      uniform: 'u_light_edge1',
      parameters: ['light.width', 'light.direction1'],
      type: 'vec3',
      compute: (params: any) => {
        const width = params['light.width'] || light.width;
        const dir = params['light.direction1'] || light.direction1;
        return [dir[0] * width, dir[1] * width, dir[2] * width];
      }
    },
    {
      uniform: 'u_light_edge2',
      parameters: ['light.height', 'light.direction2'],
      type: 'vec3',
      compute: (params: any) => {
        const height = params['light.height'] || light.height;
        const dir = params['light.direction2'] || light.direction2;
        return [dir[0] * height, dir[1] * height, dir[2] * height];
      }
    }
  ];
}

/**
 * Encode quad light data for LightData struct
 */
export function encodeQuadLightData(light: QuadLight) {
  const radiance: [number, number, number] = [
    light.color[0] * light.intensity,
    light.color[1] * light.intensity,
    light.color[2] * light.intensity
  ];

  // Compute edge vectors from width/height and directions
  const edge1: [number, number, number] = [
    light.direction1[0] * light.width,
    light.direction1[1] * light.width,
    light.direction1[2] * light.width
  ];
  const edge2: [number, number, number] = [
    light.direction2[0] * light.height,
    light.direction2[1] * light.height,
    light.direction2[2] * light.height
  ];

  return {
    radiance,
    samplingType: 4, // SAMPLING_QUAD
    param0: [...light.center, 0] as [number, number, number, number],
    param1: [...edge1, 0] as [number, number, number, number],
    param2: [...edge2, 0] as [number, number, number, number]
  };
}

/**
 * Get GLSL code for accessing quad light data from LightData struct
 */
export function getQuadLightDataAccess(): string {
  return `
vec4(u_light_center, 0.0),
vec4(u_light_edge1, 0.0),
vec4(u_light_edge2, 0.0)
  `.trim();
}
