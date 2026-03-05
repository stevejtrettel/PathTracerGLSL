/**
 * ProductionPanelExtension
 *
 * Shows production render progress and controls.
 *
 * Features:
 * - Progress bar with sample count and percentage
 * - ETA calculation
 * - Tile grid visualization for tiled renders
 * - Pause/Resume, Cancel buttons
 * - Export PNG/HDR buttons on completion
 * - Auto-shows during production renders, auto-hides when returning to interactive
 *
 * Mounts to region-statusbar if layout available, otherwise fixed to bottom.
 * Styles are defined in ui/styles/extensions.css
 */
import { UIExtension } from './UIExtension.js';
import type { RegionName } from '../layout/index.js';
import type { ProgressInfo } from '../RenderCoordinator.js';
import type { TiledJobProgressInfo } from '../TiledRenderer.js';
import { formatTime } from '../utils/format.js';
import { AppEvents } from '../events.js';

export class ProductionPanelExtension extends UIExtension {
    name = 'production-panel';
    version = '2.1.0';
    description = 'Production render progress and controls';

    protected readonly region: RegionName = 'region-statusbar';

    private barFill: HTMLDivElement | null = null;
    private statsContainer: HTMLDivElement | null = null;
    private controlsContainer: HTMLDivElement | null = null;
    private tileGridContainer: HTMLDivElement | null = null;

    // Track tiled job state
    private tiledJob: TiledJobProgressInfo | null = null;
    // Track render state so controls only rebuild on state transitions
    private lastControlsState: string | null = null;

    constructor() {
        super({ startHidden: true });
    }

    // ============================================================================
    // UIExtension Implementation
    // ============================================================================

    protected createRoot(): HTMLElement {
        const panel = document.createElement('div');
        panel.className = 'production-panel';

        // Tile grid section (only shown for tiled renders)
        this.tileGridContainer = document.createElement('div');
        this.tileGridContainer.className = 'production-panel-tiles hidden';
        panel.appendChild(this.tileGridContainer);

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

        panel.appendChild(progress);
        panel.appendChild(this.controlsContainer);

        return panel;
    }

    protected setup(): void {
        // Mode transitions
        this.on(AppEvents.RENDER_STARTED, this.onRenderStarted);
        this.on(AppEvents.RENDER_COMPLETE, this.onRenderComplete);
        this.on(AppEvents.RENDER_STOPPED, this.onRenderStopped);

        // Progress updates (only during production)
        this.on(AppEvents.RENDER_PROGRESS, this.onProgress);

        // Tiled job events
        this.on(AppEvents.TILED_JOB_PROGRESS, this.onTiledJobProgress);
        this.on(AppEvents.TILED_JOB_COMPLETE, this.onTiledJobComplete);

        console.log(`ProductionPanel installed [${this.useLayout ? 'layout' : 'standalone'}]`);
    }

    // ============================================================================
    // Event Handlers
    // ============================================================================

    private onRenderStarted = (data: { mode: string; targetSamples?: number }): void => {
        if (data.mode === 'production') {
            this.resetProgress();
            this.show();
        }
    };

    private onRenderComplete = (): void => {
        // Keep visible to show completion state and export buttons
        // Will be hidden when user clicks "Close" or starts new render
        if (this.barFill) {
            this.barFill.classList.add('complete');
        }
    };

    private onRenderStopped = (): void => {
        // Hide when render is cancelled/stopped
        this.hide();
        this.resetProgress();
    };

    private onProgress = (info: ProgressInfo): void => {
        // Only update during production mode
        if (info.mode !== 'production') return;

        // Skip progress bar updates during tiled job (we use tile progress instead)
        if (!this.tiledJob) {
            this.updateProgressBar(info);
        }
        this.updateStats(info);

        // Only rebuild controls when render state changes (not every progress tick)
        if (info.state !== this.lastControlsState) {
            this.lastControlsState = info.state;
            this.updateControls(info);
        }
    };

