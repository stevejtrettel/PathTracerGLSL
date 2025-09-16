import { describe, it, expect, vi, beforeEach } from "vitest";
import ResourceBinder from "../../../../src/engine/bindings/resource-binder";
import TextureUnitPool from "../../../../src/engine/bindings/texture-unit-pool";

// Minimal GL stub
function makeGL() {
    return {
        TEXTURE0: 0x84C0,
        TEXTURE_2D: 0x0DE1,
        activeTexture: vi.fn(),
        bindTexture: vi.fn(),
    } as unknown as WebGL2RenderingContext;
}

// UniformBinder shim
function makeBinder() {
    const calls: Array<{ logical: string; value: number; kind?: "int" }> = [];
    return {
        setMany(items: Array<{ logical: string; value: number; kind?: "int" }>) {
            calls.push(...items);
            return { bound: items.length, skipped: [] as string[] };
        },
        _calls: calls,
    };
}

describe("ResourceBinder", () => {
    let gl: WebGL2RenderingContext;

    beforeEach(() => {
        gl = makeGL();
    });

    it("binds known sampler (including null for unbind) and sets sampler unit uniform", () => {
        const manifest = { samplers: [{ logical: "colorTex", type: "sampler2D" }] };
        const pool = new TextureUnitPool({ size: 2, baseUnit: 0 });
        const binder = makeBinder();

        const rb = new ResourceBinder(gl, pool, binder as any, manifest);

        const res = rb.bind({
            colorTex: { texture: null, target: (gl as any).TEXTURE_2D, pin: true },
        });

        expect(res.attempted).toBe(1);
        expect(res.bound).toBe(1);
        expect(res.errors).toEqual([]);
        expect(res.skipped).toEqual([]);

        // GL calls made with correct unit (0) and null texture allowed
        expect((gl as any).activeTexture).toHaveBeenCalledWith((gl as any).TEXTURE0 + 0);
        expect((gl as any).bindTexture).toHaveBeenCalledWith((gl as any).TEXTURE_2D, null);

        // UniformBinder received an int for the unit
        const calls = (binder as any)._calls as Array<{ logical: string; value: number; kind?: "int" }>;
        expect(calls).toHaveLength(1);
        expect(calls[0]).toEqual({ logical: "colorTex", value: 0, kind: "int" });
    });

    it("skips unknown logical sampler names", () => {
        const manifest = { samplers: [{ logical: "known", type: "sampler2D" }] };
        const pool = new TextureUnitPool({ size: 1, baseUnit: 0 });
        const binder = makeBinder();
        const rb = new ResourceBinder(gl, pool, binder as any, manifest);

        const res = rb.bind({
            known: { texture: null, target: (gl as any).TEXTURE_2D },
            unknown: { texture: null, target: (gl as any).TEXTURE_2D },
        });

        expect(res.attempted).toBe(1);      // only "known" was attempted
        expect(res.bound).toBe(1);
        expect(res.skipped).toContain("unknown");
        expect(res.errors).toEqual([]);
    });

    it("reports pool errors (e.g., all units pinned) without crashing", () => {
        const manifest = {
            samplers: [{ logical: "a", type: "sampler2D" }, { logical: "b", type: "sampler2D" }],
        };
        const pool = new TextureUnitPool({ size: 1, baseUnit: 0 });
        const binder = makeBinder();
        const rb = new ResourceBinder(gl, pool, binder as any, manifest);

        // First bind pins unit 0 for "a"
        const r1 = rb.bind({ a: { texture: null, target: (gl as any).TEXTURE_2D, pin: true } });
        expect(r1.bound).toBe(1);

        // Second bind attempts "b" with no free unpinned units → should report error
        const r2 = rb.bind({ b: { texture: null, target: (gl as any).TEXTURE_2D } });
        expect(r2.bound).toBe(0);
        expect(r2.attempted).toBe(0); // setMany not called due to acquire failure
        expect(r2.errors.length).toBe(1);
        expect(String(r2.errors[0])).toMatch(/no available texture units|all pinned/i);
    });

    it("release() frees a mapping and reset() frees all mappings it touched", () => {
        const manifest = { samplers: [{ logical: "x", type: "sampler2D" }, { logical: "y", type: "sampler2D" }] };
        const pool = new TextureUnitPool({ size: 2, baseUnit: 0 });
        const binder = makeBinder();
        const rb = new ResourceBinder(gl, pool, binder as any, manifest);

        rb.bind({
            x: { texture: null, target: (gl as any).TEXTURE_2D },
            y: { texture: null, target: (gl as any).TEXTURE_2D },
        });

        expect(pool.count).toBe(2);

        rb.release("x");
        expect(pool.unitOf("x")).toBeUndefined();
        expect(pool.count).toBe(1);

        rb.reset();
        expect(pool.count).toBe(0);
    });

    it("pin/unpin toggles eviction protection on existing mappings", () => {
        const manifest = { samplers: [{ logical: "x", type: "sampler2D" }] };
        const pool = new TextureUnitPool({ size: 1, baseUnit: 0 });
        const binder = makeBinder();
        const rb = new ResourceBinder(gl, pool, binder as any, manifest);

        rb.bind({ x: { texture: null, target: (gl as any).TEXTURE_2D } });
        expect(pool.isPinned("x")).toBe(false);

        rb.pin("x", true);
        expect(pool.isPinned("x")).toBe(true);

        rb.pin("x", false);
        expect(pool.isPinned("x")).toBe(false);
    });
});
