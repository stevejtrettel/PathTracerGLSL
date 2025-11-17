/**
 * Multi-light test scene
 *
 * Tests the multiple light sampling system with:
 * - 1 quad area light (ceiling)
 * - 1 sphere light (left side)
 * - 1 point light (right side)
 */

import type { LightingDescription } from '../../src/world/lighting/types.js';

export const multiLightDescription: LightingDescription = {
  lights: [
    // Quad area light on ceiling
    {
      type: 'quad',
      id: 'ceiling_light',
      center: [0, 1.8, 0],
      width: 1.2,
      height: 1.2,
      direction1: [1, 0, 0],  // X direction
      direction2: [0, 0, 1],  // Z direction
      color: [1.0, 1.0, 1.0],
      intensity: 12.0  // Reduced from 25
    },

    // Sphere light on left
    {
      type: 'sphere',
      id: 'left_light',
      position: [-1.5, 0.5, 0],
      radius: 0.3,
      color: [1.0, 0.3, 0.3],  // Red-ish
      intensity: 6.0  // Reduced from 15
    },

    // Point light on right
    {
      type: 'point',
      id: 'right_light',
      position: [1.5, 0.5, 0],
      color: [0.3, 0.3, 1.0],  // Blue-ish
      intensity: 8.0  // Reduced from 20
    }
  ]
};
