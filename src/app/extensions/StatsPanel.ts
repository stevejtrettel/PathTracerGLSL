/**
 * StatsPanel - Rendering statistics overlay
 *
 * Displays:
 * - Samples and samples/sec
 * - FPS
 * - Resolution
 * - GPU pass timings (if profiling enabled)
 * - Render state indicators
 *
 * Toggle visibility with 'i' key (info).
 * Mounts to region-left if layout available, otherwise fixed to top-left.
 * Styles are defined in ui/styles/extensions.css
 */
import { UIExtension } from './UIExtension.js';
import type { RegionName } from '../layout/index.js';
import { formatTime } from '../utils/format.js';
import { isTypingInInput } from '../utils/dom.js';

export class StatsPanel extends UIExtension {
    name = 'stats-panel';
    version = '3.0.0';
    description = 'Rendering statistics overlay';

    protected readonly region: RegionName = 'region-left';

    private updateInterval: number | null = null;
    private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

    // ============================================================================
    // UIExtension Implementation
    // ============================================================================

    protected createRoot(): HTMLElement {
        const panel = document.createElement('div');
        panel.className = 'stats-panel';
        return panel;
    }

    protected setup(): void {
        this.startUpdating();
        this.attachKeyboardShortcut();

        // Hide during production mode (info shown in ProductionPanel)
        this.on('render.started', this.onRenderStarted);
        this.on('render.complete', this.onRenderEnded);
        this.on('render.stopped', this.onRenderEnded);

        console.log(`StatsPanel installed (press i to toggle) [${this.useLayout ? 'layout' : 'standalone'}]`);
    }

    protected cleanup(): void {
        this.stopUpdating();
        if (this.keydownHandler) {
            window.removeEventListener('keydown', this.keydownHandler);
        }
    }

    // ============================================================================
    // Mode Handling
    // ============================================================================

    private onRenderStarted = (data: { mode: string }): void => {
        if (data.mode === 'production') {
            this.hide();
        }
    };

    private onRenderEnded = (): void => {
        this.show();
    };

    // ============================================================================
    // Update Loop
    // ============================================================================

    private startUpdating(): void {
        this.updateInterval = window.setInterval(() => {
            this.updateDisplay();
        }, 100);
    }

    private stopUpdating(): void {
        if (this.updateInterval !== null) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    private updateDisplay(): void {
        if (!this.isVisible) return;

        const stats = this.app.getStats();
        const lines: string[] = [];

        // State indicator
        if (stats.state === 'paused') {
            lines.push('<span class="stats-panel-state paused">PAUSED</span>');
        } else if (stats.mode === 'production') {
            lines.push('<span class="stats-panel-state production">PRODUCTION</span>');
        }

        // Core stats
        lines.push(`<b>Samples:</b> ${stats.samples.toLocaleString()}`);
        lines.push(`<b>FPS:</b> ${stats.fps.toFixed(1)}`);
        lines.push(`<b>Resolution:</b> ${stats.resolution[0]}×${stats.resolution[1]}`);
        lines.push(`<b>Time:</b> ${formatTime(stats.elapsedMs)}`);

        // Renderer
        if (stats.rendererId) {
            const shortId = stats.rendererId.split('-').slice(0, 2).join('-');
            lines.push(`<b>Renderer:</b> ${shortId}`);
        }

        // GPU timings (if profiling enabled)
        if (stats.profilingEnabled && stats.gpuTimings) {
            lines.push('<span class="stats-panel-divider">─────────────</span>');
            lines.push('<b>GPU Timings:</b>');

            let totalGpu = 0;
            for (const [passId, timeMs] of Object.entries(stats.gpuTimings)) {
                const shortPass = passId.replace('-pass', '');
                lines.push(`  ${shortPass}: ${timeMs.toFixed(2)}ms`);
                totalGpu += timeMs;
            }
            lines.push(`  <b>Total:</b> ${totalGpu.toFixed(2)}ms`);
        }

        this.root.innerHTML = lines.join('<br>');
    }

    // ============================================================================
    // Keyboard Shortcut
    // ============================================================================

    private attachKeyboardShortcut(): void {
        this.keydownHandler = (e: KeyboardEvent) => {
            if (isTypingInInput(e)) return;

            if (e.key === 'i' || e.key === 'I') {
                e.preventDefault();
                this.toggle();
            }
        };

        window.addEventListener('keydown', this.keydownHandler);
    }
}
