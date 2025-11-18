/**
 * RGB Color Mixing Example
 *
 * Demonstrates additive color mixing with three colored point lights.
 * Watch for color mixing in overlapping shadows:
 * - R + G = Yellow
 * - G + B = Cyan
 * - R + B = Magenta
 */

import { App } from '../../src/infrastructure/app/App.js';
import type { Recipe } from '../../src/infrastructure/engine/types.js';
import { SceneCompiler } from '../../src/research/world/scene/SceneCompiler.js';
import { LightsCompiler } from '../../src/research/world/lighting/LightsCompiler.js';
import { rgbScene } from './sceneDescription.js';
import { rgbLighting } from './lightingDescription.js';

// Compile the scene and lighting at module load time
const sceneCompiler = new SceneCompiler();
const compiledScene = sceneCompiler.compile(rgbScene);

const lightsCompiler = new LightsCompiler();
const compiledLighting = lightsCompiler.compile(rgbLighting);

// World modules
import { euclideanAmbient } from '../../src/research/world/ambient/euclidean/euclidean-ambient.js';
import { constEnvironment } from '../../src/research/world/environment/const-environment.js';

// Optics modules
import { pinholeCamera } from '../../src/research/optics/camera/pinhole-camera.js';
import { lambertInteraction } from '../../src/research/optics/interaction/lambert-interaction.js';
import { pathTracerDirectLight } from '../../src/research/optics/transport/path-tracer-direct-light.js';
import { averagingAccumulator } from '../../src/research/optics/accumulator/average-accumulator.js';
import { gammaDeveloper } from '../../src/research/optics/developer/gamma-developer.js';

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
            name: 'RGB Color Mixing',
            description: 'Three colored lights demonstrating additive color',

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
        // Camera
        'camera.position': [0, 1.5, 3.5],
        'camera.target': [0, 0, 0],
        'camera.fov': 50,
        'resolution': [window.innerWidth, window.innerHeight],

        // Environment (off)
        'environment.intensity': 0.0,
        'environment.rotation': 0,
        'environment.radiance': [0.0, 0.0, 0.0],

        // Developer settings
        'developer.exposureEV': 0,
        'developer.desat': 0.0,  // Keep full saturation for color mixing
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

    console.log('RGB Color Mixing scene initialized');
    console.log('Watch for color mixing in overlapping shadows');

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
