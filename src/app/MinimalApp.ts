// app/MinimalApp.ts
import { Engine } from '../engine/Engine';
import { ParameterStore } from './ParameterStore';
import { FrameStats } from './FrameStats';
import { euclideanAmbient } from '../objects/ambient/euclidean/euclidean-ambient';
import { pinholeCamera } from '../optics/camera/pinhole-camera';
import { lambertInteraction } from "../optics/interaction/lambert-interaction";
import { gammaDeveloper } from "../optics/developer/gamma-developer";
import { averagingAccumulator } from "../optics/accumulator/average-accumulator";
import { pathTracerDirectLight } from "../optics/transport/path-tracer-direct-light";
import { pathTracingTransport } from "../optics/transport/path-tracer-transport";
import { sphereLight } from "../objects/lighting/sphere-light";
import {quadLight} from "../objects/lighting/quad-light";
import {glossyInteraction} from "../optics/interaction/glossy-interaction";
import {sceneRaymarch} from "../objects/scene/raymarch-scene";


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
     * Load and compile modules
     */
    loadModules(): void {
        this.engine.loadModules([
            euclideanAmbient,
            sceneRaymarch,
            quadLight,
            glossyInteraction,
            pathTracerDirectLight,
            pinholeCamera,
            averagingAccumulator,
            gammaDeveloper
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

            // 'sphere_light.position': [0, 3, 0],
            // 'sphere_light.radius': 0.1,
            // 'sphere_light.color': [1.0, 1.0, 1.0],
            // 'sphere_light.intensity': 500.0,

            // Quad light (ceiling)
            'quad.center': [0, 3.9, 0],  // Center at ceiling
            'quad.width': 2.0,
            'quad.height': 2.0,
            'quad.direction1': [1, 0, 0],
            'quad.direction2': [0, 0, 1],
            'quad.intensity': 20.0,
            'quad.color': [1, 1,1],

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
