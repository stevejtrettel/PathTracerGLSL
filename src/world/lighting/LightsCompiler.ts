/**
 * LightsCompiler - Generates unified GLSL lighting module from light descriptions
 *
 * Design Philosophy:
 * - Each light type has its own sampler generator function
 * - Adding new light types = adding a new generator function
 * - Core compiler logic doesn't need to change when adding types
 */

import type { ModuleDescriptor } from '../../engine/types.js';
import type {
  LightingDescription,
  Light,
  PointLight,
  SphereLight,
  QuadLight,
  CompilerLight,
  LightSampling,
  ParameterMetadata
} from './types.js';

// ============================================
// Light Type Sampler Generators
// ============================================

/**
 * Generates GLSL sampler for a point light
 * EASY TO EXTEND: Copy this pattern for new light types!
 */
function generatePointLightSampler(light: PointLight, index: number, isSingleLight: boolean): string {
  // For single light, access uniforms directly; for multiple, use array
  const posAccess = isSingleLight ? 'u_light_position' : 'u_lights[${index}].param0.xyz';
  const radianceAccess = isSingleLight ? '(u_light_color * u_light_intensity)' : 'u_lights[${index}].radiance';
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

      // Inverse square falloff
      vec3 radiance = ${radianceAccess};
      ls.radiance = radiance / (ls.distance * ls.distance);

      // Delta distribution - probability 1 since it's a point
      ls.pdf = 1.0;

      return ls;
    }
  `.trim();
}

/**
 * Generates GLSL sampler for a sphere light
 */
function generateSphereLightSampler(light: SphereLight, index: number, isSingleLight: boolean): string {
  const centerAccess = isSingleLight ? 'u_light_position' : `u_lights[${index}].param0.xyz`;
  const radiusAccess = isSingleLight ? 'u_light_radius' : `u_lights[${index}].param0.w`;
  const radianceAccess = isSingleLight ? '(u_light_color * u_light_intensity)' : `u_lights[${index}].radiance`;
  const signature = isSingleLight ? 'Point p' : 'Point p, vec2 xi';
  const randomGen = isSingleLight ? 'vec2 xi = random2();' : '';

  return `
    // Sphere light: ${light.id}
    LightSample sample_light_${index}(${signature}) {
      LightSample ls;

      ${randomGen}
      vec3 center = ${centerAccess};
      float radius = ${radiusAccess};

      // Sample point uniformly on sphere surface
      float z = 1.0 - 2.0 * xi.x;
      float r = sqrt(max(0.0, 1.0 - z * z));
      float phi = 2.0 * PI * xi.y;

      vec3 local_dir = vec3(r * cos(phi), r * sin(phi), z);
      vec3 light_point = center + radius * local_dir;

      // Direction from shading point to light sample
      vec3 to_light = light_point - p;
      float distance = length(to_light);
      ls.wi = to_light / distance;
      ls.distance = distance;
      ls.position = light_point;

      // Check if sample faces the shading point
      vec3 light_normal = (light_point - center) / radius;
      float cos_light = dot(-ls.wi, light_normal);

      if (cos_light <= 0.0) {
        ls.radiance = vec3(0.0);
        ls.pdf = 1.0;
        return ls;
      }

      // PDF conversion from uniform area sampling to solid angle
      float sphere_area = 4.0 * PI * radius * radius;
      float pdf_area = 1.0 / sphere_area;
      ls.pdf = pdf_area * distance * distance / cos_light;

      ls.radiance = ${radianceAccess};

      return ls;
    }
  `.trim();
}

/**
 * Generates GLSL sampler for a quad light
 */
function generateQuadLightSampler(light: QuadLight, index: number, isSingleLight: boolean): string {
  const centerAccess = isSingleLight ? 'u_light_center' : `u_lights[${index}].param0.xyz`;
  const edge1Access = isSingleLight ? 'u_light_edge1' : `u_lights[${index}].param1.xyz`;
  const edge2Access = isSingleLight ? 'u_light_edge2' : `u_lights[${index}].param2.xyz`;
  const radianceAccess = isSingleLight ? '(u_light_color * u_light_intensity)' : `u_lights[${index}].radiance`;
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
      vec3 light_point = center + (xi.x - 0.5) * edge1 + (xi.y - 0.5) * edge2;

      // Quad normal
      vec3 quad_normal = normalize(cross(edge1, edge2));

      // Direction from shading point to light
      vec3 to_light = light_point - p;
      float distance = length(to_light);
      ls.wi = to_light / distance;
      ls.distance = distance;
      ls.position = light_point;

      // Check orientation
      float cos_light = dot(-ls.wi, quad_normal);
      if (cos_light <= 0.0) {
        ls.radiance = vec3(0.0);
        ls.pdf = 1.0;
        return ls;
      }

      // Quad area
      float area = length(cross(edge1, edge2));

      // PDF conversion from area to solid angle
      ls.pdf = (distance * distance) / (area * cos_light);

      ls.radiance = ${radianceAccess};

      return ls;
    }
  `.trim();
}

