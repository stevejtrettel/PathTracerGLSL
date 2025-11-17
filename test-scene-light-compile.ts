/**
 * Test scene-with-light compilation to see actual GLSL errors
 */

import { SceneCompiler } from './src/world/scene/SceneCompiler.js';
import { LightsCompiler } from './src/world/lighting/LightsCompiler.js';
import { sceneDescription } from './examples/scene-with-light/sceneDescription.js';
import { lightingDescription } from './examples/scene-with-light/lightingDescription.js';

console.log('Compiling scene...');
const sceneCompiler = new SceneCompiler();
const compiledScene = sceneCompiler.compile(sceneDescription);

console.log('Compiling lighting...');
const lightsCompiler = new LightsCompiler();
const compiledLighting = lightsCompiler.compile(lightingDescription);

console.log('\n=== SCENE MODULE ===');
console.log('ID:', compiledScene.id);
console.log('\nFunctions (first 1000 chars):');
console.log(compiledScene.fragment.functions?.substring(0, 1000));

console.log('\n=== LIGHTING MODULE ===');
console.log('ID:', compiledLighting.id);

console.log('\nConstants:');
console.log(compiledLighting.fragment.constants);

console.log('\nUniforms:');
console.log(compiledLighting.fragment.uniforms || '(none)');

console.log('\nFunctions:');
console.log(compiledLighting.fragment.functions);

console.log('\n=== UNIFORM BINDINGS ===');
console.log('Scene bindings:', compiledScene.uniformBindings?.length || 0);
console.log('Lighting bindings:', compiledLighting.uniformBindings?.length || 0);

console.log('\n✓ Both modules compiled successfully');
