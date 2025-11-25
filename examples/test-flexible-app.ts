// examples/test-flexible-app.ts
// Test for FlexibleApp architecture with full UI

import { FlexibleApp, STRATEGY_PRESETS, type Extension } from '../src/app-new/index.js';
import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';

/**
 * Simple stats extension demonstrating the extension API
 */
class StatsExtension implements Extension {
    name = 'stats';
    version = '1.0.0';
    description = 'Displays render statistics';

    private app: FlexibleApp | null = null;
    private unsubscribe: (() => void)[] = [];

    install(app: FlexibleApp, bus: any): void {
        this.app = app;

        // Subscribe to events
        const onProgress = (info: any) => {
            this.updateDisplay(info);
        };

        const onRendererSwitch = (data: any) => {
            console.log(`[StatsExtension] Renderer switched: ${data.rendererId}`);
        };

        bus.on('render.progress', onProgress);
        bus.on('renderer.switched', onRendererSwitch);

        this.unsubscribe.push(() => bus.off('render.progress', onProgress));
        this.unsubscribe.push(() => bus.off('renderer.switched', onRendererSwitch));

        console.log('[StatsExtension] Installed');
    }

    uninstall(): void {
        for (const unsub of this.unsubscribe) {
            unsub();
        }
        this.unsubscribe = [];
        console.log('[StatsExtension] Uninstalled');
    }