// ============================================
// Light Sampler Dispatcher
// ============================================

/**
 * Dispatches to the appropriate sampler generator based on light type
 * TO ADD NEW LIGHT TYPE: Add a new case here
 */
function generateLightSampler(light: Light, index: number, isSingleLight: boolean): string {
  switch (light.type) {
    case 'point':
      return generatePointLightSampler(light, index, isSingleLight);
    case 'sphere':
      return generateSphereLightSampler(light, index, isSingleLight);
    case 'quad':
      return generateQuadLightSampler(light, index, isSingleLight);
    default:
      // TypeScript ensures this is exhaustive
      const _exhaustive: never = light;
      throw new Error(`Unknown light type: ${(light as any).type}`);
  }
}

// ============================================
// Light Data Encoding
// ============================================

/**
 * Encodes light parameters into uniform data
 * TO ADD NEW LIGHT TYPE: Add a new case here
 */
function encodeLightData(light: Light): {
  radiance: [number, number, number];
  samplingType: number;
  param0: [number, number, number, number];
  param1: [number, number, number, number];
  param2: [number, number, number, number];
} {
  const radiance: [number, number, number] = [
    light.color[0] * light.intensity,
    light.color[1] * light.intensity,
    light.color[2] * light.intensity
  ];

  switch (light.type) {
    case 'point':
      return {
        radiance,
        samplingType: 1, // SAMPLING_POINT
        param0: [...light.position, 0],
        param1: [0, 0, 0, 0],
        param2: [0, 0, 0, 0]
      };

    case 'sphere':
      return {
        radiance,
        samplingType: 3, // SAMPLING_SPHERE
        param0: [...light.position, light.radius],
        param1: [0, 0, 0, 0],
        param2: [0, 0, 0, 0]
      };

    case 'quad': {
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
        param0: [...light.center, 0],
        param1: [...edge1, 0],
        param2: [...edge2, 0]
      };
    }

    default:
      const _exhaustive: never = light;
      throw new Error(`Unknown light type: ${(light as any).type}`);
  }
}

/**
 * Computes luminance for power-based light selection
 */
function luminance(rgb: [number, number, number]): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

// ============================================
// Main Compiler
// ============================================

export class LightsCompiler {
  /**
   * Compile a lighting description into a GLSL module
   */
  compile(description: LightingDescription): ModuleDescriptor {
    const { lights } = description;

    if (lights.length === 0) {
      return this.generateEmptyLightingModule();
    }

    const isSingleLight = lights.length === 1;

    // Encode all lights
    const encodedLights = lights.map(encodeLightData);
    const lightPowers = encodedLights.map(l => luminance(l.radiance));
    const totalPower = lightPowers.reduce((sum, p) => sum + p, 0);

    // Generate sampler functions for each light
    const samplers = lights.map((light, index) => generateLightSampler(light, index, isSingleLight));

    // Generate the complete module
    return this.buildModule(lights, encodedLights, samplers, lightPowers, totalPower);
  }

