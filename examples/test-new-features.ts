// examples/test-new-features.ts
// Test for new Phase 7-10 features: TiledRenderer, Camera Controls, ParameterPanel

import {
    FlexibleApp,
    STRATEGY_PRESETS,
    TiledRenderer,
    OrbitControls,
    TouchOrbitControls,
    ParameterPanelExtension,
    type Extension
} from '../src/app-new/index.js';
import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';

/**
 * Stats display extension
 */
class StatsExtension implements Extension {
    name = 'stats';
    version = '1.0.0';

    private unsubscribe: (() => void)[] = [];

    install(app: FlexibleApp, bus: any): void {
        const onProgress = (info: any) => {
            const samplesEl = document.getElementById('stat-samples');
            const fpsEl = document.getElementById('stat-fps');
            const modeEl = document.getElementById('stat-mode');
            const stateEl = document.getElementById('stat-state');

            if (samplesEl) samplesEl.textContent = info.samples.toString();
            if (fpsEl) fpsEl.textContent = info.fps.toFixed(1);
            if (modeEl) modeEl.textContent = info.mode;
            if (stateEl) stateEl.textContent = info.state;

            // Progress bar for production
            const progressBar = document.getElementById('progress-bar');
            if (info.mode === 'production' && info.percentComplete !== undefined) {
                if (progressBar) {
                    progressBar.style.width = info.percentComplete + '%';
                    progressBar.style.display = 'block';
                }
            } else {
                if (progressBar) progressBar.style.display = 'none';
            }
        };

        bus.on('render.progress', onProgress);
        this.unsubscribe.push(() => bus.off('render.progress', onProgress));

        // Camera move updates
        const onCameraMove = (data: any) => {
            const camPosEl = document.getElementById('stat-cam-pos');
            if (camPosEl && data.position) {
                const [x, y, z] = data.position;
                camPosEl.textContent = `(${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`;
            }
        };

        bus.on('camera.moved', onCameraMove);
        this.unsubscribe.push(() => bus.off('camera.moved', onCameraMove));
    }

    uninstall(): void {
        this.unsubscribe.forEach(fn => fn());
        this.unsubscribe = [];
    }
}

/**
 * Main test
 */
async function main() {
    console.log('=== Testing New Features (Phase 7-10) ===');

    // Create canvas
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

    // Define scene
    const scene: SceneDescription = {
        id: 'test-scene',
        name: 'Test Scene'
    };

    // Use pathtracer strategies
    const strategies: RenderStrategy[] = [
        STRATEGY_PRESETS.pathtracer.strategy,
        STRATEGY_PRESETS['pathtracer-aovs'].strategy,
        STRATEGY_PRESETS.debug.strategy
    ];

    // Initialize
    await app.initialize({ scene, strategies });
    console.log('App initialized');

    // ===== INSTALL NEW EXTENSIONS =====

    // 1. Stats extension
    app.use(new StatsExtension());
    console.log('StatsExtension installed');

    // 2. Orbit Controls (mouse drag to rotate, scroll to zoom)
    const orbitControls = new OrbitControls();
    app.use(orbitControls);
    console.log('OrbitControls installed');

    // 3. Touch Orbit Controls (for mobile/tablet)
    const touchControls = new TouchOrbitControls();
    app.use(touchControls);
    console.log('TouchOrbitControls installed');

    // 4. Parameter Panel (Tab to toggle)
    const paramPanel = new ParameterPanelExtension();
    app.use(paramPanel);
    console.log('ParameterPanelExtension installed');

    // ===== CREATE TILED RENDERER =====
    const tiledRenderer = new TiledRenderer(app);

    // Store globally for debugging
    (window as any).app = app;
    (window as any).tiledRenderer = tiledRenderer;
    (window as any).orbitControls = orbitControls;
    (window as any).paramPanel = paramPanel;

    // Setup UI
    setupUI(app, tiledRenderer);

    // Start rendering
    app.start();

    // Sync initial button state
    const activeId = app.getActiveRendererId();
    if (activeId) updateActiveButton(activeId);

    // Renderer change callback
    app.onRendererChanged = (rendererId) => {
        updateActiveButton(rendererId);
        updateExportList(app);
    };

    // Handle resize
    window.addEventListener('resize', () => app.resizeToWindow());

    // Setup keyboard controls
    app.setupKeyboardControls();

    console.log('=== Test Running ===');
    console.log('');
    console.log('NEW FEATURES TO TEST:');
    console.log('  - Tab: Toggle Parameter Panel');
    console.log('  - Mouse Drag: Orbit camera around scene');
    console.log('  - Mouse Wheel: Zoom in/out');
    console.log('  - Touch: One finger orbit, two finger pinch zoom');
    console.log('  - Tiled Render button: High-res production render');
    console.log('');
    console.log('Standard controls:');
    console.log('  1-3: Switch renderers');
    console.log('  r: Reset accumulation');
    console.log('  Space: Toggle rendering');
    console.log('  p: Production render');
    console.log('  x/X/a: Export PNG/HDR/AOVs');
}

