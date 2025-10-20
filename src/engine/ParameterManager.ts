// engine/ParameterManager.ts
import type { ModuleDescriptor, UniformBinding } from './types';
import type { ParameterChanges } from '../app/types';
import { setUniformValue, uniformValuesEqual } from './utils/shader-uniform-utils';

/**
 * ParameterManager - Manages parameter-to-uniform bindings
 *
 * Responsibilities:
 * - Build uniform bindings from module descriptors
 * - Update GPU uniforms when parameters change
 * - Cache uniform values to skip redundant GPU calls
 * - Track performance statistics
 */
class ParameterManager {
    private gl: WebGL2RenderingContext;
    private program: WebGLProgram | null = null;

    // Binding metadata
    private uniformBindings = new Map<string, UniformBinding>();
    private parameterToBindings = new Map<string, Set<UniformBinding>>();

    // Caches
    private parameterCache = new Map<string, any>();
    private uniformValueCache = new Map<string, any>();
    private uniformLocations = new Map<string, WebGLUniformLocation>();

    // Statistics
    private updateStats = { total: 0, skipped: 0 };
    private frameCount = 0;

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
    }

    /**
     * Initialize with shader program and modules
     */
    initialize(program: WebGLProgram, modules: ModuleDescriptor[]): void {
        this.program = program;

        this.buildUniformBindings(modules);
        this.cacheUniformLocations();

        // Clear caches for fresh start
        this.parameterCache.clear();
        this.uniformValueCache.clear();
        this.updateStats = { total: 0, skipped: 0 };
        this.frameCount = 0;
    }

    /**
     * Update uniforms from parameter changes
     */
    updateUniforms(changes: ParameterChanges): void {
        if (!this.program) return;

        this.gl.useProgram(this.program);

        // Update parameter cache
        for (const change of changes.changes) {
            this.parameterCache.set(change.path, change.newValue);
        }

        // Find affected uniform bindings
        const affectedBindings = new Set<UniformBinding>();
        for (const change of changes.changes) {
            const bindings = this.parameterToBindings.get(change.path);
            if (bindings) {
                bindings.forEach(binding => affectedBindings.add(binding));
            }
        }

        // Update each affected uniform
        for (const binding of affectedBindings) {
            const paramValues: Record<string, any> = {};
            for (const paramPath of binding.parameters) {
                paramValues[paramPath] = this.parameterCache.get(paramPath);
            }

            const uniformValue = binding.compute(paramValues);

            // Skip if value unchanged (cache hit)
            const cachedValue = this.uniformValueCache.get(binding.uniform);
            if (uniformValuesEqual(cachedValue, uniformValue, binding.type)) {
                this.updateStats.skipped++;
                continue;
            }

            // Update cache and GPU
            this.uniformValueCache.set(binding.uniform, uniformValue);
            const location = this.uniformLocations.get(binding.uniform);
            if (location) {
                setUniformValue(this.gl, location, uniformValue, binding.type);
                this.updateStats.total++;
            }
        }

        this.logStatsIfNeeded();
    }

    /**
     * Clear uniform cache
     */
    clearUniformCache(): void {
        this.uniformValueCache.clear();
        this.updateStats = { total: 0, skipped: 0 };
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): { total: number; skipped: number; skipRate: number } {
        const total = this.updateStats.total + this.updateStats.skipped;
        return {
            total: this.updateStats.total,
            skipped: this.updateStats.skipped,
            skipRate: total > 0 ? this.updateStats.skipped / total : 0
        };
    }

    // ============================================================================
    // Private: Initialization
    // ============================================================================

    private buildUniformBindings(modules: ModuleDescriptor[]): void {
        this.uniformBindings.clear();
        this.parameterToBindings.clear();

        for (const module of modules) {
            for (const binding of module.uniformBindings || []) {
                this.uniformBindings.set(binding.uniform, binding);

                for (const paramPath of binding.parameters) {
                    if (!this.parameterToBindings.has(paramPath)) {
                        this.parameterToBindings.set(paramPath, new Set());
                    }
                    this.parameterToBindings.get(paramPath)!.add(binding);
                }
            }
        }
    }

    private cacheUniformLocations(): void {
        if (!this.program) return;

        this.uniformLocations.clear();

        for (const uniformName of this.uniformBindings.keys()) {
            const location = this.gl.getUniformLocation(this.program, uniformName);
            if (location) {
                this.uniformLocations.set(uniformName, location);
            }
        }
    }

    // ============================================================================
    // Private: Statistics
    // ============================================================================

    private logStatsIfNeeded(): void {
        this.frameCount++;

        if (this.frameCount % 60 === 0) {
            const total = this.updateStats.total + this.updateStats.skipped;
            if (total > 0) {
                const skipRate = (this.updateStats.skipped / total * 100).toFixed(1);
                console.log(`Uniform cache: ${skipRate}% skipped (${this.updateStats.skipped}/${total})`);
            }
        }
    }
}

export { ParameterManager };
