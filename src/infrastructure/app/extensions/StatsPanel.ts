// app/extensions/StatsPanelExtension.ts
import type { Extension } from '../types';
import { EventManager } from '../utils/EventManager';

/**
 * StatsPanelExtension - Displays rendering statistics overlay
 *
 * Adapts display based on rendering state:
 * - Accumulating: Shows samples/sec, total samples, time
 * - One-shot: Shows FPS only
 * - Shows lock/pause status indicators
 */
class StatsPanelExtension implements Extension {
    name = 'stats-panel';
    version = '1.0.0';
    description = 'Displays rendering statistics overlay';

    private app: any;
    private bus: any;
    private panel: HTMLDivElement | null = null;
    private events = new EventManager();

    // Stats tracking
    private totalSamples = 0;
    private resolution = [0, 0];
    private timeSinceReset = 0;

    // Rolling windows for rate calculations
    private sampleWindow: Array<{ samples: number; time: number }> = [];
    private frameWindow: Array<{ time: number }> = [];
    private readonly WINDOW_DURATION = 1000; // 1 second window in ms

    install(app: any, bus: any): void {
        this.app = app;
        this.bus = bus;

        app.registerService('stats', this);

        this.createPanel();

        const res = app.parameterStore.get('resolution');
        if (res) {
            this.resolution = res;
        }

        this.events.onBus(bus, 'render.progress', this.handleProgress);
        this.events.onBus(bus, 'accumulation.reset', this.handleReset);
        this.events.onBus(bus, 'parameter.changed', this.handleParameterChange);
        this.events.onBus(bus, 'render.paused', this.handlePause);
        this.events.onBus(bus, 'render.resumed', this.handleResume);

        console.log('StatsPanel extension installed');
    }

    uninstall(): void {
        this.events.removeAll();

        if (this.panel) {
            this.panel.remove();
            this.panel = null;
        }
    }

    // ============================================================================
    // Private: UI
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

    private updateDisplay(): void {
        if (!this.panel) return;

        const coordinator = this.app.renderCoordinator;
        const isAccumulating = coordinator.isAccumulating();
        const isLocked = coordinator.isLocked();
        const isPaused = coordinator.isPaused();

        let html = '';

        // Status indicators
        if (isPaused) {
            html += `<div style="color: orange; margin-bottom: 4px">⏸ PAUSED</div>`;
        } else if (isLocked) {
            html += `<div style="color: orange; margin-bottom: 4px">🔒 PRODUCTION</div>`;
        }

        // Accumulating: show sample statistics
        if (isAccumulating) {
            const sps = this.calculateSamplesPerSecond();
            const spsDisplay = sps > 0 ? sps.toFixed(1) : '---';
            const timeDisplay = this.formatTime(this.timeSinceReset);

            html += `
                <div><strong>Samples/sec:</strong> ${spsDisplay}</div>
                <div><strong>Total samples:</strong> ${this.totalSamples}</div>
                <div><strong>Resolution:</strong> ${this.resolution[0]}×${this.resolution[1]}</div>
                <div><strong>Time:</strong> ${timeDisplay}</div>
            `;
        }
        // One-shot: show FPS only
        else {
            const fps = this.calculateFPS();
            const fpsDisplay = fps > 0 ? fps.toFixed(1) : '---';

            html += `
                <div><strong>FPS:</strong> ${fpsDisplay}</div>
                <div><strong>Resolution:</strong> ${this.resolution[0]}×${this.resolution[1]}</div>
            `;
        }

        this.panel.innerHTML = html;
    }

    // ============================================================================
    // Private: Event Handlers
    // ============================================================================

    private handleProgress = (info: any): void => {
        if (info.samples !== undefined) {
            this.totalSamples = info.samples;
        }

        if (info.elapsedTime !== undefined) {
            this.timeSinceReset = info.elapsedTime / 1000;

            // Add to sample window
            this.sampleWindow.push({
                samples: info.samples || 0,
                time: info.elapsedTime
            });

            // Remove old entries outside window
            const cutoffTime = info.elapsedTime - this.WINDOW_DURATION;
            this.sampleWindow = this.sampleWindow.filter(entry => entry.time > cutoffTime);
        }

        if (info.timestamp !== undefined) {
            // Track frames for FPS calculation
            this.frameWindow.push({ time: info.timestamp });

            // Remove old frames outside window
            const cutoffTime = info.timestamp - this.WINDOW_DURATION;
            this.frameWindow = this.frameWindow.filter(f => f.time > cutoffTime);
        }

        this.updateDisplay();
    };

    private handleReset = (): void => {
        this.totalSamples = 0;
        this.timeSinceReset = 0;
        this.sampleWindow = [];
        this.frameWindow = [];
        this.updateDisplay();
    };

    private handleParameterChange = (changes: any): void => {
        for (const change of changes.changes) {
            if (change.path === 'resolution') {
                this.resolution = change.newValue;
                this.updateDisplay();
                break;
            }
        }
    };

    private handlePause = (): void => {
        // Force update to show pause indicator
        this.updateDisplay();
    };

    private handleResume = (): void => {
        // Force update to remove pause indicator
        this.updateDisplay();
    };

    // ============================================================================
    // Private: Calculations
    // ============================================================================

    private calculateSamplesPerSecond(): number {
        if (this.sampleWindow.length < 2) return 0;

        const oldest = this.sampleWindow[0];
        const newest = this.sampleWindow[this.sampleWindow.length - 1];

        const sampleDiff = newest.samples - oldest.samples;
        const timeDiff = (newest.time - oldest.time) / 1000; // Convert to seconds

        if (timeDiff <= 0) return 0;

        return sampleDiff / timeDiff;
    }

    private calculateFPS(): number {
        if (this.frameWindow.length < 2) return 0;

        const oldest = this.frameWindow[0];
        const newest = this.frameWindow[this.frameWindow.length - 1];

        const timeDiff = (newest.time - oldest.time) / 1000; // Convert to seconds

        if (timeDiff <= 0) return 0;

        return this.frameWindow.length / timeDiff;
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
