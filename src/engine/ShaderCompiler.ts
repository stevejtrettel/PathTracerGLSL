// ShaderCompiler.ts - COMPLETE REPLACEMENT
import type { ModuleDescriptor, UniformBinding, EngineUniforms } from './types';
import { MODULE_ORDER } from "./types";
import type { ParameterChanges } from '../app/types';
import commonStructsGLSL from './common-structs.glsl?raw';
import randomGLSL from '../math/random.glsl?raw';

class ShaderCompiler {
    private gl: WebGL2RenderingContext;

    // TWO programs now
    private mainProgram: WebGLProgram | null = null;
    private displayProgram: WebGLProgram | null = null;
    private activeProgram: WebGLProgram | null = null;

    private uniformLocations = new Map<string, WebGLUniformLocation>();

    // Uniform binding system
    private uniformBindings = new Map<string, UniformBinding>();
    private parameterCache = new Map<string, any>();
    private parameterToBindings = new Map<string, Set<UniformBinding>>();

    // Value cache to prevent redundant GPU updates
    private uniformValueCache = new Map<string, any>();
    private updateStats = { total: 0, skipped: 0 };

    // Store debug info
    private lastCompiledSource: string | null = null;
    private lastCompiledSourceWithLineNumbers: string | null = null;

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
    }

    compile(modules: ModuleDescriptor[]): string {
        this.buildUniformBindings(modules);

        // Build main shader (accumulation without developer)
        const mainSource = this.buildMainShader(modules);
        this.mainProgram = this.compileAndLinkProgram(mainSource, 'main');

        // Build display shader (tone mapping)
        const displaySource = this.buildDisplayShader(modules);
        this.displayProgram = this.compileAndLinkProgram(displaySource, 'display');

        // Store for debug access
        this.lastCompiledSource = mainSource;
        this.lastCompiledSourceWithLineNumbers = this.addLineNumbers(mainSource);

        return mainSource;
    }

    private buildMainShader(modules: ModuleDescriptor[]): string {
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
        parts.push('uniform int u_sample_count;');
        parts.push('');

        const orderedModules = this.orderModules(modules);

        // Add all modules EXCEPT developer
        for (const module of orderedModules) {
            if (module.id.kind === 'developer') continue;  // Skip developer

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

        return parts.join('\n');
    }

    private buildDisplayShader(modules: ModuleDescriptor[]): string {
        // Find developer module
        const developer = modules.find(m => m.id.kind === 'developer');
        if (!developer) {
            throw new Error('No developer module found');
        }

        const parts: string[] = [];

        parts.push('#version 300 es');
        parts.push('precision highp float;');
        parts.push('');
        parts.push('uniform sampler2D u_radiance_texture;');
        parts.push('');
        parts.push('#define Radiance vec3');
        parts.push('#define RGB vec3');
        parts.push('');

        if (developer.fragment.constants) {
            parts.push(developer.fragment.constants);
        }

        if (developer.fragment.uniforms) {
            parts.push(developer.fragment.uniforms);
        }
        parts.push(developer.fragment.functions);
        parts.push('');

        parts.push('out vec4 fragColor;');
        parts.push('');

        parts.push(`void main() {
    ivec2 coord = ivec2(gl_FragCoord.xy);
    Radiance radiance = texelFetch(u_radiance_texture, coord, 0).rgb;
    RGB color = developer_develop(radiance);
    fragColor = vec4(color, 1.0);
}`);

        return parts.join('\n');
    }

    private compileAndLinkProgram(fragmentSource: string, name: string): WebGLProgram {
        // Common vertex shader for both
        const vertexSource = `#version 300 es
void main() {
    float x = float((gl_VertexID & 1) << 2) - 1.0;
    float y = float((gl_VertexID & 2) << 1) - 1.0;
    gl_Position = vec4(x, y, 0.0, 1.0);
}`;

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

    // NEW: Getters for both programs
    getMainProgram(): WebGLProgram | null {
        return this.mainProgram;
    }

    getDisplayProgram(): WebGLProgram | null {
        return this.displayProgram;
    }

    // Generate main function that outputs RADIANCE
    private generateMainFunction(): string {
        return `
void main(){
    vec2 pixel = gl_FragCoord.xy;
    uint rng_state = hash3(uint(pixel.x), uint(pixel.y), uint(u_frame_index));
    vec2 xi = random2(rng_state);
    
    Ray ray = camera_generateRay(pixel, xi);
    Spectrum spectrum = transport_trace(ray);
    Radiance radiance = accumulator_accumulate(spectrum, pixel);
    
    // Output RADIANCE for accumulation (no developer)
    fragColor = vec4(radiance, 1.0);
}`;
    }

    // All existing methods stay exactly the same
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

        for (const change of changes.changes) {
            this.parameterCache.set(change.path, change.newValue);
        }

        const affectedBindings = new Set<UniformBinding>();
        for (const change of changes.changes) {
            const bindings = this.parameterToBindings.get(change.path);
            if (bindings) {
                bindings.forEach(binding => affectedBindings.add(binding));
            }
        }

        for (const binding of affectedBindings) {
            const paramValues: Record<string, any> = {};
            for (const paramPath of binding.parameters) {
                paramValues[paramPath] = this.parameterCache.get(paramPath);
            }

            const uniformValue = binding.compute(paramValues);

            const cachedValue = this.uniformValueCache.get(binding.uniform);
            if (this.valuesEqual(cachedValue, uniformValue)) {
                this.updateStats.skipped++;
                continue;
            }

            this.uniformValueCache.set(binding.uniform, uniformValue);
            const location = this.uniformLocations.get(binding.uniform);
            if (location) {
                this.setUniformValue(location, uniformValue);
                this.updateStats.total++;
            }
        }

        if ((this.updateStats.total + this.updateStats.skipped) % 60 === 0) {
            const skipRate = (this.updateStats.skipped / (this.updateStats.total + this.updateStats.skipped) * 100).toFixed(1);
            console.log(`Uniform cache: ${skipRate}% GPU calls skipped`);
        }
    }

    updateEngineUniforms(uniforms: EngineUniforms): void {
        if (!this.activeProgram) return;

        this.gl.useProgram(this.activeProgram);

        const locRes = this.uniformLocations.get('u_resolution');
        if (locRes) this.gl.uniform2fv(locRes, uniforms.resolution);

        const locFrame = this.uniformLocations.get('u_frame_index');
        if (locFrame) this.gl.uniform1i(locFrame, uniforms.frameIndex);

        const locTime = this.uniformLocations.get('u_time');
        if (locTime) this.gl.uniform1f(locTime, uniforms.time);

        const locSample = this.uniformLocations.get('u_sample_count');
        if (locSample) this.gl.uniform1i(locSample, uniforms.sampleCount);

        if (uniforms.frameIndex % 60 === 0 && uniforms.frameIndex > 0) {
            const total = this.updateStats.total + this.updateStats.skipped;
            const skipRate = total > 0 ? (this.updateStats.skipped / total * 100) : 0;
            console.log(`Uniform cache: ${skipRate.toFixed(1)}% GPU calls skipped (${this.updateStats.skipped}/${total})`);
        }
    }

    private setCachedUniform(name: string, value: any): void {
        const cached = this.uniformValueCache.get(name);
        if (this.valuesEqual(cached, value)) {
            this.updateStats.skipped++;
            return;
        }

        this.uniformValueCache.set(name, value);
        const location = this.uniformLocations.get(name);
        if (location) {
            this.setUniformValue(location, value);
            this.updateStats.total++;
        }
    }

    private valuesEqual(a: any, b: any): boolean {
        if (a === b) return true;
        if (a == null || b == null) return false;

        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                if (Math.abs(a[i] - b[i]) > 0.00001) return false;
            }
            return true;
        }

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
