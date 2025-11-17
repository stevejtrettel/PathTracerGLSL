/**
 * RGB Lighting Setup
 *
 * Three point lights positioned to create color mixing:
 * - Red light (left)
 * - Green light (top)
 * - Blue light (right)
 *
 * Where shadows overlap, you'll see:
 * - Red + Green = Yellow
 * - Green + Blue = Cyan
 * - Red + Blue = Magenta
 * - Red + Green + Blue = White
 */

import type { LightingDescription } from '../../src/world/lighting/types.js';

export const rgbLighting: LightingDescription = {
  lights: [
    // Red light from left
    {
      type: 'point',
      id: 'red_light',
      position: [-2.5, 1.5, 2.0],
      color: [1.0, 0.0, 0.0],  // Pure red
      intensity: 15.0
    },

    // Green light from top
    {
      type: 'point',
      id: 'green_light',
      position: [0.0, 3.0, 2.0],
      color: [0.0, 1.0, 0.0],  // Pure green
      intensity: 15.0
    },

    // Blue light from right
    {
      type: 'point',
      id: 'blue_light',
      position: [2.5, 1.5, 2.0],
      color: [0.0, 0.0, 1.0],  // Pure blue
      intensity: 15.0
    }
  ]
};
