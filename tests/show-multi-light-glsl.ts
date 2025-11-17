/**
 * Show the complete GLSL generated for multi-light
 */

import { LightsCompiler } from '../src/world/lighting/LightsCompiler.js';
import type { LightingDescription } from '../src/world/lighting/types.js';

const multiLightDescription: LightingDescription = {
  lights: [
    {
      type: 'quad',
      id: 'ceiling_light',
      center: [0, 1.8, 0],
      width: 1.2,
      height: 1.2,
      direction1: [1, 0, 0],
      direction2: [0, 0, 1],
      color: [1.0, 1.0, 1.0],
      intensity: 25.0
    },
    {
      type: 'sphere',
      id: 'left_light',
      position: [-1.5, 0.5, 0],
      radius: 0.3,
      color: [1.0, 0.3, 0.3],
      intensity: 15.0
    },
    {
      type: 'point',
      id: 'right_light',
      position: [1.5, 0.5, 0],
      color: [0.3, 0.3, 1.0],
      intensity: 20.0
    }
  ]
};

const compiler = new LightsCompiler();
const module = compiler.compile(multiLightDescription);

// Output complete generated GLSL
console.log(module.fragment.constants);
console.log(module.fragment.uniforms || '');
console.log(module.fragment.functions);
