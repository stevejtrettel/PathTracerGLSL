import { Engine } from '../engine/Engine';
import { ParameterStore } from './ParameterStore';
import { euclideanAmbient } from '../objects/ambient/euclidean/euclidean-ambient';
import { pinholeCamera } from '../optics/camera/pinhole-camera';
import { simpleSphereScene } from '../objects/scene/simple-sphere';
import { albedoInteraction } from "../optics/interaction/albedo-interaction";
import { directTransport } from "../optics/transport/direct-transport";
import {pointLight} from "../objects/lighting/point-light";
import {directLightingTransport} from "../optics/transport/direct-lighting-transport";
import {lambertInteraction} from "../optics/interaction/lambert-interaction";
import {oneshotAccumulator} from "../optics/accumulator/oneshot-accumulator";
import {gammaDeveloper} from "../optics/developer/gamma-developer";
import {passthroughDeveloper} from "../optics/developer/passthrough-developer";

/**
 * MinimalApp - basic application shell for Phase 3
 * Establishes ParameterStore → Engine architecture
 */
class MinimalApp {
    private engine: Engine;
    private parameterStore: ParameterStore;
    private lightAnimationId: number | null = null;

    constructor(canvas: HTMLCanvasElement) {
        // Set up canvas size
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const gl = canvas.getContext('webgl2');
        if (!gl) {
            throw new Error('WebGL2 not supported');
        }

        // Create architecture components
        this.engine = new Engine(gl);
        this.parameterStore = new ParameterStore();

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
            simpleSphereScene,
            pointLight,
            lambertInteraction,
            directLightingTransport,
            pinholeCamera,
            oneshotAccumulator,
            gammaDeveloper
        ]);
    }

    setupParameters(): void {
        this.parameterStore.batch({
            'camera.position': [0, 0, 10],
            'camera.target': [0, 0, 0],
            'camera.fov': 60,
            'resolution': [window.innerWidth, window.innerHeight],

            // Light parameters
            'light.position': [5, 5, 5],       // Above and to the right
            'light.color': [1.0, 1.0, 1.0],   // White light
            'light.intensity': 200.0           // Bright enough to see
        });
    }

    /**
     * Start animating the light in a circle
     */
    startLightAnimation(): void {
        const animate = () => {
            const time = this.engine.time;
            const radius = 8.0;
            const speed = 0.5;

            this.parameterStore.set('light.position', [
                Math.cos(time * speed) * radius,
                5.0,  // Fixed height
                Math.sin(time * speed) * radius
            ]);

            this.lightAnimationId = requestAnimationFrame(animate);
        };

        animate();
    }

    /**
     * Stop light animation
     */
    stopLightAnimation(): void {
        if (this.lightAnimationId) {
            cancelAnimationFrame(this.lightAnimationId);
            this.lightAnimationId = null;
        }
    }

    /**
     * Set camera position and orientation - only semantic parameters
     */
    setCamera(position: [number, number, number], lookAt: [number, number, number], fov: number): void {
        this.parameterStore.batch({
            'camera.position': position,
            'camera.target': lookAt,
            'camera.fov': fov
        });
    }

    /**
     * Convenience method to move camera
     */
    moveCamera(position: [number, number, number]): void {
        this.parameterStore.set('camera.position', position);
    }

    /**
     * Convenience method to look at target
     */
    lookAt(target: [number, number, number]): void {
        this.parameterStore.set('camera.target', target);
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
        this.stopLightAnimation();
        this.engine.dispose();
    }

    /**
     * Move light position
     */
    moveLight(position: [number, number, number]): void {
        this.parameterStore.set('light.position', position);
    }

    /**
     * Set light intensity
     */
    setLightIntensity(intensity: number): void {
        this.parameterStore.set('light.intensity', intensity);
    }
}

export { MinimalApp };
