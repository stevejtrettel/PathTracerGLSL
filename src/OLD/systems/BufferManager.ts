import type { Lifetime, TargetFormat } from "../core/types";

/** Describe a 2D GPU buffer/texture the engine manages. */
export interface BufferDesc {
    format: TargetFormat;
    size: { w: number; h: number };
    lifetime: Lifetime;                 // "perFrame" | "history"
    filtering?: "nearest" | "linear";
    clear?: [number, number, number, number]; // RGBA clear value
}

/**
 * BufferManager abstracts named textures & draw targets.
 * - Create named textures (AOVs, history, moments, etc.)
 * - Bind as sampling units and as draw targets (MRT)
 * - Clear by lifetime policy
 * - Cache framebuffers (no per-frame FBO churn)
 * - Resize textures on canvas changes
 * - Ping-pong pairs are built-in (Option C)
 *
 * WebGL2-oriented; adapt for WebGPU later.
 */
export class BufferManager {
    private gl: WebGL2RenderingContext;

    // textures & metadata
    private tex = new Map<string, WebGLTexture>();
    private desc = new Map<string, BufferDesc>();
    private gen  = new Map<string, number>(); // increments whenever a texture object changes

    // FBO cache: key = "name0,name1,..."
    private fboCache = new Map<string, WebGLFramebuffer>();
    private fboCacheAttachGen = new Map<string, number[]>(); // per-attachment gen snapshot

    // one reusable FBO for clears and adhoc ops
    private scratchFBO: WebGLFramebuffer | null = null;

    // restore previous draw FBO on unbind
    private previousFBO: WebGLFramebuffer | null = null;

    // ping-pong pairs: base -> ["baseA","baseB"] with flip index
    private pairs = new Map<string, { names: [string, string]; flip: 0 | 1 }>();

    // caps
    private maxColorAttachments: number;
    private hasEXTColorBufferFloat: boolean;

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;