  /**
   * Build the complete GLSL module
   */
  private buildModule(
    lights: Light[],
    encodedLights: ReturnType<typeof encodeLightData>[],
    samplers: string[],
    lightPowers: number[],
    totalPower: number
  ): ModuleDescriptor {
    const numLights = lights.length;

    // For single light, generate uniforms + parameters for UI control
    // For multiple lights, embed as constants (MIS problem deferred)
    const isSingleLight = numLights === 1;

    let uniformsCode = '';
    let lightDataCode = '';

    if (isSingleLight) {
      // Generate uniforms that will be populated from parameters
      uniformsCode = this.generateUniformsForSingleLight(lights[0]);
      lightDataCode = this.generateDynamicLightData(lights[0]);
    } else {
      // Embed light data as constants
      const lightDataArray = encodedLights
        .map(
          (data, i) => `  LightData(
    vec3(${data.radiance.join(', ')}),
    ${data.samplingType},
    vec4(${data.param0.join(', ')}),
    vec4(${data.param1.join(', ')}),
    vec4(${data.param2.join(', ')})
  )`
        )
        .join(',\n');

      lightDataCode = `LightData u_lights[${numLights}] = LightData[](
${lightDataArray}
);`;
    }

    const constants = `
// ============================================
// Generated by LightsCompiler
// ${numLights} light${numLights > 1 ? 's' : ''}${isSingleLight ? ' (with UI parameters)' : ''}
// ============================================

#define NUM_LIGHTS ${numLights}
#define PI 3.14159265359

// Sampling type constants
#define SAMPLING_NONE 0
#define SAMPLING_POINT 1
#define SAMPLING_SPHERE 3
#define SAMPLING_QUAD 4
`;

    const structs = `
// Light data structure
struct LightData {
  vec3 radiance;      // Color * intensity
  int sampling_type;  // Type of sampling
  vec4 param0;        // Position / center
  vec4 param1;        // Edge1 or other params
  vec4 param2;        // Edge2 or other params
};

// Light sample structure
struct LightSample {
  vec3 position;   // Point on light
  vec3 wi;         // Direction to light
  float distance;  // Distance to light
  vec3 radiance;   // Emitted radiance
  float pdf;       // Sampling PDF
};
`;

    const functions = `
${structs}

// ========== LIGHT DATA ${isSingleLight ? 'ACCESSOR' : 'ARRAY'} ==========

${lightDataCode}

// ========== INDIVIDUAL LIGHT SAMPLERS ==========

${samplers.join('\n\n')}

// ========== LIGHT SELECTION ==========

${this.generateLightSelection(lightPowers, totalPower)}

// ========== MAIN SAMPLING FUNCTION ==========

${this.generateMainSampler(numLights, lightPowers, totalPower)}

// ========== QUERY FUNCTIONS ==========

${isSingleLight ? '' : `
LightData lighting_get_light(int light_id) {
  if (light_id < 0 || light_id >= NUM_LIGHTS) {
    return LightData(vec3(0.0), SAMPLING_NONE, vec4(0.0), vec4(0.0), vec4(0.0));
  }
  return u_lights[light_id];
}
`}

bool lighting_can_sample(int light_id) {
  return (light_id >= 0 && light_id < NUM_LIGHTS);
}

int lighting_count() {
  return NUM_LIGHTS;
}

bool lighting_has_environment() {
  return false;  // TODO: Environment support
}

vec3 lighting_environment(vec3 dir) {
  return vec3(0.0);  // TODO: Environment support
}
`;

    // Generate parameters and bindings for single light
    const parameters = isSingleLight ? this.generateParametersForLight(lights[0]) : {};
    const uniformBindings = isSingleLight ? this.generateUniformBindingsForLight(lights[0]) : [];

    return {
      id: {
        kind: 'lighting',
        name: 'compiled-lighting',
        version: '1.0.0'
      },
      fragment: {
        constants,
        uniforms: uniformsCode,
        functions
      },
      uniformBindings,
      parameters
    };
  }

