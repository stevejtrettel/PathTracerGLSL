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
import { Modal, NumberInput, Button, Dropdown } from '../ui/index.js';

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
    }

    /**
     * Show the production render setup dialog
     */
    showProductionDialog(): void {
        // Pause rendering and block canvas interaction
        this.app.pause();
        const canvas = this.app.getCanvas();
        if (canvas) canvas.style.pointerEvents = 'none';

        const modal = new Modal('Start Production Render', { width: 400 });

        let samples = 1000;
        let resolution = 'screen'; // screen, 1080p, 4k

        modal.add(new NumberInput(samples, {
            label: 'Target Samples',
            min: 1,
            max: 100000,
            step: 100,
            integer: true,
            onChange: (v) => { samples = v; }
        }));

        modal.add(new Dropdown(resolution, {
            label: 'Resolution',
            options: [
                { label: 'Screen Size', value: 'screen' },
                { label: '2K (1920x1080)', value: '1080p' },
                { label: '4K (3840x2160)', value: '4k' }
            ],
            onChange: (v) => { resolution = v; }
        }));

        const footer = modal.addFooter();

        const cleanup = () => {
            if (canvas) canvas.style.pointerEvents = '';
            this.app.resume();
        };

        new Button('Cancel', () => {
            modal.close();
            cleanup();
        }).mount(footer);

        new Button('Start Render', () => {
            modal.close();
            cleanup();

            if (samples > 0) {
                // Determine resolution
                let width: number | undefined;
                let height: number | undefined;

                if (resolution === '1080p') {
                    width = 1920;
                    height = 1080;
                } else if (resolution === '4k') {
                    width = 3840;
                    height = 2160;
                }

                this.app.renderProduction(samples, {
                    width,
                    height,
                    autoExportPNG: true, // Fix: Ensure PNG is saved
                    autoExportAllAOVs: true,
                    autoSave: true
                }).then(() => {
                    console.log('Production render complete!');
                }).catch(err => {
                    if (err.name === 'RenderStopped') {
                        console.log('Production render stopped');
                    } else {
                        console.error('Production render failed:', err);
                    }
                });
            }
        }, { variant: 'primary' }).mount(footer);

        modal.show();
    }
}
