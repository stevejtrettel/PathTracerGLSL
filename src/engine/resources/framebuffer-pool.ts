// src/engine/resources/framebuffer-pool.test.ts
/**
 * framebuffer-pool.test.ts — v1
 * ------------------------------------------------------------
 * PURPOSE
 *   Manage a persistent, ping-pong pair of HDR color textures + FBOs used as the
 *   GPU "film". The pool abstracts allocation, resize, clear, and read/write
 *   pairing, so the RenderPipeline can render a frame by:
 *
 *     const { readTex, writeFbo } = pool.pair();
 *     // bind program, bind readTex as `historyColor` if Film wants it
 *     gl.bindFramebuffer(gl.FRAMEBUFFER, writeFbo);
 *     // ... draw fullscreen quad
 *     pool.swap();
 *
 * RENDERING MODEL
 *   - Two color attachments (A, B), both RGBA HDR (default RGBA16F).
 *   - Each frame: sample from READ (texture) and write into WRITE (FBO), then swap.
 *   - `clear()` zeros both textures/FBOs (accumulation reset).
 *
 * WEBGL2 + EXTENSIONS
 *   - Prefers RGBA16F (internalFormat = gl.RGBA16F, type = gl.HALF_FLOAT).
 *   - Requires EXT_color_buffer_float for float rendering on many platforms.
 *   - Gracefully falls back to RGBA8/UNSIGNED_BYTE if float rendering unsupported.
 *
 * API
 *   - ensureSize(w,h[,opts]) : (re)allocates if size or format changed.
 *   - pair()  : returns current { readTex, writeFbo }.
 *   - swap()  : swaps read/write roles (call after finishing a frame).
 *   - clear() : clears both attachments to (0,0,0,0).
 *   - dispose(): releases GL resources.
 *
 * TYPESCRIPT NOTES
 *   - GL handles are typed as `WebGLTexture | null` / `WebGLFramebuffer | null`
 *     so assigning `null` is type-safe and explicit. Callers see `null` only
 *     during uninitialized states; `pair()` returns `null` if not allocated.
 */

export interface FramebufferPoolOptions {
    /** Use linear filtering (default: false → NEAREST). */
    linearFiltering?: boolean;
    /** Force 8-bit fallback even if float is available (handy for tests). */
    forceRGBA8?: boolean;
}

export interface FramebufferPair {
    readTex: WebGLTexture | null;
    writeFbo: WebGLFramebuffer | null;
}

export interface PoolFormatInfo {
    /** texture internalFormat (e.g., gl.RGBA16F or gl.RGBA8) */
    internalFormat: number;
    /** texture format (gl.RGBA) */
    format: number;
    /** texture type (gl.HALF_FLOAT or gl.UNSIGNED_BYTE) */
    type: number;
    /** filter value (gl.NEAREST or gl.LINEAR) */
    filter: number;
    /** true if using floating-point renderable attachment */
    hdr: boolean;
}

export default class FramebufferPool {
    private gl: WebGL2RenderingContext;

    private width = 0;
    private height = 0;

    // ping-pong state: index 0/1 are the two attachments
    private readIdx = 0;

    private textures: (WebGLTexture | null)[] = [null, null];
    private fbos: (WebGLFramebuffer | null)[] = [null, null];

