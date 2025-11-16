// app/extensions/RenderProgressExtension.ts
import type { Extension } from '../types';
import { EventManager } from '../utils/EventManager';

/**
 * RenderProgressExtension - Progress bar for production renders
 *
 * Shows:
 * - Progress bar (0-100%)
 * - Current/target samples
 * - Time elapsed + ETA
 * - Total ray samples cast
 * - Only visible during production mode (when targetSamples exists)
 */
class RenderProgressExtension implements Extension {
    name = 'render-progress';
    version = '1.0.0';
    description = 'Progress bar for production renders';

    private app: any;
    private bus: any;
    private container: HTMLDivElement | null = null;
    private events = new EventManager();

    // Progress tracking
    private currentSamples = 0;
    private targetSamples = 0;
    private percentComplete = 0;
    private elapsedTime = 0;
    private resolution = [0, 0];

    // Rate tracking for ETA
    private sampleWindow: Array<{ samples: number; time: number }> = [];
    private readonly WINDOW_DURATION = 3000; // 3 second window for stable ETA

    install(app: any, bus: any): void {
        this.app = app;
        this.bus = bus;

        this.createUI();

        // Get initial resolution
        const res = app.parameterStore.get('resolution');
        if (res) {
            this.resolution = res;
        }

        // Listen to events
        this.events.onBus(bus, 'render.progress', this.handleProgress);
        this.events.onBus(bus, 'accumulation.reset', this.handleReset);
        this.events.onBus(bus, 'parameter.changed', this.handleParameterChange);
        this.events.onBus(bus, 'render.locked', this.handleLocked);
        this.events.onBus(bus, 'render.unlocked', this.handleUnlocked);

        console.log('RenderProgress extension installed');
    }

    uninstall(): void {
        this.events.removeAll();
        if (this.container) {
            this.container.remove();
            this.container = null;
        }
    }

    // ============================================================================
    // UI Creation
    // ============================================================================

    private createUI(): void {
        this.container = document.createElement('div');
        this.container.id = 'render-progress-container';
        this.container.style.cssText = `
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: rgba(20, 20, 20, 0.95);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            padding: 16px 24px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            z-index: 9000;
            opacity: 0;
            transform: translateY(100%);
            transition: all 0.3s cubic-bezier(0.4, 0.0, 0.2, 1);
            pointer-events: none;
        `;

        this.container.innerHTML = `
            <div style="max-width: 1200px; margin: 0 auto;">
                <!-- Stats row -->
                <div style="
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 12px;
                    font-size: 13px;
                    color: rgba(255, 255, 255, 0.7);
                ">
                    <div id="progress-samples">0 / 0 samples</div>
                    <div id="progress-percentage" style="
                        font-size: 24px;
                        font-weight: 600;
                        color: rgba(255, 255, 255, 0.95);
                    ">0%</div>
                    <div id="progress-time">Time: 0s | ETA: --</div>
                </div>

                <!-- Progress bar -->
                <div style="
                    height: 8px;
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 4px;
                    overflow: hidden;
                    position: relative;
                ">
                    <div id="progress-bar-fill" style="
                        height: 100%;
                        width: 0%;
                        background: linear-gradient(90deg,
                            rgba(74, 158, 255, 0.8),
                            rgba(74, 158, 255, 1)
                        );
                        border-radius: 4px;
                        transition: width 0.3s ease;
                        box-shadow: 0 0 10px rgba(74, 158, 255, 0.5);
                    "></div>
                </div>

                <!-- Details row -->
                <div style="
                    display: flex;
                    justify-content: space-between;
                    margin-top: 8px;
                    font-size: 11px;
                    color: rgba(255, 255, 255, 0.5);
                ">
                    <div id="progress-rays">Total rays: 0</div>
                    <div id="progress-rate">Rate: -- samples/sec</div>
                </div>
            </div>
        `;

        document.body.appendChild(this.container);
    }

    private show(): void {
        if (!this.container) return;
        this.container.style.opacity = '1';
        this.container.style.transform = 'translateY(0)';
    }

    private hide(): void {
        if (!this.container) return;
        this.container.style.opacity = '0';
        this.container.style.transform = 'translateY(100%)';
    }