    private onTiledJobProgress = (info: TiledJobProgressInfo): void => {
        this.tiledJob = info;

        // Show panel if not already visible
        if (!this.isVisible) {
            this.show();
        }

        // Update tile grid
        this.updateTileGrid(info);

        // Update progress bar based on tile progress
        if (this.barFill) {
            const percent = (info.completedTiles / info.totalTiles) * 100;
            this.barFill.style.width = `${percent}%`;
        }
    };

    private onTiledJobComplete = (): void => {
        if (this.barFill) {
            this.barFill.classList.add('complete');
        }
    };

    // ============================================================================
    // UI Updates
    // ============================================================================

    private resetProgress(): void {
        if (this.barFill) {
            this.barFill.style.width = '0%';
            this.barFill.classList.remove('complete');
        }
        if (this.statsContainer) {
            this.statsContainer.innerHTML = '';
        }
        if (this.controlsContainer) {
            this.controlsContainer.innerHTML = '';
        }
        if (this.tileGridContainer) {
            this.tileGridContainer.innerHTML = '';
            this.tileGridContainer.classList.add('hidden');
        }
        this.tiledJob = null;
        this.lastControlsState = null;
    }

    private updateProgressBar(info: ProgressInfo): void {
        if (!this.barFill) return;

        const percent = info.percentComplete ?? 0;
        this.barFill.style.width = `${percent}%`;

        if (info.state === 'complete') {
            this.barFill.classList.add('complete');
        } else {
            this.barFill.classList.remove('complete');
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
        stats.push(this.createStat('Elapsed', formatTime(info.elapsedTime)));

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
            buttons.push(this.createButton('Export PNG', 'exportPNG', 'success'));
            buttons.push(this.createButton('Export HDR', 'exportHDR', 'success'));
            buttons.push(this.createButton('Close', 'close', ''));
        } else if (info.state === 'paused') {
            buttons.push(this.createButton('Resume', 'resume', 'primary'));
            buttons.push(this.createButton('Cancel', 'cancel', 'danger'));
        } else {
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
                break;
            case 'exportPNG':
                this.app.exportPNG();
                break;
            case 'exportHDR':
                this.app.exportHDR();
                break;
            case 'close':
                // Close triggers stop, which triggers layout/resolution restore
                this.app.stop();
                this.hide();
                break;
        }
    }

    // ============================================================================
    // Tile Grid
    // ============================================================================

    private updateTileGrid(info: TiledJobProgressInfo): void {
        if (!this.tileGridContainer) return;

        const { grid, completedPositions, currentTile } = info;
        const completedSet = new Set(completedPositions.map(([x, y]) => `${x},${y}`));

        // Build the grid HTML
        let html = `<div class="tile-grid-header">
            <span class="tile-grid-title">Tiles</span>
            <span class="tile-grid-count">${info.completedTiles} / ${info.totalTiles}</span>
        </div>`;

        html += '<div class="tile-grid" style="' +
            `grid-template-columns: repeat(${grid.tilesX}, 1fr);` +
            `grid-template-rows: repeat(${grid.tilesY}, 1fr);">`;

        for (let y = 0; y < grid.tilesY; y++) {
            for (let x = 0; x < grid.tilesX; x++) {
                const key = `${x},${y}`;
                const isComplete = completedSet.has(key);
                const isCurrent = currentTile && currentTile.x === x && currentTile.y === y;

                let className = 'tile-cell';
                let content = '';

                if (isComplete) {
                    className += ' complete';
                    content = '✓';
                } else if (isCurrent) {
                    className += ' current';
                    content = '▶';
                }

                html += `<div class="${className}" title="Tile [${x}, ${y}]">${content}</div>`;
            }
        }

        html += '</div>';

        this.tileGridContainer.innerHTML = html;
        this.tileGridContainer.classList.remove('hidden');
    }

    // ============================================================================
    // Utilities
    // ============================================================================

    private calculateETA(info: ProgressInfo): string | null {
        if (!info.targetSamples || info.samples === 0) return null;

        const elapsed = info.elapsedTime;
        const samplesPerMs = info.samples / elapsed;
        const remainingSamples = info.targetSamples - info.samples;
        const remainingMs = remainingSamples / samplesPerMs;

        if (!isFinite(remainingMs) || remainingMs < 0) return null;

        return formatTime(remainingMs);
    }
}
