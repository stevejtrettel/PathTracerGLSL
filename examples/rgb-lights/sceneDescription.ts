/**
 * RGB Color Mixing Scene
 *
 * Three spheres illuminated by red, green, and blue lights
 * demonstrating additive color mixing through overlapping shadows
 */

import type { SceneDescription } from '../../src/world/scene/types.js';

export const rgbScene: SceneDescription = {
  objects: [
    // Floor (white)
    {
      id: 'floor',
      sdf: 'float sdf(vec3 p) { return p.y + 1.0; }',
      material: 'white_floor'
    },

    // Back wall (white)
    {
      id: 'back_wall',
      sdf: 'float sdf(vec3 p) { return p.z + 3.0; }',
      material: 'white_back'
    },

    // Left sphere
    {
      id: 'sphere_left',
      sdf: 'float sdf(vec3 p) { return length(p - vec3(-1.0, 0.0, 0.0)) - 0.5; }',
      material: 'white_sphere'
    },

    // Center sphere
    {
      id: 'sphere_center',
      sdf: 'float sdf(vec3 p) { return length(p - vec3(0.0, 0.0, 0.0)) - 0.5; }',
      material: 'white_sphere'
    },

    // Right sphere
    {
      id: 'sphere_right',
      sdf: 'float sdf(vec3 p) { return length(p - vec3(1.0, 0.0, 0.0)) - 0.5; }',
      material: 'white_sphere'
    }
  ],

  materials: new Map([
    ['white_floor', {
      albedo: [0.9, 0.9, 0.9],
      roughness: 0.9,
      metallic: 0.0,
      ior: 1.5,
      emission: [0.0, 0.0, 0.0],
      emission_strength: 0.0
    }],
    ['white_back', {
      albedo: [0.9, 0.9, 0.9],
      roughness: 0.9,
      metallic: 0.0,
      ior: 1.5,
      emission: [0.0, 0.0, 0.0],
      emission_strength: 0.0
    }],
    ['white_sphere', {
      albedo: [0.9, 0.9, 0.9],
      roughness: 0.3,
      metallic: 0.0,
      ior: 1.5,
      emission: [0.0, 0.0, 0.0],
      emission_strength: 0.0
    }]
  ])
};
