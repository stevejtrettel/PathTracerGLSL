import { describe, it, expect, vi, beforeEach } from "vitest";
import RenderPipeline, { ProgramLike, FramebufferPoolLike } from "../../../../src/engine/execution/render-pipeline";
import type { UniformManifest } from "../../../../src/engine/shaders/shader-compiler";



// ---- Minimal GL mock (subset used by pipeline) ----
class MockGL implements Partial<WebGL2RenderingContext> {
    // constants
    readonly FRAMEBUFFER = 0x8d40;
    readonly ARRAY_BUFFER = 0x8892;
    readonly STATIC_DRAW = 0x88e4;
    readonly FLOAT = 0x1406;
    readonly TRIANGLE_STRIP = 0x0005;
    readonly TEXTURE_2D = 0x0de1;
    readonly TEXTURE0 = 0x84c0;

    // internal state trackers
    vaoCreated = 0;
    vboCreated = 0;
    used = false;
    boundFbo: WebGLFramebuffer | null = null;
    viewportSet: [number, number, number, number] | null = null;
    draws = 0;
    activeTexUnit = 0;
    boundTex: WebGLTexture | null = null;

    // spies for uniforms
    set2f: Array<[any, number, number]> = [];
    set1i: Array<[any, number]> = [];
    getUniformLocationCalls: string[] = [];

    // VAO/VBO lifecycle
    createVertexArray(): WebGLVertexArrayObject | null { this.vaoCreated++; return {} as any; }
    deleteVertexArray(_vao: WebGLVertexArrayObject): void {} // <- added
    createBuffer(): WebGLBuffer | null { this.vboCreated++; return {} as any; }
    deleteBuffer(_buf: WebGLBuffer): void {} // <- added

    // binds & data
    bindVertexArray(_vao: WebGLVertexArrayObject | null): void {}
    bindBuffer(_t: number, _b: WebGLBuffer | null): void {}
    bufferData(_t: number, _data: ArrayBufferView, _usage: number): void {}
    enableVertexAttribArray(_loc: number): void {}
    vertexAttribPointer(_loc: number, _size: number, _type: number, _norm: boolean, _stride: number, _offset: number): void {}

    // textures/fbo minimal
    createTexture(): WebGLTexture | null { return {} as any; }
    createFramebuffer(): WebGLFramebuffer | null { return {} as any; }
    bindFramebuffer(_t: number, fbo: WebGLFramebuffer | null): void { this.boundFbo = fbo; }
    activeTexture(t: number): void { this.activeTexUnit = t; }
    bindTexture(_t: number, tex: WebGLTexture | null): void { this.boundTex = tex; }

    // viewport / draw
    viewport(x: number, y: number, w: number, h: number): void { this.viewportSet = [x, y, w, h]; }
    drawArrays(_mode: number, _first: number, _count: number): void { this.draws++; }

    // program + uniforms
    useProgram(_p: WebGLProgram | null): void { this.used = true; }
    uniform2f(loc: any, x: number, y: number): void { this.set2f.push([loc, x, y]); }
    uniform1i(loc: any, v: number): void { this.set1i.push([loc, v]); }
}


// ---- Program mock that records uniform lookups and allows test locations ----
class MockProgram implements ProgramLike {
    constructor(private gl: MockGL, private locs: Record<string, any>) {}
    use(): void { this.gl.useProgram(null as any); }
    getUniformLocation(name: string): WebGLUniformLocation | null {
        this.gl.getUniformLocationCalls.push(name);
        return (this.locs[name] ?? {}) as any;
    }
}



// ---- Pool mock to control ping-pong pairing/swap ----
class MockPool implements FramebufferPoolLike {
    public ensured: Array<[number, number]> = [];
    public swaps = 0;
    private texA: WebGLTexture = {} as any;
    private texB: WebGLTexture = {} as any;
    private fboA: WebGLFramebuffer = {} as any;
    private fboB: WebGLFramebuffer = {} as any;
    private readIsA = true;

    ensureSize(w: number, h: number): void { this.ensured.push([w, h]); }
    pair() {
        const readTex = this.readIsA ? this.texA : this.texB;
        const writeFbo = this.readIsA ? this.fboB : this.fboA;
        return { readTex, writeFbo };
    }
    swap(): void { this.readIsA = !this.readIsA; this.swaps++; }
}

// ---- helpers ----
function manifestWith(logicals: string[]): UniformManifest {
    const entries = logicals.map((L) => ({ logicalName: L, namespacedName: `ns_${L}`, owner: {kind:"X", name:"Y", version:"1"}, type: L === "historyColor" ? "sampler2D" : (L === "sampleCount" ? "int" : undefined)}));
    const byLogical: Record<string, string> = {};
    const byNamespaced: Record<string, string> = {};
    for (const e of entries) { byLogical[e.logicalName] = e.namespacedName; byNamespaced[e.namespacedName] = e.logicalName; }
    return { entries, byLogical, byNamespaced };
}

describe("RenderPipeline", () => {
    let gl: MockGL;

    beforeEach(() => { gl = new MockGL(); });

    it("renders and binds engine uniforms + film uniforms when present", () => {
        const pool = new MockPool();
        const man = manifestWith(["historyColor", "sampleCount"]);
        const prog = new MockProgram(gl, {
            u_resolution: { u: "res" },
            u_frameIndex: { u: "frame" },
            ns_historyColor: { u: "hist" },
            ns_sampleCount: { u: "samps" },
        });

        const pipe = new RenderPipeline(gl as any, prog, pool, man);
        pipe.setFrameIndex(7);
        pipe.setSampleCount(42);
        pipe.render(640, 360);

        // ensured size and drew
        expect(pool.ensured).toEqual([[640, 360]]);
        expect(gl.viewportSet).toEqual([0, 0, 640, 360]);
        expect(gl.draws).toBe(1);
        expect(pool.swaps).toBe(1);

        // engine uniforms set
        expect(gl.getUniformLocationCalls).toContain("u_resolution");
        expect(gl.getUniformLocationCalls).toContain("u_frameIndex");
        expect(gl.set2f.length).toBeGreaterThan(0);
        expect(gl.set1i.find(([_loc, v]) => v === 7)).toBeTruthy();

        // film uniforms bound
        expect(gl.getUniformLocationCalls).toContain("ns_historyColor");
        expect(gl.getUniformLocationCalls).toContain("ns_sampleCount");
        // sampler set to unit 0 and texture bound
        expect(gl.activeTexUnit).toBe(gl.TEXTURE0 + 0);
        expect(gl.boundTex).not.toBeNull();
        // sample count uniform set to 42
        expect(gl.set1i.find(([_loc, v]) => v === 42)).toBeTruthy();

        pipe.dispose();
    });

    it("renders without binding history/sampleCount if manifest lacks them", () => {
        const pool = new MockPool();
        const man = manifestWith([]); // no film-specific uniforms
        const prog = new MockProgram(gl, {
            u_resolution: { u: "res" },
            u_frameIndex: { u: "frame" },
        });

        const pipe = new RenderPipeline(gl as any, prog, pool, man);
        pipe.render(320, 200);

        // drew and swapped
        expect(gl.draws).toBe(1);
        expect(pool.swaps).toBe(1);

        // never looked up film uniforms
        expect(gl.getUniformLocationCalls).not.toContain("ns_historyColor");
        expect(gl.getUniformLocationCalls).not.toContain("ns_sampleCount");

        pipe.dispose();
    });
});
