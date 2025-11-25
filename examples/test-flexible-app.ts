// examples/test-flexible-app.ts
// Test for FlexibleApp architecture

import { FlexibleApp, STRATEGY_PRESETS } from '../src/app-new/index.js';
import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';

/**
 * Simple FPS tracker
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
 * Main test application
 */
async function main() {
    console.log('=== FlexibleApp Test Starting ===');

    // Get or create canvas
    let canvas = document.getElementById('canvas') as HTMLCanvasElement;
    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'canvas';
        canvas.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            display: block;
        `;
        document.body.appendChild(canvas);
    }

    // Create app
    const app = new FlexibleApp(canvas);
    console.log('✅ FlexibleApp created');

    // Define scene
    const scene: SceneDescription = {
        id: 'test-scene',
        name: 'Test Scene'
    };

    // Define strategies (using presets)
    const strategies: RenderStrategy[] = [
        STRATEGY_PRESETS.debug.strategy,
        STRATEGY_PRESETS.pathtracer.strategy,
        STRATEGY_PRESETS['pathtracer-aovs'].strategy
    ];

    // Initialize
    await app.initialize({
        scene,
        strategies
    });
    console.log('✅ FlexibleApp initialized');

    // Store globally for debugging
    (window as any).app = app;

    // Setup UI
    setupUI(app);

    // Setup progress tracking
    const fpsTracker = new FPSTracker();
    app.onProgress = (progress) => {
        updateStats(progress.samples, fpsTracker.update());
    };

    // Setup renderer change callback
    app.onRendererChanged = (rendererId) => {
        updateActiveButton(rendererId);
        console.log(`Renderer changed to: ${rendererId}`);
    };

    // Start rendering
    app.start();
    console.log('✅ Render loop started');

    // Handle resize
    window.addEventListener('resize', () => {
        app.resizeToWindow();
    });

    console.log('=== FlexibleApp Test Running ===');
    console.log('Press 1-3 to switch renderers, R to reset, Space to pause');
}

/**
 * Setup UI elements
 */
function setupUI(app: FlexibleApp) {
    // Create UI container
    const ui = document.createElement('div');
    ui.id = 'ui';
    ui.innerHTML = `
        <style>
            #ui {
                position: fixed;
                top: 20px;
                left: 20px;
                background: rgba(0, 0, 0, 0.8);
                color: #fff;
                padding: 20px;
                border-radius: 8px;
                font-family: system-ui, sans-serif;
                font-size: 14px;
                z-index: 1000;
            }
            #ui h2 {
                margin: 0 0 15px 0;
                color: #4CAF50;
            }
            .ui-section {
                margin-bottom: 15px;
            }
            .ui-label {
                display: block;
                margin-bottom: 5px;
                color: #aaa;
                font-size: 12px;
                text-transform: uppercase;
            }
            .button-group {
                display: flex;
                gap: 8px;
            }
            button {
                padding: 8px 16px;
                background: #333;
                color: #fff;
                border: 1px solid #555;
                border-radius: 4px;
                cursor: pointer;
            }
            button:hover {
                background: #444;
            }
            button.active {
                background: #4CAF50;
                border-color: #4CAF50;
            }
            .stat {
                display: flex;
                justify-content: space-between;
                padding: 5px 0;
                border-bottom: 1px solid #333;
            }
            .stat-label { color: #999; }
            .stat-value { color: #fff; font-weight: bold; }
        </style>
        <h2>FlexibleApp Test</h2>

        <div class="ui-section">
            <span class="ui-label">Renderer</span>
            <div class="button-group">
                <button id="btn-debug">1: Debug</button>
                <button id="btn-pathtracer" class="active">2: Pathtracer</button>
                <button id="btn-aovs">3: AOVs</button>
            </div>
        </div>

        <div class="ui-section">
            <span class="ui-label">Stats</span>
            <div class="stat">
                <span class="stat-label">Samples</span>
                <span class="stat-value" id="stat-samples">0</span>
            </div>
            <div class="stat">
                <span class="stat-label">FPS</span>
                <span class="stat-value" id="stat-fps">0</span>
            </div>
        </div>

        <div class="ui-section">
            <button id="btn-reset" style="width: 100%;">Reset (R)</button>
        </div>
    `;
    document.body.appendChild(ui);

    // Button handlers
    const rendererIds = app.getAvailableRendererIds();

    document.getElementById('btn-debug')?.addEventListener('click', () => {
        app.selectRenderer(rendererIds[0]);
    });

    document.getElementById('btn-pathtracer')?.addEventListener('click', () => {
        app.selectRenderer(rendererIds[1]);
    });

    document.getElementById('btn-aovs')?.addEventListener('click', () => {
        app.selectRenderer(rendererIds[2]);
    });

    document.getElementById('btn-reset')?.addEventListener('click', () => {
        app.clearAccumulation();
    });

    // Keyboard controls
    app.setupKeyboardControls();
}

/**
 * Update stats display
 */
function updateStats(samples: number, fps: number) {
    const samplesEl = document.getElementById('stat-samples');
    const fpsEl = document.getElementById('stat-fps');

    if (samplesEl) samplesEl.textContent = samples.toString();
    if (fpsEl) fpsEl.textContent = fps.toFixed(1);
}

/**
 * Update active button state
 */
function updateActiveButton(rendererId: string) {
    const btnDebug = document.getElementById('btn-debug');
    const btnPathtracer = document.getElementById('btn-pathtracer');
    const btnAovs = document.getElementById('btn-aovs');

    btnDebug?.classList.toggle('active', rendererId.includes('debug'));
    btnPathtracer?.classList.toggle('active', rendererId.includes('pathtracer') && !rendererId.includes('aovs'));
    btnAovs?.classList.toggle('active', rendererId.includes('aovs'));
}

// Run
main().catch(error => {
    console.error('Fatal error:', error);
    alert('Failed to start: ' + error.message);
});
