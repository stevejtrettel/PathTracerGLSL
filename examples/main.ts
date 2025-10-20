// main.ts
import { App } from '../src/app/App.js';
import type { Recipe } from '../src/engine/types.js';

// World modules
import { euclideanAmbient } from '../src/world/ambient/euclidean/euclidean-ambient.js';
import { sceneRaymarch } from '../src/world/scene/raymarch-scene.js';
import { hdriEnvironmentImportance } from '../src/world/environment/hdri-environment-importance.js';
import { constEnvironment } from '../src/world/environment/const-environment.js';
import { quadLight } from '../src/world/lighting/quad-light.js';

// Optics modules
import { pinholeCamera } from '../src/optics/camera/pinhole-camera.js';
import { lambertInteraction } from '../src/optics/interaction/lambert-interaction.js';
import { albedoInteraction } from '../src/optics/interaction/albedo-interaction.js';
import { pathTracerDirectLight } from '../src/optics/transport/path-tracer-direct-light.js';
import { directTransport } from '../src/optics/transport/direct-transport.js';
import { averagingAccumulator } from '../src/optics/accumulator/average-accumulator.js';
import { oneshotAccumulator } from '../src/optics/accumulator/oneshot-accumulator.js';
import { gammaDeveloper } from '../src/optics/developer/gamma-developer.js';


import { OrbitControls } from "../src/app/extensions/OrbitControls";
import { KeyboardControls } from "../src/app/extensions/KeyboardControls";
import { StatsPanelExtension } from "../src/app/extensions/StatsPanel";
import { ScreenshotExtension } from "../src/app/extensions/ScreenshotExtension";
import { HDRExportExtension } from "../src/app/extensions/HDRExportExtension";

// HDR environment
import envHDRI from '/hdri/autumn_field_1k.hdr';

async function main() {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    if (!canvas) {
        throw new Error('Canvas not found');
    }

    // Create recipes
    const recipes: Recipe[] = [
        // Recipe 1: Full path tracer with GI
        {
            id: 'pathtracer',
            name: 'Path Tracer',
            description: 'Full global illumination with direct light sampling',

            world: {
                ambient: euclideanAmbient,
                environment: constEnvironment,
                scene: sceneRaymarch,
                lighting: quadLight
            },

            optics: {
                camera: pinholeCamera,
                interaction: lambertInteraction,
                transport: pathTracerDirectLight,
                accumulator: averagingAccumulator,
                developer: gammaDeveloper
            }
        },

        // Recipe 2: Albedo debug view
        {
            id: 'albedo',
            name: 'Albedo View',
            description: 'Direct albedo visualization without lighting',

            world: {
                ambient: euclideanAmbient,
                environment: constEnvironment,
                scene: sceneRaymarch,
                lighting: quadLight
            },

            optics: {
                camera: pinholeCamera,
                interaction: albedoInteraction,
                transport: directTransport,
                accumulator: oneshotAccumulator,
                developer: gammaDeveloper
            }
        }
    ];

    // Initial parameters
    const parameters = {
        // Camera (shared)
        'camera.position': [1.5, 1, 5],
        'camera.target': [0, 0, 0],
        'camera.fov': 60,
        'resolution': [window.innerWidth, window.innerHeight],

        // Quad light (shared)
        'quad.center': [0, 3.9, 0],
        'quad.width': 2,
        'quad.height': 2,
        'quad.direction1': [1, 0, 0],
        'quad.direction2': [0, 0, 1],
        'quad.intensity': 30.0,
        'quad.color': [1, 1, 1],

        // Environment (shared)
        'environment.intensity': 1.0,
        'environment.rotation': 0,
        'environment.radiance': [1.0, 1.0, 1.0],

        // Developer settings (shared)
        'developer.exposureEV': 0,
        'developer.desat': 0.2,
        'developer.whiteBalance': [1, 1, 1],

        // Accumulator
        'accumulator.reset': false
    };

    // Create app
    const app = new App(canvas);

    // Initialize with recipes, HDR, and parameters
    await app.initialize(recipes, envHDRI, parameters);


   // app.use(new KeyboardControls());
    app.use( new KeyboardControls());
    app.use(new StatsPanelExtension());
    app.use(new ScreenshotExtension());
    app.use(new HDRExportExtension());

    // Setup keyboard controls (1 = pathtracer, 2 = albedo, R = reset)
    app.setupKeyboardControls();

    console.log('Progressive rendering started');

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

        // App handles everything
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
