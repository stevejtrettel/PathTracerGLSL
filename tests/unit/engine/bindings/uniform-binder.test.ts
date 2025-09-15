import { describe, it, expect, beforeEach } from "vitest";
import UniformBinder, { type ProgramLike, type ParamKind } from "../../../../src/engine/bindings/uniform-binder";
import type { UniformManifest } from "../../../../src/engine/shaders/shader-compiler";

// Minimal GL mock: record uniform calls
class MockGL implements Partial<WebGL2RenderingContext> {
    calls: Record<string, any[]> = {
        uniform1f: [], uniform1i: [],
        uniform2f: [], uniform3f: [], uniform4f: [],
        uniformMatrix3fv: [], uniformMatrix4fv: [],
    };

    uniform1f(loc: any, x: number): void { this.calls.uniform1f.push([loc, x]); }
    uniform1i(loc: any, x: number): void { this.calls.uniform1i.push([loc, x]); }
    uniform2f(loc: any, x: number, y: number): void { this.calls.uniform2f.push([loc, x, y]); }
    uniform3f(loc: any, x: number, y: number, z: number): void { this.calls.uniform3f.push([loc, x, y, z]); }
    uniform4f(loc: any, a: number, b: number, c: number, d: number): void { this.calls.uniform4f.push([loc, a, b, c, d]); }
    uniformMatrix3fv(loc: any, transpose: boolean, a: Float32Array): void { this.calls.uniformMatrix3fv.push([loc, transpose, Array.from(a)]); }
    uniformMatrix4fv(loc: any, transpose: boolean, a: Float32Array): void { this.calls.uniformMatrix4fv.push([loc, transpose, Array.from(a)]); }
}

class MockProgram implements ProgramLike {
    public lookups: string[] = [];
    constructor(private existing: Record<string, any>) {}
    getUniformLocation(name: string): WebGLUniformLocation | null {
        this.lookups.push(name);
        return (this.existing[name] ?? null) as any;
    }
}

function manifestOf(names: string[]): UniformManifest {
    const byLogical: Record<string, string> = {};
    const byNamespaced: Record<string, string> = {};
    const entries = names.map((L) => {
        const ns = `ns_${L}`;
        byLogical[L] = ns;
        byNamespaced[ns] = L;
        return { logicalName: L, namespacedName: ns, owner: { kind: "X", name: "Y", version: "1.0.0" } };
    });
    return { entries, byLogical, byNamespaced };
}

describe("UniformBinder", () => {
    let gl: MockGL;

    beforeEach(() => {
        gl = new MockGL();
    });

    it("binds float, int, bool scalars to correct calls", () => {
        const man = manifestOf(["gain", "seed", "enabled"]);
        const prog = new MockProgram({ ns_gain: {l:"gain"}, ns_seed: {l:"seed"}, ns_enabled: {l:"enabled"} });
        const ub = new UniformBinder(gl as any, prog, man);

        expect(ub.set("gain", 1.25, "float")).toBe(true);
        expect(ub.set("seed", 7, "int")).toBe(true);
        expect(ub.set("enabled", true, "bool")).toBe(true);

        expect(gl.calls.uniform1f[0][1]).toBeCloseTo(1.25);
        expect(gl.calls.uniform1i[0][1]).toBe(7);
        expect(gl.calls.uniform1i[1][1]).toBe(1);
    });

    it("binds vec2/vec3/vec4 with component calls", () => {
        const man = manifestOf(["uvScale", "albedo", "clip"]);
        const prog = new MockProgram({ ns_uvScale: 1, ns_albedo: 2, ns_clip: 3 });
        const ub = new UniformBinder(gl as any, prog, man);

        expect(ub.set("uvScale", [2, 3], "vec2")).toBe(true);
        expect(ub.set("albedo", [0.5, 0.6, 0.7], "vec3")).toBe(true);
        expect(ub.set("clip", [0, 1, 0, 1], "vec4")).toBe(true);

        expect(gl.calls.uniform2f[0].slice(1)).toEqual([2, 3]);
        expect(gl.calls.uniform3f[0].slice(1)).toEqual([0.5, 0.6, 0.7]);
        expect(gl.calls.uniform4f[0].slice(1)).toEqual([0, 1, 0, 1]);
    });

    it("binds mat3/mat4 with matrix calls", () => {
        const man = manifestOf(["M3", "M4"]);
        const prog = new MockProgram({ ns_M3: 1, ns_M4: 2 });
        const ub = new UniformBinder(gl as any, prog, man);

        const m3 = new Float32Array(9).map((_, i) => i as any) as Float32Array;
        const m4 = new Float32Array(16).map((_, i) => i as any) as Float32Array;

        expect(ub.set("M3", m3, "mat3")).toBe(true);
        expect(ub.set("M4", Array.from(m4), "mat4")).toBe(true);

        expect(gl.calls.uniformMatrix3fv[0][1]).toBe(false);
        expect(gl.calls.uniformMatrix3fv[0][2]).toHaveLength(9);
        expect(gl.calls.uniformMatrix4fv[0][2]).toHaveLength(16);
    });

    it("skips uniforms that aren't in the manifest", () => {
        const man = manifestOf(["exposure"]); // 'gamma' not present
        const prog = new MockProgram({ ns_exposure: 1 });
        const ub = new UniformBinder(gl as any, prog, man);

        expect(ub.set("gamma", 2.2, "float")).toBe(false);
        const r = ub.setMany([{ logical: "exposure", value: 1.0, kind: "float" }, { logical: "gamma", value: 2.2, kind: "float" }]);
        expect(r.bound).toBe(1);
        expect(r.skipped).toEqual(["gamma"]);
    });

    it("caches uniform locations (no duplicate lookups)", () => {
        const man = manifestOf(["gain"]);
        const prog = new MockProgram({ ns_gain: {} });
        const ub = new UniformBinder(gl as any, prog, man);

        ub.set("gain", 0.5, "float");
        ub.set("gain", 0.6, "float");
        const lookups = prog.lookups.filter((n) => n === "ns_gain").length;
        expect(lookups).toBe(1);
    });

    it("infers kinds when not provided", () => {
        const man = manifestOf(["f", "b", "v2", "v3", "v4", "m3", "m4"]);
        const prog = new MockProgram({
            ns_f: 1, ns_b: 2, ns_v2: 3, ns_v3: 4, ns_v4: 5, ns_m3: 6, ns_m4: 7,
        });
        const ub = new UniformBinder(gl as any, prog, man);

        expect(ub.set("f", 1.0)).toBe(true);
        expect(ub.set("b", true)).toBe(true);
        expect(ub.set("v2", [1,2])).toBe(true);
        expect(ub.set("v3", [1,2,3])).toBe(true);
        expect(ub.set("v4", [1,2,3,4])).toBe(true);
        expect(ub.set("m3", new Float32Array(9))).toBe(true);
        expect(ub.set("m4", new Float32Array(16))).toBe(true);

        expect(gl.calls.uniform1f.length).toBeGreaterThan(0);
        expect(gl.calls.uniform1i.length).toBeGreaterThan(0);
        expect(gl.calls.uniform2f.length).toBe(1);
        expect(gl.calls.uniform3f.length).toBe(1);
        expect(gl.calls.uniform4f.length).toBe(1);
        expect(gl.calls.uniformMatrix3fv.length).toBe(1);
        expect(gl.calls.uniformMatrix4fv.length).toBe(1);
    });
});
