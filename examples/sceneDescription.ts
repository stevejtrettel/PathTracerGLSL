/**
 * Simple scene with spheres
 * - Floor plane
 * - Red sphere (left)
 * - Blue sphere (right)
 */

import type { SceneDescription } from '../src/world/scene/types.js';

export const simpleScene: SceneDescription = {
  objects: [
    // Floor
    {
      id: 'floor',
      sdf: 'float sdf(vec3 p) { return p.y + 1.0; }',
      material: 'floor_mat'
    },

    // Red sphere on left
    {
      id: 'sphere_left',
      sdf: 'float sdf(vec3 p) { return length(p - vec3(-1.2, 0.0, 0.0)) - 0.8; }',
      material: 'red_mat'
    },

    // Blue sphere on right
    {
      id: 'sphere_right',
      sdf: 'float sdf(vec3 p) { return length(p - vec3(1.2, 0.0, 0.0)) - 0.8; }',
      material: 'blue_mat'
    }
  ],

  materials: new Map([
    ['floor_mat', {
      albedo: [0.5, 0.5, 0.5],
      roughness: 0.9,
      metallic: 0.0,
      ior: 1.5,
      emission: [0.0, 0.0, 0.0],
      emission_strength: 0.0
    }],
    ['red_mat', {
      albedo: [0.8, 0.2, 0.2],
      roughness: 0.9,
      metallic: 0.0,
      ior: 1.5,
      emission: [0.0, 0.0, 0.0],
      emission_strength: 0.0
    }],
    ['blue_mat', {
      albedo: [0.2, 0.2, 0.8],
      roughness: 0.9,
      metallic: 0.0,
      ior: 1.5,
      emission: [0.0, 0.0, 0.0],
      emission_strength: 0.0
    }]
  ])
};
