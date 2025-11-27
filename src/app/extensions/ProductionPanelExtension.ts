/**
 * ProductionPanelExtension
 *
 * Shows production render progress and controls.
 *
 * Features:
 * - Progress bar with sample count and percentage
 * - ETA calculation
 * - Pause/Resume, Cancel buttons
 * - Export PNG/HDR buttons on completion
 * - Auto-shows during production renders, auto-hides when done
 *
 * Mounts to region-statusbar if layout available, otherwise fixed to bottom.
 * Styles are defined in ui/styles/extensions.css
 */
import type { App } from '../App.js';
import type { EventBus } from '../EventBus.js';
import type { Extension } from '../types.js';
import type { ProgressInfo } from '../RenderCoordinator.js';

// Ensure UI styles (including extensions.css) are loaded
import '../ui/index.js';

export class ProductionPanelExtension implements Extension {
    name = 'production-panel';
    version = '1.0.0';
    description = 'Production render progress and controls';

    private app!: App;
    private bus!: EventBus;
    private panel: HTMLDivElement | null = null;
    private barFill: HTMLDivElement | null = null;
    private statsContainer: HTMLDivElement | null = null;
    private controlsContainer: HTMLDivElement | null = null;

    private isVisible = false;
    private isComplete = false;
    private startTime = 0;

    // Event handler references for cleanup
    private progressHandler: ((info: ProgressInfo) => void) | null = null;

    install(app: App, bus: EventBus): void {
        this.app = app;
        this.bus = bus;

        this.createPanel();
        this.attachEventListeners();

        console.log('ProductionPanel installed');
    }

    uninstall(): void {
        this.detachEventListeners();
        this.panel?.remove();
    }

    // ============================================================================
    // Public API
    // ============================================================================

    show(): void {
        if (this.panel && !this.isVisible) {
            this.panel.classList.remove('hidden');
            this.isVisible = true;
        }
    }

    hide(): void {
        if (this.panel && this.isVisible) {
            this.panel.classList.add('hidden');
            this.isVisible = false;
        }
    }

    // ============================================================================
    // Private: Setup
    // ============================================================================

    private createPanel(): void {
        this.panel = document.createElement('div');
        this.panel.className = 'production-panel hidden';

        // Progress section
        const progress = document.createElement('div');
        progress.className = 'production-panel-progress';

        const bar = document.createElement('div');
        bar.className = 'production-panel-bar';
        this.barFill = document.createElement('div');
        this.barFill.className = 'production-panel-bar-fill';
        this.barFill.style.width = '0%';
        bar.appendChild(this.barFill);

        this.statsContainer = document.createElement('div');
        this.statsContainer.className = 'production-panel-stats';

        progress.appendChild(bar);
        progress.appendChild(this.statsContainer);

        // Controls section
        this.controlsContainer = document.createElement('div');
        this.controlsContainer.className = 'production-panel-controls';

        this.panel.appendChild(progress);
        this.panel.appendChild(this.controlsContainer);

        // Mount to layout region or body
        if (this.app.hasLayout()) {
            const statusbar = this.app.getRegion('region-statusbar');
            statusbar.appendChild(this.panel);
        } else {
            this.panel.classList.add('standalone');
            document.body.appendChild(this.panel);
        }
    }

    private attachEventListeners(): void {
        this.progressHandler = (info: ProgressInfo) => this.onProgress(info);
        this.bus.on('render.progress', this.progressHandler);
    }

    private detachEventListeners(): void {
        if (this.progressHandler) {
            this.bus.off('render.progress', this.progressHandler);
        }
    }

    // ============================================================================
    // Private: Progress Handling
    // ============================================================================

    private onProgress(info: ProgressInfo): void {
        // Only show during production mode
        if (info.mode !== 'production') {
            if (this.isVisible) {
                this.hide();
                this.isComplete = false;
            }
            return;
        }

        // Show panel if not visible
        if (!this.isVisible) {
            this.show();
            this.startTime = Date.now() - info.elapsedTime;
            this.isComplete = false;
        }

        // Update progress bar
        const percent = info.percentComplete ?? 0;
        if (this.barFill) {
            this.barFill.style.width = `${percent}%`;
            if (info.state === 'complete') {
                this.barFill.classList.add('complete');
            } else {
                this.barFill.classList.remove('complete');
            }
        }

        // Update stats
        this.updateStats(info);

        // Update controls
        this.updateControls(info);

        // Track completion
        if (info.state === 'complete' && !this.isComplete) {
            this.isComplete = true;
        }
    }

