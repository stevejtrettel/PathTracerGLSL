import type { ModuleDescriptor, UniformBinding, EngineUniforms } from './types';
import type { ParameterChanges } from '../app/types';

import commonStructsGLSL from './common-structs.glsl?raw';

/**
 * Minimal ShaderCompiler - concatenates modules into GLSL and manages uniforms via bindings
 */
class ShaderCompiler {
    private gl: WebGL2RenderingContext;
    private activeProgram: WebGLProgram | null = null;
    private uniformLocations = new Map<string, WebGLUniformLocation>();

    // Uniform binding system
    private uniformBindings = new Map<string, UniformBinding>();
    private parameterCache = new Map<string, any>();
    private parameterToBindings = new Map<string, Set<UniformBinding>>();

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
    }

    /**
     * Compile modules into complete fragment shader
     */
    compile(modules: ModuleDescriptor[]): string {
        this.buildUniformBindings(modules);

        const parts: string[] = [];

        parts.push('#version 300 es');
        parts.push('precision highp float;');
        parts.push('');

        // Include common structs that depend on Point/Direction, and
        parts.push('// ============ COMMON STRUCTS ============');
        parts.push(commonStructsGLSL);
        parts.push('');

        // ADD THIS: Engine uniforms (always available)
        parts.push('// ============ ENGINE UNIFORMS ============');
        parts.push('uniform vec2 u_resolution;');
        parts.push('uniform int u_frame_index;');
        parts.push('uniform float u_time;');
        parts.push('');

        // Process modules in order
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

        return parts.join('\n');
    }

    /**
     * Set active program and cache uniform locations
     */
    setActiveProgram(program: WebGLProgram): void {
        this.activeProgram = program;
        this.cacheUniformLocations();
    }

    /**
     * Update uniforms from parameter changes using binding system
     */
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

        // Execute bindings
        for (const binding of affectedBindings) {
            const paramValues: Record<string, any> = {};
            for (const paramPath of binding.parameters) {
                paramValues[paramPath] = this.parameterCache.get(paramPath);
            }

            const uniformValue = binding.compute(paramValues);
            const location = this.uniformLocations.get(binding.uniform);
            if (location) {
                this.setUniformValue(location, uniformValue);
            }
        }

        console.log('Setting uniforms:', changes.changes.map(c => `${c.path} = ${JSON.stringify(c.newValue)}`));

    }



    updateEngineUniforms(uniforms: EngineUniforms): void {
        if (!this.activeProgram) return;

        this.gl.useProgram(this.activeProgram);

        // Set standard engine uniforms
        const setUniform = (name: string, value: any) => {
            const location = this.uniformLocations.get(name);
            if (location) {
                this.setUniformValue(location, value);
            }
        };

        setUniform('u_resolution', uniforms.resolution);
        setUniform('u_frame_index', uniforms.frameIndex);
        setUniform('u_time', uniforms.time);

        console.log('Engine uniforms:', uniforms);
    }

    /**
     * Build uniform bindings from modules
     */
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

    /**
     * Cache uniform locations
     */
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

    /**
     * Generate main function for Phase 3
     */
    private generateMainFunction(): string {
        return `void main() {
    vec2 pixel = gl_FragCoord.xy;
    Ray ray = camera_generateRay(pixel, vec2(0.0));
    vec3 color = transport_trace(ray);
    fragColor = vec4(color, 1.0);
}`;
    }

    /**
     * Simple module ordering for Phase 3
     */
    private orderModules(modules: ModuleDescriptor[]): ModuleDescriptor[] {
        const order = ['ambient', 'scene', 'lighting', 'interaction', 'transport', 'camera'];
        const result: ModuleDescriptor[] = [];

        for (const kind of order) {
            const module = modules.find(m => m.id.kind === kind);
            if (module) result.push(module);
        }

        return result;
    }

    /**
     * Set uniform value by type
     */
    private setUniformValue(location: WebGLUniformLocation, value: any): void {
        if (typeof value === 'number') {
            this.gl.uniform1f(location, value);
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
}

export { ShaderCompiler };
