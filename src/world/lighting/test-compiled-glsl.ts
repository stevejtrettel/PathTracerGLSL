/**
 * Print the compiled GLSL for debugging
 */

import { LightsCompiler } from './LightsCompiler.js';
import type { LightingDescription } from './types.js';

const singleQuadLight: LightingDescription = {
  lights: [
    {
      type: 'quad',
      id: 'ceiling_light',
      center: [0, 3.9, 0],
      width: 2.0,
      height: 2.0,
      direction1: [1, 0, 0],
      direction2: [0, 0, 1],
      color: [1, 1, 1],
      intensity: 30
    }
  ]
};

const compiler = new LightsCompiler();
const module = compiler.compile(singleQuadLight);

console.log('================================================================================');
console.log('COMPILED GLSL - CONSTANTS');
console.log('================================================================================\n');
console.log(module.fragment.constants);

console.log('\n================================================================================');
console.log('COMPILED GLSL - UNIFORMS');
console.log('================================================================================\n');
console.log(module.fragment.uniforms);

console.log('\n================================================================================');
console.log('COMPILED GLSL - FUNCTIONS');
console.log('================================================================================\n');
console.log(module.fragment.functions);