    private updateStats(info: ProgressInfo): void {
        if (!this.statsContainer) return;

        const stats: string[] = [];

        // Samples
        const samplesStr = info.targetSamples
            ? `${info.samples.toLocaleString()} / ${info.targetSamples.toLocaleString()}`
            : info.samples.toLocaleString();
        stats.push(this.createStat('Samples', samplesStr));

        // Percentage
        if (info.percentComplete !== undefined) {
            stats.push(this.createStat('Progress', `${info.percentComplete.toFixed(1)}%`));
        }

        // ETA (only if not complete and we have target)
        if (info.state !== 'complete' && info.targetSamples && info.samples > 0) {
            const eta = this.calculateETA(info);
            if (eta) {
                stats.push(this.createStat('ETA', eta));
            }
        }

        // Elapsed time
        stats.push(this.createStat('Elapsed', this.formatTime(info.elapsedTime)));

        // State indicator
        if (info.state === 'paused') {
            stats.push('<span style="color: #ffa500; font-weight: 500;">PAUSED</span>');
        } else if (info.state === 'complete') {
            stats.push('<span style="color: #4caf50; font-weight: 500;">COMPLETE</span>');
        }

        this.statsContainer.innerHTML = stats.join('');
    }

    private createStat(label: string, value: string): string {
        return `<span class="production-panel-stat">
            ${label}: <span class="production-panel-stat-value">${value}</span>
        </span>`;
    }

    private updateControls(info: ProgressInfo): void {
        if (!this.controlsContainer) return;

        const buttons: string[] = [];

        if (info.state === 'complete') {
            // Export buttons
            buttons.push(this.createButton('Export PNG', 'exportPNG', 'success'));
            buttons.push(this.createButton('Export HDR', 'exportHDR', 'success'));
            buttons.push(this.createButton('Close', 'close', ''));
        } else if (info.state === 'paused') {
            // Resume/Cancel
            buttons.push(this.createButton('Resume', 'resume', 'primary'));
            buttons.push(this.createButton('Cancel', 'cancel', 'danger'));
        } else {
            // Pause/Cancel
            buttons.push(this.createButton('Pause', 'pause', ''));
            buttons.push(this.createButton('Cancel', 'cancel', 'danger'));
        }

        this.controlsContainer.innerHTML = buttons.join('');

        // Attach click handlers
        this.controlsContainer.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => this.onButtonClick(btn.dataset.action!));
        });
    }

    private createButton(label: string, action: string, style: string): string {
        const className = style ? `production-panel-btn ${style}` : 'production-panel-btn';
        return `<button class="${className}" data-action="${action}">${label}</button>`;
    }

    private onButtonClick(action: string): void {
        switch (action) {
            case 'pause':
                this.app.pause();
                break;
            case 'resume':
                this.app.resume();
                break;
            case 'cancel':
                this.app.stop();
                this.hide();
                break;
            case 'exportPNG':
                this.app.exportPNG();
                break;
            case 'exportHDR':
                this.app.exportHDR();
                break;
            case 'close':
                this.hide();
                break;
        }
    }

    // ============================================================================
    // Private: Utilities
    // ============================================================================

    private calculateETA(info: ProgressInfo): string | null {
        if (!info.targetSamples || info.samples === 0) return null;

        const elapsed = info.elapsedTime;
        const samplesPerMs = info.samples / elapsed;
        const remainingSamples = info.targetSamples - info.samples;
        const remainingMs = remainingSamples / samplesPerMs;

        if (!isFinite(remainingMs) || remainingMs < 0) return null;

        return this.formatTime(remainingMs);
    }

    private formatTime(ms: number): string {
        const seconds = Math.floor(ms / 1000);

        if (seconds < 60) {
            return `${seconds}s`;
        } else if (seconds < 3600) {
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            return `${mins}m ${secs}s`;
        } else {
            const hours = Math.floor(seconds / 3600);
            const mins = Math.floor((seconds % 3600) / 60);
            return `${hours}h ${mins}m`;
        }
    }
}
