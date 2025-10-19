// app/MinimalApp.ts
import { Engine } from '../engine/Engine';
import { ParameterStore } from './ParameterStore';
import { FrameStats } from './FrameStats';
import type { Recipe } from '../engine/types';

// World modules
import { euclideanAmbient } from '../world/ambient/euclidean/euclidean-ambient';
import { sceneRaymarch } from '../world/scene/raymarch-scene';
import { hdriEnvironmentImportance } from '../world/environment/hdri-environment-importance';
import { constEnvironment } from '../world/environment/const-environment';
import { quadLight } from '../world/lighting/quad-light';

// Optics modules
import { pinholeCamera } from '../optics/camera/pinhole-camera';
import { lambertInteraction } from '../optics/interaction/lambert-interaction';
import {glossyInteraction} from "../optics/interaction/glossy-interaction";
import { albedoInteraction } from '../optics/interaction/albedo-interaction';
import { pathTracingTransport } from '../optics/transport/path-tracer-transport';
import { pathTracerDirectLight} from "../optics/transport/path-tracer-direct-light";
import { directTransport } from '../optics/transport/direct-transport';
import { averagingAccumulator } from '../optics/accumulator/average-accumulator';
import { oneshotAccumulator } from '../optics/accumulator/oneshot-accumulator';
import { reinhardDeveloper } from '../optics/developer/reinhard-developer';
import { gammaDeveloper } from '../optics/developer/gamma-developer';

// HDR environment
import envHDRI from '/hdri/autumn_field_1k.hdr';

/**
 * MinimalApp with Recipe system
 * Two recipes: pathtracer (1) and albedo view (2)
 */
class App {
    private engine: Engine;
    private parameterStore: ParameterStore;
    private frameStats: FrameStats;
    private renderLoopId: number | null = null;
    private currentRecipeId: string = 'pathtracer';

    constructor(canvas: HTMLCanvasElement) {
        // Set up canvas size
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const gl = canvas.getContext('webgl2', {
            antialias: false,
            preserveDrawingBuffer: true
        });

        if (!gl) {
            throw new Error('WebGL2 not supported');
        }

        // Create architecture components
        this.engine = new Engine(gl);
        this.parameterStore = new ParameterStore();
        this.frameStats = new FrameStats();

        // Set initial resolution
        this.frameStats.setResolution(canvas.width, canvas.height);

        // Wire parameter store to engine
        this.parameterStore.onChange = (changes) => {
            this.engine.updateParameters(changes);
        };

        // Setup keyboard controls
        this.setupKeyboardControls();
    }

    /**
     * Initialize app with recipes and HDR environment
     */
    async initialize(): Promise<void> {
        // 1. Register all modules
        this.registerModules();

        // 2. Create recipes
        const recipes = this.createRecipes();

        // 3. Initialize engine with recipes
        this.engine.initialize(recipes);

        // 4. Load HDR environment (global, shared by all recipes)
        await this.engine.loadEnvironmentHDR(envHDRI);

        // 5. Setup parameters (shared across recipes)
        this.setupParameters();

        // 6. Start rendering
        this.startRenderLoop();

        console.log('MinimalApp initialized with recipes:', this.engine.getAvailableRecipes());
    }

    /**
     * Register all modules that recipes will reference
     */
    private registerModules(): void {
        this.engine.registerModules([
            // World
            euclideanAmbient,
            sceneRaymarch,
            hdriEnvironmentImportance,
            constEnvironment,
            quadLight,

            // Optics
            pinholeCamera,
            lambertInteraction,
            glossyInteraction,
            albedoInteraction,
            pathTracingTransport,
            pathTracerDirectLight,
            directTransport,
            averagingAccumulator,
            oneshotAccumulator,
            reinhardDeveloper,
            gammaDeveloper
        ]);
    }

