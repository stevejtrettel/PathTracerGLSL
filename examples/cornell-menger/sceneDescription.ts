/**
 * Cornell Box with Menger Sponge Fractal
 *
 * A Cornell box containing a Menger sponge fractal.
 * The Menger sponge is created by recursively subdividing a cube
 * and removing cross-shaped sections.
 */

import type { SceneDescription } from '../../src/world/scene/types.js';

// Menger sponge SDF
const mengerSpongeSDF = `
float sdf(vec3 p) {
  // Center the sponge
  vec3 pos = p - vec3(0.0, -0.5, 0.0);

  // Initial cube
  float d = length(max(abs(pos) - vec3(1.0), 0.0));

  // Scale for recursion
  float s = 1.0;

  // Menger sponge iterations
  for(int i = 0; i < 4; i++) {
    vec3 a = mod(pos * s, 2.0) - 1.0;
    s *= 3.0;
    vec3 r = abs(1.0 - 3.0 * abs(a));

    float da = max(r.x, r.y);
    float db = max(r.y, r.z);
    float dc = max(r.z, r.x);
    float c = (min(da, min(db, dc)) - 1.0) / s;

    d = max(d, c);
  }

  return d;
}
`;

export const mengerSpongeScene: SceneDescription = {
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

    // Menger sponge fractal
    {
      id: 'menger_sponge',
      sdf: mengerSpongeSDF,
      material: 'gold'
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
    ['gold', {
      albedo: [0.9, 0.7, 0.2],
      roughness: 0.3,
      metallic: 0.8,
      ior: 1.5,
      emission: [0.0, 0.0, 0.0],
      emission_strength: 0.0
    }]
  ])
};
