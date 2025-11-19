// engine-new/GPUProfiler.ts

/**
 * GPUProfiler - Measures GPU execution time for render passes
 *
 * Uses EXT_disjoint_timer_query_webgl2 to measure actual GPU time.
 * Results are async - timing from frame N becomes available in frame N+2.
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

    // One query per pass ID, reused every frame
    private queries = new Map<string, WebGLQuery>();

    // Latest timing results (ms)
    private timings = new Map<string, number>();

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

        // Get or create query for this pass
        let query = this.queries.get(passId);
        if (!query) {
            query = this.gl.createQuery()!;
            this.queries.set(passId, query);
        }

        this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    }

    /**
     * End timing a pass
     */
    endPass(passId: string): void {
        if (!this.enabled) return;
        this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    }

    /**
     * Poll for completed query results
     * Call once per frame before beginPass/endPass
     */
    update(): void {
        if (!this.enabled) return;

        for (const [passId, query] of this.queries) {
            const available = this.gl.getQueryParameter(
                query,
                this.gl.QUERY_RESULT_AVAILABLE
            );

            if (available) {
                const timeNs = this.gl.getQueryParameter(query, this.gl.QUERY_RESULT);
                const timeMs = timeNs / 1_000_000;
                this.timings.set(passId, timeMs);
            }
        }
    }

    /**
     * Get timing for a specific pass
     * @returns timing in milliseconds, or null if not available
     */
    getPassTiming(passId: string): number | null {
        return this.timings.get(passId) ?? null;
    }

    /**
     * Get all pass timings
     * @returns Map of passId -> timing (ms)
     */
    getAllTimings(): Map<string, number> {
        return new Map(this.timings);  // Return copy
    }

    /**
     * Check if profiling is enabled
     */
    isEnabled(): boolean {
        return this.enabled;
    }
}
