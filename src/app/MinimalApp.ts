import { Engine } from '../engine/Engine';
import { ParameterStore } from './ParameterStore';
import { euclideanAmbient } from '../objects/ambient/euclidean/euclidean-ambient';
import { pinholeCamera } from '../optics/camera/pinhole-camera';
import { simpleSphereScene } from '../objects/scene/simple-sphere';
import { simpleInteraction } from "../optics/interaction/simple-interaction";
import { simpleTransport } from "../optics/transport/simple-transport";

/**
 * MinimalApp - basic application shell for Phase 3
 * Establishes ParameterStore → Engine architecture
 */
class MinimalApp {
    private engine: Engine;
    private parameterStore: ParameterStore;

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
            simpleInteraction,
            simpleTransport,
            pinholeCamera
        ]);
    }

    /**
     * Set up default camera parameters
     */
    setupCameraParameters(): void {
        this.parameterStore.batch({
            'camera.position': [0, 0, 5],
            'camera.target': [0, 0, 0],
            'camera.fov': 60,
            'resolution': [window.innerWidth, window.innerHeight]
        });
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
        this.engine.dispose();
    }
}

export { MinimalApp };
