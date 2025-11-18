/**
 * LightsCompiler - Simplified version using modular light samplers
 *
 * This is a PREVIEW of how LightsCompiler.ts would look after refactoring.
 * Each light type's logic is now in its own file in samplers/
 */

import type { ModuleDescriptor, ParameterMetadata } from '../../../infrastructure/engine/types.js';
import type { LightingDescription, Light, LightPropertyValue } from './types.js';

// Import light-specific sampler generators
import { generatePointLightSampler } from './samplers/point-light.js';
import { generateSphereLightSampler } from './samplers/sphere-light.js';
import { generateQuadLightSampler } from './samplers/quad-light.js';

export class LightsCompiler {
  /**
   * Compile a lighting description into a GLSL module
   * Follows the same pattern as SceneCompiler:
   * - Direct values become inline constants
   * - { param: '...' } references become uniforms
   */
  compile(description: LightingDescription): ModuleDescriptor {
    const { lights, parameters = {} } = description;

    if (lights.length === 0) {
      return this.generateEmptyLightingModule();
    }

    // Analyze which parameters are used (like SceneCompiler does)
    const paramUsage = this.analyzeParameterUsage(lights, parameters);

    // Calculate light powers for selection (use default values for params)
    const lightPowers = lights.map(light => {
      const color = this.isParam(light.color) ? (parameters[light.color.param]?.default || [1, 1, 1]) : light.color;
      const intensity = this.isParam(light.intensity) ? (parameters[light.intensity.param]?.default || 1) : light.intensity;
      const radiance = [color[0] * intensity, color[1] * intensity, color[2] * intensity] as [number, number, number];
      return this.luminance(radiance);
    });
    const totalPower = lightPowers.reduce((sum, p) => sum + p, 0);

    // Generate sampler functions using light-specific generators
    const samplers = lights.map((light, index) =>
      this.generateLightSampler(light, { index })
    );

    // Generate the complete module
    return this.buildModule(lights, samplers, lightPowers, totalPower, paramUsage, parameters);
  }

  /**
   * Check if a property value is a parameter reference (like SceneCompiler.isParam)
   */
  private isParam<T>(value: LightPropertyValue<T>): value is { param: string } {
    return typeof value === 'object' && value !== null && 'param' in value;
  }

  /**
   * Analyze which parameters are used and their types (like SceneCompiler.analyzeParameterUsage)
   */
  private analyzeParameterUsage(
    lights: Light[],
    parameters: Record<string, ParameterMetadata>
  ): Map<string, 'vec3' | 'float'> {
    const usage = new Map<string, 'vec3' | 'float'>();

    // Check for parameter references in each light
    for (const light of lights) {
      // Common properties
      if (this.isParam(light.color)) {
        usage.set(light.color.param, 'vec3');
      }
      if (this.isParam(light.intensity)) {
        usage.set(light.intensity.param, 'float');
      }

      // Type-specific properties
      switch (light.type) {
        case 'point':
          if (this.isParam(light.position)) {
            usage.set(light.position.param, 'vec3');
          }
          break;
        case 'sphere':
          if (this.isParam(light.position)) {
            usage.set(light.position.param, 'vec3');
          }
          if (this.isParam(light.radius)) {
            usage.set(light.radius.param, 'float');
          }
          break;
        case 'quad':
          if (this.isParam(light.center)) {
            usage.set(light.center.param, 'vec3');
          }
          if (this.isParam(light.width)) {
            usage.set(light.width.param, 'float');
          }
          if (this.isParam(light.height)) {
            usage.set(light.height.param, 'float');
          }
          if (this.isParam(light.direction1)) {
            usage.set(light.direction1.param, 'vec3');
          }
          if (this.isParam(light.direction2)) {
            usage.set(light.direction2.param, 'vec3');
          }
          break;
      }
    }

    // Add ALL scene parameters (for any potential use)
    for (const [paramPath, paramMeta] of Object.entries(parameters)) {
      if (!usage.has(paramPath)) {
        const type = paramMeta.type;
        if (type === 'color' || type === 'vec3') {
          usage.set(paramPath, 'vec3');
        } else if (type === 'float' || type === 'int') {
          usage.set(paramPath, 'float');
        }
      }
    }

    return usage;
  }

  /**
   * Get uniform name for a parameter (symmetric with SceneCompiler.paramToUniform)
   */
  private paramToUniform(paramPath: string): string {
    return 'u_light_' + paramPath.replace(/\./g, '_');
  }

