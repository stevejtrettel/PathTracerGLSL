/**
 * RenderControlsExtension
 *
 * Provides UI controls for triggering production renders.
 *
 * Features:
 * - Toolbar with app title and render button
 * - Sample count input
 * - Button state changes during production (disabled + "Rendering...")
 *
 * Mounts to region-toolbar if layout available, otherwise fixed to top.
 * Styles are defined in ui/styles/extensions.css
 */

import { UIExtension } from './UIExtension.js';
import type { RegionName } from '../layout/index.js';
import { Modal, NumberInput, Button, Dropdown, Checkbox } from '../ui/index.js';
import { AppEvents } from '../events.js';
import { RenderStoppedError } from '../../errors/RenderErrors.js';
import { DEFAULT_TILE_SIZE } from '../TiledRenderer.js';

/** Production sizes offered in the dialog. */
const RESOLUTIONS: Record<string, [number, number] | null> = {
    screen: null,
    '1080p': [1920, 1080],
    '4k': [3840, 2160],
    '8k': [7680, 4320],
};

export class RenderControlsExtension extends UIExtension {
    name = 'render-controls';
    version = '3.1.0';
    description = 'Production render setup manager';

    // We don't need a visible region anymore, but UIExtension requires one.
    // We'll use overlay but not render anything by default.
    protected readonly region: RegionName = 'region-overlay';

    protected createRoot(): HTMLElement {
        // No persistent UI, just a placeholder
        const root = document.createElement('div');
        root.style.display = 'none';
        return root;
    }

    protected setup(): void {
        console.log('RenderControls (Production Setup) installed');
        this.on(AppEvents.RENDER_COMPLETE, this.onRenderComplete);
        this.on(AppEvents.PRODUCTION_DIALOG_REQUESTED, () => this.showProductionDialog());
    }

    private onRenderComplete = (): void => {
        if (this.app.isTiledRenderActive()) return;   // a tile finished; the job saves its own files
        console.log('RenderControlsExtension: render.complete event received');
        // Small delay to ensure exports finish
        setTimeout(() => {
            console.log('RenderControlsExtension: showing completion dialog');
            this.showCompletionDialog();
        }, 100);
    };

    private showCompletionDialog(): void {
        console.log('RenderControlsExtension: creating completion dialog');
        const modal = new Modal('Render Complete', { width: 400 });

        // Extend options
        let extendSamples = 500;
        modal.add(new NumberInput(extendSamples, {
            label: 'Additional Samples',
            min: 100,
            max: 10000,
            step: 100,
            integer: true,
            onChange: (v) => { extendSamples = v; }
        }));

        const footer = modal.addFooter();

        // Return to Interactive (Primary action now that render is done)
        new Button('Return to Interactive', () => {
            console.log('Return to Interactive clicked');
            modal.close();
            this.app.stop(); // Triggers layout/resolution restore and unlock
            // Restart interactive rendering
            setTimeout(() => {
                // Ensure we're not paused before starting
                this.app.resume();
                this.app.start();
                console.log('Restarted interactive rendering');
            }, 50);
        }, { variant: 'primary' }).mount(footer);

        // Extend Render
        new Button('Extend Render', () => {
            console.log('Extend Render clicked');
            modal.close();
            if (extendSamples > 0) {
                // No .then here: the extension's own RENDER_COMPLETE reopens this dialog
                // (onRenderComplete). Opening it here too stacked two dialogs, and extending
                // from the second one while the first extension ran cancelled it.
                this.app.extendProduction(extendSamples)
                    .catch(err => {
                        if (!(err instanceof RenderStoppedError)) console.error('Extended render failed:', err);
                        // Return to interactive
                        this.app.stop();
                        setTimeout(() => this.app.start(), 50);
                    });
            }
        }).mount(footer);

        console.log('RenderControlsExtension: showing modal');
        modal.show();
    }

