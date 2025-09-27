import type { ModuleDescriptor } from './types.js';
import type { ParameterChanges } from '../app/types.js';

/**
 * ShaderCompiler takes validated modules and concatenates them into complete GLSL
 * Phase 2: Also handles uniform management for the compiled program
 */
class ShaderCompiler {
    private gl: WebGL2RenderingContext;
    private activeProgram: WebGLProgram | null = null;

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
    }

    /**
     * Compile modules into complete fragment shader source
     * Returns GLSL string ready for WebGL compilation
     */
    compile(modules: ModuleDescriptor[]): string {
        const parts: string[] = [];

        // WebGL version and precision
        parts.push('#version 300 es');
        parts.push('precision highp float;');
        parts.push('');

        // Order modules by dependency: ambient → scene → lighting → camera → transport → interaction → film → developer
        const orderedModules = this.orderModules(modules);

        // Concatenate each module: constants, uniforms, then functions
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

        // Output variable
        parts.push('out vec4 fragColor;');
        parts.push('');

        // Main function
        parts.push(this.generateMainFunction(orderedModules));

        return parts.join('\n');
    }

    /**
     * Set the active program for uniform management
     */
    setActiveProgram(program: WebGLProgram): void {
        this.activeProgram = program;
    }

    /**
     * Update uniforms from parameter changes
     * Phase 2: Simple path-to-uniform mapping
     */
    updateUniforms(changes: ParameterChanges): void {
        if (!this.activeProgram) {
            console.warn('ShaderCompiler: No active program for uniform updates');
            return;
        }

        this.gl.useProgram(this.activeProgram);

        for (const change of changes.changes) {
            const uniformName = this.pathToUniform(change.path);
            const location = this.gl.getUniformLocation(this.activeProgram, uniformName);

            if (location) {
                this.setUniformValue(location, change.newValue);
            } else {
                console.warn(`ShaderCompiler: Uniform '${uniformName}' not found`);
            }
        }
    }

    /**
     * Generate main() function for camera ray visualization
     * Phase 2: Assumes camera module is present
     */
    private generateMainFunction(modules: ModuleDescriptor[]): string {
        return `void main() {
  vec2 pixel = gl_FragCoord.xy;
  vec2 xi = vec2(0.0);  // No antialiasing for Phase 2
  
  Ray ray = camera_generateRay(pixel, xi);
  
  // Visualize ray direction as color
  // Map direction [-1,1] to color [0,1] for visibility
  vec3 color = ray.direction * 0.5 + 0.5;
  
  fragColor = vec4(color, 1.0);
}`;
    }

    /**
     * Order modules by dependency requirements
     * ambient → scene → lighting → camera → transport → interaction → film → developer
     */
    private orderModules(modules: ModuleDescriptor[]): ModuleDescriptor[] {
        const moduleOrder: string[] = [
            'ambient', 'scene', 'lighting', 'camera',
            'transport', 'interaction', 'film', 'developer', 'test'
        ];

        const orderedModules: ModuleDescriptor[] = [];

        // Add modules in dependency order
        for (const kind of moduleOrder) {
            const modulesOfKind = modules.filter(m => m.id.kind === kind);
            orderedModules.push(...modulesOfKind);
        }

        // Add any modules not in the standard order (future module types)
        const handledKinds = new Set(moduleOrder);
        const unhandledModules = modules.filter(m => !handledKinds.has(m.id.kind));
        orderedModules.push(...unhandledModules);

        return orderedModules;
    }

    /**
     * Convert parameter path to uniform name
     */
    private pathToUniform(path: string): string {
        return 'u_' + path.replace('.', '_');
    }

    /**
     * Set uniform value based on type
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
                default: console.warn(`ShaderCompiler: Unsupported uniform array length: ${value.length}`);
            }
        }
    }
}

export { ShaderCompiler };