        this.maxColorAttachments = gl.getParameter(gl.MAX_COLOR_ATTACHMENTS) as number;
        // Required for rendering to RGBA16F in WebGL2
        this.hasEXTColorBufferFloat = !!gl.getExtension("EXT_color_buffer_float");
        if (!this.hasEXTColorBufferFloat) {
            // You can still create float textures for sampling; rendering to them may fail.
            console.warn("[BufferManager] EXT_color_buffer_float not available: rendering to *16F/*32F may be unsupported.");
        }
    }

    /** Create (or recreate) a texture with the given name/desc. */
    create(name: string, d: BufferDesc): WebGLTexture {
        const { gl } = this;

        // delete existing object if present
        const existing = this.tex.get(name);
        if (existing) gl.deleteTexture(existing);

        const t = gl.createTexture();
        if (!t) throw new Error(`BufferManager.create: failed to create texture '${name}'`);
        gl.bindTexture(gl.TEXTURE_2D, t);

        const { w, h } = d.size;
        const filtering = d.filtering ?? "nearest";
        const fmt = this.toGLFormat(d.format);


        // AFTER (pick one)
       // const data: ArrayBufferView | null = null;
       // gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internalFormat, w, h, 0, fmt.format, fmt.type, data);
        //ALT
         gl.texStorage2D(gl.TEXTURE_2D, 1, fmt.internalFormat, w, h);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filtering === "linear" ? gl.LINEAR : gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filtering === "linear" ? gl.LINEAR : gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        this.tex.set(name, t);
        this.desc.set(name, { ...d });
        this.bumpGen(name);
        return t;
    }

    /** Replace a name with an externally created texture (reservoirs, imported AOVs, etc.). */
    alias(name: string, tex: WebGLTexture, d: BufferDesc): void {
        const { gl } = this;
        const existing = this.tex.get(name);
        if (existing) gl.deleteTexture(existing);
        this.tex.set(name, tex);
        this.desc.set(name, { ...d });
        this.bumpGen(name);
    }

    /** Resize a named texture to (w,h) if different. Recreates the texture. */
    resize(name: string, w: number, h: number): void {
        const d = this.desc.get(name);
        if (!d) throw new Error(`BufferManager.resize: unknown buffer '${name}'`);
        if (d.size.w === w && d.size.h === h) return;
        this.create(name, { ...d, size: { w, h } });
        // No need to invalidate FBO cache: we always re-attach current textures on bind.
    }

    /** Resize all textures to (w,h) that are sized like the canvas. */
    resizeAll(w: number, h: number): void {
        for (const [name, d] of this.desc.entries()) {
            if (d.size.w !== w || d.size.h !== h) {
                this.create(name, { ...d, size: { w, h } });
            }
        }
    }

    /** Swap two named textures (ping-pong). */
    swap(a: string, b: string): void {
        const ta = this.tex.get(a), tb = this.tex.get(b);
        if (!ta || !tb) throw new Error(`BufferManager.swap: missing '${a}' or '${b}'`);
        this.tex.set(a, tb);
        this.tex.set(b, ta);
        const da = this.desc.get(a), db = this.desc.get(b);
        if (da && db) { this.desc.set(a, db); this.desc.set(b, da); }
        // gens are associated with names; swapping textures does not change gens
    }

    /** Bind a named texture to a texture unit for sampling. */
    bindAsTexture(name: string, unit: number): void {
        const t = this.tex.get(name);
        if (!t) throw new Error(`BufferManager.bindAsTexture: unknown texture '${name}'`);
        const { gl } = this;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t);
    }

    /**
     * Bind an FBO with provided target names as color attachments (MRT).
     * Caches the FBO object and always re-attaches current textures.
     * Call `unbindDrawTarget()` after drawing to restore previous binding.
     */
    bindAsDrawTarget(names: string[]): void {
        const { gl } = this;

        if (names.length === 0) {
            throw new Error("BufferManager.bindAsDrawTarget: at least one target required");
        }
        if (names.length > this.maxColorAttachments) {
            throw new Error(`BufferManager.bindAsDrawTarget: too many targets (${names.length} > ${this.maxColorAttachments})`);
        }

        // Cache key depends on names & order (attachment indices)
        const key = names.join(",");

        // Create or reuse FBO
        let fbo = this.fboCache.get(key);
        if (!fbo) {
            fbo = gl.createFramebuffer()!;
            if (!fbo) throw new Error("BufferManager: failed to create framebuffer");
            this.fboCache.set(key, fbo);
            this.fboCacheAttachGen.set(key, new Array(names.length).fill(-1));
        }

        // Save previous binding and bind our FBO
        this.previousFBO = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

        // (Re)attach textures each bind to track resizes/aliases automatically
        const gens = this.fboCacheAttachGen.get(key)!;
        const attachments: number[] = [];

        for (let i = 0; i < names.length; i++) {
            const name = names[i];
            const t = this.tex.get(name);
            if (!t) throw new Error(`BufferManager.bindAsDrawTarget: unknown MRT target '${name}'`);

            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
            attachments.push(gl.COLOR_ATTACHMENT0 + i);

            // Refresh attach gen snapshot
            gens[i] = this.gen.get(name) ?? 0;
        }

        // Set draw buffers
        // @ts-ignore WebGL2 drawBuffers is core
        gl.drawBuffers(attachments);

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error(`BufferManager: FBO incomplete (status 0x${status.toString(16)})`);
        }
    }

    /** Restore previously bound draw framebuffer. */
    unbindDrawTarget(): void {
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.previousFBO);
        this.previousFBO = null;
    }

    /** Clear all textures whose desc.lifetime matches, reusing one scratch FBO. */
    clearByLifetime(l: Lifetime): void {
        const { gl } = this;

        if (!this.scratchFBO) {
            this.scratchFBO = gl.createFramebuffer();
            if (!this.scratchFBO) throw new Error("BufferManager: scratch FBO create failed");
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.scratchFBO);

        for (const [name, d] of this.desc.entries()) {
            if (d.lifetime !== l) continue;

            const t = this.tex.get(name)!;
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
            // @ts-ignore
            gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

            const clr = d.clear ?? [0, 0, 0, 0];
            gl.clearColor(clr[0], clr[1], clr[2], clr[3]);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // ---------------- Ping-pong pairs (Option C) ----------------

    /** Create a ping-pong pair: "<base>A" and "<base>B". */
    createPair(base: string, d: BufferDesc): [string, string] {
        const a = `${base}A`;
        const b = `${base}B`;
        this.create(a, d);
        this.create(b, d);
        this.pairs.set(base, { names: [a, b], flip: 0 });
        return [a, b];
    }

    /** Current read name for a pair. */
    pairRead(base: string): string {
        const p = this.pairs.get(base);
        if (!p) throw new Error(`BufferManager.pairRead: unknown pair '${base}'`);
        return p.names[p.flip];
    }

    /** Current write name for a pair. */
    pairWrite(base: string): string {
        const p = this.pairs.get(base);
        if (!p) throw new Error(`BufferManager.pairWrite: unknown pair '${base}'`);
        return p.names[p.flip ^ 1];
    }

    /** Swap read/write for a pair. */
    swapPair(base: string): void {
        const p = this.pairs.get(base);
        if (!p) throw new Error(`BufferManager.swapPair: unknown pair '${base}'`);
        p.flip = (p.flip ^ 1) as 0 | 1;
    }

    /** Convenience: bind pair READ as texture unit. */
    bindPairReadAsTexture(base: string, unit: number): void {
        this.bindAsTexture(this.pairRead(base), unit);
    }

    /** Convenience: bind pair WRITE as the sole draw target. */
    bindPairWriteAsDrawTarget(base: string): void {
        this.bindAsDrawTarget([this.pairWrite(base)]);
    }

    /** Resize both textures in a pair. */
    resizePair(base: string, w: number, h: number): void {
        const p = this.pairs.get(base);
        if (!p) throw new Error(`BufferManager.resizePair: unknown pair '${base}'`);
        const [a, b] = p.names;
        this.resize(a, w, h);
        this.resize(b, w, h);
    }

    // ---------------- Debug / utilities ----------------

    /** For debugging: list known texture names. */
    list(): string[] { return Array.from(this.tex.keys()); }

    /** Get a copy of the BufferDesc. */
    getDesc(name: string): BufferDesc | undefined {
        const d = this.desc.get(name);
        return d ? { ...d, size: { ...d.size } } : undefined;
    }

    /** Grab the raw texture (rarely needed). */
    getTexture(name: string): WebGLTexture | undefined { return this.tex.get(name); }

    /** Delete everything (textures, FBOs). Call on context loss/teardown. */
    dispose(): void {
        const { gl } = this;
        for (const t of this.tex.values()) gl.deleteTexture(t);
        for (const f of this.fboCache.values()) gl.deleteFramebuffer(f);
        if (this.scratchFBO) gl.deleteFramebuffer(this.scratchFBO);
        this.tex.clear();
        this.desc.clear();
        this.gen.clear();
        this.fboCache.clear();
        this.fboCacheAttachGen.clear();
        this.scratchFBO = null;
        this.previousFBO = null;
        this.pairs.clear();
    }

    // ---------------- internals ----------------

    /** Internal: bump generation token for a name. */
    private bumpGen(name: string): void {
        const g = (this.gen.get(name) ?? 0) + 1;
        this.gen.set(name, g);
    }

    /** Map our TargetFormat to WebGL enums. */
    private toGLFormat(fmt: TargetFormat): { internalFormat: number; format: number; type: number } {
        const gl = this.gl;
        switch (fmt) {
            case "rgba16f": return { internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
            case "rg16f":   return { internalFormat: gl.RG16F,   format: gl.RG,   type: gl.HALF_FLOAT };
            case "r16f":    return { internalFormat: gl.R16F,    format: gl.RED,  type: gl.HALF_FLOAT };
            case "rgba8":   return { internalFormat: gl.RGBA8,   format: gl.RGBA, type: gl.UNSIGNED_BYTE };
            // r32f is usually NOT color-renderable in WebGL2; keep mapping for sampling-only usage.
            case "r32f": {
                const i = (gl as any).R32F ?? gl.RGBA32F;  // TS safety
                const f = (gl as any).RED  ?? gl.RGBA;
                const t = gl.FLOAT;
                return { internalFormat: i, format: f, type: t };
            }
            default: throw new Error(`BufferManager: unsupported format '${fmt}'`);
        }
    }
}
