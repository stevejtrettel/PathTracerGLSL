/**
 * Minimal Scene Example
 *
 * Demonstrates the real Compiler pipeline:
 * - Sphere on ground plane
 * - Lambert materials
 * - Point light with NEE
 * - Progressive accumulation
 */

import { App } from '../src/app/index.js';
import { minimalScene, minimalStrategy, directOnlyStrategy } from '../src/compiler/scenes/minimalScene.js';
import {
    OrbitControls,
    ParameterPanelExtension,
    ProductionPanelExtension,
    RenderControlsExtension,
    StatsPanel,
    AppShortcutsExtension
} from '../src/app/extensions/index.js';

async function main() {
    console.log('=== Minimal Scene (Real Compiler) ===');

    const app = App.create(document.body, { layout: 'fullscreen' });

    await app.initialize({
        scene: minimalScene,
        strategies: [minimalStrategy, directOnlyStrategy]
    });

    console.log('Renderers:', app.getAvailableRendererIds());

    app.use(new OrbitControls());
    app.use(new StatsPanel());
    app.use(new ParameterPanelExtension());
    app.use(new ProductionPanelExtension());
    app.use(new RenderControlsExtension());
    app.use(new AppShortcutsExtension());

    app.enableProfiling();
    app.start();

    (window as any).app = app;
    console.log('Ready!');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main();
}
