import type { SceneDescription } from '../../src/world/scene/types';

/**
 * Simple scene example
 * - Floor plane at y = -1
 * - Red diffuse sphere at origin
 * - Glass sphere offset to the right
 */
export const simpleSceneDescription: SceneDescription = {
  objects: [
    {
      id: 'floor',
      sdf: 'p.y + 1.0',
      material: 'concrete'
    },
    {
      id: 'red_sphere',
      sdf: 'length(p - vec3(0.0, 0.0, 0.0)) - 1.0',
      material: 'red_diffuse'
    },
    {
      id: 'glass_sphere',
      sdf: 'length(p - vec3(2.5, 0.0, 0.0)) - 0.7',
      material: 'glass'
    }
  ],

  materials: new Map([
    ['concrete', {
      albedo: [0.5, 0.5, 0.5],
      roughness: 0.8,
      metallic: 0.0,
      ior: 1.5,
      emission: [0.0, 0.0, 0.0],
      emission_strength: 0.0
    }],
    ['red_diffuse', {
      albedo: [0.8, 0.2, 0.2],
      roughness: 0.9,
      metallic: 0.0,
      ior: 1.5,
      emission: [0.0, 0.0, 0.0],
      emission_strength: 0.0
    }],
    ['glass', {
      albedo: [1.0, 1.0, 1.0],
      roughness: 0.0,
      metallic: 0.0,
      ior: 1.5,
      emission: [0.0, 0.0, 0.0],
      emission_strength: 0.0
    }]
  ])
};
