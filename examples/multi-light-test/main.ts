/**
 * Multi-light test example
 *
 * Tests the multiple light sampling system without MIS.
 * Should see contributions from all three lights with correct PDF.
 */

import { App } from '../../src/app/App.js';
import type { Recipe } from '../../src/engine/types.js';
import { SceneCompiler } from '../../src/world/scene/SceneCompiler.js';
import { LightsCompiler } from '../../src/world/lighting/LightsCompiler.js';
import { multiLightTestScene } from './sceneDescription.js';
import { multiLightDescription } from './lightingDescription.js';

// Compile the scene and lighting at module load time
const sceneCompiler = new SceneCompiler();
const compiledScene = sceneCompiler.compile(multiLightTestScene);

const lightsCompiler = new LightsCompiler();
const compiledLighting = lightsCompiler.compile(multiLightDescription);

// World modules
import { euclideanAmbient } from '../../src/world/ambient/euclidean/euclidean-ambient.js';
import { constEnvironment } from '../../src/world/environment/const-environment.js';

// Optics modules
import { pinholeCamera } from '../../src/optics/camera/pinhole-camera.js';
import { lambertInteraction } from '../../src/optics/interaction/lambert-interaction.js';
import { pathTracerDirectLight } from '../../src/optics/transport/path-tracer-direct-light.js';
import { averagingAccumulator } from '../../src/optics/accumulator/average-accumulator.js';
import { gammaDeveloper } from '../../src/optics/developer/gamma-developer.js';

// Extensions
import { OrbitControls } from "../../src/app/extensions/OrbitControls";
import { StatsPanelExtension } from "../../src/app/extensions/StatsPanel";
import { ScreenshotExtension } from "../../src/app/extensions/ScreenshotExtension";
import { TouchOrbitControls } from "../../src/app/extensions/TouchOrbitControls";
import { ParameterPanelExtension } from "../../src/app/extensions/ParameterPanelExtension";

function getOrCreateCanvas(id: string = 'canvas'): HTMLCanvasElement {
    let canvas = document.getElementById(id) as HTMLCanvasElement;

    if (!canvas) {
        console.log('No canvas found, creating one...');
        canvas = document.createElement('canvas');
        canvas.id = id;
        canvas.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            display: block;
            margin: 0;
            padding: 0;
        `;
        document.body.style.cssText = `
            margin: 0;
            padding: 0;
            overflow: hidden;
        `;
        document.body.appendChild(canvas);
    }

    return canvas;
}

async function main() {
    const canvas = getOrCreateCanvas();

    // Create recipe
    const recipes: Recipe[] = [
        {
            id: 'pathtracer',
            name: 'Multi-Light Path Tracer',
            description: 'Path tracer with 3 lights (quad, sphere, point)',

            world: {
                ambient: euclideanAmbient,
                environment: constEnvironment,
                scene: compiledScene,
                lighting: compiledLighting
            },

            optics: {
                camera: pinholeCamera,
                interaction: lambertInteraction,
                transport: pathTracerDirectLight,
                accumulator: averagingAccumulator,
                developer: gammaDeveloper
            }
        }
    ];

    // Initial parameters
    const parameters = {
        // Camera (inside the box, looking at center)
        'camera.position': [0, 0, 1.8],
        'camera.target': [0, 0, 0],
        'camera.fov': 60,
        'resolution': [window.innerWidth, window.innerHeight],

        // Environment
        'environment.intensity': 0.0,  // No environment light
        'environment.rotation': 0,
        'environment.radiance': [0.0, 0.0, 0.0],

        // Developer settings
        'developer.exposureEV': 0,
        'developer.desat': 0.2,
        'developer.whiteBalance': [1, 1, 1],

        // Accumulator
        'accumulator.reset': false
    };

    // Create app
    const app = new App(canvas);

    // Initialize with recipes and parameters
    await app.initialize(recipes, undefined, parameters);

    // Install extensions
    app.use(new ParameterPanelExtension());
    app.use(new TouchOrbitControls());
    app.use(new OrbitControls());
    app.use(new StatsPanelExtension());
    app.use(new ScreenshotExtension());

    // Setup keyboard controls
    app.setupKeyboardControls();

    console.log('Multi-light test scene initialized');
    console.log('3 lights: Quad (ceiling, white) + Sphere (left, red) + Point (right, blue)');
    console.log('Testing multiple light sampling without MIS');

    // Store app reference for resize handler
    (window as any).app = app;
}

// Handle window resize
window.addEventListener('resize', () => {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    const app = (window as any).app;

    if (canvas && app) {
        const width = window.innerWidth;
        const height = window.innerHeight;
        app.handleResize(width, height);
    }
});

// Run
main().catch(error => {
    console.error('Failed to start:', error);
    document.body.innerHTML = `
        <div style="color: red; padding: 20px; font-family: monospace;">
            <h2>Failed to start</h2>
            <p>${error.message}</p>
            <pre>${error.stack}</pre>
        </div>
    `;
});
