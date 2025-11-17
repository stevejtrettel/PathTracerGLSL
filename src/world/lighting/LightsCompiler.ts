/**
 * LightsCompiler - Simplified version using modular light samplers
 *
 * This is a PREVIEW of how LightsCompiler.ts would look after refactoring.
 * Each light type's logic is now in its own file in samplers/
 */

import type { ModuleDescriptor } from '../../engine/types.js';
import type { LightingDescription, Light, ParameterMetadata } from './types.js';

// Import light-specific modules
import {
  generatePointLightSampler,
  generatePointLightUniforms,
  getPointLightParameters,
  getPointLightUniformBindings,
  encodePointLightData
} from './samplers/point-light.js';

import {
  generateSphereLightSampler,
  generateSphereLightUniforms,
  getSphereLightParameters,
  getSphereLightUniformBindings,
  encodeSphereLightData
} from './samplers/sphere-light.js';

import {
  generateQuadLightSampler,
  generateQuadLightUniforms,
  getQuadLightParameters,
  getQuadLightUniformBindings,
  encodeQuadLightData
} from './samplers/quad-light.js';

export class LightsCompiler {
  /**
   * Compile a lighting description into a GLSL module
   *
   * @param description - Lighting setup to compile
   * @param options - Compilation options
   *   - uniformMode: 'auto' (default) | 'constants' | 'uniforms'
   *     - 'auto': Single light uses uniforms, multiple lights use constants
   *     - 'constants': Always use hardcoded constants
   *     - 'uniforms': Always use uniforms (allows runtime control)
   */
  compile(description: LightingDescription, options: { uniformMode?: 'auto' | 'constants' | 'uniforms' } = {}): ModuleDescriptor {
    const { lights } = description;
    const { uniformMode = 'auto' } = options;

    if (lights.length === 0) {
      return this.generateEmptyLightingModule();
    }

    const isSingleLight = lights.length === 1;

    // Determine whether to use uniforms
    const useUniforms = uniformMode === 'uniforms' || (uniformMode === 'auto' && isSingleLight);

    // Encode all lights using light-specific encoders
    const encodedLights = lights.map(light => this.encodeLightData(light));
    const lightPowers = encodedLights.map(l => this.luminance(l.radiance));
    const totalPower = lightPowers.reduce((sum, p) => sum + p, 0);

    // Generate sampler functions using light-specific generators
    const samplers = lights.map((light, index) =>
      this.generateLightSampler(light, { index, isSingleLight: useUniforms && isSingleLight })
    );

    // Generate the complete module
    return this.buildModule(lights, encodedLights, samplers, lightPowers, totalPower, useUniforms);
  }

  /**
   * Generate sampler for a specific light type
   */
  private generateLightSampler(light: Light, options: { index: number; isSingleLight: boolean }): string {
    switch (light.type) {
      case 'point':
        return generatePointLightSampler(light, options);
      case 'sphere':
        return generateSphereLightSampler(light, options);
      case 'quad':
        return generateQuadLightSampler(light, options);
      default:
        const _exhaustive: never = light;
        throw new Error(`Unknown light type: ${(light as any).type}`);
    }
  }

  /**
   * Encode light data using light-specific encoder
   */
  private encodeLightData(light: Light) {
    switch (light.type) {
      case 'point':
        return encodePointLightData(light);
      case 'sphere':
        return encodeSphereLightData(light);
      case 'quad':
        return encodeQuadLightData(light);
      default:
        const _exhaustive: never = light;
        throw new Error(`Unknown light type: ${(light as any).type}`);
    }
  }

  /**
   * Generate uniforms for single light using light-specific generator
   */
  private generateUniformsForSingleLight(light: Light): string {
    switch (light.type) {
      case 'point':
        return generatePointLightUniforms();
      case 'sphere':
        return generateSphereLightUniforms();
      case 'quad':
        return generateQuadLightUniforms();
      default:
        const _exhaustive: never = light;
        return '';
    }
  }

