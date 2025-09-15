// src/engine/execution/render-pipeline.test.ts
/**
 * render-pipeline.test.ts — v1
 * ------------------------------------------------------------
 * PURPOSE
 *   Execute a single-pass, fullscreen render using the compiled shader program
 *   and a GPU-resident film (ping-pong textures) managed by FramebufferPool.
 *
 *   The pipeline:
 *     1) Ensures film textures match the target size.
 *     2) Obtains { readTex, writeFbo } from the pool.
 *     3) Binds the program + fullscreen VAO.
 *     4) Sets engine uniforms (u_resolution, u_frameIndex).
 *     5) Conditionally binds Film-specific uniforms if present in the manifest,
 *        e.g. historyColor (sampler2D @ unit 0), sampleCount (int).
 *     6) Draws a fullscreen triangle strip.
 *     7) Swaps the ping-pong buffers in the pool.
 *
 * DESIGN NOTES
 *   - No feature branches: we only bind uniforms that actually appear in the
 *     compiled manifest. Different Film variants expose different logical
 *     uniforms and are handled uniformly by discovery.
 *   - Engine prelude uniforms are stable and minimal.
 *   - VAO/VBO are internal to the pipeline and disposed with it.
 *
 * TYPES
 *   - ProgramLike: a tiny adapter around your compiled program to `use()` it
 *     and look up uniform locations. Keeps this file independent of any wrapper.
 *   - UniformManifest: from shader-compiler (logical ↔ namespaced names).
 *
 * NULLABLES
 *   - FramebufferPool returns WebGLTexture | null and WebGLFramebuffer | null.
 *     We propagate that safely; when not allocated, render() no-ops.
 */

import type { UniformManifest } from "../shaders/shader-compiler";

export interface FramebufferPoolLike {
    ensureSize(w: number, h: number): void;
    pair(): { readTex: WebGLTexture | null; writeFbo: WebGLFramebuffer | null };
    swap(): void;
}

export interface ProgramLike {
    use(): void;
    getUniformLocation(name: string): WebGLUniformLocation | null;
}

export interface RenderPipelineOptions {
    /** Texture unit index to bind the film history sampler to (default 0). */
    historyTextureUnit?: number;
}

export default class RenderPipeline {
    private gl: WebGL2RenderingContext;
    private program: ProgramLike;
    private pool: FramebufferPoolLike;
    private manifest: UniformManifest;
    private opts: Required<RenderPipelineOptions>;

    private vao: WebGLVertexArrayObject | null = null;
    private vbo: WebGLBuffer | null = null;

    // cached uniform locations
    private uResolution: WebGLUniformLocation | null = null;
    private uFrameIndex: WebGLUniformLocation | null = null;
    private uHistory: WebGLUniformLocation | null = null;
    private uSampleCount: WebGLUniformLocation | null = null;

    private _frameIndex = 0;
    private _sampleCount = 0;

    constructor(
        gl: WebGL2RenderingContext,
        program: ProgramLike,
        pool: FramebufferPoolLike,
        manifest: UniformManifest,
        opts: RenderPipelineOptions = {}
    ) {
        this.gl = gl;
        this.program = program;
        this.pool = pool;
        this.manifest = manifest;
        this.opts = {
            historyTextureUnit: opts.historyTextureUnit ?? 0,
        };

        this.initGeometry();
        this.resolveUniformLocations();
    }

    /** External control over accumulation counters. */
    setFrameIndex(i: number): void {
        this._frameIndex = i | 0;
    }
    setSampleCount(n: number): void {
        this._sampleCount = n | 0;
    }

    /** Render one frame into the film's write FBO; swap ping-pong afterwards. */
    render(width: number, height: number): void {
        if (width <= 0 || height <= 0) return;

        this.pool.ensureSize(width, height);

        const { readTex, writeFbo } = this.pool.pair();
        if (!writeFbo) return; // nothing allocated yet

        const gl = this.gl;

        // bind output target
        gl.bindFramebuffer(gl.FRAMEBUFFER, writeFbo);
        gl.viewport(0, 0, width, height);

        // bind program + geometry
        this.program.use();
        gl.bindVertexArray(this.vao);

        // engine uniforms
        if (this.uResolution) gl.uniform2f(this.uResolution, width, height);
        if (this.uFrameIndex) gl.uniform1i(this.uFrameIndex, this._frameIndex);

        // film-dependent uniforms (only if present in the manifest)
        if (this.uHistory) {
            const unit = this.opts.historyTextureUnit | 0;
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, readTex); // may be null on very first frame; GL ignores
            gl.uniform1i(this.uHistory, unit);
        }
        if (this.uSampleCount) {
            gl.uniform1i(this.uSampleCount, this._sampleCount);
        }

        // draw
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // cleanup minimal state we touched
        gl.bindVertexArray(null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // rotate ping-pong
        this.pool.swap();
    }

    /** Free GL resources. */
    dispose(): void {
        const gl = this.gl;
        if (this.vbo) gl.deleteBuffer(this.vbo);
        if (this.vao) gl.deleteVertexArray(this.vao);
        this.vbo = null;
        this.vao = null;
    }



    // ---------- internals ----------

    private initGeometry(): void {
        const gl = this.gl;
        // Fullscreen quad in NDC: (-1,-1) to (1,1) as TRIANGLE_STRIP with 4 verts
        const verts = new Float32Array([
            -1, -1,
            1, -1,
            -1,  1,
            1,  1,
        ]);

        const vao = gl.createVertexArray();
        const vbo = gl.createBuffer();
        if (!vao || !vbo) throw new Error("RenderPipeline: failed to create VAO/VBO");

        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

        // layout(location=0) in vec2 a_position;
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);

        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);

        this.vao = vao;
        this.vbo = vbo;
    }

    private resolveUniformLocations(): void {
        // Engine prelude uniforms are global (not namespaced)
        this.uResolution = this.program.getUniformLocation("u_resolution");
        this.uFrameIndex = this.program.getUniformLocation("u_frameIndex");

        // Film-dependent uniforms are discovered via manifest logical names
        const maybe = (logical: string): WebGLUniformLocation | null => {
            const ns = this.manifest.byLogical[logical];
            return ns ? this.program.getUniformLocation(ns) : null;
        };
        this.uHistory = maybe("historyColor");
        this.uSampleCount = maybe("sampleCount");
    }
}