/**
 * Setup UI
 */
function setupUI(app: FlexibleApp, tiledRenderer: TiledRenderer) {
    const ui = document.createElement('div');
    ui.id = 'ui';
    ui.innerHTML = `
        <style>
            #ui {
                position: fixed;
                top: 20px;
                left: 20px;
                background: rgba(0, 0, 0, 0.9);
                color: #fff;
                padding: 20px;
                border-radius: 12px;
                font-family: system-ui, -apple-system, sans-serif;
                font-size: 13px;
                z-index: 1000;
                min-width: 300px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.6);
                backdrop-filter: blur(10px);
            }
            #ui h2 {
                margin: 0 0 15px 0;
                color: #4CAF50;
                font-size: 16px;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            #ui h2::before {
                content: '⚡';
            }
            .ui-section {
                margin-bottom: 16px;
                padding-bottom: 12px;
                border-bottom: 1px solid rgba(255,255,255,0.1);
            }
            .ui-section:last-child {
                border-bottom: none;
                margin-bottom: 0;
            }
            .ui-label {
                display: block;
                margin-bottom: 8px;
                color: #888;
                font-size: 10px;
                text-transform: uppercase;
                letter-spacing: 1px;
            }
            .button-group {
                display: flex;
                gap: 6px;
                flex-wrap: wrap;
            }
            button {
                padding: 8px 12px;
                background: rgba(255,255,255,0.1);
                color: #fff;
                border: 1px solid rgba(255,255,255,0.2);
                border-radius: 6px;
                cursor: pointer;
                font-size: 12px;
                transition: all 0.15s;
            }
            button:hover {
                background: rgba(255,255,255,0.15);
                border-color: rgba(255,255,255,0.3);
            }
            button.active {
                background: #4CAF50;
                border-color: #4CAF50;
            }
            button.feature {
                background: rgba(74, 158, 255, 0.2);
                border-color: rgba(74, 158, 255, 0.4);
            }
            button.feature:hover {
                background: rgba(74, 158, 255, 0.3);
            }
            .stat {
                display: flex;
                justify-content: space-between;
                padding: 4px 0;
            }
            .stat-label { color: #666; font-size: 11px; }
            .stat-value {
                color: #fff;
                font-weight: 500;
                font-variant-numeric: tabular-nums;
                font-family: 'SF Mono', Monaco, monospace;
                font-size: 12px;
            }
            .progress-container {
                height: 3px;
                background: rgba(255,255,255,0.1);
                border-radius: 2px;
                margin-top: 8px;
                overflow: hidden;
            }
            #progress-bar {
                height: 100%;
                background: linear-gradient(90deg, #4CAF50, #8BC34A);
                width: 0%;
                transition: width 0.1s;
                display: none;
            }
            .new-badge {
                background: #ff5722;
                color: white;
                font-size: 9px;
                padding: 2px 5px;
                border-radius: 3px;
                margin-left: 6px;
                font-weight: bold;
            }
            .info-box {
                background: rgba(74, 158, 255, 0.1);
                border: 1px solid rgba(74, 158, 255, 0.3);
                border-radius: 6px;
                padding: 10px;
                font-size: 11px;
                color: #88c0ff;
                line-height: 1.5;
            }
            .info-box strong {
                color: #fff;
            }
        </style>
        <h2>New Features Test</h2>

        <div class="ui-section">
            <span class="ui-label">Renderer</span>
            <div class="button-group">
                <button id="btn-pathtracer">Path</button>
                <button id="btn-aovs">AOVs</button>
                <button id="btn-debug">Debug</button>
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
                <span class="stat-label">Mode</span>
                <span class="stat-value" id="stat-mode">interactive</span>
            </div>
            <div class="stat">
                <span class="stat-label">State</span>
                <span class="stat-value" id="stat-state">rendering</span>
            </div>
            <div class="stat">
                <span class="stat-label">Camera</span>
                <span class="stat-value" id="stat-cam-pos">(0, 0, 5)</span>
            </div>
            <div class="progress-container">
                <div id="progress-bar"></div>
            </div>
        </div>

        <div class="ui-section">
            <span class="ui-label">New Features <span class="new-badge">NEW</span></span>
            <div class="button-group">
                <button id="btn-param-panel" class="feature">Parameter Panel (Tab)</button>
                <button id="btn-tiled" class="feature">Tiled Render</button>
            </div>
        </div>

        <div class="ui-section">
            <span class="ui-label">Controls</span>
            <div class="button-group">
                <button id="btn-reset">Reset (r)</button>
                <button id="btn-pause">Pause</button>
                <button id="btn-production">Production</button>
            </div>
        </div>

        <div class="ui-section">
            <span class="ui-label">Export</span>
            <div class="button-group">
                <button id="btn-png">PNG</button>
                <button id="btn-hdr">HDR</button>
                <button id="btn-aov">AOVs</button>
            </div>
            <div style="font-size: 10px; color: #666; margin-top: 6px;">
                Available: <span id="export-list">-</span>
            </div>
        </div>

        <div class="info-box">
            <strong>Camera Controls:</strong> Drag to orbit, scroll to zoom<br>
            <strong>Parameter Panel:</strong> Press Tab to toggle<br>
            <strong>Tiled Render:</strong> High-res production output
        </div>
    `;
    document.body.appendChild(ui);

    // Get renderer IDs
    const rendererIds = app.getAvailableRendererIds();

    // Renderer buttons
    document.getElementById('btn-pathtracer')?.addEventListener('click', () => {
        app.selectRenderer(rendererIds[0]);
    });
    document.getElementById('btn-aovs')?.addEventListener('click', () => {
        app.selectRenderer(rendererIds[1]);
    });
    document.getElementById('btn-debug')?.addEventListener('click', () => {
        app.selectRenderer(rendererIds[2]);
    });

    // Control buttons
    document.getElementById('btn-reset')?.addEventListener('click', () => {
        app.clearAccumulation();
    });

    document.getElementById('btn-pause')?.addEventListener('click', () => {
        const btn = document.getElementById('btn-pause');
        if (app.isPaused()) {
            app.resume();
            if (btn) btn.textContent = 'Pause';
        } else {
            app.pause();
            if (btn) btn.textContent = 'Resume';
        }
    });

    document.getElementById('btn-production')?.addEventListener('click', () => {
        const samples = prompt('Target samples?', '500');
        if (samples) {
            const count = parseInt(samples);
            if (count > 0) {
                app.renderProduction(count).then(() => {
                    alert('Production render complete!');
                }).catch(err => {
                    if (err.name !== 'RenderStopped') console.error(err);
                });
            }
        }
    });

    // NEW FEATURE: Parameter Panel toggle
    document.getElementById('btn-param-panel')?.addEventListener('click', () => {
        // Access paramPanel from window (set in main)
        const panel = (window as any).paramPanel;
        if (panel && panel.open) {
            // Toggle: check if panel element has 'open' class
            const panelEl = document.querySelector('.param-panel');
            if (panelEl?.classList.contains('open')) {
                panel.close();
            } else {
                panel.open();
            }
        } else {
            console.warn('Parameter panel not available');
        }
    });

    // NEW FEATURE: Tiled Render
    document.getElementById('btn-tiled')?.addEventListener('click', () => {
        const width = prompt('Target width (pixels)?', '2048');
        const height = prompt('Target height (pixels)?', '1024');
        const tileSize = prompt('Tile size?', '512');
        const samples = prompt('Samples per tile?', '100');
        const format = prompt('Format (hdr/png/both)?', 'both');

        if (width && height && tileSize && samples && format) {
            const config = {
                targetWidth: parseInt(width),
                targetHeight: parseInt(height),
                targetTileSize: parseInt(tileSize),
                samplesPerTile: parseInt(samples),
                format: format as 'hdr' | 'png' | 'both'
            };

            console.log('Starting tiled render:', config);

            tiledRenderer.startJob(config).then(() => {
                alert('Tiled render complete! Check downloads for tile files.');
            }).catch(err => {
                if (err.name !== 'RenderStopped') {
                    console.error('Tiled render failed:', err);
                    alert('Tiled render failed: ' + err.message);
                }
            });
        }
    });

    // Export buttons
    document.getElementById('btn-png')?.addEventListener('click', () => app.exportPNG());
    document.getElementById('btn-hdr')?.addEventListener('click', () => app.exportHDR());
    document.getElementById('btn-aov')?.addEventListener('click', () => app.exportAllAOVs());

    // Initial export list
    updateExportList(app);
}

/**
 * Update active renderer button
 */
function updateActiveButton(rendererId: string) {
    const btnDebug = document.getElementById('btn-debug');
    const btnPathtracer = document.getElementById('btn-pathtracer');
    const btnAovs = document.getElementById('btn-aovs');

    btnDebug?.classList.toggle('active', rendererId.includes('debug'));
    btnPathtracer?.classList.toggle('active', rendererId.includes('pathtracer') && !rendererId.includes('aovs'));
    btnAovs?.classList.toggle('active', rendererId.includes('aovs'));
}

/**
 * Update export list display
 */
function updateExportList(app: FlexibleApp) {
    setTimeout(() => {
        const exports = app.getAvailableExports();
        const el = document.getElementById('export-list');
        if (el) el.textContent = exports.join(', ') || 'none';
    }, 100);
}

// Run
main().catch(error => {
    console.error('Fatal error:', error);
    alert('Failed to start: ' + error.message);
});
