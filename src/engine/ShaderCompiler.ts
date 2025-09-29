// ShaderCompiler.ts - With integrated RNG system
import type { ModuleDescriptor, UniformBinding, EngineUniforms, UniformType } from './types';
import {MODULE_ORDER} from "./types";
import type { ParameterChanges } from '../app/types';
import commonStructsGLSL from './common-structs.glsl?raw';

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

        const mainSource = this.buildMainShader(modules);
        this.mainProgram = this.compileAndLinkProgram(mainSource, 'main');

        const displaySource = this.buildDisplayShader(modules);
        this.displayProgram = this.compileAndLinkProgram(displaySource, 'display');

        this.lastCompiledSource = mainSource;
        this.lastCompiledSourceWithLineNumbers = this.addLineNumbers(mainSource);

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
        this.cacheUniformLocations();
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

            // Skip if value unchanged (using typed comparison)
            const cachedValue = this.uniformValueCache.get(binding.uniform);
            if (this.valuesEqualTyped(cachedValue, uniformValue, binding.type)) {
                this.updateStats.skipped++;
                continue;
            }

            // Update cache and GPU
            this.uniformValueCache.set(binding.uniform, uniformValue);
            const location = this.uniformLocations.get(binding.uniform);
            if (location) {
                this.setUniformTyped(location, uniformValue, binding.type);
                this.updateStats.total++;
            }
        }

        this.logStatsIfNeeded();
    }

    updateEngineUniforms(uniforms: EngineUniforms): void {
        if (!this.activeProgram) return;

        this.gl.useProgram(this.activeProgram);

        // Engine uniforms with known types
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
            this.setUniformTyped(location, value, type);
        }
    }

    // ============ TYPED UNIFORM SETTING ============

    private setUniformTyped(location: WebGLUniformLocation, value: any, type: UniformType): void {
        switch (type) {
            case 'float':
                this.gl.uniform1f(location, value);
                break;
            case 'int':
                this.gl.uniform1i(location, value);
                break;
            case 'bool':
                this.gl.uniform1i(location, value ? 1 : 0);
                break;
            case 'vec2':
                this.gl.uniform2fv(location, value);
                break;
            case 'vec3':
                this.gl.uniform3fv(location, value);
                break;
            case 'vec4':
                this.gl.uniform4fv(location, value);
                break;
            case 'mat3':
                this.gl.uniformMatrix3fv(location, false, value);
                break;
            case 'mat4':
                this.gl.uniformMatrix4fv(location, false, value);
                break;
            case 'sampler2D':
            case 'samplerCube':
                this.gl.uniform1i(location, value);
                break;
            default:
                console.warn(`Unknown uniform type: ${type}`);
                // Fall back to old inference method
                this.setUniformInferred(location, value);
        }
    }

    private setUniformInferred(location: WebGLUniformLocation, value: any): void {
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

    // ============ TYPED VALUE COMPARISON ============

    private valuesEqualTyped(a: any, b: any, type?: UniformType): boolean {
        if (a === b) return true;
        if (a == null || b == null) return false;

        if (!type) {
            // Fall back to untyped comparison
            return this.valuesEqual(a, b);
        }

        const EPSILON = 0.00001;

        switch (type) {
            case 'float':
                return Math.abs(a - b) < EPSILON;

            case 'int':
            case 'bool':
                return a === b;

            case 'vec2':
                return a.length === 2 && b.length === 2 &&
                    Math.abs(a[0] - b[0]) < EPSILON &&
                    Math.abs(a[1] - b[1]) < EPSILON;

            case 'vec3':
                return a.length === 3 && b.length === 3 &&
                    Math.abs(a[0] - b[0]) < EPSILON &&
                    Math.abs(a[1] - b[1]) < EPSILON &&
                    Math.abs(a[2] - b[2]) < EPSILON;

            case 'vec4':
                return a.length === 4 && b.length === 4 &&
                    Math.abs(a[0] - b[0]) < EPSILON &&
                    Math.abs(a[1] - b[1]) < EPSILON &&
                    Math.abs(a[2] - b[2]) < EPSILON &&
                    Math.abs(a[3] - b[3]) < EPSILON;

            case 'mat3':
                if (a.length !== 9 || b.length !== 9) return false;
                for (let i = 0; i < 9; i++) {
                    if (Math.abs(a[i] - b[i]) >= EPSILON) return false;
                }
                return true;

            case 'mat4':
                if (a.length !== 16 || b.length !== 16) return false;
                for (let i = 0; i < 16; i++) {
                    if (Math.abs(a[i] - b[i]) >= EPSILON) return false;
                }
                return true;

            case 'sampler2D':
            case 'samplerCube':
                return a === b; // Texture unit comparison

            default:
                return this.valuesEqual(a, b);
        }
    }

    // Keep old method for fallback
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

    // ============ RNG SYSTEM ============

    private getRNGSystem(): string {
        return `
// ============ RNG SYSTEM ============
// Per-fragment RNG state that gets initialized in main()
uint rng_seed;

// Wang hash for generating random numbers
uint wang_hash(uint seed) {
    seed = uint(seed ^ uint(61)) ^ uint(seed >> uint(16));
    seed *= uint(9);
    seed = seed ^ (seed >> 4);
    seed *= uint(0x27d4eb2d);
    seed = seed ^ (seed >> 15);
    return seed;
}

// Get next random float in [0,1]
float random() {
    rng_seed = wang_hash(rng_seed);
    return float(rng_seed) / 4294967296.0;
}

// Get two random floats
vec2 random2() {
    return vec2(random(), random());
}

// Get three random floats
vec3 random3() {
    return vec3(random(), random(), random());
}`;
    }

    // ============ SHADER BUILDING ============

    private buildMainShader(modules: ModuleDescriptor[]): string {
        const parts: string[] = [];

        parts.push('#version 300 es');
        parts.push('precision highp float;');
        parts.push('');
        parts.push('// ============ COMMON STRUCTS ============');
        parts.push(commonStructsGLSL);
        parts.push('');
        parts.push('// ============ ENGINE UNIFORMS ============');
        parts.push('uniform vec2 u_resolution;');
        parts.push('uniform int u_frame_index;');
        parts.push('uniform float u_time;');
        parts.push('uniform int u_sample_count;');
        parts.push('');

        // Add the RNG system
        parts.push(this.getRNGSystem());
        parts.push('');

        const orderedModules = this.orderModules(modules);

        for (const module of orderedModules) {
            if (module.id.kind === 'developer') continue;

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

    private generateMainFunction(): string {
        return `
void main(){
    vec2 pixel = gl_FragCoord.xy;
    
    // Initialize RNG seed once per pixel
    rng_seed = uint(uint(pixel.x) * uint(1973) + 
                   uint(pixel.y) * uint(9277) + 
                   uint(u_frame_index) * uint(26699)) | uint(1);
    
    // Now just use random() or random2() anywhere!
    Ray ray = camera_generateRay(pixel, random2());
    Spectrum spectrum = transport_trace(ray);
    Radiance radiance = accumulator_accumulate(spectrum, pixel);
    
    fragColor = vec4(radiance, 1.0);
}`;
    }

    // ============ COMPILATION ============

    private compileAndLinkProgram(fragmentSource: string, name: string): WebGLProgram {
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

    // ============ UTILITY ============

    private logStatsIfNeeded(): void {
        const total = this.updateStats.total + this.updateStats.skipped;
        if (total % 60 === 0 && total > 0) {
            const skipRate = (this.updateStats.skipped / total * 100).toFixed(1);
            console.log(`Uniform cache: ${skipRate}% GPU calls skipped (${this.updateStats.skipped}/${total})`);
        }
    }

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