  /**
   * Generate light selection code
   */
  private generateLightSelection(lightPowers: number[], totalPower: number): string {
    if (lightPowers.length === 1) {
      return '// Only one light - no selection needed';
    }

    return `
// Power-based light selection
const float light_powers[${lightPowers.length}] = float[](${lightPowers.join(', ')});
const float total_power = ${totalPower.toFixed(6)};

int select_light(float xi) {
  float r = xi * total_power;
  float cumulative = 0.0;

  for (int i = 0; i < ${lightPowers.length}; i++) {
    cumulative += light_powers[i];
    if (r <= cumulative) return i;
  }

  return ${lightPowers.length - 1};
}
    `.trim();
  }

  /**
   * Generate main sampling function
   */
  private generateMainSampler(numLights: number, lightPowers: number[], totalPower: number): string {
    if (numLights === 1) {
      // Single light optimization - match old signature
      return `
LightSample lighting_sample(Point p) {
  return sample_light_0(p);
}
      `.trim();
    }

    // Multiple lights - need selection
    const dispatchCases = Array.from({ length: numLights }, (_, i) =>
      `    case ${i}: return sample_light_${i}(p, xi);`
    ).join('\n');

    return `
LightSample lighting_sample(Point p, vec2 xi) {
  // Select which light to sample
  int light_idx = select_light(xi.x);

  // Get new random numbers for the selected light
  vec2 light_xi = random2();

  // Dispatch to specific sampler
  LightSample ls;
  switch(light_idx) {
${dispatchCases}
  }

  // Account for selection probability
  ls.pdf *= light_powers[light_idx] / total_power;

  return ls;
}
    `.trim();
  }

  /**
   * Generate empty module when no lights exist
   */
  private generateEmptyLightingModule(): ModuleDescriptor {
    return {
      id: {
        kind: 'lighting',
        name: 'no-lighting',
        version: '1.0.0'
      },
      fragment: {
        constants: `
#define NUM_LIGHTS 0
        `,
        functions: `
struct LightSample {
  vec3 position;
  vec3 wi;
  float distance;
  vec3 radiance;
  float pdf;
};

struct LightData {
  vec3 radiance;
  int sampling_type;
  vec4 param0;
  vec4 param1;
  vec4 param2;
};

LightSample lighting_sample(vec3 p, vec2 xi) {
  LightSample ls;
  ls.pdf = 0.0;
  ls.radiance = vec3(0.0);
  return ls;
}

LightData lighting_get_light(int light_id) {
  return LightData(vec3(0.0), 0, vec4(0.0), vec4(0.0), vec4(0.0));
}

bool lighting_can_sample(int light_id) { return false; }
int lighting_count() { return 0; }
bool lighting_has_environment() { return false; }
vec3 lighting_environment(vec3 dir) { return vec3(0.0); }
        `
      },
      uniformBindings: [],
      parameters: {}
    };
  }

  /**
   * Generate uniforms for a single light (used for UI control)
   */
  private generateUniformsForSingleLight(light: Light): string {
    switch (light.type) {
      case 'point':
        return `
// Uniforms for point light
uniform vec3 u_light_position;
uniform vec3 u_light_color;
uniform float u_light_intensity;
        `.trim();

      case 'sphere':
        return `
// Uniforms for sphere light
uniform vec3 u_light_position;
uniform float u_light_radius;
uniform vec3 u_light_color;
uniform float u_light_intensity;
        `.trim();

      case 'quad':
        return `
// Uniforms for quad light
uniform vec3 u_light_center;
uniform vec3 u_light_edge1;
uniform vec3 u_light_edge2;
uniform vec3 u_light_color;
uniform float u_light_intensity;
        `.trim();

      default:
        const _exhaustive: never = light;
        return '';
    }
  }

