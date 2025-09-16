import { describe, it, expect, beforeEach } from "vitest";
import ResourceBinder from "../../../../src/engine/bindings/resource-binder";
import TextureUnitPool from "../../../../src/engine/bindings/texture-unit-pool";
import type { UniformBinderLike } from "../../../../src/engine/execution/render-engine";

// ---- minimal GL mock (only what we call) ----
class MockGL implements Partial<WebGL2RenderingContext> {
    public activations: number[] = [];
    public binds: Array<{ target: number; texture: WebGLTexture | null; unit: number }> = [];
    TEXTURE0 = 33984;        // canonical value; tests depend only on addition
    TEXTURE_2D = 3553;

    activeTexture(tex: number): void {
        this.activations.push(tex);
    }
    bindTexture(target: number, texture: WebGLTexture | null): void {
        // infer last unit from last activation for verification
        const lastTexEnum = this.activations[this.activations.length - 1] ?? this.TEXTURE0;
        const unit = lastTexEnum - this.TEXTURE0;
        this.binds.push({ target, texture, unit });
    }
}

// ---- Uniform binder mock ----
class MockBinder implements UniformBinderLike {
    public calls: Array<{ logical: string; value: number }[]> = [];
    public skip: string[] = [];
    setMany(items: { logical: string; value: number }[]) {
        this.calls.push(items);
        const skipped = items.filter(i => this.skip.includes(i.logical)).map(i => i.logical);
        return { bound: items.length - skipped.length, skipped };
    }
}

// ---- helpers ----
function manifestWithSamplers(names: string[] | { logical: string; type: string }[]) {
    return { samplers: names };
}

