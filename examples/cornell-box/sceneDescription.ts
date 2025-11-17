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
      albedo: [0.8, 0.8, 0.8],
      roughness: 0.9,
      metallic: 0.0,
      ior: 1.5,
      emission: [0.0, 0.0, 0.0],
      emission_strength: 0.0
    }],
    ['white_ceiling', {
      albedo: [0.8, 0.8, 0.8],
      roughness: 0.9,
      metallic: 0.0,
      ior: 1.5,
      emission: [0.0, 0.0, 0.0],
      emission_strength: 0.0
    }],
    ['white_back', {
      albedo: [0.8, 0.8, 0.8],
      roughness: 0.9,
      metallic: 0.0,
      ior: 1.5,
      emission: [0.0, 0.0, 0.0],
      emission_strength: 0.0
    }],
    ['red_left', {
      albedo: [0.8, 0.1, 0.1],
      roughness: 0.9,
      metallic: 0.0,
      ior: 1.5,
      emission: [0.0, 0.0, 0.0],
      emission_strength: 0.0
    }],
    ['green_right', {
      albedo: [0.1, 0.8, 0.1],
      roughness: 0.9,
      metallic: 0.0,
      ior: 1.5,
      emission: [0.0, 0.0, 0.0],
      emission_strength: 0.0
    }],
    ['reflective_sphere', {
      albedo: [0.9, 0.9, 0.9],
      roughness: 0.1,
      metallic: 0.0,
      ior: 1.5,
      emission: [0.0, 0.0, 0.0],
      emission_strength: 0.0
    }]
  ])
};
