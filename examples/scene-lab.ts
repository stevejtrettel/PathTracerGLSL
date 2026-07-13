/**
 * Scene Lab
 *
 * Renders any scene from the suite (src/compiler/scenes/index.ts):
 * /lab.html?scene=furnace  (default: two-light). Strategies bind to keys 1-9; `r` resets
 * accumulation. The landing page (index.html and /suite.html) is the suite GALLERY
 * (examples/suite.ts) — every card links here.
 */

import { App } from '../src/app/index.js';
import { sceneSuite, DEFAULT_SCENE } from '../src/compiler/scenes/index.js';
import {
    OrbitControls,
    ParameterPanelExtension,
    ProductionPanelExtension,
    RenderControlsExtension,
    StatsPanel,
    AppShortcutsExtension,
} from '../src/app/extensions/index.js';

async function main() {
    const requested = new URLSearchParams(window.location.search).get('scene') ?? DEFAULT_SCENE;
    const id = requested in sceneSuite ? requested : DEFAULT_SCENE;
    const entry = sceneSuite[id];

    console.log(`=== Scene Lab: ${id} ===`);
    console.log(`Exercises: ${entry.exercises}`);
    console.log(`Available scenes: ${Object.keys(sceneSuite).join(', ')} (switch with ?scene=<id>; gallery at /suite.html)`);

    const app = App.create(document.body, { layout: 'fullscreen' });

    await app.initialize({
        scene: entry.scene,
        strategies: entry.strategies,
        initialParameters: entry.initialParameters,
    });

    console.log('Renderers (keys 1-9):', app.getAvailableRendererIds());

    app.use(new OrbitControls());
    app.use(new StatsPanel());
    app.use(new ParameterPanelExtension());
    app.use(new ProductionPanelExtension());
    app.use(new RenderControlsExtension());
    app.use(new AppShortcutsExtension());

    app.enableProfiling();
    app.start();

    (window as any).app = app;
    // The full registry (incl. witness specs) for tooling — tools/witness.mjs reads it
    // through the page so node never needs to load TS.
    (window as any).sceneSuite = sceneSuite;
    console.log('Ready!');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main();
}
