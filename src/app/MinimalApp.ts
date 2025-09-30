// app/MinimalApp.ts
import { Engine } from '../engine/Engine';
import { ParameterStore } from './ParameterStore';
import { FrameStats } from './FrameStats';
import { euclideanAmbient } from '../world/ambient/euclidean/euclidean-ambient';
import { pinholeCamera } from '../optics/camera/pinhole-camera';
import { lambertInteraction } from "../optics/interaction/lambert-interaction";
import { gammaDeveloper } from "../optics/developer/gamma-developer";
import { averagingAccumulator } from "../optics/accumulator/average-accumulator";
import { pathTracerDirectLight } from "../optics/transport/path-tracer-direct-light";
import { pathTracingTransport} from "../optics/transport/path-tracer-transport";
import { sphereLight } from "../world/lighting/sphere-light";
import { directTransport} from "../optics/transport/direct-transport";
import {quadLight} from "../world/lighting/quad-light";
import {glossyInteraction} from "../optics/interaction/glossy-interaction";
import {sceneRaymarch} from "../world/scene/raymarch-scene";
import { constEnvironment } from "../world/environment/const-environment";
import { oneshotAccumulator } from "../optics/accumulator/oneshot-accumulator";
import { albedoInteraction } from "../optics/interaction/albedo-interaction";
import { hdriEnvironment } from "../world/environment/hdri-environment";
import {pathTracerDirectEnv} from "../optics/transport/path-tracer-direct-env";
import {acesDeveloper} from "../optics/developer/aces-developer";
import {reinhardDeveloper} from "../optics/developer/reinhard-developer";


//the hdri image (from public/)
import envHDRI from '/hdri/autumn_field_1k.hdr';



/**
 * MinimalApp - basic application shell for Phase 3
 * Establishes ParameterStore → Engine architecture
 */
class MinimalApp {
    private engine: Engine;
    private parameterStore: ParameterStore;
    private frameStats: FrameStats;
    private renderLoopId: number | null = null;

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
    }

    /**
     * Initialize app with HDR environment
     */
    async initialize(): Promise<void> {
        // Load modules
        this.loadModules();

        // Setup parameters
        this.setupParameters();

        // Load HDR environment map
        // Put your HDR file in public/assets/hdri/
        await this.engine.loadEnvironmentHDR(envHDRI);

        // Set environment parameters
        this.parameterStore.batch({
            'environment.intensity': 1.0,
            'environment.rotation': 0  // degrees
        });

        // Start rendering
        this.startRenderLoop();
    }

    /**
     * Load and compile modules
     */
    loadModules(): void {
        this.engine.loadModules([
            euclideanAmbient,
            sceneRaymarch,
            hdriEnvironment,  // Using HDRI instead of const
            quadLight,
            glossyInteraction,
            pathTracingTransport,
            pinholeCamera,
            averagingAccumulator,
            acesDeveloper,
        ]);
    }

    /**
     * Initialize default parameters
     */
    setupParameters(): void {
        this.parameterStore.batch({
            'camera.position': [0, 0, 5],
            'camera.target': [0, 0, 0],
            'camera.fov': 60,
            'resolution': [window.innerWidth, window.innerHeight],

            // Quad light (ceiling)
            'quad.center': [0, 3.9, 0],  // Center at ceiling
            'quad.width': 2.0,
            'quad.height': 2.0,
            'quad.direction1': [1, 0, 0],
            'quad.direction2': [0, 0, 1],
            'quad.intensity': 10.0,
            'quad.color': [1, 1,1],

            'environment.intensity': 1.,


            'developer.exposureEV':0,
            'developer.desat':0.2,
            'developer.whiteBalance':[1,1,1],



            'accumulator.reset': false

        });
    }

    /**
     * Start render loop
     */
    startRenderLoop(): void {
        // Initial reset
        this.parameterStore.set('accumulator.reset', true);
        this.engine.clearAccumulation();

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

export { MinimalApp };
