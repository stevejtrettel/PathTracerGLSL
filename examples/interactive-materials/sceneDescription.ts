import type { SceneDescription } from '../../src/world/scene/types';

/**
 * Interactive materials example
 * Demonstrates UI-controllable material parameters
 * - Floor with controllable color
 * - Left sphere with adjustable roughness
 * - Right sphere with metallic control
 */
export const interactiveMaterialsScene: SceneDescription = {
  objects: [
    {
      id: 'floor',
      sdf: 'float sdf(vec3 p) { return p.y + 1.0; }',
      material: 'floor'
    },
    {
      id: 'left_sphere',
      sdf: 'float sdf(vec3 p) { return length(p - vec3(-1.5, 0.0, 0.0)) - 0.8; }',
      material: 'rough_sphere'
    },
    {
      id: 'right_sphere',
      sdf: 'float sdf(vec3 p) { return length(p - vec3(1.5, 0.0, 0.0)) - 0.8; }',
      material: 'metallic_sphere'
    }
  ],

  materials: new Map([
    // Floor with controllable color
    ['floor', {
      albedo: { param: 'floor.color' },        // UI-controllable!
      roughness: 0.9,
      metallic: 0.0,
      ior: 1.5,
      emission: [0.0, 0.0, 0.0],
      emission_strength: 0.0
    }],

    // Sphere with adjustable roughness
    ['rough_sphere', {
      albedo: { param: 'rough.color' },        // UI-controllable!
      roughness: { param: 'rough.roughness' }, // UI-controllable!
      metallic: 0.0,
      ior: 1.5,
      emission: [0.0, 0.0, 0.0],
      emission_strength: 0.0
    }],

    // Sphere with metallic control
    ['metallic_sphere', {
      albedo: { param: 'metal.color' },        // UI-controllable!
      roughness: { param: 'metal.roughness' }, // UI-controllable!
      metallic: { param: 'metal.metallic' },   // UI-controllable!
      ior: 1.5,
      emission: [0.0, 0.0, 0.0],
      emission_strength: 0.0
    }]
  ]),

  // Parameter definitions for the UI
  parameters: {
    'floor.color': {
      type: 'color',
      default: [0.5, 0.5, 0.5],
      name: 'Floor Color',
      group: 'Materials',
      help: 'Base color of the floor',
      triggersReset: false  // Color changes don't need reset
    },

    'rough.color': {
      type: 'color',
      default: [0.8, 0.3, 0.3],
      name: 'Rough Sphere Color',
      group: 'Materials',
      triggersReset: false
    },
    'rough.roughness': {
      type: 'float',
      default: 0.8,
      range: [0.0, 1.0],
      step: 0.01,
      name: 'Rough Sphere Roughness',
      group: 'Materials',
      help: '0 = mirror, 1 = fully diffuse',
      triggersReset: false
    },

    'metal.color': {
      type: 'color',
      default: [0.9, 0.9, 0.95],
      name: 'Metal Sphere Color',
      group: 'Materials',
      triggersReset: false
    },
    'metal.roughness': {
      type: 'float',
      default: 0.1,
      range: [0.0, 1.0],
      step: 0.01,
      name: 'Metal Sphere Roughness',
      group: 'Materials',
      triggersReset: false
    },
    'metal.metallic': {
      type: 'float',
      default: 0.9,
      range: [0.0, 1.0],
      step: 0.01,
      name: 'Metal Sphere Metallic',
      group: 'Materials',
      help: '0 = dielectric, 1 = metallic',
      triggersReset: false
    }
  }
};
