/**
 * RenderControlsExtension
 *
 * Provides UI controls for triggering production renders.
 *
 * Phase 1: Simple toolbar with render button and sample count input.
 * Future: Could open a modal for full render settings (resolution, tiles, etc.)
 *
 * Mounts to region-toolbar if layout available, otherwise fixed to top.
 * Styles are defined in ui/styles/extensions.css
 */
import type { App } from '../App.js';
import type { EventBus } from '../EventBus.js';
import type { Extension } from '../types.js';

// Ensure UI styles (including extensions.css) are loaded
import '../ui/index.js';

export class RenderControlsExtension implements Extension {
    name = 'render-controls';
    version = '1.0.0';
    description = 'Production render controls toolbar';

    private app!: App;
    private toolbar: HTMLDivElement | null = null;
    private renderButton: HTMLButtonElement | null = null;
    private samplesInput: HTMLInputElement | null = null;
    private useLayout = false;

    // Default render settings
    private defaultSamples = 1024;

    install(app: App, _bus: EventBus): void {
        this.app = app;
        this.useLayout = app.hasLayout();

        this.createToolbar();

        const modeStr = this.useLayout ? 'layout-integrated' : 'standalone';
        console.log(`RenderControls installed [${modeStr}]`);
    }

    uninstall(): void {
        this.toolbar?.remove();
        this.toolbar = null;
        this.renderButton = null;
        this.samplesInput = null;
    }

    // ============================================================================
    // Private: Setup
    // ============================================================================

    private createToolbar(): void {
        this.toolbar = document.createElement('div');
        this.toolbar.className = 'render-controls-toolbar';

        // App title/logo area (left)
        const titleArea = document.createElement('div');
        titleArea.className = 'render-controls-title';
        titleArea.textContent = 'Path Tracer';

        // Render controls (right)
        const controlsArea = document.createElement('div');
        controlsArea.className = 'render-controls-actions';

        // Samples input
        const samplesLabel = document.createElement('label');
        samplesLabel.className = 'render-controls-label';
        samplesLabel.textContent = 'Samples:';

        this.samplesInput = document.createElement('input');
        this.samplesInput.type = 'number';
        this.samplesInput.className = 'render-controls-input';
        this.samplesInput.value = String(this.defaultSamples);
        this.samplesInput.min = '1';
        this.samplesInput.max = '100000';
        this.samplesInput.step = '256';

        // Render button
        this.renderButton = document.createElement('button');
        this.renderButton.className = 'render-controls-btn primary';
        this.renderButton.textContent = 'Render';
        this.renderButton.onclick = () => this.startRender();

        // Assemble
        samplesLabel.appendChild(this.samplesInput);
        controlsArea.appendChild(samplesLabel);
        controlsArea.appendChild(this.renderButton);

        this.toolbar.appendChild(titleArea);
        this.toolbar.appendChild(controlsArea);

        // Mount
        if (this.useLayout) {
            const toolbarRegion = this.app.getRegion('region-toolbar');
            toolbarRegion.appendChild(this.toolbar);
        } else {
            this.toolbar.classList.add('standalone');
            document.body.appendChild(this.toolbar);
        }
    }

    // ============================================================================
    // Actions
    // ============================================================================

    private async startRender(): Promise<void> {
        if (!this.samplesInput || !this.renderButton) return;

        const targetSamples = parseInt(this.samplesInput.value, 10) || this.defaultSamples;

        // Disable button during render
        this.renderButton.disabled = true;
        this.renderButton.textContent = 'Rendering...';

        try {
            console.log(`Starting production render: ${targetSamples} samples`);
            await this.app.renderProduction(targetSamples);
            console.log('Production render complete');
        } catch (error) {
            console.error('Render failed:', error);
        } finally {
            // Re-enable button
            if (this.renderButton) {
                this.renderButton.disabled = false;
                this.renderButton.textContent = 'Render';
            }
        }
    }

    // ============================================================================
    // Public API
    // ============================================================================

    /**
     * Get current sample count setting
     */
    getSampleCount(): number {
        return parseInt(this.samplesInput?.value || String(this.defaultSamples), 10);
    }

    /**
     * Set sample count
     */
    setSampleCount(samples: number): void {
        if (this.samplesInput) {
            this.samplesInput.value = String(samples);
        }
    }

    /**
     * Programmatically trigger a render
     */
    async triggerRender(samples?: number): Promise<void> {
        if (samples !== undefined) {
            this.setSampleCount(samples);
        }
        await this.startRender();
    }
}
