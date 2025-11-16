// engine/ShaderCompiler.ts
import type { ModuleDescriptor, EngineUniforms, UniformType, CompilationResult } from './types';
import {
    buildMainShaderSource,
    buildDisplayShaderSource,
    buildVertexShaderSource,
    addLineNumbers
} from './utils/shader-builder-utils';
import {
    setUniformValue,
    cacheUniformLocations
} from './utils/shader-uniform-utils';
import { translateShaderErrors, ShaderErrorFormatter } from '../errors/index.js';

/**
 * ShaderCompiler - Handles GLSL shader compilation and linking
 *
 * Responsibilities:
 * - Compile vertex and fragment shaders
 * - Link programs (main accumulation + display tone mapping + composite)
 * - Update engine-provided uniforms (time, resolution, etc.)
 * - Provide debug info for shader errors
 */
class ShaderCompiler {
    private gl: WebGL2RenderingContext;
    private mainProgram: WebGLProgram | null = null;
    private displayProgram: WebGLProgram | null = null;
    private compositeProgram: WebGLProgram | null = null;
    private activeProgram: WebGLProgram | null = null;

    // Engine uniform locations
    private uniformLocations = new Map<string, WebGLUniformLocation>();

    // Debug info
    private lastCompiledSource: string | null = null;
    private lastCompiledSourceWithLineNumbers: string | null = null;

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
    }

    /**
     * Compile modules into shader programs
     * Returns CompilationResult with either programs or diagnostics
     */
    compile(modules: ModuleDescriptor[]): CompilationResult {
        const mainSource = buildMainShaderSource(modules);
        const displaySource = buildDisplayShaderSource(modules);
        const compositeSource = this.buildCompositeShaderSource();
        const vertexSource = buildVertexShaderSource();

        try {
            this.mainProgram = this.compileAndLinkProgram(vertexSource, mainSource, 'main');
            this.displayProgram = this.compileAndLinkProgram(vertexSource, displaySource, 'display');
            this.compositeProgram = this.compileAndLinkProgram(vertexSource, compositeSource, 'composite');

            this.lastCompiledSource = mainSource;
            this.lastCompiledSourceWithLineNumbers = addLineNumbers(mainSource);

            return {
                success: true,
                mainProgram: this.mainProgram,
                displayProgram: this.displayProgram,
                compositeProgram: this.compositeProgram
            };
        } catch (error: any) {
            // Compilation failed - translate errors using error reporting system
            const errorLog = error.message || String(error);

            const diagnostics = translateShaderErrors(
                errorLog,
                mainSource,
                modules
            );

            // Format and log errors to console
            const formatter = new ShaderErrorFormatter();
            const formattedErrors = formatter.formatConsole(diagnostics);
            console.error(formattedErrors);

            return {
                success: false,
                diagnostics
            };
        }
    }

    /**
     * Set active program and cache engine uniform locations
     */
    setActiveProgram(program: WebGLProgram): void {
        this.activeProgram = program;
        this.uniformLocations = cacheUniformLocations(this.gl, program);
    }

    /**
     * Update engine uniforms
     */
    updateEngineUniforms(uniforms: EngineUniforms): void {
        if (!this.activeProgram) return;

        this.gl.useProgram(this.activeProgram);

        this.setEngineUniform('u_resolution', uniforms.resolution, 'vec2');
        this.setEngineUniform('u_image_size', uniforms.imageSize, 'vec2');
        this.setEngineUniform('u_frame_index', uniforms.frameIndex, 'int');
        this.setEngineUniform('u_time', uniforms.time, 'float');
        this.setEngineUniform('u_sample_count', uniforms.sampleCount, 'int');
        this.setEngineUniform('u_pixel_offset', uniforms.pixelOffset, 'vec2');
    }

    /**
     * Get main program
     */
    getMainProgram(): WebGLProgram | null {
        return this.mainProgram;
    }

    /**
     * Get display program
     */
    getDisplayProgram(): WebGLProgram | null {
        return this.displayProgram;
    }

    /**
     * Get composite program
     */
    getCompositeProgram(): WebGLProgram | null {
        return this.compositeProgram;
    }

    /**
     * Get debug info for last compiled shader
     */
    getDebugInfo(): { source: string; numberedSource: string } | null {
        if (!this.lastCompiledSource || !this.lastCompiledSourceWithLineNumbers) {
            return null;
        }
        return {
            source: this.lastCompiledSource,
            numberedSource: this.lastCompiledSourceWithLineNumbers
        };
    }

    // ============================================================================
    // Private: Compilation
    // ============================================================================

    private buildCompositeShaderSource(): string {
        return `#version 300 es
precision highp float;

uniform sampler2D u_rgb_texture;

out vec4 fragColor;

void main() {
    ivec2 coord = ivec2(gl_FragCoord.xy);
    vec3 color = texelFetch(u_rgb_texture, coord, 0).rgb;
    fragColor = vec4(color, 1.0);
}`;
    }

    private setEngineUniform(name: string, value: any, type: UniformType): void {
        const location = this.uniformLocations.get(name);
        if (location) {
            setUniformValue(this.gl, location, value, type);
        }
    }

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
}

export { ShaderCompiler };
