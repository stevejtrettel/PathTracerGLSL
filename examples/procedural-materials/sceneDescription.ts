import type { SceneDescription } from '../../src/world/scene/types';

/**
 * Procedural materials example
 * Demonstrates GLSL-computed material properties
 * - Checkerboard floor
 * - Striped sphere
 * - Animated noise sphere
 */
export const proceduralMaterialsScene: SceneDescription = {
  objects: [
    {
      id: 'floor',
      sdf: 'float sdf(vec3 p) { return p.y + 1.0; }',
      material: 'checkerboard'
    },
    {
      id: 'left_sphere',
      sdf: 'float sdf(vec3 p) { return length(p - vec3(-1.5, 0.0, 0.0)) - 0.8; }',
      material: 'striped'
    },
    {
      id: 'right_sphere',
      sdf: 'float sdf(vec3 p) { return length(p - vec3(1.5, 0.0, 0.0)) - 0.8; }',
      material: 'noisy'
    }
  ],

  materials: new Map([
    // Checkerboard floor - procedural pattern with multi-line function
    ['checkerboard', {
      albedo: {
        glsl: `
          vec3 checkerboard(vec3 p) {
            // Compute checkerboard pattern
            float checker = mod(floor(p.x * 2.0) + floor(p.z * 2.0), 2.0);
            vec3 color1 = vec3(0.8, 0.8, 0.8);
            vec3 color2 = vec3(0.3, 0.3, 0.3);
            return mix(color1, color2, checker);
          }
        `
      },
      roughness: 0.9,
      metallic: 0.0,
      ior: 1.5,
      emission: [0.0, 0.0, 0.0],
      emission_strength: 0.0
    }],

    // Striped sphere - vertical stripes with local variables
    ['striped', {
      albedo: {
        glsl: `
          vec3 stripes(vec3 p) {
            // Vertical stripes based on x-position
            float stripes = sin(p.x * u_scene_stripe_freq) * 0.5 + 0.5;
            vec3 color1 = u_scene_stripe_color1;
            vec3 color2 = u_scene_stripe_color2;
            return mix(color1, color2, stripes);
          }
        `
      },
      roughness: 0.6,
      metallic: 0.0,
      ior: 1.5,
      emission: [0.0, 0.0, 0.0],
      emission_strength: 0.0
    }],

    // Noisy sphere - complex multi-statement noise
    ['noisy', {
      albedo: {
        glsl: `
          vec3 noiseColor(vec3 p) {
            // Simple hash-based noise pattern
            float n = fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
            vec3 baseColor = u_scene_noise_color;
            vec3 result = baseColor * (0.7 + 0.3 * n);
            return result;
          }
        `
      },
      roughness: {
        glsl: `
          float noiseRoughness(vec3 p) {
            // Procedural roughness variation
            float noise = fract(sin(dot(p, vec3(53.123, 91.456, 23.789))) * 21654.321);
            float r = 0.3 + 0.4 * noise;
            return r;
          }
        `
      },
      metallic: 0.0,
      ior: 1.5,
      emission: [0.0, 0.0, 0.0],
      emission_strength: 0.0
    }]
  ]),

  // Parameters that procedural materials can use
  parameters: {
    'stripe.freq': {
      type: 'float',
      default: 10.0,
      range: [1.0, 50.0],
      step: 0.5,
      name: 'Stripe Frequency',
      group: 'Procedural',
      help: 'Number of stripes across the sphere',
      triggersReset: false
    },
    'stripe.color1': {
      type: 'color',
      default: [0.9, 0.3, 0.3],
      name: 'Stripe Color 1',
      group: 'Procedural',
      triggersReset: false
    },
    'stripe.color2': {
      type: 'color',
      default: [0.3, 0.3, 0.9],
      name: 'Stripe Color 2',
      group: 'Procedural',
      triggersReset: false
    },
    'noise.color': {
      type: 'color',
      default: [0.9, 0.7, 0.4],
      name: 'Noise Base Color',
      group: 'Procedural',
      triggersReset: false
    }
  }
};
