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
function generatePointLightSampler(light: PointLight, index: number): string {
  return `
    // Point light: ${light.id}
    LightSample sample_light_${index}(Point p, vec2 xi) {
      LightSample ls;

      vec3 light_pos = u_lights[${index}].param0.xyz;

      // Direction from surface point to light
      vec3 light_vector = light_pos - p;
      ls.distance = length(light_vector);
      ls.wi = normalize(light_vector);
      ls.position = light_pos;

      // Inverse square falloff
      vec3 radiance = u_lights[${index}].radiance;
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
function generateSphereLightSampler(light: SphereLight, index: number): string {
  return `
    // Sphere light: ${light.id}
    LightSample sample_light_${index}(Point p, vec2 xi) {
      LightSample ls;

      vec3 center = u_lights[${index}].param0.xyz;
      float radius = u_lights[${index}].param0.w;

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

      ls.radiance = u_lights[${index}].radiance;

      return ls;
    }
  `.trim();
}

/**
 * Generates GLSL sampler for a quad light
 */
function generateQuadLightSampler(light: QuadLight, index: number): string {
  return `
    // Quad light: ${light.id}
    LightSample sample_light_${index}(Point p, vec2 xi) {
      LightSample ls;

      vec3 center = u_lights[${index}].param0.xyz;
      vec3 edge1 = u_lights[${index}].param1.xyz;
      vec3 edge2 = u_lights[${index}].param2.xyz;

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

      ls.radiance = u_lights[${index}].radiance;

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
function generateLightSampler(light: Light, index: number): string {
  switch (light.type) {
    case 'point':
      return generatePointLightSampler(light, index);
    case 'sphere':
      return generateSphereLightSampler(light, index);
    case 'quad':
      return generateQuadLightSampler(light, index);
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

    // Encode all lights
    const encodedLights = lights.map(encodeLightData);
    const lightPowers = encodedLights.map(l => luminance(l.radiance));
    const totalPower = lightPowers.reduce((sum, p) => sum + p, 0);

    // Generate sampler functions for each light
    const samplers = lights.map((light, index) => generateLightSampler(light, index));

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

    // Generate light data array initialization
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

    const fragment = `
// ============================================
// Generated by LightsCompiler
// ${numLights} lights
// ============================================

#define NUM_LIGHTS ${numLights}
#define PI 3.14159265359

// Sampling type constants
#define SAMPLING_NONE 0
#define SAMPLING_POINT 1
#define SAMPLING_SPHERE 3
#define SAMPLING_QUAD 4

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

// ========== LIGHT DATA ARRAY ==========

LightData u_lights[${numLights}] = LightData[](
${lightDataArray}
);

// ========== INDIVIDUAL LIGHT SAMPLERS ==========

${samplers.join('\n\n')}

// ========== LIGHT SELECTION ==========

${this.generateLightSelection(lightPowers, totalPower)}

// ========== MAIN SAMPLING FUNCTION ==========

${this.generateMainSampler(numLights, lightPowers, totalPower)}

// ========== QUERY FUNCTIONS ==========

LightData lighting_get_light(int light_id) {
  if (light_id < 0 || light_id >= NUM_LIGHTS) {
    return LightData(vec3(0.0), SAMPLING_NONE, vec4(0.0), vec4(0.0), vec4(0.0));
  }
  return u_lights[light_id];
}

bool lighting_can_sample(int light_id) {
  if (light_id < 0 || light_id >= NUM_LIGHTS) return false;
  return u_lights[light_id].sampling_type != SAMPLING_NONE;
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

    return {
      id: {
        kind: 'lighting',
        name: 'compiled-lighting',
        version: '1.0.0'
      },
      fragment: {
        functions: fragment
      },
      uniformBindings: [],
      parameters: {}
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
      // Single light optimization
      return `
LightSample lighting_sample(Point p, vec2 xi) {
  return sample_light_0(p, xi);
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
        functions: `
#define NUM_LIGHTS 0

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
}
