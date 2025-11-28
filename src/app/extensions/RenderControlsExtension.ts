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

export class RenderControlsExtension extends UIExtension {
    name = 'render-controls';
    version = '2.0.0';
    description = 'Production render controls toolbar';

    protected readonly region: RegionName = 'region-toolbar';

    private renderButton: HTMLButtonElement | null = null;
    private samplesInput: HTMLInputElement | null = null;

    private defaultSamples = 1024;
    private isRendering = false;

    // ============================================================================
    // UIExtension Implementation
    // ============================================================================

    protected createRoot(): HTMLElement {
        const toolbar = document.createElement('div');
        toolbar.className = 'render-controls-toolbar';

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

        toolbar.appendChild(titleArea);
        toolbar.appendChild(controlsArea);

        return toolbar;
    }

    protected setup(): void {
        // Listen to mode changes
        this.on('render.started', this.onRenderStarted);
        this.on('render.complete', this.onRenderEnded);
        this.on('render.stopped', this.onRenderEnded);

        console.log(`RenderControls installed [${this.useLayout ? 'layout' : 'standalone'}]`);
    }

    // ============================================================================
    // Event Handlers
    // ============================================================================

    private onRenderStarted = (data: { mode: string }): void => {
        if (data.mode === 'production') {
            this.setRenderingState(true);
        }
    };

    private onRenderEnded = (): void => {
        this.setRenderingState(false);
    };

    private setRenderingState(rendering: boolean): void {
        this.isRendering = rendering;

        if (this.renderButton) {
            this.renderButton.disabled = rendering;
            this.renderButton.textContent = rendering ? 'Rendering...' : 'Render';
        }

        if (this.samplesInput) {
            this.samplesInput.disabled = rendering;
        }
    }

    // ============================================================================
    // Actions
    // ============================================================================

    private async startRender(): Promise<void> {
        if (!this.samplesInput || !this.renderButton || this.isRendering) return;

        const targetSamples = parseInt(this.samplesInput.value, 10) || this.defaultSamples;

        try {
            console.log(`Starting production render: ${targetSamples} samples`);
            await this.app.renderProduction(targetSamples);
            console.log('Production render complete');
        } catch (error) {
            console.error('Render failed:', error);
        }
    }

    // ============================================================================
    // Public API
    // ============================================================================

    /** Get current sample count setting */
    getSampleCount(): number {
        return parseInt(this.samplesInput?.value || String(this.defaultSamples), 10);
    }

    /** Set sample count */
    setSampleCount(samples: number): void {
        if (this.samplesInput) {
            this.samplesInput.value = String(samples);
        }
    }

    /** Programmatically trigger a render */
    async triggerRender(samples?: number): Promise<void> {
        if (samples !== undefined) {
            this.setSampleCount(samples);
        }
        await this.startRender();
    }
}
