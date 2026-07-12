// engine/RenderExecutor.ts

import type { RenderPipeline, RenderPass, ShaderProgram } from '../compiler/types.js';
import type { ResourceManager } from './ResourceManager.js';
import type { TextureRegistry } from './TextureRegistry.js';
import type { GPUProfiler } from './GPUProfiler.js';
import type { ParameterManager } from './ParameterManager.js';

/** Reserved prefix for registry-resolved texture inputs (contracts §2.10). */
const EXTERN_PREFIX = 'extern:';

/**
 * RenderExecutor
 *
 * Generic pass execution engine that reads RenderPipeline and executes it.
 * Data-driven - doesn't know about scenes/strategies, just executes passes.
 *
 * Key responsibilities:
 * - Compile GLSL shaders into WebGL programs
 * - Execute individual render passes (bind framebuffer, textures, draw)
 * - Execute complete pipelines (iterate passes + post-frame swaps)
 * - Coordinate with ParameterManager for uniform setting
 * - Handle shader compilation errors
 *
 * Uses fullscreen triangle technique (no VAO needed, gl.drawArrays with 3 vertices)
 */
export class RenderExecutor {
    private gl: WebGL2RenderingContext;
    private resourceManager: ResourceManager;
    private textureRegistry: TextureRegistry | null;
    private parameterManager: ParameterManager | null = null;

    // Compiled shader programs (shader id → WebGLProgram)
    private programs: Map<string, WebGLProgram>;

    // GPU profiler (optional)
    private profiler: GPUProfiler | null = null;

    // Cached draw buffers per pass (passId → drawBuffers array)
    private drawBuffersCache: Map<string, number[]> = new Map();

    // getUniformLocation cache — one GL round-trip per (program, name), not per frame.
    // WeakMap keyed on the program so deleted programs drop their entries automatically.
    private uniformLocationCache = new WeakMap<WebGLProgram, Map<string, WebGLUniformLocation | null>>();

    constructor(gl: WebGL2RenderingContext, resourceManager: ResourceManager, textureRegistry: TextureRegistry | null = null) {
        this.gl = gl;
        this.resourceManager = resourceManager;
        this.textureRegistry = textureRegistry;
        this.programs = new Map();
    }

    /**
     * Set ParameterManager for uniform handling
     */
    setParameterManager(parameterManager: ParameterManager): void {
        this.parameterManager = parameterManager;
    }

    /**
     * Set GPU profiler (optional)
     */
    setProfiler(profiler: GPUProfiler): void {
        this.profiler = profiler;
    }

    /**
     * Load shaders and compile them into WebGL programs
     *
     * @param shaders - Map of shader id → shader source (vertex + fragment)
     */
    loadShaders(shaders: Map<string, ShaderProgram>): void {
        for (const [id, shader] of shaders) {
            try {
                const program = this._compileAndLinkProgram(
                    shader.vertex,
                    shader.fragment,
                    id
                );
                // Delete any existing program at this id before overwriting (GPU leak otherwise)
                const existing = this.programs.get(id);
                if (existing) this.gl.deleteProgram(existing);
                this.programs.set(id, program);
            } catch (error) {
                // Re-throw with shader id for better error messages
                throw new Error(`Failed to compile shader '${id}': ${error}`);
            }
        }
    }

    /**
     * Check that every shader compiles and links on the GPU, without installing
     * anything. Each program is built to a throwaway and deleted immediately, so
     * this holds at most one program at a time and allocates no framebuffers or
     * textures — cheap enough to run before a destructive renderer swap to prove
     * the new shaders are good while the current renderer is still loaded.
     *
     * Throws on the first failure with the same message shape as loadShaders, so
     * the error maps back through source maps (see mapEngineShaderError).
     */
    validateShaders(shaders: Map<string, ShaderProgram>): void {
        for (const [id, shader] of shaders) {
            let program: WebGLProgram | undefined;
            try {
                program = this._compileAndLinkProgram(shader.vertex, shader.fragment, id);
            } catch (error) {
                throw new Error(`Failed to compile shader '${id}': ${error}`);
            } finally {
                if (program) this.gl.deleteProgram(program);
            }
        }
    }

    /**
     * Unload compiled programs by shader id, freeing their GPU resources.
     */
    unloadShaders(shaderIds: Iterable<string>): void {
        for (const id of shaderIds) {
            const program = this.programs.get(id);
            if (program) {
                this.gl.deleteProgram(program);
                this.programs.delete(id);
            }
        }
    }

