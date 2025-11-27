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
import type { App } from '../App.js';
import type { EventBus } from '../EventBus.js';
import type { Extension } from '../types.js';

// Ensure UI styles (including extensions.css) are loaded
import '../ui/index.js';

export class StatsPanel implements Extension {
    name = 'stats-panel';
    version = '2.0.0';
    description = 'Rendering statistics overlay';

    private app!: App;
    private panel: HTMLDivElement | null = null;
    private visible = true;
    private updateInterval: number | null = null;
    private useLayout = false;

    install(app: App, _bus: EventBus): void {
        this.app = app;
        this.useLayout = app.hasLayout();

        this.createPanel();
        this.startUpdating();

        // Toggle with 'i' key
        window.addEventListener('keydown', this.onKeyDown);

        const modeStr = this.useLayout ? 'layout-integrated' : 'standalone';
        console.log(`StatsPanel installed (press i to toggle) [${modeStr}]`);
    }

    uninstall(): void {
        window.removeEventListener('keydown', this.onKeyDown);
        this.stopUpdating();
        if (this.panel) {
            this.panel.remove();
            this.panel = null;
        }
    }

    // ============================================================================
    // Public API
    // ============================================================================

    show(): void {
        this.visible = true;
        if (this.panel) this.panel.style.display = 'block';
    }

    hide(): void {
        this.visible = false;
        if (this.panel) this.panel.style.display = 'none';
    }

    toggle(): void {
        if (this.visible) {
            this.hide();
        } else {
            this.show();
        }
    }

    // ============================================================================
    // Private: UI
    // ============================================================================

    private createPanel(): void {
        this.panel = document.createElement('div');
        this.panel.className = 'stats-panel';

        if (this.useLayout) {
            // Layout mode: mount to region-left
            const regionLeft = this.app.getRegion('region-left');
            regionLeft.appendChild(this.panel);
        } else {
            // Standalone mode: fixed position
            this.panel.classList.add('standalone');
            document.body.appendChild(this.panel);
        }
    }

    private startUpdating(): void {
        // Update at 10 Hz (every 100ms)
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
        if (!this.panel || !this.visible) return;

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
        lines.push(`<b>Time:</b> ${this.formatTime(stats.elapsedMs)}`);

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

        this.panel.innerHTML = lines.join('<br>');
    }

    private formatTime(ms: number): string {
        const seconds = ms / 1000;
        if (seconds < 60) {
            return `${seconds.toFixed(1)}s`;
        } else if (seconds < 3600) {
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${mins}m ${secs}s`;
        } else {
            const hours = Math.floor(seconds / 3600);
            const mins = Math.floor((seconds % 3600) / 60);
            return `${hours}h ${mins}m`;
        }
    }

    // ============================================================================
    // Private: Event Handlers
    // ============================================================================

    private onKeyDown = (e: KeyboardEvent): void => {
        // Skip if typing in input
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
            return;
        }

        // Toggle with 'i' key
        if (e.key === 'i' || e.key === 'I') {
            e.preventDefault();
            this.toggle();
        }
    };
}