    /**
     * Create recipe configurations
     */
    private createRecipes(): Recipe[] {
        // Recipe 1: Full path tracer with GI
        const pathtracerRecipe: Recipe = {
            id: 'pathtracer',
            name: 'Path Tracer',
            description: 'Full global illumination with importance sampled environment',

            world: {
                ambient: { kind: 'ambient', name: 'euclidean' },
                environment: { kind: 'environment', name: 'constant' },
                scene: { kind: 'scene', name: 'scene-raymarch' },  // FIXED
                lighting: { kind: 'lighting', name: 'quad-light' }
            },

            optics: {
                camera: { kind: 'camera', name: 'pinhole' },
                interaction: { kind: 'interaction', name: 'lambert' },
                transport: { kind: 'transport', name: 'pathtracer-direct' },
                accumulator: { kind: 'accumulator', name: 'averaging' },
                developer: { kind: 'developer', name: 'gamma' }
            }
        };

        // Recipe 2: Simple albedo view for debugging
        const albedoRecipe: Recipe = {
            id: 'albedo',
            name: 'Albedo View',
            description: 'Direct albedo visualization without lighting',

            world: {
                ambient: { kind: 'ambient', name: 'euclidean' },
                environment: { kind: 'environment', name: 'constant' },
                scene: { kind: 'scene', name: 'scene-raymarch' },  // FIXED
                lighting: { kind: 'lighting', name: 'quad-light' }
            },

            optics: {
                camera: { kind: 'camera', name: 'pinhole' },
                interaction: { kind: 'interaction', name: 'albedo' },
                transport: { kind: 'transport', name: 'direct' },
                accumulator: { kind: 'accumulator', name: 'oneshot' },
                developer: { kind: 'developer', name: 'gamma' }
            }
        };

        return [pathtracerRecipe, albedoRecipe];
    }

    /**
     * Initialize parameters (shared across all recipes)
     */
    private setupParameters(): void {
        this.parameterStore.batch({
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
            'environment.radiance': [1.0, 1.0, 1.0],  // Constant white environment

            // Developer settings (shared)
            'developer.exposureEV': 0,
            'developer.desat': 0.2,
            'developer.whiteBalance': [1, 1, 1],

            // Accumulator
            'accumulator.reset': false
        });
    }

    /**
     * Setup keyboard controls for recipe switching
     */
    private setupKeyboardControls(): void {
        window.addEventListener('keydown', (e) => {
            if (e.key === '1') {
                this.switchRecipe('pathtracer');
            } else if (e.key === '2') {
                this.switchRecipe('albedo');
            } else if (e.key === 'r' || e.key === 'R') {
                this.resetAccumulation();
            }
        });
    }

    /**
     * Switch to a different recipe
     */
    private switchRecipe(recipeId: string): void {
        if (recipeId === this.currentRecipeId) return;

        console.log(`Switching to recipe: ${recipeId}`);
        this.engine.selectRecipe(recipeId);
        this.currentRecipeId = recipeId;

        // Re-send all parameters to the new recipe's program
        this.parameterStore.resendAll();

        // Reset accumulation for new recipe view
       // this.resetAccumulation();
    }

    /**
     * Reset accumulation
     */
    private resetAccumulation(): void {
        console.log('Resetting accumulation');
        this.engine.clearAccumulation();
        this.parameterStore.set('accumulator.reset', true);
    }

    /**
     * Start render loop
     */
    private startRenderLoop(): void {
        // Initial reset
        this.resetAccumulation();

        const loop = () => {
            // Turn off reset after first frame
            if (this.engine.sampleCount === 1) {
                this.parameterStore.set('accumulator.reset', false);
            }

            this.render();

            // Update frame stats
            this.frameStats.update(this.engine.sampleCount);

            this.renderLoopId = requestAnimationFrame(loop);
        };

        loop();
    }

    /**
     * Stop render loop
     */
    stopRenderLoop(): void {
        if (this.renderLoopId) {
            cancelAnimationFrame(this.renderLoopId);
            this.renderLoopId = null;
        }
    }

    /**
     * Render one frame
     */
    render(): void {
        this.engine.renderFrame();
    }

    /**
     * Clean up resources
     */
    dispose(): void {
        this.stopRenderLoop();
        this.frameStats.dispose();
        this.engine.dispose();
    }
}

export { App };