    private updateDisplay(info: any): void {
        // Update mode/state display
        const modeEl = document.getElementById('stat-mode');
        const stateEl = document.getElementById('stat-state');
        const timeEl = document.getElementById('stat-time');

        if (modeEl) modeEl.textContent = info.mode;
        if (stateEl) stateEl.textContent = info.state;
        if (timeEl) timeEl.textContent = (info.elapsedTime / 1000).toFixed(1) + 's';

        // Update progress bar for production mode
        const progressBar = document.getElementById('progress-bar');
        const progressText = document.getElementById('progress-text');
        if (info.mode === 'production' && info.percentComplete !== undefined) {
            if (progressBar) {
                progressBar.style.width = info.percentComplete + '%';
                progressBar.style.display = 'block';
            }
            if (progressText) {
                progressText.textContent = `${info.percentComplete.toFixed(1)}%`;
            }
        } else {
            if (progressBar) progressBar.style.display = 'none';
            if (progressText) progressText.textContent = '';
        }
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
    console.log('FlexibleApp created');

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
    console.log('FlexibleApp initialized');

    // Install stats extension
    app.use(new StatsExtension());

    // Store globally for debugging
    (window as any).app = app;

    // Setup UI
    setupUI(app);

    // Setup progress tracking
    app.onProgress = (progress) => {
        updateStats(progress.samples, progress.fps);
    };

    // Setup renderer change callback
    app.onRendererChanged = (rendererId) => {
        updateActiveButton(rendererId);
    };

    // Start rendering
    app.start();
    console.log('Render loop started');

    // Sync initial button state with actual renderer
    const activeId = app.getActiveRendererId();
    if (activeId) updateActiveButton(activeId);

    // Handle resize
    window.addEventListener('resize', () => {
        app.resizeToWindow();
    });

    console.log('=== FlexibleApp Test Running ===');
    console.log('Controls:');
    console.log('  1-3: Switch renderers');
    console.log('  r: Reset accumulation');
    console.log('  Space: Toggle rendering');
    console.log('  \\: Pause/resume');
    console.log('  p: Production render');
    console.log('  Escape: Stop');
    console.log('  x/X/a: Export PNG/HDR/AOVs');
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
                background: rgba(0, 0, 0, 0.85);
                color: #fff;
                padding: 20px;
                border-radius: 8px;
                font-family: system-ui, -apple-system, sans-serif;
                font-size: 14px;
                z-index: 1000;
                min-width: 280px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            }
            #ui h2 {
                margin: 0 0 15px 0;
                color: #4CAF50;
                font-size: 18px;
            }
            .ui-section {
                margin-bottom: 15px;
            }
            .ui-label {
                display: block;
                margin-bottom: 5px;
                color: #888;
                font-size: 11px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .button-group {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
            }
            button {
                padding: 8px 14px;
                background: #333;
                color: #fff;
                border: 1px solid #555;
                border-radius: 4px;
                cursor: pointer;
                font-size: 13px;
                transition: all 0.15s;
            }
            button:hover {
                background: #444;
                border-color: #666;
            }
            button.active {
                background: #4CAF50;
                border-color: #4CAF50;
            }
            button:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            .stat {
                display: flex;
                justify-content: space-between;
                padding: 5px 0;
                border-bottom: 1px solid #333;
            }
            .stat:last-child {
                border-bottom: none;
            }
            .stat-label { color: #888; }
            .stat-value { color: #fff; font-weight: 500; font-variant-numeric: tabular-nums; }
            .progress-container {
                height: 4px;
                background: #333;
                border-radius: 2px;
                margin-top: 10px;
                overflow: hidden;
            }
            #progress-bar {
                height: 100%;
                background: #4CAF50;
                width: 0%;
                transition: width 0.1s;
                display: none;
            }
            .export-group {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 8px;
            }
            .info-text {
                font-size: 11px;
                color: #666;
                margin-top: 10px;
                line-height: 1.4;
            }
        </style>
        <h2>FlexibleApp Test</h2>

        <div class="ui-section">
            <span class="ui-label">Renderer</span>
            <div class="button-group">
                <button id="btn-debug">1: Debug</button>
                <button id="btn-pathtracer" class="active">2: Path</button>
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
            <div class="stat">
                <span class="stat-label">Time</span>
                <span class="stat-value" id="stat-time">0s</span>
            </div>
            <div class="stat">
                <span class="stat-label">Mode</span>
                <span class="stat-value" id="stat-mode">interactive</span>
            </div>
            <div class="stat">
                <span class="stat-label">State</span>
                <span class="stat-value" id="stat-state">rendering</span>
            </div>
            <div class="progress-container">
                <div id="progress-bar"></div>
            </div>
            <span id="progress-text" style="font-size: 12px; color: #4CAF50;"></span>
        </div>

        <div class="ui-section">
            <span class="ui-label">Controls</span>
            <div class="button-group">
                <button id="btn-reset">Reset (r)</button>
                <button id="btn-pause">Pause (\\)</button>
                <button id="btn-production">Prod (p)</button>
            </div>
        </div>

        <div class="ui-section">
            <span class="ui-label">Export</span>
            <div class="export-group">
                <button id="btn-png">PNG (x)</button>
                <button id="btn-hdr">HDR (X)</button>
                <button id="btn-aov">All AOVs (a)</button>
                <button id="btn-session">Save Session</button>
            </div>
        </div>

        <div class="info-text">
            Press 1-3 for renderers, Space to start/stop<br>
            Available exports: <span id="export-list">-</span>
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

    document.getElementById('btn-pause')?.addEventListener('click', () => {
        if (app.isPaused()) {
            app.resume();
        } else {
            app.pause();
        }
        updatePauseButton(app);
    });

    document.getElementById('btn-production')?.addEventListener('click', () => {
        const samples = prompt('Target samples?', '500');
        if (samples) {
            const count = parseInt(samples);
            if (count > 0) {
                app.renderProduction(count).then(() => {
                    console.log('Production complete!');
                }).catch(err => {
                    if (err.name === 'RenderStopped') {
                        console.log('Production stopped');
                    }
                });
            }
        }
    });

    document.getElementById('btn-png')?.addEventListener('click', () => {
        app.exportPNG();
    });

    document.getElementById('btn-hdr')?.addEventListener('click', () => {
        app.exportHDR();
    });

    document.getElementById('btn-aov')?.addEventListener('click', () => {
        app.exportAllAOVs();
    });

    document.getElementById('btn-session')?.addEventListener('click', () => {
        const session = app.saveSession();
        const json = JSON.stringify(session, null, 2);
        console.log('Session saved:', session);

        // Download as JSON file
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'session.json';
        a.click();
        URL.revokeObjectURL(url);
    });

    // Show available exports
    setTimeout(() => {
        const exports = app.getAvailableExports();
        const exportList = document.getElementById('export-list');
        if (exportList) {
            exportList.textContent = exports.join(', ') || 'none';
        }
    }, 100);

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
 * Update pause button text
 */
function updatePauseButton(app: FlexibleApp) {
    const btn = document.getElementById('btn-pause');
    if (btn) {
        btn.textContent = app.isPaused() ? 'Resume (\\)' : 'Pause (\\)';
    }
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

    // Update export list when renderer changes
    setTimeout(() => {
        const app = (window as any).app as FlexibleApp;
        if (app) {
            const exports = app.getAvailableExports();
            const exportList = document.getElementById('export-list');
            if (exportList) {
                exportList.textContent = exports.join(', ') || 'none';
            }
        }
    }, 100);
}

// Run
main().catch(error => {
    console.error('Fatal error:', error);
    alert('Failed to start: ' + error.message);
});
