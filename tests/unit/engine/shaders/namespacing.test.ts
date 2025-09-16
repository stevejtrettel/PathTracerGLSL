


import { describe, it, expect } from "vitest";
import { namespaceModule, extractUniforms, makeModulePrefix } from "../../../../src/engine/shaders/namespacing";
import type { ShaderModuleDescriptor } from "../../../../src/core/shader-fragment";

const mkMod = (over: Partial<ShaderModuleDescriptor>): ShaderModuleDescriptor => ({
    id: { kind: "Material", name: "Test", version: "1.0.0" },
    fragment: {
        uniforms: "",
        functions: "",
        provides: [],
        requires: [],
        mainCode: "",
        ...over.fragment,
    } as any,
    priority: over.priority,
    ...over,
} as ShaderModuleDescriptor);

describe("namespacing", () => {
    it("parses sampler arrays with arraySize and ignores uniform blocks", () => {
        const src = `
      // block should be ignored
      uniform BlockName {
        mat4 view;
        mat4 proj;
      };

      uniform sampler2D set[4], aux;
      uniform float exposure;
    `;

        const u = extractUniforms(src);
        // block removed, so we should only see set, aux, exposure
        const names = u.map(x => x.name);
        expect(names).toContain("set");
        expect(names).toContain("aux");
        expect(names).toContain("exposure");

        const setEntry = u.find(x => x.name === "set")!;
        expect(setEntry.arraySize).toBe(4);
        expect(setEntry.type).toBe("sampler2D");

        const auxEntry = u.find(x => x.name === "aux")!;
        expect(auxEntry.arraySize).toBeUndefined();
        expect(auxEntry.type).toBe("sampler2D");
    });

    it("prefixes private helpers/uniforms and preserves public symbols", () => {
        const mod = mkMod({
            fragment: {
                uniforms: `
          uniform sampler2D set[4];
          uniform float exposure;
        `,
                // shadePixel is a public symbol we want to preserve
                functions: `
          /* don't touch exposure in comments */
          // nor in "strings like exposure"
          vec3 shadePixel(vec2 frag) {
            return vec3(0.0) + vec3(exposure);
          }
          void helperFoo() {}
        `,
                provides: ["shadePixel"],
                requires: [],
                mainCode: `
          // references to helperFoo should be renamed
          void main_extra() {
            helperFoo();
            // sampler index use should remain readable: set[0]
            vec4 c = texture(set[0], fragCoord.xy);
          }
        `,
            } as any,
        });

        const res = namespaceModule(mod, { preserve: ["shadePixel"] });
        const prefix = makeModulePrefix(mod.id);

        // Uniform mappings include array size metadata
        const names = res.uniformMappings.map(u => u.logicalName);
        expect(names).toContain("set");
        expect(names).toContain("exposure");
        const setMap = res.uniformMappings.find(u => u.logicalName === "set")!;
        expect(setMap.arraySize).toBe(4);
        expect(setMap.namespacedName.startsWith(prefix)).toBe(true);

        // Public function name is preserved
        expect(res.functions).toMatch(/\bvec3\s+shadePixel\s*\(/);

        // Helper renamed
        expect(res.functions).toMatch(new RegExp(`\\bvoid\\s+${prefix}helperFoo\\s*\\(`));

        // Comments/strings not rewritten (original "exposure" should appear)
        expect(res.functions).toMatch(/don't touch exposure/);
        expect(res.functions).toMatch(/strings like exposure/);

        // Main code uses renamed helper
        expect(res.mainCode).toMatch(new RegExp(`\\b${prefix}helperFoo\\s*\\(`));
        // The identifier 'set' should be prefixed where it’s an identifier; the [0] index survives.
        // We can at least ensure the namespaced 'set' exists:
        const nsSet = setMap.namespacedName;
        expect(res.mainCode).toContain(`${nsSet}[0]`);
    });
});