  /**
   * Generate dynamic light data accessor (no global array - uniforms accessed directly)
   */
  private generateDynamicLightData(light: Light): string {
    // For single light, we don't need a global array
    // The sampler accesses uniforms directly
    // But we provide a helper for compatibility
    return `
// Light data accessor (accesses uniforms directly)
LightData lighting_get_light(int light_id) {
  if (light_id != 0) {
    return LightData(vec3(0.0), SAMPLING_NONE, vec4(0.0), vec4(0.0), vec4(0.0));
  }

  return LightData(
    u_light_color * u_light_intensity,
    ${this.getSamplingType(light)},
    ${this.getParam0(light)},
    ${this.getParam1(light)},
    ${this.getParam2(light)}
  );
}
    `.trim();
  }

  private getSamplingType(light: Light): number {
    switch (light.type) {
      case 'point': return 1; // SAMPLING_POINT
      case 'sphere': return 3; // SAMPLING_SPHERE
      case 'quad': return 4; // SAMPLING_QUAD
      default: return 0;
    }
  }

  private getParam0(light: Light): string {
    switch (light.type) {
      case 'point': return 'vec4(u_light_position, 0.0)';
      case 'sphere': return 'vec4(u_light_position, u_light_radius)';
      case 'quad': return 'vec4(u_light_center, 0.0)';
      default: return 'vec4(0.0)';
    }
  }

  private getParam1(light: Light): string {
    switch (light.type) {
      case 'quad': return 'vec4(u_light_edge1, 0.0)';
      default: return 'vec4(0.0)';
    }
  }

  private getParam2(light: Light): string {
    switch (light.type) {
      case 'quad': return 'vec4(u_light_edge2, 0.0)';
      default: return 'vec4(0.0)';
    }
  }

  /**
   * Generate parameters for a single light
   */
  private generateParametersForLight(light: Light): Record<string, ParameterMetadata> {
    const baseParams: Record<string, ParameterMetadata> = {
      'light.color': {
        type: 'color',
        default: light.color,
        name: 'Light Color'
      },
      'light.intensity': {
        type: 'float',
        default: light.intensity,
        range: [0, 200],
        step: 1,
        name: 'Light Intensity'
      }
    };

    switch (light.type) {
      case 'point':
        return {
          ...baseParams,
          'light.position': {
            type: 'vec3',
            default: light.position,
            name: 'Light Position'
          }
        };

      case 'sphere':
        return {
          ...baseParams,
          'light.position': {
            type: 'vec3',
            default: light.position,
            name: 'Light Position'
          },
          'light.radius': {
            type: 'float',
            default: light.radius,
            range: [0.1, 5],
            step: 0.1,
            name: 'Light Radius'
          }
        };

      case 'quad':
        return {
          ...baseParams,
          'light.center': {
            type: 'vec3',
            default: light.center,
            name: 'Light Center'
          },
          'light.width': {
            type: 'float',
            default: light.width,
            range: [0.1, 10],
            step: 0.1,
            name: 'Light Width'
          },
          'light.height': {
            type: 'float',
            default: light.height,
            range: [0.1, 10],
            step: 0.1,
            name: 'Light Height'
          },
          'light.direction1': {
            type: 'vec3',
            default: light.direction1,
            name: 'Width Direction'
          },
          'light.direction2': {
            type: 'vec3',
            default: light.direction2,
            name: 'Height Direction'
          }
        };

      default:
        const _exhaustive: never = light;
        return baseParams;
    }
  }

  /**
   * Generate uniform bindings for a single light
   */
  private generateUniformBindingsForLight(light: Light): any[] {
    const baseBindings = [
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
      }
    ];

    switch (light.type) {
      case 'point':
        return [
          ...baseBindings,
          {
            uniform: 'u_light_position',
            parameters: ['light.position'],
            type: 'vec3',
            compute: (params: any) => params['light.position'] || light.position
          }
        ];

      case 'sphere':
        return [
          ...baseBindings,
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

      case 'quad':
        return [
          ...baseBindings,
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

      default:
        const _exhaustive: never = light;
        return baseBindings;
    }
  }
}
