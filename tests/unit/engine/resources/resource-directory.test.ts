import { describe, it, expect, beforeEach } from "vitest";
import ResourceDirectory from "../../../../src/engine/resources/resource-directory";

describe("ResourceDirectory", () => {
    let dir: ResourceDirectory;
    const TEX = {} as WebGLTexture;
    const TEX2 = {} as WebGLTexture;

    const GL_TEXTURE_2D = 0x0DE1;        // typical value
    const GL_TEXTURE_CUBE_MAP = 0x8513;  // typical value

    beforeEach(() => {
        dir = new ResourceDirectory();
    });

    it("add/remove and snapshot contain expected bindings", () => {
        dir.set("albedo", { texture: TEX, target: GL_TEXTURE_2D });
        dir.set("env", { texture: TEX2, target: GL_TEXTURE_CUBE_MAP, pin: true });

        expect(dir.has("albedo")).toBe(true);
        expect(dir.has("env")).toBe(true);

        const snap1 = dir.snapshot();
        expect(Object.keys(snap1).sort()).toEqual(["albedo", "env"]);
        expect(snap1.albedo.texture).toBe(TEX);
        expect(snap1.albedo.target).toBe(GL_TEXTURE_2D);
        // optional pin omitted when false
        expect("pin" in snap1.albedo).toBe(false);
        // pin preserved when true
        expect(snap1.env.pin).toBe(true);

        // remove one
        dir.remove("albedo");
        expect(dir.has("albedo")).toBe(false);
        const snap2 = dir.snapshot();
        expect(snap2.albedo).toBeUndefined();
        expect(snap2.env.texture).toBe(TEX2);

        // clear all
        dir.clear();
        expect(Object.keys(dir.snapshot())).toEqual([]);
    });

    it("idempotent set on same logical produces stable snapshot", () => {
        dir.set("env", { texture: TEX2, target: GL_TEXTURE_CUBE_MAP, pin: true });
        const s1 = dir.snapshot();
        dir.set("env", { texture: TEX2, target: GL_TEXTURE_CUBE_MAP, pin: true });
        const s2 = dir.snapshot();
        expect(s2).toEqual(s1);

        // changing value updates snapshot
        dir.set("env", { texture: TEX2, target: GL_TEXTURE_CUBE_MAP /* pin omitted (false) */ });
        const s3 = dir.snapshot();
        expect(s3.env.pin).toBeUndefined();
    });

    it("snapshot is immutable and does not affect internal state when mutated externally", () => {
        dir.set("env", { texture: TEX2, target: GL_TEXTURE_CUBE_MAP, pin: true });

        const snapA = dir.snapshot();
        // Attempt to mutate snapshot contents
        // @ts-expect-error: we're deliberately mutating
        snapA.env.pin = false;
        // @ts-expect-error: deliberately adding junk
        (snapA as any).extra = 123;

        const snapB = dir.snapshot();
        expect(snapB.env.pin).toBe(true);
        expect((snapB as any).extra).toBeUndefined();
    });

    it("get() returns a copy (mutating it does not affect the directory)", () => {
        dir.set("env", { texture: TEX2, target: GL_TEXTURE_CUBE_MAP, pin: true });
        const g = dir.get("env")!;
        expect(g.pin).toBe(true);
        g.pin = false; // mutate the copy
        const g2 = dir.get("env")!;
        expect(g2.pin).toBe(true);
    });
});
