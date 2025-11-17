/**
 * Test the SceneCompiler with parameter-based materials
 */

import { SceneCompiler } from './SceneCompiler';
import { interactiveMaterialsScene } from '../../../examples/interactive-materials/sceneDescription.js';

console.log('================================================================================');
console.log('SCENE COMPILER PARAMETER TEST');
console.log('================================================================================\n');

const compiler = new SceneCompiler();
const compiled = compiler.compile(interactiveMaterialsScene);

console.log('--- GENERATED UNIFORMS ---\n');
console.log(compiled.fragment.uniforms || '(none)');

console.log('\n--- UNIFORM BINDINGS ---\n');
if (compiled.uniformBindings) {
  for (const binding of compiled.uniformBindings) {
    console.log(`${binding.uniform}:`);
    console.log(`  Type: ${binding.type}`);
    console.log(`  Parameters: ${binding.parameters.join(', ')}`);
  }
} else {
  console.log('(none)');
}

console.log('\n--- PARAMETERS METADATA ---\n');
if (compiled.parameters) {
  for (const [path, meta] of Object.entries(compiled.parameters)) {
    console.log(`${path}:`);
    console.log(`  Type: ${meta.type}`);
    console.log(`  Default: ${JSON.stringify(meta.default)}`);
    console.log(`  Group: ${meta.group || '(auto)'}`);
    if (meta.range) console.log(`  Range: [${meta.range[0]}, ${meta.range[1]}]`);
  }
} else {
  console.log('(none)');
}

console.log('\n--- GENERATED MATERIAL PROPERTIES (excerpt) ---\n');
const propsStart = compiled.fragment.functions.indexOf('MaterialProperties scene_material_properties');
if (propsStart >= 0) {
  const propsEnd = compiled.fragment.functions.indexOf('}', propsStart + 300);
  console.log(compiled.fragment.functions.substring(propsStart, propsEnd + 1));
}

console.log('\n================================================================================');
console.log('TEST COMPLETE');
console.log('================================================================================');
