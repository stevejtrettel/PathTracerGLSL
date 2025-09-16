import { describe, it, expect, vi } from "vitest";
import ResourceBinder, { type UniformBinderLike } from "../../../../src/engine/bindings/resource-binder";
import TextureUnitPool from "../../../../src/engine/bindings/texture-unit-pool";

function makeGL() {
    const gl: Partial<WebGL2RenderingContext> = {
        TEXTURE0: 33984,
        TEXTURE_2D: 3553,

        activeTexture: vi.fn(),
        bindTexture: vi.fn(),
    };
    return gl as unknown as WebGL2RenderingContext;
}

function makeManifest() {
    return {
        // ResourceBinder only needs .samplers to know the allowed logicals
        samplers: [
            { logical: "historyColor", type: "sampler2D", namespaced: "mX_historyColor" },
            { logical: "noiseTex",     type: "sampler2D", namespaced: "mY_noiseTex" },
        ],
    };
}

describe("ResourceBinder + TextureUnitPool + UniformBinder (integration)", () => {
    it("binds known sampler, calls GL, and passes the same unit to UniformBinder.setMany", () => {
        const gl = makeGL();
        const pool = new TextureUnitPool({ size: 4, baseUnit: 0 });

        const setMany = vi.fn((items: Array<{ logical: string; value: number; kind?: "int" }>) => {
            return { bound: items.length, skipped: [] as string[] };
        });
        const binder: UniformBinderLike = { setMany } as any;

        const manifest = makeManifest();
        const rb = new ResourceBinder(gl, pool, binder, manifest);

        const texA = {} as WebGLTexture;
        const res = rb.bind({
            historyColor: { texture: texA, target: gl.TEXTURE_2D },
            notInManifest: { texture: {} as WebGLTexture, target: gl.TEXTURE_2D },
        });

        // attempted should only count known logicals (historyColor)
        expect(res.attempted).toBe(1);
        expect(res.bound).toBe(1);
        expect(res.skipped).toContain("notInManifest");
        expect(res.errors).toEqual([]);

        // GL calls made
        expect(gl.activeTexture).toHaveBeenCalledTimes(1);
        expect(gl.bindTexture).toHaveBeenCalledTimes(1);

        // The unit used in activeTexture is TEXTURE0 + unit
        const activeArg = (gl.activeTexture as any).mock.calls[0][0] as number;
        const unitFromGL = activeArg - gl.TEXTURE0;

        // Binder got the same unit value for the same logical name
        const items = (setMany as any).mock.calls[0][0] as Array<{ logical: string; value: number; kind?: "int" }>;
        expect(items.length).toBe(1);
        expect(items[0].logical).toBe("historyColor");
        expect(items[0].kind).toBe("int");
        expect(items[0].value).toBe(unitFromGL);

        // Pool should report the same unit for the logical
        const unitFromPool = pool.unitOf("historyColor");
        expect(unitFromPool).toBe(unitFromGL);
    });

    it("allows explicit unbind (null texture) and still sets the sampler uniform to the allocated unit", () => {
        const gl = makeGL();
        const pool = new TextureUnitPool({ size: 2, baseUnit: 0 });

        const setMany = vi.fn((items: Array<{ logical: string; value: number; kind?: "int" }>) => {
            return { bound: items.length, skipped: [] as string[] };
        });
        const binder: UniformBinderLike = { setMany } as any;
        const rb = new ResourceBinder(gl, pool, binder, makeManifest());

        const res = rb.bind({
            noiseTex: { texture: null, target: gl.TEXTURE_2D }, // explicit unbind
        });

        expect(res.attempted).toBe(1);
        expect(res.bound).toBe(1);
        expect(res.errors).toEqual([]);

        // GL.bindTexture should have been called with target + null
        const btArgs = (gl.bindTexture as any).mock.calls[0];
        expect(btArgs[0]).toBe(gl.TEXTURE_2D);
        expect(btArgs[1]).toBeNull();

        // Binder received an int (unit index)
        const items = (setMany as any).mock.calls[0][0] as Array<{ logical: string; value: number; kind?: "int" }>;
        expect(items[0].logical).toBe("noiseTex");
        expect(typeof items[0].value).toBe("number");
        expect(items[0].kind).toBe("int");
    });

    it("surfaces pool exhaustion errors (all units pinned)", () => {
        const gl = makeGL();
        const pool = new TextureUnitPool({ size: 1, baseUnit: 0 });

        // Pre-pin the only unit with a different logical name
        pool.acquire("alreadyPinned", { pin: true });

        const setMany = vi.fn(() => ({ bound: 0, skipped: [] as string[] }));
        const binder: UniformBinderLike = { setMany } as any;
        const rb = new ResourceBinder(gl, pool, binder, makeManifest());

        const out = rb.bind({
            historyColor: { texture: {} as WebGLTexture, target: gl.TEXTURE_2D, pin: true },
        });

        expect(out.attempted).toBe(0); // couldn't assign any unit
        expect(out.bound).toBe(0);
        expect(out.errors.length).toBe(1);
        expect(out.errors[0]).toMatch(/no available texture units/i);

        // No GL or binder calls should have been made
        expect(gl.activeTexture).not.toHaveBeenCalled();
        expect(gl.bindTexture).not.toHaveBeenCalled();
        expect(setMany).not.toHaveBeenCalled();
    });

    it("marks attached mappings and can release/reset cleanly", () => {
        const gl = makeGL();
        const pool = new TextureUnitPool({ size: 2, baseUnit: 0 });
        const setMany = vi.fn((items: any[]) => ({ bound: items.length, skipped: [] as string[] }));
        const binder: UniformBinderLike = { setMany } as any;
        const rb = new ResourceBinder(gl, pool, binder, makeManifest());

        // First bind
        rb.bind({ historyColor: { texture: {} as WebGLTexture, target: gl.TEXTURE_2D } });
        const unit = pool.unitOf("historyColor");
        expect(typeof unit).toBe("number");

        // Release via ResourceBinder API
        rb.release("historyColor");
        expect(pool.unitOf("historyColor")).toBeUndefined();

        // Rebind should allocate again (may reuse same unit or a different one)
        rb.bind({ historyColor: { texture: {} as WebGLTexture, target: gl.TEXTURE_2D } });
        expect(pool.unitOf("historyColor")).toBeDefined();

        // Reset should release all mappings it touched
        rb.reset();
        expect(pool.unitOf("historyColor")).toBeUndefined();
    });
});
