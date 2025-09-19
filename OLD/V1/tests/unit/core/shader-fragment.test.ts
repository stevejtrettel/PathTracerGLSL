import { describe, it, expect } from "vitest";
import {
    isShaderFragment,
    normalizeShaderFragment,
    type ShaderFragment,
} from "../../../src/core/shader-fragment";

describe("ShaderFragment basics", () => {
    it("accepts minimal fragment", () => {
        const f: ShaderFragment = { functions: "float f(){return 1.;}" };
        expect(isShaderFragment(f)).toBe(true);
        const n = normalizeShaderFragment(f);
        expect(n.functions).toContain("float f()");
        expect(n.uniforms).toBe("");
        expect(n.requires).toEqual([]);
        expect(n.provides).toEqual([]);
    });

    it("rejects bad entrypoints type", () => {
        // @ts-expect-error runtime guard should fail too
        const bad: any = { entrypoints: { fragmentMain: 42 } };
        expect(isShaderFragment(bad)).toBe(false);
    });

    it("normalizes arrays and strings", () => {
        const f: ShaderFragment = {
            uniforms: "uniform float exposure;",
            requires: ["geodesic", "intersectScene"],
            provides: ["shadePixel"],
            entrypoints: { fragmentMain: "shadePixel" },
        };
        const n = normalizeShaderFragment(f);
        expect(n.uniforms).toContain("uniform float exposure;");
        expect(n.requires).toEqual(["geodesic", "intersectScene"]);
        expect(n.provides).toEqual(["shadePixel"]);
        expect(n.entrypoints?.fragmentMain).toBe("shadePixel");
    });
});
