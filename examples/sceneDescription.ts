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
      type: 'lambert',
      albedo: [0.5, 0.5, 0.5]
    }],
    ['red_mat', {
      type: 'lambert',
      albedo: [0.8, 0.2, 0.2]
    }],
    ['blue_mat', {
      type: 'lambert',
      albedo: [0.2, 0.2, 0.8]
    }]
  ])
};
