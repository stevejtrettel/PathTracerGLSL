// engine/ParameterManager.ts
import type { UniformBinding } from './types.js';
import { setUniformValue, uniformValuesEqual } from './utils/shader-uniform-utils.js';

/**
 * ParameterManager - Manages parameter-to-uniform bindings for multi-program renderers
 *
 * Responsibilities:
 * - Cache uniform locations for all shader programs
 * - Set uniforms per-shader during pass execution
 * - Cache uniform values to skip redundant GPU calls
 * - Track performance statistics
 *
 * Usage:
 * 1. Call initialize() with all programs and bindings when switching renderers
 * 2. Call setUniformsForShader() before each pass execution
 */
class ParameterManager {
    private gl: WebGL2RenderingContext;

    // Multi-program storage
    private programs = new Map<string, WebGLProgram>();
    private bindings: UniformBinding[] = [];

    // Location cache: uniformName → (shaderId → location)
    // Allows quick lookup of where each uniform exists
    private uniformLocations = new Map<string, Map<string, WebGLUniformLocation>>();

    // Reverse lookup: parameterPath → Set<UniformBinding>
    // Allows finding which uniforms are affected by a parameter change
    private parameterToBindings = new Map<string, Set<UniformBinding>>();

    // Value cache for change detection (uniform values are same across shaders)
    private uniformValueCache = new Map<string, any>();

    // E7 (recompute-on-change): per-binding INPUT snapshots + the last computed value.
    // Closures run only when an input actually changed — previously every compute()
    // (camera basis, light CDFs, majorants, env selection) ran once per shader per
    // frame unconditionally, the scaling cliff for hundreds of driven objects. Inputs
    // are snapshotted BY COPY (the reused-mutated-array trap documented below).
    private inputSnapshots = new Map<string, Record<string, any>>();
    private computedValues = new Map<string, any>();

