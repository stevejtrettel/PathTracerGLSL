/**
 * Test the SceneCompiler with procedural materials
 */

import { SceneCompiler } from './SceneCompiler';
import { proceduralMaterialsScene } from '../../../examples/procedural-materials/sceneDescription.js';

console.log('================================================================================');
console.log('PROCEDURAL MATERIALS TEST');
console.log('================================================================================\n');

const compiler = new SceneCompiler();
const compiled = compiler.compile(proceduralMaterialsScene);

console.log('--- GENERATED UNIFORMS ---\n');
console.log(compiled.fragment.uniforms || '(none)');

console.log('\n--- MATERIAL PROPERTIES (showing procedural GLSL) ---\n');

// Find and display the material properties function
const functions = compiled.fragment.functions;
const propsStart = functions.indexOf('MaterialProperties scene_material_properties');
if (propsStart >= 0) {
  // Find the end of the function
  let braceCount = 0;
  let inFunction = false;
  let propsEnd = propsStart;

  for (let i = propsStart; i < functions.length; i++) {
    if (functions[i] === '{') {
      braceCount++;
      inFunction = true;
    }
    if (functions[i] === '}') {
      braceCount--;
      if (inFunction && braceCount === 0) {
        propsEnd = i + 1;
        break;
      }
    }
  }

  console.log(functions.substring(propsStart, propsEnd));
}

console.log('\n================================================================================');
console.log('TEST COMPLETE');
console.log('================================================================================');
console.log('\nThe procedural GLSL code is embedded directly in the material properties!');
console.log('Notice how the albedo values contain GLSL expressions like sin(), mix(), etc.');