    // chosen format (after extension checks)
    private _fmt!: PoolFormatInfo;

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
        // format is decided on first ensureSize() unless forced in options
    }

    /** Current size (0,0 if not allocated). */
    getSize(): { width: number; height: number } {
        return { width: this.width, height: this.height };
    }

    /** Format info actually in use (after ensureSize). */
    get formatInfo(): PoolFormatInfo {
        if (!this._fmt) {
            // Provide a sensible default view before allocation
            const gl = this.gl;
            return {
                internalFormat: gl.RGBA16F ?? 0x881a, // fallback number if undefined in mock
                format: gl.RGBA,
                type: (gl as any).HALF_FLOAT ?? 0x140B,
                filter: this.gl.NEAREST,
                hdr: true,
            };
        }
        return this._fmt;
    }

    /**
     * Ensure the pool is allocated at (w,h). Reallocates if size or format changes.
     * This is cheap to call every frame; it no-ops if nothing changed.
     */
    ensureSize(width: number, height: number, opts: FramebufferPoolOptions = {}): void {
        if (width <= 0 || height <= 0) return; // ignore invalid sizes

        const gl = this.gl;

        // Decide on format (first time) or keep existing unless forced to RGBA8
        const wantLinear = !!opts.linearFiltering;
        const wantRGBA8 = !!opts.forceRGBA8;

        const hdrSupported = !!gl.getExtension("EXT_color_buffer_float");
        const useHDR = !wantRGBA8 && hdrSupported;

        const fmt: PoolFormatInfo = useHDR
            ? {
                internalFormat: (gl as any).RGBA16F ?? 0x881a,
                format: gl.RGBA,
                type: (gl as any).HALF_FLOAT ?? 0x140B,
                filter: wantLinear ? gl.LINEAR : gl.NEAREST,
                hdr: true,
            }
            : {
                internalFormat: gl.RGBA8,
                format: gl.RGBA,
                type: gl.UNSIGNED_BYTE,
                filter: wantLinear ? gl.LINEAR : gl.NEAREST,
                hdr: false,
            };

        const sizeChanged = width !== this.width || height !== this.height;
        const fmtChanged =
            !this._fmt ||
            this._fmt.internalFormat !== fmt.internalFormat ||
            this._fmt.type !== fmt.type ||
            this._fmt.filter !== fmt.filter;

        if (!sizeChanged && !fmtChanged && this.textures[0] && this.textures[1]) {
            return; // already good
        }

        // (Re)allocate
        this.destroyResources();
        this._fmt = fmt;
        this.width = width;
        this.height = height;
        this.readIdx = 0;

        this.textures = [this.createColorTexture(width, height, fmt), this.createColorTexture(width, height, fmt)];
        this.fbos = [this.createFramebuffer(this.textures[0]), this.createFramebuffer(this.textures[1])];

        // verify completeness
        for (const fbo of this.fbos) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
            const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
            if (status !== gl.FRAMEBUFFER_COMPLETE) {
                throw new Error(`FramebufferPool: framebuffer incomplete (status=0x${status.toString(16)})`);
            }
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /** Return the current read texture + write FBO. */
    pair(): FramebufferPair {
        const readTex = this.textures[this.readIdx] ?? null;
        const writeFbo = this.fbos[1 - this.readIdx] ?? null;
        return { readTex, writeFbo };
    }

    /** Swap read/write roles (call after finishing a frame). */
    swap(): void {
        this.readIdx = 1 - this.readIdx;
    }

    /** Zero both attachments (accumulation reset). */
    clear(): void {
        const gl = this.gl;
        const oldFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        const oldCC = gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array;

        gl.colorMask(true, true, true, true);

        for (const fbo of this.fbos) {
            if (!fbo) continue;
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }

        // restore previous bindings/state
        gl.clearColor(oldCC[0], oldCC[1], oldCC[2], oldCC[3]);
        gl.bindFramebuffer(gl.FRAMEBUFFER, oldFbo);
    }

    /** Free all GL resources. Safe to call multiple times. */
    dispose(): void {
        this.destroyResources();
        this.width = 0;
        this.height = 0;
    }

    // ---------- internals ----------

    private createColorTexture(w: number, h: number, fmt: PoolFormatInfo): WebGLTexture {
        const gl = this.gl;
        const tex = gl.createTexture();
        if (!tex) throw new Error("FramebufferPool: createTexture failed");
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, fmt.filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, fmt.filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            fmt.internalFormat,
            w,
            h,
            0,
            fmt.format,
            fmt.type,
            null
        );
        gl.bindTexture(gl.TEXTURE_2D, null);
        return tex;
    }

    private createFramebuffer(colorTex: WebGLTexture | null): WebGLFramebuffer {
        const gl = this.gl;
        const fbo = gl.createFramebuffer();
        if (!fbo) throw new Error("FramebufferPool: createFramebuffer failed");
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return fbo;
    }

    private destroyResources(): void {
        const gl = this.gl;
        for (const fbo of this.fbos) {
            if (fbo) gl.deleteFramebuffer(fbo);
        }
        for (const t of this.textures) {
            if (t) gl.deleteTexture(t);
        }
        this.fbos = [null, null];
        this.textures = [null, null];
    }
}