    /**
     * Set active pipeline
     *
     * Caches draw buffer configurations for MRT passes.
     */
    setActivePipeline(pipeline: RenderPipeline): void {
        // Cache draw buffers for MRT passes
        this.drawBuffersCache.clear();
        for (const pass of pipeline.passes) {
            const outputs = Array.isArray(pass.output) ? pass.output : [pass.output];
            if (outputs.length > 1) {
                this.drawBuffersCache.set(pass.id, this._computeDrawBuffers(outputs));
            }
        }
    }

    /**
     * Execute a single render pass
     *
     * Steps:
     * 1. Bind output framebuffer
     * 2. Set viewport
     * 3. Set up draw buffers (for MRT)
     * 4. Clear if needed
     * 5. Use shader program
     * 6. Set uniforms via ParameterManager
     * 7. Bind input textures
     * 8. Draw fullscreen triangle
     *
     * @param pass - The render pass to execute
     * @param parameters - All parameter values for uniform computation
     */
    executePass(pass: RenderPass, parameters: Record<string, any>): void {
        const gl = this.gl;

        // Get shader program
        const program = this.programs.get(pass.shader);
        if (!program) {
            throw new Error(`Shader not found: ${pass.shader}`);
        }

        // Normalize output to array
        const outputs = Array.isArray(pass.output) ? pass.output : [pass.output];

        // Bind output framebuffer (use first output to get framebuffer)
        const framebuffer = this.resourceManager.getFramebuffer(outputs[0]);
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

        // Set viewport to the OUTPUT's dimensions — fixed-size buffers (config.size, the T4
        // contract extension) render at their own size, everything else at canvas size.
        const [vw, vh] = this.resourceManager.getBufferSize(outputs[0]);
        gl.viewport(0, 0, vw, vh);

        // Set up draw buffers if MRT (use cached values)
        if (outputs.length > 1) {
            const cached = this.drawBuffersCache.get(pass.id);
            if (cached) {
                gl.drawBuffers(cached);
            } else {
                // Fallback: compute on the fly if not cached
                gl.drawBuffers(this._computeDrawBuffers(outputs));
            }
        }

        // Clear if requested (clears all attachments)
        if (pass.execution.clearBeforeRender) {
            gl.clear(gl.COLOR_BUFFER_BIT);
        }

        // Use shader program
        gl.useProgram(program);

        // Set uniforms via ParameterManager
        if (this.parameterManager) {
            this.parameterManager.setUniformsForShader(pass.shader, parameters);
        }

        // Bind input textures
        if (pass.inputs?.textures) {
            this._bindTextures(program, pass.inputs.textures);
        }

        // Draw fullscreen triangle (uses gl_VertexID trick in vertex shader)
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    /**
     * Execute complete render pipeline
     *
     * Steps:
     * 1. Execute all passes in order (with uniform setting per-pass)
     * 2. Execute post-frame operations (swaps)
     *
     * @param pipeline - The render pipeline to execute
     * @param parameters - All parameter values for uniform computation
     */
    executePipeline(pipeline: RenderPipeline, parameters: Record<string, any>): void {
        // Update profiler (poll for results from previous frame)
        if (this.profiler) {
            this.profiler.update();
        }

        // Execute all passes
        for (const pass of pipeline.passes) {
            // Begin GPU timing
            if (this.profiler) {
                this.profiler.beginPass(pass.id);
            }

            // Handle execution type
            if (pass.execution.type === 'once') {
                this.executePass(pass, parameters);
            } else if (pass.execution.type === 'loop') {
                const iterations = pass.execution.iterations || 1;
                for (let i = 0; i < iterations; i++) {
                    this.executePass(pass, parameters);
                }
            }

            // End GPU timing
            if (this.profiler) {
                this.profiler.endPass(pass.id);
            }
        }

        // Execute post-frame operations
        if (pipeline.postFrame?.swaps) {
            for (const swap of pipeline.postFrame.swaps) {
                this.resourceManager.executeSwap(swap);
            }
        }
    }

    /**
     * Get a compiled program by shader id
     */
    getProgram(shaderId: string): WebGLProgram | undefined {
        return this.programs.get(shaderId);
    }

    /**
     * Invalidate cached GPU handles after a context loss.
     *
     * The WebGLProgram handles are already dead (the context is gone), so just
     * drop them — no deleteProgram. loadShaders rebuilds them on restore.
     */
    invalidate(): void {
        this.programs.clear();
        this.drawBuffersCache.clear();
    }

    /**
     * Clean up all programs
     */
    cleanup(): void {
        const gl = this.gl;

        for (const program of this.programs.values()) {
            gl.deleteProgram(program);
        }

        this.programs.clear();
        this.drawBuffersCache.clear();
    }

    // ============ PRIVATE METHODS ============

    /**
     * Compile and link a shader program
     * Based on existing ShaderCompiler pattern
     */
    private _compileAndLinkProgram(
        vertexSource: string,
        fragmentSource: string,
        name: string
    ): WebGLProgram {
        const gl = this.gl;

        // Compile shaders
        const vertexShader = this._compileShader(
            vertexSource,
            gl.VERTEX_SHADER,
            `${name} vertex`
        );
        const fragmentShader = this._compileShader(
            fragmentSource,
            gl.FRAGMENT_SHADER,
            `${name} fragment`
        );

        // Create and link program
        const program = gl.createProgram();
        if (!program) {
            throw new Error(`Failed to create program: ${name}`);
        }

        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);

        // Check link status
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const log = gl.getProgramInfoLog(program);
            gl.deleteProgram(program);
            throw new Error(`Program link failed: ${log}`);
        }

