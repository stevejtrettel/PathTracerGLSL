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
   */
  compile(description: LightingDescription): ModuleDescriptor {
    const { lights } = description;

    if (lights.length === 0) {
      return this.generateEmptyLightingModule();
    }

    const isSingleLight = lights.length === 1;

    // Encode all lights using light-specific encoders
    const encodedLights = lights.map(light => this.encodeLightData(light));
    const lightPowers = encodedLights.map(l => this.luminance(l.radiance));
    const totalPower = lightPowers.reduce((sum, p) => sum + p, 0);

    // Generate sampler functions using light-specific generators
    const samplers = lights.map((light, index) =>
      this.generateLightSampler(light, { index, isSingleLight })
    );

    // Generate the complete module
    return this.buildModule(lights, encodedLights, samplers, lightPowers, totalPower);
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
   * Build the complete GLSL module
   * (This stays in the main compiler - it's the orchestration logic)
   */
  private buildModule(
    lights: Light[],
    encodedLights: ReturnType<typeof encodePointLightData>[],
    samplers: string[],
    lightPowers: number[],
    totalPower: number
  ): ModuleDescriptor {
    const numLights = lights.length;
    const isSingleLight = numLights === 1;

    let uniformsCode = '';
    let lightDataCode = '';

    if (isSingleLight) {
      uniformsCode = this.generateUniformsForSingleLight(lights[0]);
      lightDataCode = this.generateDynamicLightData(lights[0]);
    } else {
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

  private generateMainSampler(numLights: number, lightPowers: number[], totalPower: number): string {
    if (numLights === 1) {
      return `
LightSample lighting_sample(Point p) {
  return sample_light_0(p);
}
      `.trim();
    }

    const dispatchCases = Array.from({ length: numLights }, (_, i) =>
      `    case ${i}: return sample_light_${i}(p, xi);`
    ).join('\n');

    return `
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
