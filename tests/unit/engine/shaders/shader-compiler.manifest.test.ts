import { describe, it, expect } from "vitest";
import { compileRecipe, type UniformManifest } from "../../../../src/engine/shaders/shader-compiler";
import type { AssemblyRecipe } from "../../../../src/engine/shaders/assembly-recipe";
import type { ShaderModuleDescriptor } from "../../../../src/core/shader-fragment";

const mod = (kind: string, name: string, frag: Partial<ShaderModuleDescriptor["fragment"]>): ShaderModuleDescriptor => ({
    id: { kind, name, version: "1.0.0" },
    fragment: {
        uniforms: "",
        functions: "",
        provides: [],
        requires: [],
        mainCode: "",
        ...frag,
    } as any,
});

describe("shader-compiler manifest", () => {
    it("separates samplers and non-samplers; carries arraySize; maps logical<->namespaced", () => {
        const M = mod("Material","Tex",{
            uniforms: `
        uniform sampler2D set[4];
        uniform float exposure;
      `,
            functions: `
        vec3 shade(vec2 fc) {
          return vec3(texture(set[0], fc * 0.0).r) * exposure;
        }
      `,
            provides: ["shade"],
        });

        const recipe: AssemblyRecipe = {
            modules: [M],
            constants: { PI: 3.14159 },
            entry: { name: "shade" },
        };

        const out = compileRecipe(recipe);
        const man: UniformManifest = out.manifest;

        // non-sampler maps
        expect(Object.keys(man.byLogical)).toContain("exposure");
        const nsName = man.byLogical["exposure"];
        expect(man.byNamespaced[nsName]).toBe("exposure");

        // samplers list only
        expect(man.samplers.length).toBe(1);
        expect(man.samplers[0].logical).toBe("set");
        expect(man.samplers[0].type).toMatch(/sampler2d/i);
        // array metadata is optional, but should be present with value 4
        expect(man.samplers[0].arraySize).toBe(4);

        // constants are emitted somewhere in fragmentSrc (as consts or comments)
        expect(out.fragmentSrc).toMatch(/const (?:float|int) PI/);
    });

    it("keeps engine prelude uniforms and emits canonical main()", () => {
        const M = mod("Material","X",{
            functions: `vec3 entry(vec2 fc){ return vec3(1.0); }`,
            provides: ["entry"],
        });
        const out = compileRecipe({ modules: [M], entry: { name: "entry" } });

        expect(out.fragmentSrc).toMatch(/\buniform\s+vec2\s+u_resolution\b/);
        expect(out.fragmentSrc).toMatch(/\buniform\s+int\s+u_frameIndex\b/);
        expect(out.fragmentSrc).toMatch(/void\s+main\(\)\s*{\s*[^}]*entry\(/s);
    });
});
