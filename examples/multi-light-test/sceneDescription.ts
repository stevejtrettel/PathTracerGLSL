/**
 * Simple Cornell box-style scene for multi-light testing
 */

import type { SceneDescription } from '../../src/world/scene/types.js';

export const multiLightTestScene: SceneDescription = {
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

    // Left wall (neutral gray)
    {
      id: 'left_wall',
      sdf: 'float sdf(vec3 p) { return -p.x + 2.0; }',
      material: 'gray_left'
    },

    // Right wall (neutral gray)
    {
      id: 'right_wall',
      sdf: 'float sdf(vec3 p) { return p.x + 2.0; }',
      material: 'gray_right'
    },

    // Center sphere (white, slightly reflective)
    {
      id: 'sphere',
      sdf: 'float sdf(vec3 p) { return length(p - vec3(0.0, -1.0, 0.0)) - 0.8; }',
      material: 'white_sphere'
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
    ['gray_left', {
      albedo: [0.6, 0.6, 0.6],
      roughness: 0.9,
      metallic: 0.0,
      ior: 1.5,
      emission: [0.0, 0.0, 0.0],
      emission_strength: 0.0
    }],
    ['gray_right', {
      albedo: [0.6, 0.6, 0.6],
      roughness: 0.9,
      metallic: 0.0,
      ior: 1.5,
      emission: [0.0, 0.0, 0.0],
      emission_strength: 0.0
    }],
    ['white_sphere', {
      albedo: [0.9, 0.9, 0.9],
      roughness: 0.2,
      metallic: 0.0,
      ior: 1.5,
      emission: [0.0, 0.0, 0.0],
      emission_strength: 0.0
    }]
  ])
};
