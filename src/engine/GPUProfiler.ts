// engine/GPUProfiler.ts

/**
 * GPUProfiler - Measures GPU execution time for render passes
 *
 * Uses EXT_disjoint_timer_query_webgl2 to measure actual GPU time.
 * Results are async - timing from frame N becomes available later.
 *
 * This implementation uses a queue of pending queries rather than
 * fixed buffers, making it robust for variable framerates.
 *
 * Usage:
 *   const profiler = new GPUProfiler(gl);
 *   profiler.enable();
 *
 *   // Each frame:
 *   profiler.update();           // Poll for results
 *   profiler.beginPass('main');
 *   // ... render ...
 *   profiler.endPass('main');
 *
 *   const timing = profiler.getPassTiming('main');  // in milliseconds
 */
export class GPUProfiler {
    private gl: WebGL2RenderingContext;
    private ext: any = null;  // EXT_disjoint_timer_query_webgl2
    private enabled: boolean = false;

    // Queue of pending queries per pass (oldest first)
    private pendingQueries = new Map<string, WebGLQuery[]>();

    // Current active query per pass (the one between beginPass/endPass)
    private activeQueries = new Map<string, WebGLQuery>();

    // Latest timing results (ms)
    private timings = new Map<string, number>();

    // Smoothed timings for display stability
    private smoothedTimings = new Map<string, number>();
    private smoothingFactor = 0.3;  // How fast to adapt (0 = never, 1 = instant)

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
    }

    /**
     * Enable profiling - checks for extension support
     * @returns true if supported, false otherwise
     */
    enable(): boolean {
        this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
        if (!this.ext) {
            console.warn('GPU profiling not supported (extension unavailable)');
            return false;
        }
        this.enabled = true;
        console.log('GPU profiling enabled');
        return true;
    }

    /**
     * Disable profiling
     */
    disable(): void {
        this.enabled = false;
    }

    /**
     * Start timing a pass
     */
    beginPass(passId: string): void {
        if (!this.enabled) return;

        // Create a fresh query for this pass
        const query = this.gl.createQuery()!;
        this.activeQueries.set(passId, query);

        this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    }

    /**
     * End timing a pass
     */
    endPass(passId: string): void {
        if (!this.enabled) return;

        this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);

        // Move active query to pending queue
        const query = this.activeQueries.get(passId);
        if (query) {
            let queue = this.pendingQueries.get(passId);
            if (!queue) {
                queue = [];
                this.pendingQueries.set(passId, queue);
            }
            queue.push(query);
            this.activeQueries.delete(passId);
        }
    }

    /**
     * Poll for completed query results.
     * Call once per frame BEFORE beginPass/endPass.
     */
    update(): void {
        if (!this.enabled) return;

        // Check for GPU disjoint - if true, timing data may be invalid
        const disjoint = this.gl.getParameter(this.ext.GPU_DISJOINT_EXT);
        if (disjoint) {
            // Timing data is unreliable this frame, clear pending queries
            this.clearPendingQueries();
            return;
        }

        // Poll each pass's pending queries
        for (const [passId, queue] of this.pendingQueries) {
            // Process from oldest to newest, stop at first unavailable
            while (queue.length > 0) {
                const query = queue[0];

                const available = this.gl.getQueryParameter(
                    query,
                    this.gl.QUERY_RESULT_AVAILABLE
                );

                if (!available) {
                    // This query isn't ready yet, and neither are newer ones
                    break;
                }

                // Read the result
                const timeNs = this.gl.getQueryParameter(query, this.gl.QUERY_RESULT);
                const timeMs = timeNs / 1_000_000;

                // Update raw timing
                this.timings.set(passId, timeMs);

                // Update smoothed timing
                const prev = this.smoothedTimings.get(passId) ?? timeMs;
                const smoothed = prev + (timeMs - prev) * this.smoothingFactor;
                this.smoothedTimings.set(passId, smoothed);

                // Delete the query and remove from queue
                this.gl.deleteQuery(query);
                queue.shift();
            }

            // Limit queue size to avoid memory buildup if results never come back
            // (shouldn't happen, but defensive)
            while (queue.length > 10) {
                const oldQuery = queue.shift()!;
                this.gl.deleteQuery(oldQuery);
            }
        }
    }

    /**
     * Get timing for a specific pass (smoothed for display stability)
     * @returns timing in milliseconds, or null if not available
     */
    getPassTiming(passId: string): number | null {
        return this.smoothedTimings.get(passId) ?? null;
    }

    /**
     * Get raw (unsmoothed) timing for a specific pass
     * @returns timing in milliseconds, or null if not available
     */
    getRawPassTiming(passId: string): number | null {
        return this.timings.get(passId) ?? null;
    }

    /**
     * Get all pass timings (smoothed)
     * @returns Map of passId -> timing (ms)
     */
    getAllTimings(): Map<string, number> {
        return new Map(this.smoothedTimings);
    }

    /**
     * Check if profiling is enabled
     */
    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Reset all timing data
     * Call when switching renderers to avoid stale data
     */
    reset(): void {
        this.timings.clear();
        this.smoothedTimings.clear();
        this.clearPendingQueries();
        this.activeQueries.clear();
    }

    /**
     * Clear all pending queries (delete WebGL objects)
     */
    private clearPendingQueries(): void {
        for (const queue of this.pendingQueries.values()) {
            for (const query of queue) {
                this.gl.deleteQuery(query);
            }
        }
        this.pendingQueries.clear();
    }
}
