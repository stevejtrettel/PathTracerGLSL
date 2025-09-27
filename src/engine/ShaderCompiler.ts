import type { ModuleDescriptor } from './types.js';
import type { ParameterChanges } from '../app/types.js';

/**
 * Minimal ShaderCompiler - concatenates modules into GLSL and manages uniforms
 */
class ShaderCompiler {
    private gl: WebGL2RenderingContext;
    private activeProgram: WebGLProgram | null = null;
    private uniformLocations = new Map<string, WebGLUniformLocation>();

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
    }

    /**
     * Compile modules into complete fragment shader
     */
    compile(modules: ModuleDescriptor[]): string {
        const parts: string[] = [];

        parts.push('#version 300 es');
        parts.push('precision highp float;');
        parts.push('');

        // Simple fixed order for Phase 3: ambient -> scene -> camera
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
     * Update uniforms from parameter changes
     */
    updateUniforms(changes: ParameterChanges): void {
        if (!this.activeProgram) return;

        this.gl.useProgram(this.activeProgram);

        for (const change of changes.changes) {
            const uniformName = this.pathToUniform(change.path);
            const location = this.uniformLocations.get(uniformName);

            if (location) {
                this.setUniformValue(location, change.newValue);
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
    
    Hit hit;
    if (scene_intersect(ray, hit)) {
        vec3 color = hit.n * 0.5 + 0.5;
        fragColor = vec4(color, 1.0);
    } else {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    }
}`;
    }

    /**
     * Simple module ordering for Phase 3
     */
    private orderModules(modules: ModuleDescriptor[]): ModuleDescriptor[] {
        const order = ['ambient', 'scene', 'camera'];
        const result: ModuleDescriptor[] = [];

        for (const kind of order) {
            const module = modules.find(m => m.id.kind === kind);
            if (module) result.push(module);
        }

        return result;
    }

    /**
     * Convert parameter path to uniform name
     */
    private pathToUniform(path: string): string {
        return 'u_' + path.replace('.', '_');
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
