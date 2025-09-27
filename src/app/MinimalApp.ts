import { Engine } from '../engine/Engine.js';
import { ParameterStore } from './ParameterStore.js';
import { euclideanAmbient } from '../objects/ambient/euclidean/euclidean-ambient.js';
import { pinholeCamera } from '../optics/camera/pinhole-camera.js';

/**
 * Minimal application shell for Phase 2
 * Establishes the real ParameterStore → Engine architecture
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

        // Create the real architecture components
        this.engine = new Engine(gl);
        this.parameterStore = new ParameterStore();

        // Wire parameter store to engine - THIS IS THE KEY PATTERN
        this.parameterStore.onChange = (changes) => {
            this.engine.updateParameters(changes);
        };

        console.log('MinimalApp: Created with ParameterStore → Engine architecture');
    }

    /**
     * Load and compile ambient + camera modules
     */
    loadModules(): void {
        // Load modules into engine
        this.engine.loadModules([euclideanAmbient, pinholeCamera]);

        console.log('MinimalApp: Modules loaded');
    }

    /**
     * Set up camera parameters using the parameter system
     */
    setupCameraParameters(): void {
        // Register parameter metadata
        this.parameterStore.registerMetadata('camera.position', {
            type: 'vec3',
            default: [0, 0, 5]
        });

        this.parameterStore.registerMetadata('camera.fov', {
            type: 'float',
            default: 60,
            min: 10,
            max: 170
        });

        console.log('MinimalApp: Camera parameters registered');
    }

    /**
     * Set camera using the parameter system
     */
    setCamera(position: [number, number, number], lookAt: [number, number, number], fov: number): void {
        // Calculate camera frame matrix
        const forward = this.normalize(this.subtract(lookAt, position));
        const up = [0, 1, 0];
        const right = this.normalize(this.cross(forward, up));
        const correctedUp = this.cross(right, forward);

        const frameMatrix = new Float32Array([
            right[0], correctedUp[0], forward[0],
            right[1], correctedUp[1], forward[1],
            right[2], correctedUp[2], forward[2]
        ]);

        const tanFov = Math.tan((fov * Math.PI / 180) / 2);

        // Set parameters through parameter store - this triggers Engine.updateParameters()
        this.parameterStore.set('camera.position', position);
        this.parameterStore.set('camera.frame', frameMatrix);
        this.parameterStore.set('camera.tan_fov', tanFov);
        this.parameterStore.set('resolution', [window.innerWidth, window.innerHeight]);

        console.log(`MinimalApp: Camera set via parameter system - pos: [${position.join(', ')}], fov: ${fov}°`);
    }

    /**
     * Render one frame
     */
    render(): void {
        this.engine.renderFrame();
    }

    // Simple vector math helpers
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
