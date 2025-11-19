// examples/test-flexible-engine.ts
// Test for SimpleCompiler + FlexibleEngine architecture

import { SimpleCompiler } from '../src/compiler/SimpleCompiler.js';
import { FlexibleEngine } from '../src/engine-new/FlexibleEngine.js';
import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';

/**
 * Create or get canvas element
 */
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
        document.body.appendChild(canvas);
    }

    return canvas;
}

/**
 * Create WebGL2 context
 */
function createWebGLContext(canvas: HTMLCanvasElement): WebGL2RenderingContext {
    const gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance'
    });

    if (!gl) {
        throw new Error('WebGL2 not supported');
    }

    return gl;
}

/**
 * Show error in UI
 */
function showError(message: string, stack?: string) {
    const errorDisplay = document.getElementById('error-display');
    const errorMessage = document.getElementById('error-message');
    const errorStack = document.getElementById('error-stack');

    if (errorDisplay && errorMessage && errorStack) {
        errorDisplay.classList.add('show');
        errorMessage.textContent = message;
        errorStack.textContent = stack || '';
    }

    console.error('ERROR:', message);
    if (stack) console.error(stack);
}

/**
 * FPS tracker
 */
class FPSTracker {
    private frames: number[] = [];
    private lastTime = performance.now();

    update(): number {
        const now = performance.now();
        const delta = now - this.lastTime;
        this.lastTime = now;

        this.frames.push(1000 / delta);
        if (this.frames.length > 60) {
            this.frames.shift();
        }

        return this.frames.reduce((a, b) => a + b, 0) / this.frames.length;
    }
}

/**
 * Main application
 */
async function main() {
    console.log('=== FlexibleEngine Test Starting ===');

    // Get canvas and setup WebGL
    const canvas = getOrCreateCanvas();
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const gl = createWebGLContext(canvas);
    console.log('✅ WebGL2 context created');

    // Create scene description (minimal for now)
    const scene: SceneDescription = {
        id: 'test-scene',
        name: 'Test Scene'
    };

    // Create strategies
    const debugStrategy: RenderStrategy = {
        id: 'debug',
        settings: {
            debugOutput: 'uv'  // Can be: 'uv', 'depth', 'normal', or omit for solid color
        }
    };

    const pathtracerStrategy: RenderStrategy = {
        id: 'pathtracer'
    };

    // Compile renderers
    console.log('Compiling renderers...');
    const compiler = new SimpleCompiler();

    const debugRenderer = compiler.compile(scene, debugStrategy);
    console.log('✅ Debug renderer compiled');

    const pathtracerRenderer = compiler.compile(scene, pathtracerStrategy);
    console.log('✅ Pathtracer renderer compiled');

    // Create engine
    console.log('Creating engine...');
    const engine = new FlexibleEngine(gl);
    console.log('✅ Engine created');

    // Load renderers
    console.log('Loading renderers...');
    engine.loadRenderers([debugRenderer, pathtracerRenderer]);
    console.log('✅ Renderers loaded');

    // Store engine globally for debugging
    (window as any).engine = engine;
    (window as any).gl = gl;

    // UI setup
    const btnDebug = document.getElementById('btn-debug') as HTMLButtonElement;
    const btnPathtracer = document.getElementById('btn-pathtracer') as HTMLButtonElement;
    const btnReset = document.getElementById('btn-reset') as HTMLButtonElement;
    const statSamples = document.getElementById('stat-samples') as HTMLSpanElement;
    const statFps = document.getElementById('stat-fps') as HTMLSpanElement;

    // Track active renderer
    let activeRendererId = 'pathtracer-test-scene';

    // Update active button state
    function updateButtonStates() {
        btnDebug.classList.toggle('active', activeRendererId === 'debug-test-scene');
        btnPathtracer.classList.toggle('active', activeRendererId === 'pathtracer-test-scene');
    }

    // Renderer switching
    btnDebug.addEventListener('click', () => {
        console.log('Switching to debug renderer');
        engine.selectRenderer('debug-test-scene');
        activeRendererId = 'debug-test-scene';
        updateButtonStates();
    });

    btnPathtracer.addEventListener('click', () => {
        console.log('Switching to pathtracer renderer');
        engine.selectRenderer('pathtracer-test-scene');
        activeRendererId = 'pathtracer-test-scene';
        updateButtonStates();
    });

    // Reset accumulation
    btnReset.addEventListener('click', () => {
        console.log('Resetting accumulation');
        engine.clearAccumulation();
    });

    // Initial button state
    updateButtonStates();

    // FPS tracking
    const fpsTracker = new FPSTracker();

    // Render loop
    let frameCount = 0;
    function renderLoop() {
        try {
            // Render frame
            engine.renderFrame();

            // Update stats
            const samples = engine.getSampleCount();
            const fps = fpsTracker.update();

            statSamples.textContent = samples.toString();
            statFps.textContent = fps.toFixed(1);

            // Log first few frames
            if (frameCount < 5) {
                console.log(`Frame ${frameCount}: samples=${samples}, fps=${fps.toFixed(1)}`);
            }

            frameCount++;

            // Check for WebGL errors (first 10 frames)
            if (frameCount < 10) {
                const error = gl.getError();
                if (error !== gl.NO_ERROR) {
                    console.error(`WebGL error detected: ${error}`);
                }
            }

            requestAnimationFrame(renderLoop);
        } catch (error: any) {
            showError('Render loop error: ' + error.message, error.stack);
        }
    }

    // Start rendering
    console.log('Starting render loop...');
    requestAnimationFrame(renderLoop);
    console.log('✅ Render loop started');

    console.log('=== FlexibleEngine Test Running ===');
}

// Handle window resize
window.addEventListener('resize', () => {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    const engine = (window as any).engine as FlexibleEngine;

    if (canvas && engine) {
        const width = window.innerWidth;
        const height = window.innerHeight;

        canvas.width = width;
        canvas.height = height;

        engine.resize(width, height);
        engine.clearAccumulation();  // Reset after resize

        console.log(`Resized to ${width}×${height}`);
    }
});

// Run with error handling
main().catch(error => {
    showError('Failed to start: ' + error.message, error.stack);
    console.error('Fatal error:', error);
});
