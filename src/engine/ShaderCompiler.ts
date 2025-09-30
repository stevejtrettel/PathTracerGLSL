// ShaderCompiler.ts - Final simplified version
import type { ModuleDescriptor, UniformBinding, EngineUniforms, UniformType } from './types';
import type { ParameterChanges } from '../app/types';
import {
    buildMainShaderSource,
    buildDisplayShaderSource,
    buildVertexShaderSource,
    addLineNumbers
} from './utils/shader-builder-utils';
import {
    setUniformValue,
    uniformValuesEqual,
    cacheUniformLocations
} from './utils/shader-uniform-utils';

class ShaderCompiler {
    private gl: WebGL2RenderingContext;

    // Programs
    private mainProgram: WebGLProgram | null = null;
    private displayProgram: WebGLProgram | null = null;
    private activeProgram: WebGLProgram | null = null;

    // Uniform management
    private uniformLocations = new Map<string, WebGLUniformLocation>();
    private uniformBindings = new Map<string, UniformBinding>();
    private parameterCache = new Map<string, any>();
    private parameterToBindings = new Map<string, Set<UniformBinding>>();

    // Caching
    private uniformValueCache = new Map<string, any>();
    private updateStats = { total: 0, skipped: 0 };

    // Debug info
    private lastCompiledSource: string | null = null;
    private lastCompiledSourceWithLineNumbers: string | null = null;

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
    }

    compile(modules: ModuleDescriptor[]): string {
        this.buildUniformBindings(modules);

        const mainSource = buildMainShaderSource(modules);
        const displaySource = buildDisplayShaderSource(modules);
        const vertexSource = buildVertexShaderSource();

        this.mainProgram = this.compileAndLinkProgram(vertexSource, mainSource, 'main');
        this.displayProgram = this.compileAndLinkProgram(vertexSource, displaySource, 'display');

        this.lastCompiledSource = mainSource;
        this.lastCompiledSourceWithLineNumbers = addLineNumbers(mainSource);

        return mainSource;
    }

    getMainProgram(): WebGLProgram | null {
        return this.mainProgram;
    }

    getDisplayProgram(): WebGLProgram | null {
        return this.displayProgram;
    }

    setActiveProgram(program: WebGLProgram): void {
        if (this.activeProgram !== program) {
            this.uniformValueCache.clear();
            this.updateStats = { total: 0, skipped: 0 };
        }
        this.activeProgram = program;
        this.uniformLocations = cacheUniformLocations(this.gl, program);
    }

    // ============ UNIFORM UPDATES ============

    updateUniforms(changes: ParameterChanges): void {
        if (!this.activeProgram) return;

        this.gl.useProgram(this.activeProgram);

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

            // Skip if value unchanged
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

    updateEngineUniforms(uniforms: EngineUniforms): void {
        if (!this.activeProgram) return;

        this.gl.useProgram(this.activeProgram);

        this.setEngineUniform('u_resolution', uniforms.resolution, 'vec2');
        this.setEngineUniform('u_frame_index', uniforms.frameIndex, 'int');
        this.setEngineUniform('u_time', uniforms.time, 'float');
        this.setEngineUniform('u_sample_count', uniforms.sampleCount, 'int');

        if (uniforms.frameIndex % 60 === 0 && uniforms.frameIndex > 0) {
            this.logStatsIfNeeded();
        }
    }

    private setEngineUniform(name: string, value: any, type: UniformType): void {
        const location = this.uniformLocations.get(name);
        if (location) {
            setUniformValue(this.gl, location, value, type);
        }
    }

    // ============ COMPILATION ============

    private compileAndLinkProgram(vertexSource: string, fragmentSource: string, name: string): WebGLProgram {
        const vertexShader = this.compileShader(vertexSource, this.gl.VERTEX_SHADER, `${name} vertex`);
        const fragmentShader = this.compileShader(fragmentSource, this.gl.FRAGMENT_SHADER, `${name} fragment`);

        const program = this.gl.createProgram();
        if (!program) throw new Error(`Failed to create ${name} program`);

        this.gl.attachShader(program, vertexShader);
        this.gl.attachShader(program, fragmentShader);
        this.gl.linkProgram(program);

        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            const log = this.gl.getProgramInfoLog(program);
            throw new Error(`${name} program link failed: ${log}`);
        }

        this.gl.deleteShader(vertexShader);
        this.gl.deleteShader(fragmentShader);

        return program;
    }

    private compileShader(source: string, type: number, name: string): WebGLShader {
        const shader = this.gl.createShader(type);
        if (!shader) throw new Error(`Failed to create ${name} shader`);

        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);

        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            const log = this.gl.getShaderInfoLog(shader);
            this.gl.deleteShader(shader);
            throw new Error(`${name} shader compilation failed: ${log}`);
        }

        return shader;
    }

    // ============ UNIFORM BINDING SETUP ============

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


    // ============ UTILITY ============

    private logStatsIfNeeded(): void {
        const total = this.updateStats.total + this.updateStats.skipped;
        if (total % 60 === 0 && total > 0) {
            const skipRate = (this.updateStats.skipped / total * 100).toFixed(1);
            console.log(`Uniform cache: ${skipRate}% GPU calls skipped (${this.updateStats.skipped}/${total})`);
        }
    }

    getDebugInfo(): { source: string, numberedSource: string } | null {
        if (!this.lastCompiledSource || !this.lastCompiledSourceWithLineNumbers) {
            return null;
        }
        return {
            source: this.lastCompiledSource,
            numberedSource: this.lastCompiledSourceWithLineNumbers
        };
    }

    clearCache(): void {
        this.uniformValueCache.clear();
        this.updateStats = { total: 0, skipped: 0 };
    }

    getCacheStats(): { total: number, skipped: number, skipRate: number } {
        const total = this.updateStats.total + this.updateStats.skipped;
        return {
            total: this.updateStats.total,
            skipped: this.updateStats.skipped,
            skipRate: total > 0 ? this.updateStats.skipped / total : 0
        };
    }
}

export { ShaderCompiler };
