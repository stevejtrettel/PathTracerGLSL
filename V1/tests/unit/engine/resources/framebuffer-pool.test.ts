import { describe, it, expect } from "vitest";
import FramebufferPool from "../../../../src/engine/resources/framebuffer-pool";

// Minimal mock WebGL2RenderingContext with enough API for our pool.
// We only implement what the pool calls; everything else is a no-op or constant.
class MockGL implements Partial<WebGL2RenderingContext> {
    // --- constants (subset) ---
    readonly FRAMEBUFFER = 0x8d40;
    readonly FRAMEBUFFER_COMPLETE = 0x8cd5;
    readonly FRAMEBUFFER_BINDING = 0x8ca6;
    readonly COLOR_ATTACHMENT0 = 0x8ce0;
    readonly COLOR_BUFFER_BIT = 0x4000;
    readonly RGBA = 0x1908;
    readonly RGBA8 = 0x8058;
    readonly RGBA16F = 0x881a; // not standard on interface, but we emulate
    readonly HALF_FLOAT = 0x140b as any; // emulate presence for tests
    readonly UNSIGNED_BYTE = 0x1401;
    readonly NEAREST = 0x2600;
    readonly LINEAR = 0x2601;
    readonly TEXTURE_2D = 0x0de1;
    readonly TEXTURE_MIN_FILTER = 0x2801;
    readonly TEXTURE_MAG_FILTER = 0x2800;
    readonly TEXTURE_WRAP_S = 0x2802;
    readonly TEXTURE_WRAP_T = 0x2803;
    readonly CLAMP_TO_EDGE = 0x812f;
    readonly COLOR_CLEAR_VALUE = 0x0c22;

    // --- state trackers ---
    textures: WebGLTexture[] = [];
    fbos: WebGLFramebuffer[] = [];
    boundFbo: WebGLFramebuffer | null = null;
    clearCount = 0;
    extFloat = true; // toggle in tests to simulate extension presence
    clearColorVal: [number, number, number, number] = [0, 0, 0, 0];

    // --- mock objects ---
    createTexture(): WebGLTexture | null {
        const t = {} as WebGLTexture;
        this.textures.push(t);
        return t;
    }
    deleteTexture(tex: WebGLTexture): void {
        this.textures = this.textures.filter((x) => x !== tex);
    }
    bindTexture(_target: number, _tex: WebGLTexture | null): void {}

    texParameteri(_target: number, _pname: number, _param: number): void {}

    texImage2D(
        _target: number,
        _level: number,
        _internalFormat: number,
        _w: number,
        _h: number,
        _border: number,
        _format: number,
        _type: number,
        _pixels: ArrayBufferView | null
    ): void {}

    createFramebuffer(): WebGLFramebuffer | null {
        const f = {} as WebGLFramebuffer;
        this.fbos.push(f);
        return f;
    }
    deleteFramebuffer(fbo: WebGLFramebuffer): void {
        this.fbos = this.fbos.filter((x) => x !== fbo);
    }
    bindFramebuffer(_target: number, fbo: WebGLFramebuffer | null): void {
        this.boundFbo = fbo;
    }
    framebufferTexture2D(
        _target: number,
        _attachment: number,
        _textarget: number,
        _texture: WebGLTexture | null,
        _level: number
    ): void {}

    checkFramebufferStatus(_target: number): number {
        return this.FRAMEBUFFER_COMPLETE;
    }

    clearColor(r: number, g: number, b: number, a: number): void {
        this.clearColorVal = [r, g, b, a];
    }
    clear(mask: number): void {
        if (mask & this.COLOR_BUFFER_BIT) this.clearCount++;
    }

    getParameter(pname: number): any {
        if (pname === this.FRAMEBUFFER_BINDING) return this.boundFbo;
        if (pname === this.COLOR_CLEAR_VALUE) return new Float32Array(this.clearColorVal);
        return null;
    }

    colorMask(_r: boolean, _g: boolean, _b: boolean, _a: boolean): void {}

    getExtension(name: string): object | null {
        if (name === "EXT_color_buffer_float") return this.extFloat ? {} : null;
        return null;
    }
}

describe("FramebufferPool", () => {
    it("allocates two textures and fbos; returns pair and swaps", () => {
        const gl = new MockGL() as unknown as WebGL2RenderingContext;
        const pool = new FramebufferPool(gl);

        pool.ensureSize(128, 64);
        const a = pool.pair();
        expect(a.readTex).not.toBeNull();
        expect(a.writeFbo).not.toBeNull();

        pool.swap();
        const b = pool.pair();
        // swapping twice should change which texture is the read side
        expect(b.readTex).not.toBe(a.readTex);
        expect(b.writeFbo).not.toBe(a.writeFbo);

        pool.dispose();
        // after dispose, internal arrays are cleared (not directly accessible)
        // we can at least ensure the mock deleted handles:
        expect((gl as any).textures.length).toBe(0);
        expect((gl as any).fbos.length).toBe(0);
    });

    it("reallocates on size change and clears both attachments", () => {
        const gl = new MockGL() as unknown as WebGL2RenderingContext;
        const pool = new FramebufferPool(gl);

        pool.ensureSize(100, 50);
        const firstTexs = (gl as any).textures.slice();
        pool.clear();
        expect((gl as any).clearCount).toBe(2); // both FBOs cleared

        pool.ensureSize(256, 256); // triggers reallocation
        const secondTexs = (gl as any).textures.slice();
        // textures were recreated (ids differ)
        expect(firstTexs[0]).not.toBe(secondTexs[0]);

        pool.dispose();
    });

    it("falls back to RGBA8 when float color buffer is not supported", () => {
        const glm = new MockGL();
        glm.extFloat = false; // simulate missing EXT_color_buffer_float
        const gl = glm as unknown as WebGL2RenderingContext;

        const pool = new FramebufferPool(gl);
        pool.ensureSize(64, 64);

        const fmt = pool.formatInfo;
        expect(fmt.hdr).toBe(false);
        expect(fmt.internalFormat).toBe(glm.RGBA8);
        expect(fmt.type).toBe(glm.UNSIGNED_BYTE);
    });

    it("supports forcing RGBA8 for tests", () => {
        const gl = new MockGL() as unknown as WebGL2RenderingContext;
        const pool = new FramebufferPool(gl);
        pool.ensureSize(64, 64, { forceRGBA8: true });

        const fmt = pool.formatInfo;
        expect(fmt.hdr).toBe(false);
    });
});
