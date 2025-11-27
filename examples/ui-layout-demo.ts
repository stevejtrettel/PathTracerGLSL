/**
 * UI & Layout Example
 *
 * Demonstrates the new UI infrastructure:
 * - AppLayout with different layout modes
 * - UI components (Panel, Folder, Slider, etc.)
 * - WidgetFactory for creating controls from metadata
 * - Independent of App - can be used standalone
 *
 * Layout modes (press L to cycle):
 * - fullscreen: Canvas fills viewport, panels overlay
 * - centered: Canvas centered with side panels
 * - split: Canvas + large side panel
 *
 * This example shows how to use these systems both with
 * the App class and independently.
 */

import { App, STRATEGY_PRESETS } from '../src/app/index.js';
import {
    OrbitControls,
    StatsPanel,
    AppShortcutsExtension
} from '../src/app/extensions/index.js';

// Import UI components directly
import {
    Panel,
    Folder,
    Slider,
    Checkbox,
    ColorPicker,
    Button,
    Dropdown,
    Window
} from '../src/app/ui/index.js';

// Import Layout system
import { AppLayout, type LayoutMode } from '../src/app/layout/index.js';

// ============================================================================
// Demo: Standalone UI (no App dependency)
// ============================================================================

function createStandaloneDemo(container: HTMLElement): Panel {
    const panel = new Panel({ title: 'Standalone UI Demo' });
    panel.setSubtitle('These components work without App');

    // Basic controls folder
    const basicFolder = new Folder('Basic Controls');

    basicFolder.add(new Slider(0.5, {
        label: 'Slider',
        min: 0,
        max: 1,
        step: 0.01,
        onChange: (v) => console.log('Slider:', v)
    }));

    basicFolder.add(new Checkbox(true, {
        label: 'Checkbox',
        onChange: (v) => console.log('Checkbox:', v)
    }));

    basicFolder.add(new ColorPicker([1, 0.5, 0], {
        label: 'Color',
        onChange: (v) => console.log('Color:', v)
    }));

    basicFolder.add(new Dropdown<string>('option1', {
        label: 'Dropdown',
        options: [
            { label: 'Option 1', value: 'option1' },
            { label: 'Option 2', value: 'option2' },
            { label: 'Option 3', value: 'option3' }
        ],
        onChange: (v) => console.log('Dropdown:', v)
    }));

    panel.add(basicFolder);

    // Actions folder
    const actionsFolder = new Folder('Actions');

    actionsFolder.add(new Button('Open Window', () => {
        const win = new Window('Floating Window', {
            width: 300,
            height: 200,
            x: 100,
            y: 100
        });
        win.add(new Slider(50, {
            label: 'Window Slider',
            min: 0,
            max: 100
        }));
        win.add(new Button('Close', () => win.close()));
        win.show();
    }));

    actionsFolder.add(new Button('Log Message', () => {
        console.log('Button clicked!');
    }, { variant: 'primary' }));

    panel.add(actionsFolder);

    panel.mount(container);
    return panel;
}

// ============================================================================
// Demo: Layout Modes
// ============================================================================

function setupLayoutSwitching(layout: AppLayout, onLayoutChange?: () => void): void {
    const modes: LayoutMode[] = ['fullscreen', 'centered', 'split'];
    let currentIndex = 0;

    // Press 'L' to cycle layouts
    window.addEventListener('keydown', (e) => {
        if (e.key === 'l' || e.key === 'L') {
            currentIndex = (currentIndex + 1) % modes.length;
            const newMode = modes[currentIndex];
            layout.setMode(newMode);
            console.log(`Layout: ${newMode}`);

            // Trigger resize after layout change (after CSS reflows)
            if (onLayoutChange) {
                requestAnimationFrame(() => {
                    onLayoutChange();
                });
            }
        }
    });

    console.log('Press L to cycle layout modes');
}

// ============================================================================
// Main
// ============================================================================

async function main() {
    console.log('=== UI & Layout Example ===');

    // Create layout first (manages page regions)
    const layout = new AppLayout(document.body, {
        mode: 'fullscreen',
        variables: {
            '--layout-canvas-width': '1024px',
            '--layout-sidebar-width': '340px'
        }
    });

    // Create canvas in the canvas container region
    const canvas = document.createElement('canvas');
    layout.getCanvasContainer().appendChild(canvas);

    // Create standalone UI demo in right panel
    const standalonePanel = createStandaloneDemo(layout.getRegion('region-right'));

    // Create app with the canvas
    const app = new App(canvas);

    // Initialize with a simple scene
    await app.initialize({
        scene: { id: 'cornell-box', name: 'Cornell Box' },
        strategies: [
            STRATEGY_PRESETS['pathtracer-full'].strategy,
            STRATEGY_PRESETS['debug-aovs'].strategy
        ]
    });

    console.log('Renderers:', app.getAvailableRendererIds());

    // Install minimal extensions (not ParameterPanelExtension - we have our own UI)
    app.use(new OrbitControls());
    app.use(new StatsPanel());
    app.use(new AppShortcutsExtension());

    // Enable profiling
    app.enableProfiling();

    // Handle resize
    const handleResize = () => {
        const { width, height } = layout.getCanvasSize();
        if (width > 0 && height > 0) {
            app.resize(width, height);
        }
    };

    // Setup layout switching (with resize callback)
    setupLayoutSwitching(layout, handleResize);

    window.addEventListener('resize', handleResize);
    // Initial resize
    setTimeout(handleResize, 100);

    // Start rendering
    app.start();

    // Expose for debugging
    (window as any).app = app;
    (window as any).layout = layout;
    (window as any).standalonePanel = standalonePanel;

    console.log('');
    console.log('Keyboard shortcuts:');
    console.log('  L: Cycle layout modes (fullscreen → centered → split)');
    console.log('  1/2: Switch renderers');
    console.log('  i: Toggle stats');
    console.log('  Space: Pause/resume');
    console.log('');
    console.log('The right panel shows standalone UI components.');
    console.log('Try different layouts to see how they arrange the canvas and panels.');
}

// Run on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main();
}
