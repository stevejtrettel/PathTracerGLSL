/**
 * Classic Cornell Box with a sphere
 *
 * A simple enclosed room with:
 * - White floor, ceiling, back wall
 * - Red left wall
 * - Green right wall
 * - A reflective sphere in the center
 */

import type { SceneDescription } from '../../src/world/scene/types.js';

export const cornellBoxScene: SceneDescription = {
  objects: [
    // Floor (white)
    {
      id: 'floor',
      sdf: 'float sdf(vec3 p) { return p.y + 2.0; }',
      material: 'white_floor'
    },

    // Ceiling (white)
    {
      id: 'ceiling',
      sdf: 'float sdf(vec3 p) { return -p.y + 2.0; }',
      material: 'white_ceiling'
    },

    // Back wall (white)
    {
      id: 'back_wall',
      sdf: 'float sdf(vec3 p) { return p.z + 2.0; }',
      material: 'white_back'
    },

    // Left wall (red)
    {
      id: 'left_wall',
      sdf: 'float sdf(vec3 p) { return -p.x + 2.0; }',
      material: 'red_left'
    },

    // Right wall (green)
    {
      id: 'right_wall',
      sdf: 'float sdf(vec3 p) { return p.x + 2.0; }',
      material: 'green_right'
    },

    // Sphere in center
    {
      id: 'sphere',
      sdf: 'float sdf(vec3 p) { return length(p - vec3(0.0, -1.0, 0.0)) - 0.8; }',
      material: 'reflective_sphere'
    }
  ],

  materials: new Map([
    ['white_floor', {
      type: 'lambert',
      albedo: [0.8, 0.8, 0.8]
    }],
    ['white_ceiling', {
      type: 'lambert',
      albedo: [0.8, 0.8, 0.8]
    }],
    ['white_back', {
      type: 'lambert',
      albedo: [0.8, 0.8, 0.8]
    }],
    ['red_left', {
      type: 'lambert',
      albedo: [0.8, 0.1, 0.1]
    }],
    ['green_right', {
      type: 'lambert',
      albedo: [0.1, 0.8, 0.1]
    }],
    ['reflective_sphere', {
      type: 'lambert',
      albedo: [0.9, 0.9, 0.9]
    }]
  ])
};
