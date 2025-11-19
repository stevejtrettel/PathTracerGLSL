// compiler/types.ts

import type { UniformBinding, ParameterMetadata } from '../engine/types.js';

/**
 * Scene description (minimal for SimpleCompiler)
 *
 * In the real Compiler, this will contain full geometry, materials, lights, etc.
 * For now, just an identifier to distinguish different scenes.
 */
export interface SceneDescription {
    id: string;
    name?: string;
}

/**
 * Render strategy specification (minimal for SimpleCompiler)
 *
 * Describes which rendering algorithms to use.
 * For SimpleCompiler: 'debug' or 'pathtracer'
 * For real Compiler: full algorithm specifications
 */
export interface RenderStrategy {
    id: 'debug' | 'pathtracer' | string;
    algorithms?: {
        transport?: string;
        sampling?: string;
        accumulation?: string;
    };
    settings?: {
        maxBounces?: number;
        samplesPerFrame?: number;
        debugOutput?: 'albedo' | 'normal' | 'depth' | 'uv';
    };
}

/**
 * GLSL shader program (vertex + fragment)
 */
export interface ShaderProgram {
    vertex: string;
    fragment: string;
}

/**
 * Framebuffer configuration
 *
 * Defines a GPU framebuffer and its associated texture(s)
 */
export interface FramebufferConfig {
    /** Unique identifier for this framebuffer */
    id: string;

    /**
     * Framebuffer type:
     * - 'screen': default framebuffer (canvas)
     * - 'texture': single framebuffer with one texture
     * - 'double_buffer': ping-pong pair for accumulation
     */
    type: 'screen' | 'texture' | 'double_buffer';

    /**
     * Texture format
     * - rgba32f: 32-bit float RGBA (HDR accumulation)
     * - rgba16f: 16-bit float RGBA (HDR intermediate)
     * - rgba8: 8-bit RGBA (LDR display)
     * - r32f: 32-bit float single channel
     * - depth: depth buffer
     */
    format?: 'rgba32f' | 'rgba16f' | 'rgba8' | 'r32f' | 'depth';
}

/**
 * Buffer swap instruction
 *
 * Describes how to swap framebuffers after rendering
 */
export interface SwapInstruction {
    /**
     * Swap type:
     * - 'swap': flip current/previous for double_buffer (ping-pong)
     * - 'rotate': rotate through queue (for temporal history)
     */
    type: 'swap' | 'rotate';

    /** Buffer IDs to swap/rotate */
    buffers: string[];
}

/**
 * Render pass execution specification
 */
export interface RenderPass {
    /** Unique identifier for this pass */
    id: string;

    /** Which shader to execute */
    shader: string;

    /** Input resources (textures, etc.) */
    inputs?: {
        textures?: Record<string, string>;  // uniform name → texture id
    };

    /** Output framebuffer id */
    output: string;

    /** Execution control */
    execution: {
        /**
         * Execution type:
         * - 'once': execute once per frame
         * - 'loop': execute multiple times (iterations specified)
         */
        type: 'once' | 'loop';

        /** Number of iterations (for 'loop' type) */
        iterations?: number;

        /** Clear framebuffer before rendering */
        clearBeforeRender?: boolean;
    };
}

/**
 * Render pipeline specification
 *
 * Complete description of GPU work to execute.
 * Engine executes this blindly without knowing about scene/strategy.
 */
export interface RenderPipeline {
    /** Framebuffer definitions */
    framebuffers: FramebufferConfig[];

    /** Render passes in execution order */
    passes: RenderPass[];

    /** Post-frame operations (buffer swaps, etc.) */
    postFrame?: {
        swaps?: SwapInstruction[];
    };
}

/**
 * Source map for error reporting
 *
 * Maps generated GLSL back to source templates for better error messages.
 * Minimal for SimpleCompiler, comprehensive for real Compiler.
 */
export interface SourceMap {
    /** Which shader this source map is for */
    shaderId: string;

    /**
     * Line mappings: generated line → source info
     * Maps each line in generated GLSL to its origin
     */
    lineMappings?: Map<number, SourceLocation>;
}

/**
 * Source location for error mapping
 */
export interface SourceLocation {
    /** Source file/template name */
    source: string;

    /** Line in source file */
    line: number;

    /** Optional: which component/module generated this */
    component?: string;
}

/**
 * Export target specification
 *
 * Defines how to export a specific output (HDR, LDR, AOVs, etc.)
 * from a rendered frame.
 */
export interface ExportTarget {
    /** Which framebuffer to read from */
    bufferId: string;

    /** Data format to read */
    format: 'float' | 'byte';

    /** Optional: number of channels (1=depth, 3=RGB, 4=RGBA). Default: 4 */
    channels?: 1 | 3 | 4;
}

/**
 * Compiled renderer output
 *
 * Complete output from Compiler, input to Engine.
 * Contains everything Engine needs to execute rendering.
 */
export interface CompiledRenderer {
    /** Unique identifier for this renderer */
    id: string;

    /** Compiled GLSL shaders (shader id → program) */
    shaders: Map<string, ShaderProgram>;

    /** Execution pipeline specification */
    pipeline: RenderPipeline;

    /** Parameter → uniform bindings for parameter system */
    uniforms: UniformBinding[];

    /** Source maps for error reporting (shader id → source map) */
    sourceMaps?: Map<string, SourceMap>;

    /** Optional: parameter metadata for UI */
    parameters?: Record<string, ParameterMetadata>;

    /**
     * Optional: export targets for reading rendered outputs
     *
     * Standard exports:
     * - 'hdr': HDR radiance (float, RGBA)
     * - 'ldr': LDR display (byte, RGBA)
     *
     * Custom exports (AOVs):
     * - 'albedo', 'normal', 'depth', etc.
     */
    exportTargets?: Record<string, ExportTarget>;
}

/**
 * Compiler interface
 *
 * Compiles scene description + render strategy into executable renderer
 */
export interface ICompiler {
    /**
     * Compile a scene + strategy into a renderer
     *
     * @param scene - Scene description (geometry, materials, lights)
     * @param strategy - Rendering strategy (algorithms, settings)
     * @returns Compiled renderer ready for Engine execution
     */
    compile(scene: SceneDescription, strategy: RenderStrategy): CompiledRenderer;
}
