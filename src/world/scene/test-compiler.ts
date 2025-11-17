/**
 * Test script for SceneCompiler
 * Run with: npx tsx src/world/scene/test-compiler.ts
 */

import { SceneCompiler } from './SceneCompiler';
import { simpleTestScene } from './examples/simple-test-scene';

console.log('='.repeat(80));
console.log('SCENE COMPILER TEST');
console.log('='.repeat(80));

const compiler = new SceneCompiler();
const module = compiler.compile(simpleTestScene);

console.log('\n--- GENERATED CONSTANTS ---\n');
console.log(module.fragment.constants);

console.log('\n--- GENERATED FUNCTIONS ---\n');
console.log(module.fragment.functions);

console.log('\n' + '='.repeat(80));
console.log('COMPILATION COMPLETE');
console.log('='.repeat(80));
