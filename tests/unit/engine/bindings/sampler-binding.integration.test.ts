import { describe, it, expect, vi } from "vitest";
import { compileRecipe } from "../../../../src/engine/shaders/shader-compiler";
import type { AssemblyRecipe } from "../../../../src/engine/shaders/assembly-recipe";
import type { ShaderModuleDescriptor } from "../../../../src/core/shader-fragment";
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

// UniformBinder shim (only needs setMany for ResourceBinder)
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

function moduleWithSampler(): ShaderModuleDescriptor {
    return {
        id: { kind: "Material", name: "TexUser", version: "1.0.0" },
        priority: 0,
        fragment: {
            uniforms: `uniform sampler2D tex0;`,
            // Keep function simple; compiler just needs a provided symbol.
            functions: `
        vec3 shadePixel(vec2 fragCoord) {
          // no dependency requirements; constant return is fine for compile
          return vec3(0.0);
        }
      `,
            provides: ["shadePixel"],
            requires: [],
        } as any,
    };
}

describe("integration: compile → manifest → ResourceBinder.bind", () => {
    it("discovers sampler in manifest and binds it by logical name", () => {
        const recipe: AssemblyRecipe = {
            modules: [moduleWithSampler()],
            constants: {},
            entry: { name: "shadePixel" },
        };

        const compiled = compileRecipe(recipe);
        const sampler = compiled.manifest.samplers.find((s) => s.logical === "tex0");
        expect(sampler).toBeTruthy();
        expect(sampler!.namespaced).toMatch(/^m[0-9a-f]{6}_tex0$/);

        const gl = makeGL();
        const pool = new TextureUnitPool({ size: 2, baseUnit: 0 });
        const binder = makeBinder();

        const rb = new ResourceBinder(gl, pool, binder as any, compiled.manifest);

        // Bind with null texture to simulate first frame/unbound
        const result = rb.bind({
            tex0: { texture: null, target: (gl as any).TEXTURE_2D },
        });

        expect(result.errors).toEqual([]);
        expect(result.skipped).toEqual([]);
        expect(result.bound).toBe(1);

        // GL calls: activeTexture(TEXTURE0+0) and bindTexture(TEXTURE_2D, null)
        expect((gl as any).activeTexture).toHaveBeenCalledWith((gl as any).TEXTURE0 + 0);
        expect((gl as any).bindTexture).toHaveBeenCalledWith((gl as any).TEXTURE_2D, null);

        // UniformBinder got the unit index for 'tex0'
        const calls = (binder as any)._calls as Array<{ logical: string; value: number; kind?: "int" }>;
        expect(calls).toHaveLength(1);
        expect(calls[0]).toEqual({ logical: "tex0", value: 0, kind: "int" });
    });
});
