// Interactive Materials Example
import { App } from '../../src/app/App.js';
import type { Recipe } from '../../src/engine/types.js';
import { SceneCompiler } from '../../src/world/scene/SceneCompiler.js';
import { LightsCompiler } from '../../src/world/lighting/LightsCompiler.js';
import { interactiveMaterialsScene } from './sceneDescription.js';
import { lightingDescription } from './lightingDescription.js';

// Compile the scene at module load time
const sceneCompiler = new SceneCompiler();
import { LightsCompiler } from '../../src/world/lighting/LightsCompiler.js';
const compiledScene = sceneCompiler.compile(interactiveMaterialsScene);

const lightsCompiler = new LightsCompiler();
const compiledLighting = lightsCompiler.compile(lightingDescription);

// World modules
import { euclideanAmbient } from '../../src/world/ambient/euclidean/euclidean-ambient.js';
import { constEnvironment } from '../../src/world/environment/const-environment.js';

// Optics modules
import { pinholeCamera } from '../../src/optics/camera/pinhole-camera.js';
import { lambertInteraction } from '../../src/optics/interaction/lambert-interaction.js';
import { albedoInteraction } from '../../src/optics/interaction/albedo-interaction.js';
import { pathTracerDirectLight } from '../../src/optics/transport/path-tracer-direct-light.js';
import { directTransport } from '../../src/optics/transport/direct-transport.js';
import { averagingAccumulator } from '../../src/optics/accumulator/average-accumulator.js';
import { oneshotAccumulator } from '../../src/optics/accumulator/oneshot-accumulator.js';
import { gammaDeveloper } from '../../src/optics/developer/gamma-developer.js';

// Extensions
import { OrbitControls } from "../../src/app/extensions/OrbitControls";
import { StatsPanelExtension } from "../../src/app/extensions/StatsPanel";
import { ScreenshotExtension } from "../../src/app/extensions/ScreenshotExtension";
import { HDRExportExtension } from "../../src/app/extensions/HDRExportExtension";
import { TouchOrbitControls } from "../../src/app/extensions/TouchOrbitControls";
import { ParameterPanelExtension } from "../../src/app/extensions/ParameterPanelExtension";
import { ProductionRenderExtension } from "../../src/app/extensions/ProductionRenderExtension";

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
        },

        // Recipe 2: Albedo debug view
        {
            id: 'albedo',
            name: 'Albedo View',
            description: 'Direct albedo visualization without lighting',

            world: {
                ambient: euclideanAmbient,
                environment: constEnvironment,
                scene: compiledScene,
                lighting: compiledLighting
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
        // Camera
        'camera.position': [0, 1, 5],
        'camera.target': [0, 0, 0],
        'camera.fov': 60,
        'resolution': [window.innerWidth, window.innerHeight],

        // Quad light
        'light.center': [0, 3.9, 0],
        'light.width': 2,
        'light.height': 2,
        'light.direction1': [1, 0, 0],
        'light.direction2': [0, 0, 1],
        'light.intensity': 30.0,
        'light.color': [1, 1, 1],

        // Environment
        'environment.intensity': 1.0,
        'environment.rotation': 0,
        'environment.radiance': [1.0, 1.0, 1.0],

        // Developer settings
        'developer.exposureEV': 0,
        'developer.desat': 0.2,
        'developer.whiteBalance': [1, 1, 1],

        // Accumulator
        'accumulator.reset': false,

        // Material parameters (from scene description)
        'floor.color': [0.5, 0.5, 0.5],
        'rough.color': [0.8, 0.3, 0.3],
        'rough.roughness': 0.8,
        'metal.color': [0.9, 0.9, 0.95],
        'metal.roughness': 0.1,
        'metal.metallic': 0.9
    };

    // Create app
    const app = new App(canvas);

    // Initialize with recipes and parameters
    await app.initialize(recipes, undefined, parameters);

    // Install extensions
    app.use(new ParameterPanelExtension());  // This will show our material controls!
    app.use(new ProductionRenderExtension());
    app.use(new TouchOrbitControls());
    app.use(new OrbitControls());
    app.use(new StatsPanelExtension());
    app.use(new ScreenshotExtension());
    app.use(new HDRExportExtension());

    // Setup keyboard controls (1 = pathtracer, 2 = albedo, R = reset)
    app.setupKeyboardControls();

    console.log('Interactive materials example running');
    console.log('Press 1 for path tracer, 2 for albedo view, R to reset');
    console.log('Open the parameter panel (P key) to adjust material properties!');

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
