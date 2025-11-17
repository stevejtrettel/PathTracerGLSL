/**
 * Test that LightsCompiler generates valid GLSL without struct redefinition errors
 */

import { LightsCompiler } from './LightsCompiler.js';
import type { LightingDescription } from './types.js';

const lightingDescription: LightingDescription = {
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

console.log('Testing LightsCompiler...');

const compiler = new LightsCompiler();
const module = compiler.compile(lightingDescription);

console.log('\n✓ Module compiled successfully!');
console.log('Module ID:', module.id);
console.log('\nConstants section:');
console.log(module.fragment.constants);

console.log('\nUniforms section:');
console.log(module.fragment.uniforms || '(none)');

console.log('\nFunctions section (first 500 chars):');
console.log(module.fragment.functions?.substring(0, 500) || '(none)');

// Check that structs are NOT defined in the generated code
const functionsCode = module.fragment.functions || '';
const hasLightSampleDef = functionsCode.includes('struct LightSample');
const hasLightDataDef = functionsCode.includes('struct LightData');

if (hasLightSampleDef || hasLightDataDef) {
  console.error('\n❌ ERROR: Generated code still contains struct definitions!');
  if (hasLightSampleDef) console.error('  - Found struct LightSample');
  if (hasLightDataDef) console.error('  - Found struct LightData');
  process.exit(1);
} else {
  console.log('\n✓ No struct redefinitions found - structs will come from common-structs.glsl');
}

console.log('\n✓ All checks passed!');
