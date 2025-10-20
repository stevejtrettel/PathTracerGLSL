// app/extensions/StatsPanelExtension.ts
import type { Extension } from '../types';

/**
 * StatsPanelExtension displays rendering statistics
 * - Samples per second
 * - Total sample count
 * - Resolution
 * - Time since last reset
 */
class StatsPanelExtension implements Extension {
    name = 'stats-panel';
    version = '1.0.0';
    description = 'Displays rendering statistics overlay';

    private app: any;
    private bus: any;
    private panel: HTMLDivElement | null = null;

    // Stats tracking
    private totalSamples = 0;
    private samplesPerSecond = 0;
    private resolution = [0, 0];
    private timeSinceReset = 0;

    install(app: any, bus: any): void {
        this.app = app;
        this.bus = bus;

        // Register as service
        app.registerService('stats', this);

        // Create UI panel
        this.createPanel();

        // Get initial resolution
        const res = app.parameterStore.get('resolution');
        if (res) {
            this.resolution = res;
        }

        // Listen to render progress events
        bus.on('render.progress', this.handleProgress);

        // Listen to reset events
        bus.on('accumulation.reset', this.handleReset);

        // Listen to parameter changes for resolution updates
        bus.on('parameter.changed', this.handleParameterChange);

        console.log('StatsPanel extension installed');
    }

    uninstall(): void {
        // Remove event listeners
        this.bus.off('render.progress', this.handleProgress);
        this.bus.off('accumulation.reset', this.handleReset);
        this.bus.off('parameter.changed', this.handleParameterChange);

        // Remove DOM element
        if (this.panel) {
            this.panel.remove();
            this.panel = null;
        }
    }

    // ============================================================================
    // Private: UI Creation
    // ============================================================================

    private createPanel(): void {
        this.panel = document.createElement('div');
        this.panel.id = 'stats-panel';
        this.panel.style.cssText = `
            position: fixed;
            top: 10px;
            left: 10px;
            background: rgba(0, 0, 0, 0.75);
            color: white;
            padding: 12px 16px;
            font-family: 'Courier New', monospace;
            font-size: 13px;
            line-height: 1.6;
            border-radius: 4px;
            z-index: 1000;
            pointer-events: none;
            user-select: none;
            min-width: 200px;
        `;

        document.body.appendChild(this.panel);
        this.updateDisplay();
    }

    // ============================================================================
    // Private: Event Handlers
    // ============================================================================

    private handleProgress = (info: any): void => {
        // Update stats from progress info
        if (info.samples !== undefined) {
            this.totalSamples = info.samples;
        }

        if (info.elapsedTime !== undefined) {
            this.timeSinceReset = info.elapsedTime / 1000; // Convert to seconds
        }

        // Calculate samples per second
        if (info.samples && info.elapsedTime) {
            this.samplesPerSecond = (info.samples / (info.elapsedTime / 1000));
        }

        // Update display immediately (no throttling)
        this.updateDisplay();
    };

    private handleReset = (): void => {
        // Reset counters
        this.totalSamples = 0;
        this.timeSinceReset = 0;
        this.samplesPerSecond = 0;
        this.updateDisplay();
    };

    private handleParameterChange = (changes: any): void => {
        // Check if resolution changed
        for (const change of changes.changes) {
            if (change.path === 'resolution') {
                this.resolution = change.newValue;
                this.updateDisplay();
                break;
            }
        }
    };

    // ============================================================================
    // Private: Display Update
    // ============================================================================

    private updateDisplay(): void {
        if (!this.panel) return;

        const spsDisplay = this.samplesPerSecond > 0
            ? this.samplesPerSecond.toFixed(1)
            : '---';

        const timeDisplay = this.formatTime(this.timeSinceReset);

        this.panel.innerHTML = `
            <div><strong>Samples/sec:</strong> ${spsDisplay}</div>
            <div><strong>Total samples:</strong> ${this.totalSamples}</div>
            <div><strong>Resolution:</strong> ${this.resolution[0]}×${this.resolution[1]}</div>
            <div><strong>Time:</strong> ${timeDisplay}</div>
        `;
    }

    private formatTime(seconds: number): string {
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
}

export { StatsPanelExtension };
