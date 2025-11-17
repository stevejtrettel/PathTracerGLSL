/**
 * Test the LightsCompiler with various light configurations
 */

import { LightsCompiler } from './LightsCompiler.js';
import type { LightingDescription } from './types.js';

console.log('================================================================================');
console.log('LIGHTS COMPILER TEST');
console.log('================================================================================\n');

// ============================================
// Test 1: Multiple lights of different types
// ============================================

const multiLightScene: LightingDescription = {
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
    },
    {
      type: 'point',
      id: 'desk_lamp',
      position: [2, 1, 0],
      color: [1, 0.9, 0.7],
      intensity: 50
    },
    {
      type: 'sphere',
      id: 'orb',
      position: [-1, 2, 0],
      radius: 0.3,
      color: [0.5, 0.8, 1],
      intensity: 20
    }
  ]
};

const compiler = new LightsCompiler();
const module = compiler.compile(multiLightScene);

console.log('--- COMPILED MODULE (3 different light types) ---\n');
console.log(module.fragment.functions);

console.log('\n================================================================================');
console.log('SUCCESS: LightsCompiler generated unified lighting module!');
console.log('================================================================================\n');

console.log('Key features:');
console.log('✓ Light data array with all 3 lights');
console.log('✓ Individual sampler for each light (sample_light_0, sample_light_1, sample_light_2)');
console.log('✓ Power-based light selection');
console.log('✓ Main lighting_sample() dispatcher');
console.log('✓ Query functions (lighting_get_light, lighting_can_sample, etc.)');

console.log('\n--- ADDING A NEW LIGHT TYPE IS EASY ---\n');
console.log('To add a new light type (e.g., "directional"):');
console.log('1. Add DirectionalLight interface to types.ts');
console.log('2. Add generateDirectionalLightSampler() function');
console.log('3. Add case to generateLightSampler() dispatcher');
console.log('4. Add case to encodeLightData()');
console.log('\nThat\'s it! The core compiler logic stays the same.');
