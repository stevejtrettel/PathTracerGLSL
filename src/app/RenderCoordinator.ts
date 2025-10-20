// app/RenderCoordinator.ts
import type { Engine } from '../engine/Engine';
import type { EventBus } from './EventBus';

type RenderMode = 'interactive' | 'progressive' | 'production';
type RenderState = 'idle' | 'rendering' | 'paused' | 'complete' | 'reset';

interface ProgressInfo {
    mode: RenderMode;
    state: RenderState;
    timestamp: number;
    samples?: number;
    elapsedTime?: number;
    fps?: number;
    frameTime?: number;
    percentComplete?: number;
    targetSamples?: number;
    reason?: string;
}

interface ProductionConfig {
    targetSamples: number;
}

/**
 * RenderCoordinator - Manages rendering execution across three modes
 *
 * Modes:
 * - Interactive: Real-time preview with FPS reporting
 * - Progressive: Continuous accumulation until manually stopped
 * - Production: Accumulate to target sample count
 */
class RenderCoordinator {
    private engine: Engine;
    private bus: EventBus;
    private mode: RenderMode = 'progressive';
    private running = false;
    private animationId?: number;
    private startTime = 0;

    // Reset rules
    private resetPrefixes = ['camera.', 'quad.', 'material.', 'scene.'];
    private noResetPrefixes = ['developer.', 'debug.', 'resolution'];

    // Production mode configuration
    private productionConfig: ProductionConfig = {
        targetSamples: 1000
    };

    // Progress reporting
    public onProgress?: (info: ProgressInfo) => void;

    constructor(engine: Engine, bus: EventBus) {
        this.engine = engine;
        this.bus = bus;
    }

    /**
     * Get current render mode
     */
    getMode(): RenderMode {
        return this.mode;
    }

    /**
     * Set render mode
     */
    setMode(mode: RenderMode): void {
        if (this.running) {
            this.stop();
        }
        this.mode = mode;
        console.log(`Render mode: ${mode}`);
    }

    /**
     * Configure production mode settings
     */
    configure(config: Partial<ProductionConfig>): void {
        this.productionConfig = { ...this.productionConfig, ...config };
    }

    /**
     * Start rendering
     */
    start(): void {
        if (this.running) {
            console.warn('Already rendering');
            return;
        }

        this.running = true;
        this.startTime = performance.now();

        console.log(`Starting ${this.mode} mode`);

        switch (this.mode) {
            case 'interactive':
                this.runInteractive();
                break;
            case 'progressive':
                this.runProgressive();
                break;
            case 'production':
                this.runProduction();
                break;
        }
    }

    /**
     * Stop rendering
     */
    stop(): void {
        if (!this.running) return;

        this.running = false;

        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = undefined;
        }

        this.reportProgress({
            state: 'paused',
            samples: this.engine.sampleCount
        });

        console.log(`Stopped rendering at ${this.engine.sampleCount} samples`);
    }

    /**
     * Check if currently rendering
     */
    isRunning(): boolean {
        return this.running;
    }

    /**
     * Check if parameter change requires accumulation reset
     */
    shouldResetForParameter(path: string): boolean {
        // Check no-reset list first
        for (const prefix of this.noResetPrefixes) {
            if (path.startsWith(prefix)) {
                return false;
            }
        }

        // Check reset list
        for (const prefix of this.resetPrefixes) {
            if (path.startsWith(prefix)) {
                return true;
            }
        }

        // Conservative default for unknown parameters
        console.warn(`Unknown parameter prefix: ${path}, resetting accumulation`);
        return true;
    }

    /**
     * Reset accumulation
     */
    resetAccumulation(reason: string = 'manual'): void {
        this.engine.clearAccumulation();
        this.startTime = performance.now();

        this.reportProgress({
            state: 'reset',
            samples: 0,
            reason
        });

        this.bus.emit('accumulation.reset', { reason });
        console.log(`Accumulation reset: ${reason}`);
    }

    // ============================================================================
    // Private: Render Loops
    // ============================================================================

    private runInteractive(): void {
        const loop = () => {
            if (!this.running || this.mode !== 'interactive') return;

            const frameStart = performance.now();
            this.engine.renderFrame();
            const frameTime = performance.now() - frameStart;

            this.reportProgress({
                state: 'rendering',
                fps: 1000 / frameTime,
                frameTime,
                elapsedTime: performance.now() - this.startTime
            });

            this.animationId = requestAnimationFrame(loop);
        };

        this.animationId = requestAnimationFrame(loop);
    }

    private runProgressive(): void {
        const loop = () => {
            if (!this.running || this.mode !== 'progressive') return;

            this.engine.renderFrame();

            this.reportProgress({
                state: 'rendering',
                samples: this.engine.sampleCount,
                elapsedTime: performance.now() - this.startTime
            });

            this.animationId = requestAnimationFrame(loop);
        };

        this.animationId = requestAnimationFrame(loop);
    }

    private runProduction(): void {
        const targetSamples = this.productionConfig.targetSamples;

        const loop = () => {
            if (!this.running || this.mode !== 'production') return;

            const samples = this.engine.sampleCount;

            // Check completion
            if (samples >= targetSamples) {
                this.running = false;

                this.reportProgress({
                    state: 'complete',
                    samples,
                    targetSamples,
                    percentComplete: 100,
                    elapsedTime: performance.now() - this.startTime
                });

                console.log(`Production render complete: ${samples} samples`);
                return;
            }

            this.engine.renderFrame();

            // Report progress periodically
            if (samples % 10 === 0) {
                this.reportProgress({
                    state: 'rendering',
                    samples,
                    targetSamples,
                    percentComplete: (samples / targetSamples) * 100,
                    elapsedTime: performance.now() - this.startTime
                });
            }

            this.animationId = requestAnimationFrame(loop);
        };

        this.animationId = requestAnimationFrame(loop);
    }

    private reportProgress(info: Partial<ProgressInfo>): void {
        if (!this.onProgress) return;

        this.onProgress({
            mode: this.mode,
            state: 'rendering',
            timestamp: performance.now(),
            ...info
        } as ProgressInfo);
    }
}

export { RenderCoordinator };
export type { RenderMode, RenderState, ProgressInfo };
