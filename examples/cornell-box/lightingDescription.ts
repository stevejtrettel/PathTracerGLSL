/**
 * Lighting for Cornell Box
 * Single quad area light on the ceiling
 */

import type { LightingDescription } from '../../src/world/lighting/types.js';

export const lightingDescription: LightingDescription = {
  lights: [
    {
      type: 'quad',
      id: 'ceiling_light',
      center: [0, 1.9, 0],
      width: 1.0,
      height: 1.0,
      direction1: [1, 0, 0],
      direction2: [0, 0, 1],
      color: [1, 1, 1],
      intensity: 40
    }
  ]
};
