/**
 * framebuffer-pool.ts — v1.1 (cached HDR probe + state-safe clear)
 * ------------------------------------------------------------
 * Ping-pong HDR film with safe state restoration during clear().
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
    internalFormat: number; // e.g., gl.RGBA16F or gl.RGBA8
    format: number;         // gl.RGBA
    type: number;           // gl.HALF_FLOAT or gl.UNSIGNED_BYTE
    filter: number;         // gl.NEAREST or gl.LINEAR
    hdr: boolean;
}

export default class FramebufferPool {
    private gl: WebGL2RenderingContext;

    private width = 0;
    private height = 0;

    // ping-pong state
    private readIdx = 0;

    private textures: (WebGLTexture | null)[] = [null, null];
    private fbos: (WebGLFramebuffer | null)[] = [null, null];

    private _fmt!: PoolFormatInfo;

    // cache the HDR renderable support probe
    private _hdrRenderable: boolean | null = null;

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
    }

    getSize(): { width: number; height: number } {
        return { width: this.width, height: this.height };
    }

    get formatInfo(): PoolFormatInfo {
        if (!this._fmt) {
            const gl = this.gl;
            return {
                internalFormat: (gl as any).RGBA16F ?? 0x881a,
                format: gl.RGBA,
                type: (gl as any).HALF_FLOAT ?? 0x140B,
                filter: gl.NEAREST,
                hdr: true,
            };
        }
        return this._fmt;
    }

    ensureSize(width: number, height: number, opts: FramebufferPoolOptions = {}): void {
        if (width <= 0 || height <= 0) return;

        const gl = this.gl;
        const wantLinear = !!opts.linearFiltering;
        const wantRGBA8 = !!opts.forceRGBA8;

        if (this._hdrRenderable === null) {
            // WebGL2: float color attachments require EXT_color_buffer_float
            this._hdrRenderable = !!gl.getExtension("EXT_color_buffer_float");
        }
        const useHDR = !wantRGBA8 && this._hdrRenderable;

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

        if (!sizeChanged && !fmtChanged && this.textures[0] && this.textures[1]) return;

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

    pair(): FramebufferPair {
        const readTex = this.textures[this.readIdx] ?? null;
        const writeFbo = this.fbos[1 - this.readIdx] ?? null;
        return { readTex, writeFbo };
    }

    swap(): void {
        this.readIdx = 1 - this.readIdx;
    }

    /** Zero both attachments (accumulation reset) with full state restore. */
    clear(): void {
        const gl = this.gl;

        // Snapshot minimal state we actually touch
        let prevFbo: WebGLFramebuffer | null = null;
        try { prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null; } catch {}

        // COLOR_CLEAR_VALUE → [r,g,b,a]; default to [0,0,0,0] if absent
        let prevClear: [number, number, number, number] = [0, 0, 0, 0];
        try {
            const v = gl.getParameter(gl.COLOR_CLEAR_VALUE) as any;
            if (v && (Array.isArray(v) || ArrayBuffer.isView(v))) {
                prevClear = [
                    Number(v[0] ?? 0),
                    Number(v[1] ?? 0),
                    Number(v[2] ?? 0),
                    Number(v[3] ?? 0),
                ];
            }
        } catch {}

        // COLOR_WRITEMASK → [r,g,b,a]; default to [true,true,true,true] if absent
        let prevMask: [boolean, boolean, boolean, boolean] = [true, true, true, true];
        try {
            const v = gl.getParameter(gl.COLOR_WRITEMASK) as any;
            if (v && (Array.isArray(v) || ArrayBuffer.isView(v))) {
                prevMask = [!!v[0], !!v[1], !!v[2], !!v[3]];
            }
        } catch {}

        // SCISSOR_TEST state; some mocks lack isEnabled → use getParameter fallback
        let scissorWasEnabled = false;
        try {
            scissorWasEnabled = typeof (gl as any).isEnabled === "function"
                ? (gl as any).isEnabled(gl.SCISSOR_TEST)
                : !!gl.getParameter(gl.SCISSOR_TEST);
        } catch { scissorWasEnabled = false; }

        // Make clears affect the full target (viewport is irrelevant; scissor controls region)
        if (scissorWasEnabled && typeof (gl as any).disable === "function") gl.disable(gl.SCISSOR_TEST);
        if (typeof (gl as any).colorMask === "function") gl.colorMask(true, true, true, true);

        for (const fbo of this.fbos) {
            if (!fbo) continue;
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }

        // Restore previous state (guard each call for mock compatibility)
        if (typeof gl.clearColor === "function") {
            gl.clearColor(prevClear[0], prevClear[1], prevClear[2], prevClear[3]);
        }
        if (typeof (gl as any).colorMask === "function") {
            gl.colorMask(prevMask[0], prevMask[1], prevMask[2], prevMask[3]);
        }
        if (scissorWasEnabled && typeof (gl as any).enable === "function") {
            gl.enable(gl.SCISSOR_TEST);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
    }



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
        for (const fbo of this.fbos) if (fbo) gl.deleteFramebuffer(fbo);
        for (const t of this.textures) if (t) gl.deleteTexture(t);
        this.fbos = [null, null];
        this.textures = [null, null];
    }
}
