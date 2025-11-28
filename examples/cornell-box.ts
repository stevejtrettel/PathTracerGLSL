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
 * UI Components:
 * - Toolbar: Render button and sample count (top)
 * - Stats Panel: FPS, samples, resolution (top-left)
 * - Parameter Panel: Uniforms (right sidebar, Tab to toggle)
 * - Production Panel: Progress bar during renders (bottom)
 *
 * Keyboard shortcuts:
 * - 1/2/3: Switch renderers
 * - r: Reset accumulation
 * - Space: Toggle rendering
 * - i: Toggle stats
 * - Tab: Toggle parameter panel
 * - x/X: Export PNG/HDR
 */

import { App, STRATEGY_PRESETS } from '../src/app/index.js';
import {
    OrbitControls,
    ParameterPanelExtension,
    ProductionPanelExtension,
    RenderControlsExtension,
    StatsPanel,
    AppShortcutsExtension
} from '../src/app/extensions/index.js';

async function main() {
    console.log('=== Cornell Box Example ===');

    // Create app with layout system
    const app = App.create(document.body, { layout: 'fullscreen' });

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
    app.use(new StatsPanel());              // Top-left: render stats
    app.use(new ParameterPanelExtension()); // Right sidebar: parameters (Tab to toggle)
    app.use(new ProductionPanelExtension()); // Bottom: progress during production renders
    app.use(new RenderControlsExtension()); // Top toolbar: render button
    app.use(new AppShortcutsExtension());   // Keyboard shortcuts

    // Enable GPU profiling for stats
    app.enableProfiling();

    // Start interactive rendering
    app.start();

    // Expose for debugging
    (window as any).app = app;

    console.log('Ready! Use 1/2/3 to switch renderers');
    console.log('  1: Full Path Tracer (GI)');
    console.log('  2: Direct Lighting');
    console.log('  3: Debug (albedo/distance/steps)');
    console.log('Click "Render" in toolbar to start production render');
}

// Run on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main();
}
