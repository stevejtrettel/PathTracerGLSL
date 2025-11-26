/**
 * Cornell Box Example
 *
 * Demonstrates the App system with:
 * - Full path tracer (multi-bounce GI)
 * - Direct lighting (single bounce)
 * - Debug visualization (albedo, distance, steps)
 *
 * Interactive parameters:
 * - Sphere position and radius
 * - Light size and intensity
 *
 * Keyboard shortcuts:
 * - 1/2/3: Switch renderers
 * - r: Reset accumulation
 * - Space: Toggle rendering
 * - p: Production render
 * - i: Toggle stats
 * - Tab: Toggle parameter panel
 * - x/X: Export PNG/HDR
 */

import { App, STRATEGY_PRESETS } from '../src/app/index.js';
import {
    OrbitControls,
    TouchOrbitControls,
    ParameterPanelExtension,
    StatsPanel
} from '../src/app/extensions/index.js';

async function main() {
    console.log('=== Cornell Box Example ===');

    // Create canvas
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    if (!canvas) {
        console.error('Canvas not found');
        return;
    }

    // Create app
    const app = new App(canvas);

    // Initialize with our strategies
    await app.initialize({
        scene: { id: 'cornell-box', name: 'Cornell Box' },
        strategies: [
            STRATEGY_PRESETS['pathtracer-full'].strategy,  // Full GI
            STRATEGY_PRESETS.pathtracer.strategy,           // Direct lighting
            STRATEGY_PRESETS['debug-aovs'].strategy         // Debug visualization
        ]
    });

    console.log('Renderers:', app.getAvailableRendererIds());

    // Install extensions
    app.use(new OrbitControls());
    app.use(new TouchOrbitControls());
    app.use(new ParameterPanelExtension());
    app.use(new StatsPanel());

    // Setup keyboard shortcuts
    app.setupKeyboardControls();

    // Enable GPU profiling for stats
    app.enableProfiling();

    // Start rendering
    app.start();

    // Expose for debugging
    (window as any).app = app;

    console.log('Ready! Use 1/2/3 to switch renderers');
    console.log('  1: Full Path Tracer (GI)');
    console.log('  2: Direct Lighting');
    console.log('  3: Debug (albedo/distance/steps)');
}

// Run on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main();
}
