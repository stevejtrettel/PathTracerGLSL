// ShaderCompiler.ts - COMPLETE REPLACEMENT
import type { ModuleDescriptor, UniformBinding, EngineUniforms } from './types';
import { MODULE_ORDER } from "./types";
import type { ParameterChanges } from '../app/types';
import commonStructsGLSL from './common-structs.glsl?raw';
import randomGLSL from '../math/random.glsl?raw';


class ShaderCompiler {
    private gl: WebGL2RenderingContext;
    private activeProgram: WebGLProgram | null = null;
    private uniformLocations = new Map<string, WebGLUniformLocation>();

    // Uniform binding system
    private uniformBindings = new Map<string, UniformBinding>();
    private parameterCache = new Map<string, any>();
    private parameterToBindings = new Map<string, Set<UniformBinding>>();

    // Value cache to prevent redundant GPU updates
    private uniformValueCache = new Map<string, any>();
    private updateStats = { total: 0, skipped: 0 };

    // NEW: Store debug info
    private lastCompiledSource: string | null = null;
    private lastCompiledSourceWithLineNumbers: string | null = null;

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
    }
// ShaderCompiler.ts - Update the compile method
    compile(modules: ModuleDescriptor[]): string {
        this.buildUniformBindings(modules);

        const parts: string[] = [];

        parts.push('#version 300 es');
        parts.push('precision highp float;');
        parts.push('');

        parts.push('// ============ COMMON STRUCTS ============');
        parts.push(commonStructsGLSL);
        parts.push('');

        parts.push('// ============ RANDOM NUMBERS ============');
        parts.push(randomGLSL);
        parts.push('');

        parts.push('// ============ ENGINE UNIFORMS ============');
        parts.push('uniform vec2 u_resolution;');
        parts.push('uniform int u_frame_index;');
        parts.push('uniform float u_time;');
        parts.push('');

        const orderedModules = this.orderModules(modules);

        for (const module of orderedModules) {
            parts.push(`// ============ ${module.id.name} (${module.id.kind}) ============`);

            if (module.fragment.constants) {
                parts.push(module.fragment.constants);
            }
            if (module.fragment.uniforms) {
                parts.push(module.fragment.uniforms);
            }
            parts.push(module.fragment.functions);
            parts.push('');
        }

        parts.push('out vec4 fragColor;');
        parts.push('');
        parts.push(this.generateMainFunction());

        const finalSource = parts.join('\n');

        // Store for debug access
        this.lastCompiledSource = finalSource;
        this.lastCompiledSourceWithLineNumbers = this.addLineNumbers(finalSource);

        return finalSource;
    }



    // NEW: Add line numbers to source
    private addLineNumbers(source: string): string {
        const lines = source.split('\n');
        const lineNumWidth = String(lines.length).length;

        return lines.map((line, index) => {
            const lineNum = String(index + 1).padStart(lineNumWidth, ' ');
            return `${lineNum}: ${line}`;
        }).join('\n');
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

    setActiveProgram(program: WebGLProgram): void {
        // Clear cache when switching programs
        if (this.activeProgram !== program) {
            this.uniformValueCache.clear();
            this.updateStats = { total: 0, skipped: 0 };
        }

        this.activeProgram = program;
        this.cacheUniformLocations();
    }

    updateUniforms(changes: ParameterChanges): void {
        if (!this.activeProgram) return;

        this.gl.useProgram(this.activeProgram);

        // Update parameter cache
        for (const change of changes.changes) {
            this.parameterCache.set(change.path, change.newValue);
        }

        // Find affected bindings
        const affectedBindings = new Set<UniformBinding>();
        for (const change of changes.changes) {
            const bindings = this.parameterToBindings.get(change.path);
            if (bindings) {
                bindings.forEach(binding => affectedBindings.add(binding));
            }
        }

        // Execute bindings WITH CACHE CHECK
        for (const binding of affectedBindings) {
            const paramValues: Record<string, any> = {};
            for (const paramPath of binding.parameters) {
                paramValues[paramPath] = this.parameterCache.get(paramPath);
            }

            const uniformValue = binding.compute(paramValues);

            // CHECK CACHE - Skip GPU update if value unchanged
            const cachedValue = this.uniformValueCache.get(binding.uniform);
            if (this.valuesEqual(cachedValue, uniformValue)) {
                this.updateStats.skipped++;
                continue;
            }

            // Value changed - update cache and GPU
            this.uniformValueCache.set(binding.uniform, uniformValue);
            const location = this.uniformLocations.get(binding.uniform);
            if (location) {
                this.setUniformValue(location, uniformValue);
                this.updateStats.total++;
            }
        }

        // Log stats periodically (every 60 frames)
        if ((this.updateStats.total + this.updateStats.skipped) % 60 === 0) {
            const skipRate = (this.updateStats.skipped / (this.updateStats.total + this.updateStats.skipped) * 100).toFixed(1);
            console.log(`Uniform cache: ${skipRate}% GPU calls skipped`);
        }

    }


    updateEngineUniforms(uniforms: EngineUniforms): void {
        if (!this.activeProgram) return;

        this.gl.useProgram(this.activeProgram);

        // Engine uniforms use the cache too
        // this.setCachedUniform('u_resolution', uniforms.resolution);
        // this.setCachedUniform('u_frame_index', uniforms.frameIndex);
        // this.setCachedUniform('u_time', uniforms.time);

        // Handle each uniform with correct type
        const locRes = this.uniformLocations.get('u_resolution');
        if (locRes) this.gl.uniform2fv(locRes, uniforms.resolution);

        const locFrame = this.uniformLocations.get('u_frame_index');
        if (locFrame) this.gl.uniform1i(locFrame, uniforms.frameIndex); // uniform1i!

        const locTime = this.uniformLocations.get('u_time');
        if (locTime) this.gl.uniform1f(locTime, uniforms.time);


        // Log stats every 60 FRAMES (not every 60 updates)
        if (uniforms.frameIndex % 60 === 0 && uniforms.frameIndex > 0) {
            const total = this.updateStats.total + this.updateStats.skipped;
            const skipRate = total > 0 ? (this.updateStats.skipped / total * 100) : 0;
            console.log(`Uniform cache: ${skipRate.toFixed(1)}% GPU calls skipped (${this.updateStats.skipped}/${total})`);
        }
    }


    private setCachedUniform(name: string, value: any): void {
        const cached = this.uniformValueCache.get(name);
        if (this.valuesEqual(cached, value)) {
            this.updateStats.skipped++;  // ADD THIS
            return;
        }

        this.uniformValueCache.set(name, value);
        const location = this.uniformLocations.get(name);
        if (location) {
            this.setUniformValue(location, value);
            this.updateStats.total++;  // ADD THIS
        }
    }

    // NEW: Value comparison including arrays and matrices
    private valuesEqual(a: any, b: any): boolean {
        if (a === b) return true;
        if (a == null || b == null) return false;

        // Handle arrays (vec2, vec3, vec4, matrices)
        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                // Use epsilon for float comparison
                if (Math.abs(a[i] - b[i]) > 0.00001) return false;
            }
            return true;
        }

        // Handle typed arrays
        if (a instanceof Float32Array && b instanceof Float32Array) {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                if (Math.abs(a[i] - b[i]) > 0.00001) return false;
            }
            return true;
        }

        return false;
    }

    private buildUniformBindings(modules: ModuleDescriptor[]): void {
        this.uniformBindings.clear();
        this.parameterToBindings.clear();

        for (const module of modules) {
            for (const binding of module.uniformBindings || []) {
                this.uniformBindings.set(binding.uniform, binding);

                // Build reverse index: parameter -> bindings
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
        if (!this.activeProgram) return;

        this.uniformLocations.clear();
        const numUniforms = this.gl.getProgramParameter(this.activeProgram, this.gl.ACTIVE_UNIFORMS);

        for (let i = 0; i < numUniforms; i++) {
            const uniformInfo = this.gl.getActiveUniform(this.activeProgram, i);
            if (!uniformInfo) continue;

            const location = this.gl.getUniformLocation(this.activeProgram, uniformInfo.name);
            if (location) {
                this.uniformLocations.set(uniformInfo.name, location);
            }
        }
    }

// ShaderCompiler.ts
    private generateMainFunction(): string {
        return `
        void main() {
    vec2 pixel = gl_FragCoord.xy;
    
    // 1. Initialize RNG state unique to this pixel at this frame
    uint rng_state = hash3(uint(pixel.x), uint(pixel.y), uint(u_frame_index));
    //                      ^^^^^^^^^^^^^  ^^^^^^^^^^^^^  ^^^^^^^^^^^^^^
    //                      pixel X pos    pixel Y pos    current frame number
    // This ensures each pixel gets different randoms, and they change each frame
    
    // 2. Generate 2D random offset in [0,1]²
    vec2 xi = random2(rng_state);
    
    // 3. Pass to camera for sub-pixel jitter
    Ray ray = camera_generateRay(pixel, xi);
    //                                   ^^
    // Camera will use xi to jitter within the pixel for anti-aliasing
    
    // Rest of pipeline unchanged
    Spectrum spectrum = transport_trace(ray);
    Radiance radiance = accumulator_accumulate(spectrum, pixel);
    RGB color = developer_develop(radiance);
    fragColor = vec4(color, 1.0);
}`;
    }

    private orderModules(mods: ModuleDescriptor[]): ModuleDescriptor[] {
        const moduleMap = new Map(mods.map(m => [m.id.kind, m]));
        const result: ModuleDescriptor[] = [];

        for (const kind of MODULE_ORDER) {
            const m = moduleMap.get(kind);
            if (m) {
                result.push(m);
                moduleMap.delete(kind);
            }
        }

        // Warn about unordered modules
        if (moduleMap.size > 0) {
            console.warn('Unordered modules:', Array.from(moduleMap.keys()));
        }

        return result;
    }

    private setUniformValue(location: WebGLUniformLocation, value: any): void {
        if (typeof value === 'number') {
            this.gl.uniform1f(location, value);
        } else if (typeof value === 'boolean') {
            this.gl.uniform1i(location, value ? 1 : 0);
        } else if (Array.isArray(value) || value instanceof Float32Array) {
            switch (value.length) {
                case 2: this.gl.uniform2fv(location, value); break;
                case 3: this.gl.uniform3fv(location, value); break;
                case 4: this.gl.uniform4fv(location, value); break;
                case 9: this.gl.uniformMatrix3fv(location, false, value); break;
                case 16: this.gl.uniformMatrix4fv(location, false, value); break;
            }
        }
    }

    // NEW: Clear cache (useful for recipe switching later)
    clearCache(): void {
        this.uniformValueCache.clear();
        this.updateStats = { total: 0, skipped: 0 };
    }

    // NEW: Get cache stats (for debugging)
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
