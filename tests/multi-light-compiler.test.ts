/**
 * Test that multi-light compilation generates correct GLSL
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

console.log('='.repeat(80));
console.log('MULTI-LIGHT COMPILATION TEST');
console.log('='.repeat(80));
console.log();

console.log('Number of lights:', multiLightDescription.lights.length);
console.log();

console.log('--- CONSTANTS ---');
console.log(module.fragment.constants);
console.log();

console.log('--- UNIFORMS ---');
console.log(module.fragment.uniforms || '(none - using constants)');
console.log();

console.log('--- FUNCTIONS (first 100 lines) ---');
const lines = module.fragment.functions.split('\n').slice(0, 100);
console.log(lines.join('\n'));
console.log();

console.log('='.repeat(80));
console.log('VERIFICATION CHECKLIST:');
console.log('='.repeat(80));

const code = module.fragment.functions;

// Check for required components
const checks = [
  ['NUM_LIGHTS is 3', code.includes('#define NUM_LIGHTS 3')],
  ['LightData array declared', code.includes('LightData u_lights[3]')],
  ['select_light() function exists', code.includes('int select_light(float xi)')],
  ['light_powers array exists', code.includes('const float light_powers[3]')],
  ['Main sampler uses xi parameter', code.includes('LightSample lighting_sample(Point p, vec2 xi)')],
  ['PDF multiplication present', code.includes('ls.pdf *= light_powers[light_idx] / total_power')],
  ['sample_light_0 exists', code.includes('sample_light_0')],
  ['sample_light_1 exists', code.includes('sample_light_1')],
  ['sample_light_2 exists', code.includes('sample_light_2')],
  ['Switch statement for dispatch', code.includes('switch(light_idx)')],
];

checks.forEach(([name, passed]) => {
  console.log(passed ? '✓' : '✗', name);
});

console.log();
console.log('='.repeat(80));

// Check for errors that would indicate problems
const problems = [
  ['Struct redefinition', code.includes('struct LightData')],
  ['Struct redefinition', code.includes('struct LightSample')],
];

let hasProblems = false;
problems.forEach(([name, found]) => {
  if (found) {
    console.log('⚠️  PROBLEM:', name);
    hasProblems = true;
  }
});

if (!hasProblems) {
  console.log('✓ No struct redefinition issues');
}

console.log('='.repeat(80));
