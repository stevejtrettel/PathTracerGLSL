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
 */
import type { App } from '../App.js';
import type { EventBus } from '../EventBus.js';
import type { Extension } from '../types.js';
import type { ProgressInfo } from '../RenderCoordinator.js';

const PANEL_STYLES = `
.production-panel {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    background: rgba(30, 30, 30, 0.95);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.9);
    transition: transform 0.3s ease, opacity 0.3s ease;
}

.production-panel.hidden {
    transform: translateY(100%);
    opacity: 0;
    pointer-events: none;
}

.production-panel.standalone {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 1001;
}

.production-panel-progress {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 200px;
}

.production-panel-bar {
    flex: 1;
    height: 6px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    overflow: hidden;
    min-width: 100px;
}

.production-panel-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #4a9eff, #6bb3ff);
    border-radius: 3px;
    transition: width 0.2s ease;
}

.production-panel-bar-fill.complete {
    background: linear-gradient(90deg, #4caf50, #66bb6a);
}

.production-panel-stats {
    display: flex;
    gap: 16px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.7);
    white-space: nowrap;
}

.production-panel-stat {
    display: flex;
    align-items: center;
    gap: 4px;
}

.production-panel-stat-value {
    color: rgba(255, 255, 255, 0.95);
    font-weight: 500;
}

.production-panel-controls {
    display: flex;
    gap: 8px;
}

.production-panel-btn {
    padding: 6px 12px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.9);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
}

.production-panel-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.3);
}

.production-panel-btn:active {
    background: rgba(255, 255, 255, 0.15);
}

.production-panel-btn.primary {
    background: rgba(74, 158, 255, 0.2);
    border-color: rgba(74, 158, 255, 0.4);
}

.production-panel-btn.primary:hover {
    background: rgba(74, 158, 255, 0.3);
    border-color: rgba(74, 158, 255, 0.5);
}

.production-panel-btn.danger {
    background: rgba(244, 67, 54, 0.15);
    border-color: rgba(244, 67, 54, 0.3);
}

.production-panel-btn.danger:hover {
    background: rgba(244, 67, 54, 0.25);
    border-color: rgba(244, 67, 54, 0.4);
}

.production-panel-btn.success {
    background: rgba(76, 175, 80, 0.2);
    border-color: rgba(76, 175, 80, 0.4);
}

.production-panel-btn.success:hover {
    background: rgba(76, 175, 80, 0.3);
    border-color: rgba(76, 175, 80, 0.5);
}
`;

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

        this.injectStyles();
        this.createPanel();
        this.attachEventListeners();

        console.log('ProductionPanel installed');
    }

    uninstall(): void {
        this.detachEventListeners();
        this.panel?.remove();
        document.getElementById('production-panel-styles')?.remove();
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

    private injectStyles(): void {
        if (document.getElementById('production-panel-styles')) return;

        const style = document.createElement('style');
        style.id = 'production-panel-styles';
        style.textContent = PANEL_STYLES;
        document.head.appendChild(style);
    }

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
