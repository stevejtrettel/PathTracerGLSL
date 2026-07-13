/**
 * Cornell Box Example
 *
 * Demonstrates the real Compiler pipeline:
 * - Cornell box with colored walls
 * - Tall box + sphere
 * - Lambert materials
 * - Point light with NEE
 * - Progressive accumulation
 */

import { App } from '../src/app/index.js';
import { cornellBox, cornellStrategy } from '../src/witnesses/scenes/cornellBox.js';
import {
    OrbitControls,
    ParameterPanelExtension,
    ProductionPanelExtension,
    RenderControlsExtension,
    StatsPanel,
    AppShortcutsExtension
} from '../src/app/extensions/index.js';

async function main() {
    console.log('=== Cornell Box ===');

    const app = App.create(document.body, { layout: 'fullscreen' });

    await app.initialize({
        scene: cornellBox,
        strategies: [cornellStrategy],
        initialParameters: {
            'camera.position': [0, 1, 4],
            'camera.target': [0, 1, 0],
        },
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