    private updateUI(): void {
        if (!this.container) return;

        // Update percentage (large center number)
        const percentEl = this.container.querySelector('#progress-percentage');
        if (percentEl) {
            percentEl.textContent = `${this.percentComplete.toFixed(1)}%`;
        }

        // Update progress bar fill
        const barEl = this.container.querySelector('#progress-bar-fill') as HTMLElement;
        if (barEl) {
            barEl.style.width = `${this.percentComplete}%`;
        }

        // Update samples
        const samplesEl = this.container.querySelector('#progress-samples');
        if (samplesEl) {
            samplesEl.textContent = `${this.currentSamples.toLocaleString()} / ${this.targetSamples.toLocaleString()} samples`;
        }

        // Calculate and update time/ETA
        const timeEl = this.container.querySelector('#progress-time');
        if (timeEl) {
            const elapsed = this.formatTime(this.elapsedTime / 1000);
            const eta = this.calculateETA();
            timeEl.textContent = `Time: ${elapsed} | ETA: ${eta}`;
        }

        // Update total rays cast
        const raysEl = this.container.querySelector('#progress-rays');
        if (raysEl) {
            const totalPixels = this.resolution[0] * this.resolution[1];
            const totalRays = this.currentSamples * totalPixels;
            raysEl.textContent = `Total rays: ${this.formatNumber(totalRays)}`;
        }

        // Update rate
        const rateEl = this.container.querySelector('#progress-rate');
        if (rateEl) {
            const rate = this.calculateSamplesPerSecond();
            const rateStr = rate > 0 ? rate.toFixed(1) : '--';
            rateEl.textContent = `Rate: ${rateStr} samples/sec`;
        }
    }

    // ============================================================================
    // Event Handlers
    // ============================================================================

    private handleProgress = (info: any): void => {
        // Update basic stats
        if (info.samples !== undefined) {
            this.currentSamples = info.samples;
        }

        if (info.targetSamples !== undefined) {
            this.targetSamples = info.targetSamples;
        }

        if (info.percentComplete !== undefined) {
            this.percentComplete = info.percentComplete;
        }

        if (info.elapsedTime !== undefined) {
            this.elapsedTime = info.elapsedTime;

            // Add to sample window for rate calculation
            this.sampleWindow.push({
                samples: this.currentSamples,
                time: info.elapsedTime
            });

            // Remove old entries outside window
            const cutoffTime = info.elapsedTime - this.WINDOW_DURATION;
            this.sampleWindow = this.sampleWindow.filter(entry => entry.time > cutoffTime);
        }

        this.updateUI();
    };

    private handleReset = (): void => {
        this.currentSamples = 0;
        this.elapsedTime = 0;
        this.percentComplete = 0;
        this.sampleWindow = [];
        this.updateUI();
    };

    private handleParameterChange = (changes: any): void => {
        for (const change of changes.changes) {
            if (change.path === 'resolution') {
                this.resolution = change.newValue;
                this.updateUI();
                break;
            }
        }
    };

    private handleLocked = (): void => {
        // Production mode started - show the progress bar
        this.show();
    };

    private handleUnlocked = (): void => {
        // Production mode ended - hide the progress bar
        this.hide();
    };

    // ============================================================================
    // Calculations
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

    private calculateETA(): string {
        const rate = this.calculateSamplesPerSecond();

        if (rate <= 0 || this.currentSamples >= this.targetSamples) {
            return '--';
        }

        const remainingSamples = this.targetSamples - this.currentSamples;
        const etaSeconds = remainingSamples / rate;

        return this.formatTime(etaSeconds);
    }

    private formatTime(seconds: number): string {
        if (seconds < 60) {
            return `${Math.floor(seconds)}s`;
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

    private formatNumber(num: number): string {
        if (num >= 1e9) {
            return `${(num / 1e9).toFixed(2)}B`;
        } else if (num >= 1e6) {
            return `${(num / 1e6).toFixed(2)}M`;
        } else if (num >= 1e3) {
            return `${(num / 1e3).toFixed(2)}K`;
        }
        return num.toLocaleString();
    }
}

export { RenderProgressExtension };
