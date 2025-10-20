// engine/ShaderCompiler.ts
import type { ModuleDescriptor, EngineUniforms, UniformType } from './types';
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

/**
 * ShaderCompiler handles GLSL compilation only.
 * Parameter management moved to ParameterManager.
 */
class ShaderCompiler {
    private gl: WebGL2RenderingContext;

    // Programs
    private mainProgram: WebGLProgram | null = null;
    private displayProgram: WebGLProgram | null = null;
    private activeProgram: WebGLProgram | null = null;

    // Uniform locations (for engine-driven uniforms only now)
    private uniformLocations = new Map<string, WebGLUniformLocation>();

    // Debug info
    private lastCompiledSource: string | null = null;
    private lastCompiledSourceWithLineNumbers: string | null = null;

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
    }

    /**
     * Compile modules into programs
     */
    compile(modules: ModuleDescriptor[]): {
        mainProgram: WebGLProgram;
        displayProgram: WebGLProgram;
    } {
        const mainSource = buildMainShaderSource(modules);
        const displaySource = buildDisplayShaderSource(modules);
        const vertexSource = buildVertexShaderSource();

        this.mainProgram = this.compileAndLinkProgram(vertexSource, mainSource, 'main');
        this.displayProgram = this.compileAndLinkProgram(vertexSource, displaySource, 'display');

        this.lastCompiledSource = mainSource;
        this.lastCompiledSourceWithLineNumbers = addLineNumbers(mainSource);

        return {
            mainProgram: this.mainProgram,
            displayProgram: this.displayProgram
        };
    }

    getMainProgram(): WebGLProgram | null {
        return this.mainProgram;
    }

    getDisplayProgram(): WebGLProgram | null {
        return this.displayProgram;
    }

    /**
     * Set active program and cache engine uniform locations
     */
    setActiveProgram(program: WebGLProgram): void {
        this.activeProgram = program;
        this.uniformLocations = cacheUniformLocations(this.gl, program);
    }

    /**
     * Update engine-provided uniforms (time, resolution, etc.)
     */
    updateEngineUniforms(uniforms: EngineUniforms): void {
        if (!this.activeProgram) return;

        this.gl.useProgram(this.activeProgram);

        this.setEngineUniform('u_resolution', uniforms.resolution, 'vec2');  // framebuffer size
        this.setEngineUniform('u_image_size', uniforms.imageSize, 'vec2');  // overall image size
        this.setEngineUniform('u_frame_index', uniforms.frameIndex, 'int');
        this.setEngineUniform('u_time', uniforms.time, 'float');
        this.setEngineUniform('u_sample_count', uniforms.sampleCount, 'int');
        this.setEngineUniform('u_pixel_offset', uniforms.pixelOffset, 'vec2');

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

    // ============ DEBUG ============

    getDebugInfo(): { source: string; numberedSource: string } | null {
        if (!this.lastCompiledSource || !this.lastCompiledSourceWithLineNumbers) {
            return null;
        }
        return {
            source: this.lastCompiledSource,
            numberedSource: this.lastCompiledSourceWithLineNumbers
        };
    }
}

export { ShaderCompiler };