        // Clean up shaders (no longer needed after linking)
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);

        return program;
    }

    /**
     * Compile a single shader
     * Based on existing ShaderCompiler pattern
     */
    private _compileShader(source: string, type: number, name: string): WebGLShader {
        const gl = this.gl;

        const shader = gl.createShader(type);
        if (!shader) {
            throw new Error(`Failed to create shader: ${name}`);
        }

        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        // Check compile status
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error(`Shader compilation failed (${name}): ${log}`);
        }

        return shader;
    }

    /**
     * Bind input textures to texture units and set uniform samplers
     *
     * @param program - Shader program to bind textures to
     * @param textures - Map of uniform name → texture id
     */
    private _bindTextures(program: WebGLProgram, textures: Record<string, string>): void {
        const gl = this.gl;

        // The executor is the SOLE texture-unit authority (§2.10): framebuffer refs and
        // extern: refs bind identically to sequential units per pass, every pass, every
        // frame — no unit is owned by anything outside this loop.
        let textureUnit = 0;

        for (const [uniformName, textureId] of Object.entries(textures)) {
            let texture: WebGLTexture;
            if (textureId.startsWith(EXTERN_PREFIX)) {
                // Registry-resolved external texture (e.g. an environment map). A missing
                // key is a HARD, NAMED error — never a silent unit-0 sample (§2.10 (3)).
                const name = textureId.slice(EXTERN_PREFIX.length);
                const registered = this.textureRegistry?.get(name);
                if (!registered) {
                    throw new Error(
                        `Extern texture '${name}' (input '${uniformName}') is not registered — ` +
                        `load it before rendering (registered: ${this.textureRegistry?.names().join(', ') || 'none'})`);
                }
                texture = registered;
            } else {
                // Framebuffer-backed texture (handles _current/_previous + :N MRT suffix)
                texture = this.resourceManager.getTexture(textureId);
            }

            gl.activeTexture(gl.TEXTURE0 + textureUnit);
            gl.bindTexture(gl.TEXTURE_2D, texture);

            const location = this._uniformLocation(program, uniformName);
            if (location) {
                gl.uniform1i(location, textureUnit);
            }

            textureUnit++;
        }
    }

    /** Cached getUniformLocation (engine review #9, cheap half). */
    private _uniformLocation(program: WebGLProgram, name: string): WebGLUniformLocation | null {
        let perProgram = this.uniformLocationCache.get(program);
        if (!perProgram) {
            perProgram = new Map();
            this.uniformLocationCache.set(program, perProgram);
        }
        if (!perProgram.has(name)) {
            perProgram.set(name, this.gl.getUniformLocation(program, name));
        }
        return perProgram.get(name)!;
    }

    /**
     * Compute draw buffers array for MRT
     *
     * Parses output IDs to extract attachment locations.
     *
     * @param outputs - Array of output buffer IDs (e.g., ['buffer:0', 'buffer:1', 'buffer:2'])
     * @returns Array of GL draw buffer constants
     */
    private _computeDrawBuffers(outputs: string[]): number[] {
        return computeDrawBuffers(outputs, this.gl.COLOR_ATTACHMENT0);
    }
}

// ============================================================================
// Pure MRT helper (exported for unit testing; used by _computeDrawBuffers above)
// ============================================================================

/**
 * Map output ids (with optional ':N' attachment suffix) to sorted GL draw-buffer
 * constants. `colorAttachment0` is gl.COLOR_ATTACHMENT0 (0x8CE0). Pure.
 */
export function computeDrawBuffers(outputs: string[], colorAttachment0: number): number[] {
    const attachments: number[] = [];
    for (const output of outputs) {
        const colonIndex = output.lastIndexOf(':');
        let attachment = 0;
        if (colonIndex !== -1) {
            const attachmentNum = parseInt(output.substring(colonIndex + 1), 10);
            if (!isNaN(attachmentNum)) attachment = attachmentNum;
        }
        attachments.push(attachment);
    }
    return [...attachments].sort((a, b) => a - b).map(a => colorAttachment0 + a);
}
