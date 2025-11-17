/**
 * Interactive RGB Lighting Setup with Uniforms
 *
 * Three point lights that can be controlled at runtime
 */

import type { LightingDescription } from '../../src/world/lighting/types.js';

export const interactiveRgbLighting: LightingDescription = {
  lights: [
    {
      type: 'point',
      id: 'red_light',
      position: [-2.5, 1.5, 2.0],
      color: [1.0, 0.0, 0.0],
      intensity: 15.0
    },

    {
      type: 'point',
      id: 'green_light',
      position: [0.0, 3.0, 2.0],
      color: [0.0, 1.0, 0.0],
      intensity: 15.0
    },

    {
      type: 'point',
      id: 'blue_light',
      position: [2.5, 1.5, 2.0],
      color: [0.0, 0.0, 1.0],
      intensity: 15.0
    }
  ]
};
