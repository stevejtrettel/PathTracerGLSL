/**
 * Scene Lab
 *
 * A single dev entry that views any scene from the suite (src/compiler/scenes/index.ts).
 * Pick one with the URL: /lab.html?scene=furnace  (default: two-light).
 * Strategies bind to keys 1-9; `r` resets accumulation. The documented cornell dev entry
 * (index.html → examples/cornell-box.ts) is left untouched.
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
    // Both entries load this file. Root (index.html) defaults to cornell — the documented
    // default dev experience; lab.html defaults to the suite (two-light). `?scene=<id>`
    // overrides on EITHER path, so the URL param always works no matter where you are.
    const onLab = window.location.pathname.includes('lab.html');
    const fallback = onLab ? DEFAULT_SCENE : 'cornell';
    const requested = new URLSearchParams(window.location.search).get('scene') ?? fallback;
    const id = requested in sceneSuite ? requested : fallback;
    const entry = sceneSuite[id];

    console.log(`=== Scene Lab: ${id} ===`);
    console.log(`Exercises: ${entry.exercises}`);
    console.log(`Available scenes: ${Object.keys(sceneSuite).join(', ')} (switch with ?scene=<id>)`);

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
    console.log('Ready!');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main();
}
