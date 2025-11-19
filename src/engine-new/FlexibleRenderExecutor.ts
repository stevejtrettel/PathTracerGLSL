// engine-new/FlexibleRenderExecutor.ts

import type { RenderPipeline, RenderPass, ShaderProgram } from '../compiler/types.js';
import type { FlexibleResourceManager } from './FlexibleResourceManager.js';

/**
 * FlexibleRenderExecutor
 *
 * Generic pass execution engine that reads RenderPipeline and executes it.
 * Data-driven - doesn't know about scenes/strategies, just executes passes.
 *
 * Key responsibilities:
 * - Compile GLSL shaders into WebGL programs
 * - Execute individual render passes (bind framebuffer, textures, draw)
 * - Execute complete pipelines (iterate passes + post-frame swaps)
 * - Handle shader compilation errors
 *
 * Uses fullscreen triangle technique (no VAO needed, gl.drawArrays with 3 vertices)
 */
export class FlexibleRenderExecutor {
    private gl: WebGL2RenderingContext;
    private resourceManager: FlexibleResourceManager;

    // Compiled shader programs (shader id → WebGLProgram)
    private programs: Map<string, WebGLProgram>;

    // Current active pipeline
    private activePipeline: RenderPipeline | null = null;

    constructor(gl: WebGL2RenderingContext, resourceManager: FlexibleResourceManager) {
        this.gl = gl;
        this.resourceManager = resourceManager;
        this.programs = new Map();
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
                this.programs.set(id, program);
            } catch (error) {
                // Re-throw with shader id for better error messages
                throw new Error(`Failed to compile shader '${id}': ${error}`);
            }
        }
    }

    /**
     * Set active pipeline
     */
    setActivePipeline(pipeline: RenderPipeline): void {
        this.activePipeline = pipeline;
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
     * 6. Bind input textures
     * 7. Draw fullscreen triangle
     */
    executePass(pass: RenderPass): void {
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

        // Set viewport (get dimensions from canvas)
        const canvas = gl.canvas as HTMLCanvasElement;
        gl.viewport(0, 0, canvas.width, canvas.height);

        // Set up draw buffers if MRT
        if (outputs.length > 1) {
            this._setupDrawBuffers(outputs);
        }

        // Clear if requested (clears all attachments)
        if (pass.execution.clearBeforeRender) {
            gl.clear(gl.COLOR_BUFFER_BIT);
        }

        // Use shader program
        gl.useProgram(program);

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
     * 1. Execute all passes in order
     * 2. Execute post-frame operations (swaps)
     */
    executePipeline(pipeline: RenderPipeline): void {
        // Execute all passes
        for (const pass of pipeline.passes) {
            // Handle execution type
            if (pass.execution.type === 'once') {
                this.executePass(pass);
            } else if (pass.execution.type === 'loop') {
                const iterations = pass.execution.iterations || 1;
                for (let i = 0; i < iterations; i++) {
                    this.executePass(pass);
                }
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
     * Clean up all programs
     */
    cleanup(): void {
        const gl = this.gl;

        for (const program of this.programs.values()) {
            gl.deleteProgram(program);
        }

        this.programs.clear();
        this.activePipeline = null;
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

        let textureUnit = 0;

        for (const [uniformName, textureId] of Object.entries(textures)) {
            // Get texture from resource manager (handles :N suffix for MRT)
            const texture = this.resourceManager.getTexture(textureId);

            // Bind texture to unit
            gl.activeTexture(gl.TEXTURE0 + textureUnit);
            gl.bindTexture(gl.TEXTURE_2D, texture);

            // Set sampler uniform
            const location = gl.getUniformLocation(program, uniformName);
            if (location) {
                gl.uniform1i(location, textureUnit);
            }

            textureUnit++;
        }
    }

    /**
     * Set up draw buffers for MRT
     *
     * Parses output IDs to extract attachment locations and sets gl.drawBuffers()
     *
     * @param outputs - Array of output buffer IDs (e.g., ['buffer:0', 'buffer:1', 'buffer:2'])
     */
    private _setupDrawBuffers(outputs: string[]): void {
        const gl = this.gl;

        // Parse attachment indices from output strings
        const attachments: number[] = [];

        for (const output of outputs) {
            // Parse :N suffix
            const colonIndex = output.lastIndexOf(':');
            let attachment = 0;

            if (colonIndex !== -1) {
                const attachmentStr = output.substring(colonIndex + 1);
                const attachmentNum = parseInt(attachmentStr, 10);
                if (!isNaN(attachmentNum)) {
                    attachment = attachmentNum;
                }
            }

            attachments.push(attachment);
        }

        // Sort and create draw buffers array
        const sortedAttachments = [...attachments].sort((a, b) => a - b);
        const drawBuffers = sortedAttachments.map(a => gl.COLOR_ATTACHMENT0 + a);

        // Set draw buffers
        gl.drawBuffers(drawBuffers);
    }
}
