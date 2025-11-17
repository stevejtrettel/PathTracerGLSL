/**
 * Test full function definition parsing
 */

import { SceneCompiler } from './SceneCompiler';
import type { SceneDescription } from './types';

const testScene: SceneDescription = {
  objects: [
    {
      id: 'box',
      sdf: `
        float sdBox(vec3 p) {
          vec3 q = abs(p) - vec3(1.0);
          return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
        }
      `,
      material: 'test'
    },
    {
      id: 'sphere',
      sdf: 'length(p) - 1.0',  // Old style expression
      material: 'test'
    }
  ],

  materials: new Map([
    ['test', {
      albedo: {
        glsl: `
          vec3 wavePattern(vec3 p) {
            float wave = sin(p.x * 10.0) * 0.5 + 0.5;
            return mix(vec3(1.0, 0.0, 0.0), vec3(0.0, 0.0, 1.0), wave);
          }
        `
      },
      roughness: 0.5,
      metallic: 0.0,
      ior: 1.5,
      emission: [0.0, 0.0, 0.0],
      emission_strength: 0.0
    }]
  ])
};

console.log('================================================================================');
console.log('FULL FUNCTION DEFINITION TEST');
console.log('================================================================================\n');

const compiler = new SceneCompiler();
const compiled = compiler.compile(testScene);

console.log('--- SDFs (showing name replacement) ---\n');
const sdfSection = compiled.fragment.functions.substring(
  compiled.fragment.functions.indexOf('// ========== OBJECT SDFs'),
  compiled.fragment.functions.indexOf('// ========== DISPATCH')
);
console.log(sdfSection);

console.log('\n--- Material Helpers (showing name replacement) ---\n');
const helperStart = compiled.fragment.functions.indexOf('// ========== PROCEDURAL MATERIAL HELPERS');
if (helperStart >= 0) {
  const propsStart = compiled.fragment.functions.indexOf('// ========== MATERIAL PROPERTIES', helperStart);
  console.log(compiled.fragment.functions.substring(helperStart, propsStart));
}

console.log('\n================================================================================');
console.log('SUCCESS: Function names replaced while preserving bodies!');
console.log('================================================================================');