  /**
   * Generate parameters using light-specific generator
   */
  private generateParametersForLight(light: Light): Record<string, ParameterMetadata> {
    switch (light.type) {
      case 'point':
        return getPointLightParameters(light);
      case 'sphere':
        return getSphereLightParameters(light);
      case 'quad':
        return getQuadLightParameters(light);
      default:
        const _exhaustive: never = light;
        return {};
    }
  }

  /**
   * Generate uniform bindings using light-specific generator
   */
  private generateUniformBindingsForLight(light: Light): any[] {
    switch (light.type) {
      case 'point':
        return getPointLightUniformBindings(light);
      case 'sphere':
        return getSphereLightUniformBindings(light);
      case 'quad':
        return getQuadLightUniformBindings(light);
      default:
        const _exhaustive: never = light;
        return [];
    }
  }

  /**
   * Get uniform name for a light property (symmetric with SceneCompiler.paramToUniform)
   */
  private lightToUniform(lightId: string, property: string): string {
    return `u_light_${lightId}_${property}`;
  }

  /**
   * Build the complete GLSL module
   * (This stays in the main compiler - it's the orchestration logic)
   */
  private buildModule(
    lights: Light[],
    encodedLights: ReturnType<typeof encodePointLightData>[],
    samplers: string[],
    lightPowers: number[],
    totalPower: number,
    useUniforms: boolean
  ): ModuleDescriptor {
    const numLights = lights.length;
    const isSingleLight = numLights === 1;

    let uniformsCode = '';
    let lightDataCode = '';

    if (useUniforms && isSingleLight) {
      // Single light with uniforms (original behavior)
      uniformsCode = this.generateUniformsForSingleLight(lights[0]);
      lightDataCode = this.generateDynamicLightData(lights[0]);
    } else if (useUniforms && !isSingleLight) {
      // Multiple lights with uniforms (NEW!)
      uniformsCode = this.generateUniformsForMultipleLights(lights);
      lightDataCode = this.generateDynamicMultiLightData(lights);
    } else {
      // Constants mode (no uniforms)
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

      lightDataCode = `LightData u_lights[${numLights}] = LightData[${numLights}](
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

    const functions = `
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

    const parameters = useUniforms
      ? (isSingleLight
          ? this.generateParametersForLight(lights[0])
          : this.generateParametersForMultipleLights(lights))
      : {};

    const uniformBindings = useUniforms
      ? (isSingleLight
          ? this.generateUniformBindingsForLight(lights[0])
          : this.generateUniformBindingsForMultipleLights(lights))
      : [];

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

  // Helper methods (these stay in the main compiler)
  private luminance(rgb: [number, number, number]): number {
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  }

  private generateLightSelection(lightPowers: number[], totalPower: number): string {
    if (lightPowers.length === 1) {
      return '// Only one light - no selection needed';
    }

    return `
// Power-based light selection
float light_powers[${lightPowers.length}] = float[${lightPowers.length}](${lightPowers.map((p, i) => `\n  ${p.toFixed(6)}${i < lightPowers.length - 1 ? ',' : ''}`).join('')}
);
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

  private generateMainSampler(numLights: number, lightPowers: number[], totalPower: number): string {
    if (numLights === 1) {
      return `
// Forward declarations
LightSample lighting_sample(Point p);
LightSample lighting_sample(Point p, vec2 xi);

// Single-argument version (backwards compatible)
LightSample lighting_sample(Point p) {
  return sample_light_0(p);
}

// Two-argument version (for consistency with multi-light)
LightSample lighting_sample(Point p, vec2 xi) {
  return sample_light_0(p);  // Ignore xi for single light
}
      `.trim();
    }

    const dispatchCases = Array.from({ length: numLights }, (_, i) =>
      `    case ${i}: ls = sample_light_${i}(p, xi); break;`
    ).join('\n');

    return `
// Forward declarations
LightSample lighting_sample(Point p);
LightSample lighting_sample(Point p, vec2 xi);

// Single-argument version (backwards compatible)
LightSample lighting_sample(Point p) {
  vec2 xi = random2();
  return lighting_sample(p, xi);
}

// Two-argument version (provides control over random numbers)
LightSample lighting_sample(Point p, vec2 xi) {
  int light_idx = select_light(xi.x);
  vec2 light_xi = random2();

  LightSample ls;
  switch(light_idx) {
${dispatchCases}
  }

  ls.pdf *= light_powers[light_idx] / total_power;
  return ls;
}
    `.trim();
  }

  private generateDynamicLightData(light: Light): string {
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
      case 'point': return 1;
      case 'sphere': return 3;
      case 'quad': return 4;
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
   * Generate uniforms for multiple lights (symmetric with SceneCompiler pattern)
   */
  private generateUniformsForMultipleLights(lights: Light[]): string {
    const uniforms: string[] = [];

    for (const light of lights) {
      const id = light.id;

      // Common uniforms for all light types
      uniforms.push(`uniform vec3 ${this.lightToUniform(id, 'color')};`);
      uniforms.push(`uniform float ${this.lightToUniform(id, 'intensity')};`);

      // Type-specific uniforms
      switch (light.type) {
        case 'point':
          uniforms.push(`uniform vec3 ${this.lightToUniform(id, 'position')};`);
          break;
        case 'sphere':
          uniforms.push(`uniform vec3 ${this.lightToUniform(id, 'position')};`);
          uniforms.push(`uniform float ${this.lightToUniform(id, 'radius')};`);
          break;
        case 'quad':
          uniforms.push(`uniform vec3 ${this.lightToUniform(id, 'center')};`);
          uniforms.push(`uniform vec3 ${this.lightToUniform(id, 'edge1')};`);
          uniforms.push(`uniform vec3 ${this.lightToUniform(id, 'edge2')};`);
          break;
      }
    }

    return uniforms.join('\n');
  }

  /**
   * Generate dynamic LightData accessor for multiple lights with uniforms
   */
  private generateDynamicMultiLightData(lights: Light[]): string {
    const cases = lights.map((light, index) => {
      const id = light.id;
      const colorUniform = this.lightToUniform(id, 'color');
      const intensityUniform = this.lightToUniform(id, 'intensity');

      let param0, param1, param2;

      switch (light.type) {
        case 'point':
          param0 = `vec4(${this.lightToUniform(id, 'position')}, 0.0)`;
          param1 = 'vec4(0.0)';
          param2 = 'vec4(0.0)';
          break;
        case 'sphere':
          param0 = `vec4(${this.lightToUniform(id, 'position')}, ${this.lightToUniform(id, 'radius')})`;
          param1 = 'vec4(0.0)';
          param2 = 'vec4(0.0)';
          break;
        case 'quad':
          param0 = `vec4(${this.lightToUniform(id, 'center')}, 0.0)`;
          param1 = `vec4(${this.lightToUniform(id, 'edge1')}, 0.0)`;
          param2 = `vec4(${this.lightToUniform(id, 'edge2')}, 0.0)`;
          break;
        default:
          param0 = param1 = param2 = 'vec4(0.0)';
      }

      return `
  ${index > 0 ? 'else ' : ''}if (light_id == ${index}) {
    return LightData(
      ${colorUniform} * ${intensityUniform},
      ${this.getSamplingType(light)},
      ${param0},
      ${param1},
      ${param2}
    );
  }`.trim();
    });

    return `
// Light data accessor (reads from uniforms)
LightData lighting_get_light(int light_id) {
  ${cases.join('\n  ')}

  // Invalid light_id
  return LightData(vec3(0.0), SAMPLING_NONE, vec4(0.0), vec4(0.0), vec4(0.0));
}
    `.trim();
  }

  /**
   * Generate parameters for multiple lights
   */
  private generateParametersForMultipleLights(lights: Light[]): Record<string, ParameterMetadata> {
    const params: Record<string, ParameterMetadata> = {};

    for (const light of lights) {
      const id = light.id;

      // Common parameters
      params[`${id}.color`] = {
        type: 'color',
        default: light.color,
        name: `${id} Color`,
        group: id
      };

      params[`${id}.intensity`] = {
        type: 'float',
        default: light.intensity,
        range: [0, 100],
        step: 0.1,
        name: `${id} Intensity`,
        group: id
      };

      // Type-specific parameters
      switch (light.type) {
        case 'point':
          params[`${id}.position`] = {
            type: 'vec3',
            default: light.position,
            name: `${id} Position`,
            group: id
          };
          break;
        case 'sphere':
          params[`${id}.position`] = {
            type: 'vec3',
            default: light.position,
            name: `${id} Position`,
            group: id
          };
          params[`${id}.radius`] = {
            type: 'float',
            default: light.radius,
            range: [0.01, 5],
            step: 0.01,
            name: `${id} Radius`,
            group: id
          };
          break;
        case 'quad':
          params[`${id}.center`] = {
            type: 'vec3',
            default: light.center,
            name: `${id} Center`,
            group: id
          };
          params[`${id}.edge1`] = {
            type: 'vec3',
            default: [light.width * light.direction1[0], light.width * light.direction1[1], light.width * light.direction1[2]],
            name: `${id} Edge1`,
            group: id
          };
          params[`${id}.edge2`] = {
            type: 'vec3',
            default: [light.height * light.direction2[0], light.height * light.direction2[1], light.height * light.direction2[2]],
            name: `${id} Edge2`,
            group: id
          };
          break;
      }
    }

    return params;
  }

  /**
   * Generate uniform bindings for multiple lights
   */
  private generateUniformBindingsForMultipleLights(lights: Light[]): any[] {
    const bindings: any[] = [];

    for (const light of lights) {
      const id = light.id;

      // Common bindings
      bindings.push({
        uniform: this.lightToUniform(id, 'color'),
        parameters: [`${id}.color`],
        type: 'vec3',
        compute: (params: any) => params[`${id}.color`] || light.color
      });

      bindings.push({
        uniform: this.lightToUniform(id, 'intensity'),
        parameters: [`${id}.intensity`],
        type: 'float',
        compute: (params: any) => params[`${id}.intensity`] || light.intensity
      });

      // Type-specific bindings
      switch (light.type) {
        case 'point':
          bindings.push({
            uniform: this.lightToUniform(id, 'position'),
            parameters: [`${id}.position`],
            type: 'vec3',
            compute: (params: any) => params[`${id}.position`] || light.position
          });
          break;
        case 'sphere':
          bindings.push({
            uniform: this.lightToUniform(id, 'position'),
            parameters: [`${id}.position`],
            type: 'vec3',
            compute: (params: any) => params[`${id}.position`] || light.position
          });
          bindings.push({
            uniform: this.lightToUniform(id, 'radius'),
            parameters: [`${id}.radius`],
            type: 'float',
            compute: (params: any) => params[`${id}.radius`] || light.radius
          });
          break;
        case 'quad':
          bindings.push({
            uniform: this.lightToUniform(id, 'center'),
            parameters: [`${id}.center`],
            type: 'vec3',
            compute: (params: any) => params[`${id}.center`] || light.center
          });
          bindings.push({
            uniform: this.lightToUniform(id, 'edge1'),
            parameters: [`${id}.edge1`],
            type: 'vec3',
            compute: (params: any) => params[`${id}.edge1`] || [
              light.width * light.direction1[0],
              light.width * light.direction1[1],
              light.width * light.direction1[2]
            ]
          });
          bindings.push({
            uniform: this.lightToUniform(id, 'edge2'),
            parameters: [`${id}.edge2`],
            type: 'vec3',
            compute: (params: any) => params[`${id}.edge2`] || [
              light.height * light.direction2[0],
              light.height * light.direction2[1],
              light.height * light.direction2[2]
            ]
          });
          break;
      }
    }

    return bindings;
  }

  private generateEmptyLightingModule(): ModuleDescriptor {
    return {
      id: {
        kind: 'lighting',
        name: 'no-lighting',
        version: '1.0.0'
      },
      fragment: {
        constants: `#define NUM_LIGHTS 0`,
        functions: `
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
}
