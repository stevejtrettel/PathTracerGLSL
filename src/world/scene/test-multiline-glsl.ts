/**
 * Test multi-line procedural GLSL generation
 */

import { SceneCompiler } from './SceneCompiler';
import { proceduralMaterialsScene } from '../../../examples/procedural-materials/sceneDescription.js';

console.log('================================================================================');
console.log('MULTI-LINE PROCEDURAL GLSL TEST');
console.log('================================================================================\n');

const compiler = new SceneCompiler();
const compiled = compiler.compile(proceduralMaterialsScene);
const functions = compiled.fragment.functions;

// Find and display helper functions section
const helperStart = functions.indexOf('// ========== PROCEDURAL MATERIAL HELPERS');
if (helperStart >= 0) {
  const propsStart = functions.indexOf('// ========== MATERIAL PROPERTIES', helperStart);
  console.log(functions.substring(helperStart, propsStart));
} else {
  console.log('❌ No helper functions found!');
}

console.log('\n================================================================================');
console.log('Material properties function calls helper functions:');
console.log('================================================================================\n');

// Show how materials call the helpers
const propsStart = functions.indexOf('MaterialProperties scene_material_properties');
if (propsStart >= 0) {
  const propsEnd = propsStart + 1000; // Show first part
  console.log(functions.substring(propsStart, propsEnd));
}