    // Statistics
    private updateStats = { total: 0, skipped: 0, closuresRun: 0, closuresSkipped: 0 };

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
    }

    /**
     * Initialize with all shader programs and uniform bindings
     *
     * Call this when switching renderers.
     *
     * @param programs - Map of shaderId → WebGLProgram
     * @param bindings - Array of uniform bindings from CompiledRenderer
     */
    initialize(
        programs: Map<string, WebGLProgram>,
        bindings: UniformBinding[]
    ): void {
        this.programs = programs;
        this.bindings = bindings;

        // Build reverse lookup
        this._buildParameterToBindings();

        // Cache uniform locations for all programs
        this._cacheAllUniformLocations();

        // Clear caches for fresh start
        this.uniformValueCache.clear();
        this.inputSnapshots.clear();
        this.computedValues.clear();
        this.updateStats = { total: 0, skipped: 0, closuresRun: 0, closuresSkipped: 0 };
    }

    /**
     * Set uniforms for a specific shader/pass
     *
     * Call this before drawing each pass. Only sets uniforms that exist
     * in the specified shader, skipping unchanged values.
     *
     * @param shaderId - The shader to set uniforms for
     * @param parameters - All parameter values (engine.* and custom)
     */
    setUniformsForShader(shaderId: string, parameters: Record<string, any>): void {
        const program = this.programs.get(shaderId);
        if (!program) return;

        this.gl.useProgram(program);

        for (const binding of this.bindings) {
            // Get location for this shader
            const locationsByShader = this.uniformLocations.get(binding.uniform);
            const location = locationsByShader?.get(shaderId);

            // Skip if this shader doesn't use this uniform
            if (!location) continue;

            // Gather parameter values for this binding
            const paramValues: Record<string, any> = {};
            for (const paramPath of binding.parameters) {
                paramValues[paramPath] = parameters[paramPath];
            }

            // E7: run the closure only when an input changed; otherwise reuse the last
            // computed value (also collapses the per-SHADER recompute — the value is
            // shader-independent, so the second shader this frame reuses it too).
            let value: any;
            const prevInputs = this.inputSnapshots.get(binding.uniform);
            if (prevInputs !== undefined && !inputsChanged(prevInputs, paramValues)) {
                value = this.computedValues.get(binding.uniform);
                this.updateStats.closuresSkipped++;
            } else {
                value = binding.compute(paramValues);
                this.inputSnapshots.set(binding.uniform, snapshotRecord(paramValues));
                // Snapshot the computed value too — a closure reusing one mutated array
                // would otherwise alias this cache.
                this.computedValues.set(binding.uniform, (Array.isArray(value) || ArrayBuffer.isView(value)) ? (value as number[]).slice() : value);
                this.updateStats.closuresRun++;
            }

            // Check cache - skip if unchanged
            const cacheKey = `${shaderId}:${binding.uniform}`;
            const cachedValue = this.uniformValueCache.get(cacheKey);
            if (uniformValuesEqual(cachedValue, value, binding.type)) {
                this.updateStats.skipped++;
                continue;
            }

            // Update cache and set uniform. Snapshot array values: a binding whose
            // compute() returns a reused array mutated in place (the standard
            // camera-controller pattern) would otherwise alias the cache, so the
            // `a === b` fast-path in uniformValuesEqual sees "no change" and the
            // uniform never re-uploads.
            const cached = (Array.isArray(value) || ArrayBuffer.isView(value))
                ? (value as number[]).slice()
                : value;
            this.uniformValueCache.set(cacheKey, cached);
            setUniformValue(this.gl, location, value, binding.type);
            this.updateStats.total++;
        }
    }

    /**
     * Clear uniform value cache
     *
     * Call this when accumulation is reset or parameters change significantly.
     */
    clearCache(): void {
        this.uniformValueCache.clear();
        this.inputSnapshots.clear();
        this.computedValues.clear();
        this.updateStats = { total: 0, skipped: 0, closuresRun: 0, closuresSkipped: 0 };
    }

    /**
     * Reset manager state
     *
     * Call this when switching renderers or cleaning up.
     */
    reset(): void {
        this.programs.clear();
        this.bindings = [];
        this.uniformLocations.clear();
        this.parameterToBindings.clear();
        this.uniformValueCache.clear();
        this.inputSnapshots.clear();
        this.computedValues.clear();
        this.updateStats = { total: 0, skipped: 0, closuresRun: 0, closuresSkipped: 0 };
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): { total: number; skipped: number; skipRate: number } {
        const totalOps = this.updateStats.total + this.updateStats.skipped;
        return {
            total: this.updateStats.total,
            skipped: this.updateStats.skipped,
            skipRate: totalOps > 0 ? this.updateStats.skipped / totalOps : 0
        };
    }

    /**
     * Get which parameters affect which uniforms (for debugging)
     */
    getParameterBindings(): Map<string, string[]> {
        const result = new Map<string, string[]>();
        for (const [param, bindings] of this.parameterToBindings) {
            result.set(param, Array.from(bindings).map(b => b.uniform));
        }
        return result;
    }

    // ============================================================================
    // Private: Initialization
    // ============================================================================

    /**
     * Build reverse lookup from parameter paths to bindings
     */
    private _buildParameterToBindings(): void {
        this.parameterToBindings.clear();

        for (const binding of this.bindings) {
            for (const paramPath of binding.parameters) {
                if (!this.parameterToBindings.has(paramPath)) {
                    this.parameterToBindings.set(paramPath, new Set());
                }
                this.parameterToBindings.get(paramPath)!.add(binding);
            }
        }
    }

    /**
     * Cache uniform locations for all bindings in all programs
     */
    private _cacheAllUniformLocations(): void {
        this.uniformLocations.clear();

        // Track which uniforms are found in at least one shader
        const uniformFoundInShader = new Set<string>();

        for (const binding of this.bindings) {
            const locationsByShader = new Map<string, WebGLUniformLocation>();

            for (const [shaderId, program] of this.programs) {
                const location = this.gl.getUniformLocation(program, binding.uniform);
                if (location) {
                    locationsByShader.set(shaderId, location);
                    uniformFoundInShader.add(binding.uniform);
                }
            }

            this.uniformLocations.set(binding.uniform, locationsByShader);
        }

        // Warn about uniforms not found in ANY shader
        for (const binding of this.bindings) {
            if (!uniformFoundInShader.has(binding.uniform)) {
                console.warn(
                    `Uniform '${binding.uniform}' not found in any shader ` +
                    `(may be optimized out or misspelled)`
                );
            }
        }
    }
}

// ============================================================================
// E7 helpers — exact input comparison (params are exact JS values; the epsilon
// tolerance belongs to the GPU-upload cache, not here) + by-copy snapshots.
// ============================================================================

function inputsChanged(prev: Record<string, any>, next: Record<string, any>): boolean {
    for (const key in next) {
        const a = prev[key], b = next[key];
        if (a === b) continue;
        if ((Array.isArray(a) || ArrayBuffer.isView(a)) && (Array.isArray(b) || ArrayBuffer.isView(b))) {
            const aa = a as ArrayLike<number>, bb = b as ArrayLike<number>;
            if (aa.length !== bb.length) return true;
            for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return true;
            continue;
        }
        return true;
    }
    return false;
}

function snapshotRecord(values: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(values)) {
        out[k] = (Array.isArray(v) || ArrayBuffer.isView(v)) ? (v as number[]).slice() : v;
    }
    return out;
}

export { ParameterManager };
