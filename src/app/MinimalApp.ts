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
        this.parameterStore.set('camera.position', [0, 0, 5]);
        this.parameterStore.set('camera.fov', 60);
    }

    /**
     * Set camera position and orientation
     */
    setCamera(position: [number, number, number], lookAt: [number, number, number], fov: number): void {
        // Calculate camera frame matrix
        const forward = this.normalize(this.subtract(lookAt, position));
        const up = [0, 1, 0];
        const right = this.normalize(this.cross(forward, up));
        const correctedUp = this.cross(right, forward);

        // Build frame matrix (negated forward for correct ray direction)
        const frameMatrix = new Float32Array([
            right[0], correctedUp[0], -forward[0],
            right[1], correctedUp[1], -forward[1],
            right[2], correctedUp[2], -forward[2]
        ]);

        // Update all camera parameters
        this.parameterStore.set('camera.position', position);
        this.parameterStore.set('camera.frame', frameMatrix);
        this.parameterStore.set('camera.tan_fov', Math.tan((fov * Math.PI / 180) / 2));
        this.parameterStore.set('resolution', [window.innerWidth, window.innerHeight]);
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

    // Vector math utilities
    private subtract(a: number[], b: number[]): number[] {
        return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    }

    private cross(a: number[], b: number[]): number[] {
        return [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]
        ];
    }

    private normalize(v: number[]): number[] {
        const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
        return [v[0] / len, v[1] / len, v[2] / len];
    }
}

export { MinimalApp };
