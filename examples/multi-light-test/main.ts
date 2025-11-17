/**
 * Multi-light test example
 *
 * Tests the multiple light sampling system without MIS.
 * Should see contributions from all three lights with correct PDF.
 */

import { PathTracerEngine } from '../../src/engine/PathTracerEngine.js';
import { SceneCompiler } from '../../src/world/scene/SceneCompiler.js';
import { LightsCompiler } from '../../src/world/lighting/LightsCompiler.js';
import { multiLightTestScene } from './sceneDescription.js';
import { multiLightDescription } from './lightingDescription.js';

// Compile scene and lighting modules
const sceneCompiler = new SceneCompiler();
const lightsCompiler = new LightsCompiler();

const sceneModule = sceneCompiler.compile(multiLightTestScene);
const lightingModule = lightsCompiler.compile(multiLightDescription);

// Create engine
const canvas = document.getElementById('glCanvas') as HTMLCanvasElement;
const engine = new PathTracerEngine(canvas);

// Initial parameters
const parameters = {
  'camera.position': [0, 0, 1.8],
  'camera.look_at': [0, 0, 0],
  'camera.fov': 60,
  'path_tracer.max_bounces': 4,
  'path_tracer.samples_per_frame': 1
};

// Initialize with compiled modules
await engine.initialize({
  scene: sceneModule,
  lighting: lightingModule,
  parameters
});

console.log('Multi-light test scene initialized');
console.log('Expected: White ceiling light + red sphere light (left) + blue point light (right)');
