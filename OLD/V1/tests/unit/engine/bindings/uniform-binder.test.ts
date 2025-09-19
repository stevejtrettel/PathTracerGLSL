


import { describe, it, expect, vi } from "vitest";
import UniformBinder, { type ProgramLike } from "../../../../src/engine/bindings/uniform-binder";
import type { UniformManifest } from "../../../../src/engine/shaders/shader-compiler";

// --- helpers ----------------------------------------------------------------

function makeGL() {
    const gl: Partial<WebGL2RenderingContext> = {
        uniform1f: vi.fn(),
        uniform1i: vi.fn(),
        uniform2f: vi.fn(),
        uniform3f: vi.fn(),
        uniform4f: vi.fn(),
        uniformMatrix3fv: vi.fn(),
        uniformMatrix4fv: vi.fn(),
    };
    return gl as unknown as WebGL2RenderingContext;
}

function makeProgram(overrides?: { nullFor?: Set<string> }) {
    const locs = new Map<string, WebGLUniformLocation | null>();
    const nullFor = overrides?.nullFor ?? new Set<string>();
    const getUniformLocation = vi.fn((name: string) => {
        if (nullFor.has(name)) {
            locs.set(name, null);
            return null;
        }
        if (!locs.has(name)) {
            // any object is fine for tests as a WebGLUniformLocation
            locs.set(name, { __loc: name } as any);
        }
        return locs.get(name)!;
    });
    const program: ProgramLike = { getUniformLocation };
    return { program, getUniformLocation };
}

function makeManifest(): UniformManifest {
    // namespaced tokens are arbitrary but stable within this test
    return {
        entries: [
            { logicalName: "exposure",     namespacedName: "mX_exposure",     type: "float", owner: { kind: "Material", name: "T", version: "1.0.0" } },
            { logicalName: "albedo",       namespacedName: "mX_albedo",       type: "vec3",  owner: { kind: "Material", name: "T", version: "1.0.0" } },
            { logicalName: "sampleCount",  namespacedName: "mX_sampleCount",  type: "int",   owner: { kind: "Film",     name: "F", version: "1.0.0" } },
            { logicalName: "viewProj",     namespacedName: "mX_viewProj",     type: "mat4",  owner: { kind: "Camera",   name: "C", version: "1.0.0" } },
            // samplers do not appear in byLogical map (we still include their entry for type provenance)
            { logicalName: "historyColor", namespacedName: "mX_historyColor", type: "sampler2D", owner: { kind: "Film", name: "F", version: "1.0.0" } },
        ],
        byLogical: {
            exposure:    "mX_exposure",
            albedo:      "mX_albedo",
            sampleCount: "mX_sampleCount",
            viewProj:    "mX_viewProj",
            // (no samplers here on purpose)
        },
        byNamespaced: {
            mX_exposure:    "exposure",
            mX_albedo:      "albedo",
            mX_sampleCount: "sampleCount",
            mX_viewProj:    "viewProj",
        },
        samplers: [
            { logical: "historyColor", namespaced: "mX_historyColor", type: "sampler2D" },
        ],
    };
}

// --- tests -------------------------------------------------------------------

describe("UniformBinder", () => {
    it("binds non-sampler uniforms and picks correct gl.uniform* from manifest types", () => {
        const gl = makeGL();
        const { program } = makeProgram();
        const manifest = makeManifest();

        const binder = new UniformBinder(gl, program, manifest);

        const mat = Array.from({ length: 16 }, (_, i) => i * 0.01);

        const res = binder.setMany([
            { logical: "exposure", value: 1.5 },                   // float → uniform1f
            { logical: "sampleCount", value: 3 },                   // int   → uniform1i
            { logical: "albedo", value: [0.1, 0.2, 0.3] },         // vec3  → uniform3f
            { logical: "viewProj", value: mat },                    // mat4  → uniformMatrix4fv
        ]);

        expect(res.bound).toBe(4);
        expect(res.skipped).toEqual([]);

        // Check the right calls happened
        expect(gl.uniform1f).toHaveBeenCalledTimes(1);
        expect(gl.uniform1i).toHaveBeenCalledTimes(1);
        expect(gl.uniform3f).toHaveBeenCalledTimes(1);
        expect(gl.uniformMatrix4fv).toHaveBeenCalledTimes(1);

        // spot-check parameters
        const u1fArgs = (gl.uniform1f as any).mock.calls[0];
        expect(u1fArgs[1]).toBeCloseTo(1.5);

        const u1iArgs = (gl.uniform1i as any).mock.calls[0];
        expect(u1iArgs[1]).toBe(3);

        const u3fArgs = (gl.uniform3f as any).mock.calls[0];
        expect(u3fArgs.slice(1)).toEqual([0.1, 0.2, 0.3]);

        const um4Args = (gl.uniformMatrix4fv as any).mock.calls[0];
        expect(um4Args[1]).toBe(false);                    // no transpose
        expect(um4Args[2]).toBeInstanceOf(Float32Array);   // matrices are Float32Array
    });

    it("binds sampler uniforms via manifest.samplers map", () => {
        const gl = makeGL();
        const { program } = makeProgram();
        const manifest = makeManifest();

        const binder = new UniformBinder(gl, program, manifest);

        // ResourceBinder would pass kind:"int" for samplers; do the same here.
        const ok = binder.set("historyColor", 5, "int");
        expect(ok).toBe(true);
        expect(gl.uniform1i).toHaveBeenCalledTimes(1);

        // Ensure it targeted the sampler location (i.e., namespaced: mX_historyColor)
        const locObj = (gl.uniform1i as any).mock.calls[0][0];
        expect((locObj as any).__loc).toBe("mX_historyColor");
    });

    it("skips unknown, bad-shape, and optimized-out uniforms without throwing", () => {
        const gl = makeGL();

        // Force one uniform to be optimized out (location = null)
        const nullFor = new Set<string>(["mX_viewProj"]);
        const { program } = makeProgram({ nullFor });
        const manifest = makeManifest();

        const binder = new UniformBinder(gl, program, manifest);

        const res = binder.setMany([
            { logical: "notInManifest", value: 1.0 },      // unknown → skip
            { logical: "albedo", value: [0.1, 0.2], kind: "vec3" }, // wrong length → skip
            { logical: "viewProj", value: new Array(16).fill(1), kind: "mat4" }, // optimized-out → skip
        ]);

        expect(res.bound).toBe(0);
        expect(res.skipped).toEqual(["notInManifest", "albedo", "viewProj"]);

        // No GL calls should have been made
        expect(gl.uniform1f).not.toHaveBeenCalled();
        expect(gl.uniform3f).not.toHaveBeenCalled();
        expect(gl.uniformMatrix4fv).not.toHaveBeenCalled();
    });

    it("caches uniform locations (getUniformLocation hit once per uniform)", () => {
        const gl = makeGL();
        const { program, getUniformLocation } = makeProgram();
        const manifest = makeManifest();

        const binder = new UniformBinder(gl, program, manifest);

        // same logical twice → should resolve ns once, cache thereafter
        expect(binder.set("exposure", 0.5)).toBe(true);
        expect(binder.set("exposure", 0.75)).toBe(true);

        // Count getUniformLocation calls for the *namespaced* exposure only
        const calls = getUniformLocation.mock.calls.filter(([name]) => name === "mX_exposure");
        expect(calls.length).toBe(1);
    });
});