    /**
     * Show the production render setup dialog
     */
    showProductionDialog(): void {
        // Pause rendering and block canvas interaction
        this.app.pause();
        const canvas = this.app.getCanvas();
        if (canvas) canvas.style.pointerEvents = 'none';

        let cleanedUp = false;
        const cleanup = () => {
            if (cleanedUp) return;
            cleanedUp = true;
            if (canvas) canvas.style.pointerEvents = '';
            this.app.resume();
        };
        // onClose runs for EVERY close — Cancel, Start, the × button and a backdrop click —
        // so the canvas never stays paused and unclickable after the dialog goes away.
        const modal = new Modal('Start Production Render', { width: 400, onClose: cleanup });

        let samples = 1000;
        let resolution = 'screen';
        let [customWidth, customHeight] = this.app.getCanvasSize();
        let tiled = false;
        let tileSize = DEFAULT_TILE_SIZE;

        modal.add(new NumberInput(samples, {
            label: 'Target Samples',
            min: 1,
            max: 100000,
            step: 100,
            integer: true,
            onChange: (v) => { samples = v; }
        }));

        const widthInput = new NumberInput(customWidth, {
            label: 'Width', min: 1, max: 32768, step: 1, integer: true,
            onChange: (v) => { customWidth = v; },
        });
        const heightInput = new NumberInput(customHeight, {
            label: 'Height', min: 1, max: 32768, step: 1, integer: true,
            onChange: (v) => { customHeight = v; },
        });
        const tiledInput = new Checkbox(tiled, {
            label: 'Render in tiles (saves one HDR + PNG)',
            onChange: (v) => { tiled = v; tileSizeInput[v ? 'show' : 'hide'](); },
        });
        const tileSizeInput = new NumberInput(tileSize, {
            label: 'Tile size (px, multiple of 64)', min: 64, max: 4096, step: 64, integer: true,
            onChange: (v) => { tileSize = v; },
        });

        modal.add(new Dropdown(resolution, {
            label: 'Resolution',
            options: [
                { label: 'Screen Size', value: 'screen' },
                { label: '2K (1920x1080)', value: '1080p' },
                { label: '4K (3840x2160)', value: '4k' },
                { label: '8K (7680x4320)', value: '8k' },
                { label: 'Custom', value: 'custom' },
            ],
            onChange: (v) => {
                resolution = v;
                widthInput[v === 'custom' ? 'show' : 'hide']();
                heightInput[v === 'custom' ? 'show' : 'hide']();
                // Beyond 4K a whole frame per draw risks the GPU watchdog; tiles are the default.
                if (v === '8k') { tiled = true; tiledInput.setValue(true); tileSizeInput.show(); }
            }
        }));
        modal.add(widthInput.hide());
        modal.add(heightInput.hide());
        modal.add(tiledInput);
        modal.add(tileSizeInput.hide());

        const footer = modal.addFooter();

        new Button('Cancel', () => modal.close()).mount(footer);

        new Button('Start Render', () => {
            modal.close();
            if (samples <= 0) return;

            const size = resolution === 'custom' ? [customWidth, customHeight] as [number, number] : RESOLUTIONS[resolution];
            const reportFailure = (err: unknown) => {
                if (err instanceof RenderStoppedError) console.log('Production render stopped');
                else console.error('Production render failed:', err);
            };

            if (tiled) {
                const [width, height] = size ?? this.app.getCanvasSize();
                this.app.renderTiled({ width, height, spp: samples, format: 'both', tileSize }).catch(reportFailure);
                return;
            }
            this.app.renderProduction(samples, {
                width: size?.[0],
                height: size?.[1],
                autoExportPNG: true,
                autoExportAllAOVs: true,
                autoSave: true
            }).then(() => {
                // Completion dialog will be triggered by render.complete event
            }).catch(reportFailure);
        }, { variant: 'primary' }).mount(footer);

        modal.show();
    }
}