describe("ResourceBinder", () => {
    let gl: MockGL;
    let pool: TextureUnitPool;
    let binder: MockBinder;
    const TEX = {} as WebGLTexture;

    beforeEach(() => {
        gl = new MockGL();
        pool = new TextureUnitPool({ baseUnit: 2, size: 3 }); // units 2,3,4
        binder = new MockBinder();
    });

    it("binds known samplers: activates unit, binds texture, and sets sampler uniform", () => {
        const manifest = manifestWithSamplers(["uAlbedo"]);
        const rb = new ResourceBinder(gl as any, pool, binder, manifest);

        const res = rb.bind({
            uAlbedo: { texture: TEX, target: gl.TEXTURE_2D },
        });

        // Unit assignment starts at base (2)
        expect(rb.unitOf("uAlbedo")).toBe(2);

        // GL calls observed
        expect(gl.activations).toEqual([gl.TEXTURE0 + 2]);
        expect(gl.binds[0]).toEqual({ target: gl.TEXTURE_2D, texture: TEX, unit: 2 });

        // Uniform set via binder
        expect(binder.calls.length).toBe(1);
        expect(binder.calls[0][0]).toMatchObject({ logical: "uAlbedo", value: 2 });


        // Stats
        expect(res.attempted).toBe(1);
        expect(res.bound).toBe(1);
        expect(res.skipped).toEqual([]);
        expect(res.errors).toEqual([]);
    });

    it("skips unknown samplers and reports them", () => {
        const rb = new ResourceBinder(gl as any, pool, binder, manifestWithSamplers(["uKnown"]));

        const res = rb.bind({
            uKnown: { texture: TEX, target: gl.TEXTURE_2D },
            uGhost: { texture: TEX, target: gl.TEXTURE_2D },
        });

        // Only one activation/bind (uKnown)
        expect(gl.activations).toEqual([gl.TEXTURE0 + 2]);
        expect(binder.calls[0].map(i => i.logical)).toEqual(["uKnown"]);

        // Stats
        expect(res.attempted).toBe(1);
        expect(res.bound).toBe(1);
        expect(res.skipped).toEqual(["uGhost"]);
        expect(res.errors).toEqual([]);
    });

    it("reuses the same unit for repeated binds of the same logical name", () => {
        const rb = new ResourceBinder(gl as any, pool, binder, manifestWithSamplers(["uEnv"]));

        rb.bind({ uEnv: { texture: TEX, target: gl.TEXTURE_2D } });
        rb.bind({ uEnv: { texture: TEX, target: gl.TEXTURE_2D } });

        expect(rb.unitOf("uEnv")).toBe(2); // stable
        // 2 activations to the same unit
        expect(gl.activations).toEqual([gl.TEXTURE0 + 2, gl.TEXTURE0 + 2]);
    });

    it("evicts LRU when pool is full (unpinned)", () => {
        // pool = units 2,3,4 ; we use 3 logicals then a 4th to evict one
        const rb = new ResourceBinder(gl as any, pool, binder, manifestWithSamplers(["a","b","c","d"]));
        rb.bind({ a: { texture: TEX, target: gl.TEXTURE_2D } }); // unit 2
        rb.bind({ b: { texture: TEX, target: gl.TEXTURE_2D } }); // unit 3
        rb.bind({ c: { texture: TEX, target: gl.TEXTURE_2D } }); // unit 4

        // touch 'a' to make 'b' LRU
        rb.bind({ a: { texture: TEX, target: gl.TEXTURE_2D } });

        // bind 'd' → evict 'b' (from pool policy); 'd' should get unit 3
        rb.bind({ d: { texture: TEX, target: gl.TEXTURE_2D } });
        expect(rb.unitOf("d")).toBe(3);
    });

    it("honors pinning; throws when all pinned and new unit is requested", () => {
        const rb = new ResourceBinder(gl as any, pool, binder, manifestWithSamplers(["x","y"]));
        rb.bind({ x: { texture: TEX, target: gl.TEXTURE_2D, pin: true } }); // unit 2 pinned
        rb.bind({ y: { texture: TEX, target: gl.TEXTURE_2D, pin: true } }); // unit 3 pinned

        // Fill last unit with another pinned name
        rb.bind({ x2: { texture: TEX, target: gl.TEXTURE_2D, pin: true } }); // unknown → skipped (not in manifest)
        const rb2 = new ResourceBinder(gl as any, pool, binder, manifestWithSamplers(["x","y","z","ghost"]));
        // consume remaining unit 4 with 'z' pinned
        const r = rb2.bind({ z: { texture: TEX, target: gl.TEXTURE_2D, pin: true } });
        expect(r.errors).toEqual([]); // ok

        // now all 3 units are pinned; asking for a *new* logical should error
        const r2 = rb2.bind({ ghost: { texture: TEX, target: gl.TEXTURE_2D, pin: true } });
        expect(r2.errors.length).toBe(1);
        expect(r2.errors[0]).toMatch(/all pinned/i);
    });

    it("supports unbinding (null texture) and explicit release()", () => {
        const rb = new ResourceBinder(gl as any, pool, binder, manifestWithSamplers(["uTex"]));
        rb.bind({ uTex: { texture: TEX, target: gl.TEXTURE_2D } });
        expect(rb.unitOf("uTex")).toBe(2);

        // Unbind via null texture (still sets sampler to the unit)
        const res = rb.bind({ uTex: { texture: null, target: gl.TEXTURE_2D } });
        expect(res.attempted).toBe(1);
        expect(gl.binds.at(-1)!.texture).toBeNull();

        // Release mapping and ensure unit becomes free for reuse
        rb.release("uTex");
        expect(rb.unitOf("uTex")).toBeUndefined();
        const rb2 = new ResourceBinder(gl as any, pool, binder, manifestWithSamplers(["other"]));
        const res2 = rb2.bind({ other: { texture: TEX, target: gl.TEXTURE_2D } });
        // should reuse the lowest free unit (2)
        expect(rb2.unitOf("other")).toBe(2);
        expect(res2.bound).toBe(1);
    });

    it("accepts manifest.samplers as strings or objects", () => {
        const m1 = manifestWithSamplers(["uA", "uB"]);
        const m2 = manifestWithSamplers([{ logical: "uA", type: "sampler2D" }, { logical: "uB", type: "sampler2D" }]);

        const rb1 = new ResourceBinder(gl as any, pool, binder, m1);
        const rb2 = new ResourceBinder(gl as any, pool, binder, m2);

        const r1 = rb1.bind({ uA: { texture: TEX, target: gl.TEXTURE_2D } });
        const r2 = rb2.bind({ uB: { texture: TEX, target: gl.TEXTURE_2D } });

        expect(r1.bound).toBe(1);
        expect(r2.bound).toBe(1);
    });
});
