/**
 * Interactive RGB Lighting Setup with Parameters
 *
 * Three point lights that can be controlled at runtime using { param: '...' } syntax
 * This follows the same pattern as SceneCompiler's interactive materials
 */

import type { LightingDescription } from '../../src/world/lighting/types.js';

export const interactiveRgbLighting: LightingDescription = {
  lights: [
    {
      type: 'point',
      id: 'red_light',
      position: { param: 'red_light.position' },
      color: { param: 'red_light.color' },
      intensity: { param: 'red_light.intensity' }
    },

    {
      type: 'point',
      id: 'green_light',
      position: { param: 'green_light.position' },
      color: { param: 'green_light.color' },
      intensity: { param: 'green_light.intensity' }
    },

    {
      type: 'point',
      id: 'blue_light',
      position: { param: 'blue_light.position' },
      color: { param: 'blue_light.color' },
      intensity: { param: 'blue_light.intensity' }
    }
  ],

  // Parameter definitions for the UI (like SceneCompiler)
  parameters: {
    'red_light.position': {
      type: 'vec3',
      default: [-2.5, 1.5, 2.0],
      name: 'Red Light Position',
      group: 'Red Light'
    },
    'red_light.color': {
      type: 'color',
      default: [1.0, 0.0, 0.0],
      name: 'Red Light Color',
      group: 'Red Light'
    },
    'red_light.intensity': {
      type: 'float',
      default: 15.0,
      range: [0, 50],
      step: 0.5,
      name: 'Red Light Intensity',
      group: 'Red Light'
    },

    'green_light.position': {
      type: 'vec3',
      default: [0.0, 3.0, 2.0],
      name: 'Green Light Position',
      group: 'Green Light'
    },
    'green_light.color': {
      type: 'color',
      default: [0.0, 1.0, 0.0],
      name: 'Green Light Color',
      group: 'Green Light'
    },
    'green_light.intensity': {
      type: 'float',
      default: 15.0,
      range: [0, 50],
      step: 0.5,
      name: 'Green Light Intensity',
      group: 'Green Light'
    },

    'blue_light.position': {
      type: 'vec3',
      default: [2.5, 1.5, 2.0],
      name: 'Blue Light Position',
      group: 'Blue Light'
    },
    'blue_light.color': {
      type: 'color',
      default: [0.0, 0.0, 1.0],
      name: 'Blue Light Color',
      group: 'Blue Light'
    },
    'blue_light.intensity': {
      type: 'float',
      default: 15.0,
      range: [0, 50],
      step: 0.5,
      name: 'Blue Light Intensity',
      group: 'Blue Light'
    }
  }
};
