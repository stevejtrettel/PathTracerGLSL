/**
 * Compiled simple scene - uses SceneCompiler to generate the scene module
 * This replaces the hardcoded raymarch-scene.ts with a compiler-generated one
 */

import { SceneCompiler } from '../SceneCompiler';
import { simpleTestScene } from './simple-test-scene';

// Compile the scene at module load time
const compiler = new SceneCompiler();
const compiledScene = compiler.compile(simpleTestScene);

// Export as a ModuleDescriptor
export { compiledScene };
