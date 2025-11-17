/**
 * Scene description with simple geometry
 */

import type { SceneDescription } from '../../src/world/scene/types.js';

export const sceneDescription: SceneDescription = {
  objects: [
    {
      id: 'floor',
      sdf: `
        float sdf(vec3 p) {
          return p.y + 1.0;
        }
      `,
      material: 'floor_mat'
    },
    {
      id: 'sphere_left',
      sdf: `
        float sdf(vec3 p) {
          return length(p - vec3(-1.2, 0.0, 0.0)) - 0.8;
        }
      `,
      material: 'red_mat'
    },
    {
      id: 'sphere_right',
      sdf: `
        float sdf(vec3 p) {
          return length(p - vec3(1.2, 0.0, 0.0)) - 0.8;
        }
      `,
      material: 'blue_mat'
    }
  ],

  materials: new Map([
    ['floor_mat', {
      albedo: [0.8, 0.8, 0.8],
      roughness: 0.9,
      metallic: 0.0,
      ior: 1.5,
      emission: [0, 0, 0],
      emission_strength: 0
    }],
    ['red_mat', {
      albedo: [0.8, 0.2, 0.2],
      roughness: 0.3,
      metallic: 0.0,
      ior: 1.5,
      emission: [0, 0, 0],
      emission_strength: 0
    }],
    ['blue_mat', {
      albedo: [0.2, 0.4, 0.8],
      roughness: 0.3,
      metallic: 0.0,
      ior: 1.5,
      emission: [0, 0, 0],
      emission_strength: 0
    }]
  ])
};