  /**
   * Generate sampler for a specific light type
   */
  private generateLightSampler(light: Light, options: { index: number }): string {
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
   * Build the complete GLSL module (following SceneCompiler pattern)
   */
  private buildModule(
    lights: Light[],
    samplers: string[],
    lightPowers: number[],
    totalPower: number,
    paramUsage: Map<string, 'vec3' | 'float'>,
    parameters: Record<string, ParameterMetadata>
  ): ModuleDescriptor {
    const numLights = lights.length;

    // Generate uniforms only for param references (like SceneCompiler)
    const uniformsCode = this.generateUniforms(paramUsage);

    // Generate lighting_get_light() function (like SceneCompiler's material properties)
    const lightDataCode = this.generateLightingGetLight(lights);

    const constants = `
// ============================================
// Generated by LightsCompiler
// ${numLights} light${numLights > 1 ? 's' : ''}
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
// ========== LIGHT DATA ACCESSOR ==========

${lightDataCode}

// ========== INDIVIDUAL LIGHT SAMPLERS ==========

${samplers.join('\n\n')}

// ========== LIGHT SELECTION ==========

${this.generateLightSelection(lightPowers, totalPower)}

// ========== MAIN SAMPLING FUNCTION ==========

${this.generateMainSampler(numLights, lightPowers, totalPower)}

// ========== QUERY FUNCTIONS ==========

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

    // Generate uniform bindings (like SceneCompiler)
    const uniformBindings = this.generateUniformBindings(paramUsage, parameters);

    return {
      id: {
        kind: 'lighting',
        name: 'compiled-lighting',
        version: '1.0.0'
      },
      fragment: {
        constants,
        uniforms: uniformsCode || undefined,
        functions
      },
      uniformBindings: uniformBindings.length > 0 ? uniformBindings : undefined,
      parameters
    };
  }

  // Helper methods (these stay in the main compiler)
  private luminance(rgb: [number, number, number]): number {
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  }

  /**
   * Generate uniform declarations (like SceneCompiler.generateUniforms)
   */
  private generateUniforms(paramUsage: Map<string, 'vec3' | 'float'>): string | null {
    if (paramUsage.size === 0) return null;

    const lines: string[] = [];
    for (const [paramPath, type] of paramUsage) {
      const uniformName = this.paramToUniform(paramPath);
      lines.push(`uniform ${type} ${uniformName};`);
    }

    return lines.join('\n');
  }

  /**
   * Generate lighting_get_light() function (like SceneCompiler.generateMaterialProperties)
   * Constructs LightData from inline constants or uniform references
   */
  private generateLightingGetLight(lights: Light[]): string {
    const cases: string[] = [];

    for (let i = 0; i < lights.length; i++) {
      const light = lights[i];

      // Build radiance value (color * intensity)
      const colorValue = this.isParam(light.color)
        ? this.paramToUniform(light.color.param)
        : `vec3(${light.color.map(v => v.toFixed(6)).join(', ')})`;
      const intensityValue = this.isParam(light.intensity)
        ? this.paramToUniform(light.intensity.param)
        : light.intensity.toFixed(6);
      const radianceValue = `${colorValue} * ${intensityValue}`;

      // Build sampling type
      const samplingType = light.type === 'point' ? 1 : light.type === 'sphere' ? 3 : 4;

      // Build param0, param1, param2 based on light type
      let param0, param1, param2;

      switch (light.type) {
        case 'point': {
          const pos = this.isParam(light.position)
            ? this.paramToUniform(light.position.param)
            : `vec3(${light.position.map(v => v.toFixed(6)).join(', ')})`;
          param0 = `vec4(${pos}, 0.0)`;
          param1 = 'vec4(0.0)';
          param2 = 'vec4(0.0)';
          break;
        }
        case 'sphere': {
          const pos = this.isParam(light.position)
            ? this.paramToUniform(light.position.param)
            : `vec3(${light.position.map(v => v.toFixed(6)).join(', ')})`;
          const radius = this.isParam(light.radius)
            ? this.paramToUniform(light.radius.param)
            : light.radius.toFixed(6);
          param0 = `vec4(${pos}, ${radius})`;
          param1 = 'vec4(0.0)';
          param2 = 'vec4(0.0)';
          break;
        }
        case 'quad': {
          const center = this.isParam(light.center)
            ? this.paramToUniform(light.center.param)
            : `vec3(${light.center.map(v => v.toFixed(6)).join(', ')})`;

          // Edge1 = direction1 * width
          const dir1 = this.isParam(light.direction1)
            ? this.paramToUniform(light.direction1.param)
            : `vec3(${light.direction1.map(v => v.toFixed(6)).join(', ')})`;
          const width = this.isParam(light.width)
            ? this.paramToUniform(light.width.param)
            : light.width.toFixed(6);

          // Edge2 = direction2 * height
          const dir2 = this.isParam(light.direction2)
            ? this.paramToUniform(light.direction2.param)
            : `vec3(${light.direction2.map(v => v.toFixed(6)).join(', ')})`;
          const height = this.isParam(light.height)
            ? this.paramToUniform(light.height.param)
            : light.height.toFixed(6);

          param0 = `vec4(${center}, 0.0)`;
          param1 = `vec4(${dir1} * ${width}, 0.0)`;
          param2 = `vec4(${dir2} * ${height}, 0.0)`;
          break;
        }
      }

      cases.push(`
  ${i > 0 ? 'else ' : ''}if (light_id == ${i}) {
    return LightData(
      ${radianceValue},
      ${samplingType},
      ${param0},
      ${param1},
      ${param2}
    );
  }`.trim());
    }

    return `
// Light data accessor (like SceneCompiler's material properties)
LightData lighting_get_light(int light_id) {
  ${cases.join('\n  ')}

  // Invalid light_id
  return LightData(vec3(0.0), SAMPLING_NONE, vec4(0.0), vec4(0.0), vec4(0.0));
}
    `.trim();
  }

  /**
   * Generate uniform bindings (like SceneCompiler.generateUniformBindings)
   */
  private generateUniformBindings(
    paramUsage: Map<string, 'vec3' | 'float'>,
    parameters: Record<string, ParameterMetadata>
  ): any[] {
    const bindings: any[] = [];

    for (const [paramPath, type] of paramUsage) {
      const uniformName = this.paramToUniform(paramPath);
      const paramMeta = parameters[paramPath];
      const defaultValue = paramMeta?.default || (type === 'vec3' ? [1, 1, 1] : 1.0);

      bindings.push({
        uniform: uniformName,
        parameters: [paramPath],
        type: type,
        compute: (params: any) => params[paramPath] || defaultValue
      });
    }

    return bindings;
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
