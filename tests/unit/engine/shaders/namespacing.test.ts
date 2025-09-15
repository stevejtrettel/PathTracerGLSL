import { describe, it, expect } from "vitest";
import type { ComponentID } from "../../../../src/core/ids";
import type { ShaderFragment, ShaderModuleDescriptor } from "../../../../src/core/shader-fragment";
import {
    namespaceModule,
    makeModulePrefix,
    extractUniforms,
    extractFunctionNames,
    replaceIds,
} from "../../../../src/engine/shaders/namespacing";

function id(kind: ComponentID["kind"], name: string): ComponentID {
    return { kind, name, version: "1.0.0" };
}

function mod(
    kind: ComponentID["kind"],
    name: string,
    fragment: Partial<ShaderFragment> & { functions?: string }
): ShaderModuleDescriptor {
    return { id: id(kind, name), fragment: { uniforms: "", mainCode: "", ...fragment } };
}

describe("extractUniforms", () => {
    it("parses single and comma-separated declarations", () => {
        const src = `
      uniform float exposure;
      uniform vec3 albedo, emission;
      uniform sampler2D tex0, tex1;
      // uniform int ignored; (comment)
      /* uniform int alsoIgnored; */
      uniform float weights[4];
    `;
        const names = extractUniforms(src).map((e) => e.name);
        expect(names).toEqual(["exposure", "albedo", "emission", "tex0", "tex1", "weights"]);
    });
});

describe("extractFunctionNames", () => {
    it("finds function definitions and ignores comments/strings", () => {
        const src = `
      // void fake() {}
      /* float nope() {} */
      const int K = 3;
      void foo(int a) { }
      vec3 bar() { return vec3(0.0); }
      void baz() {
        // "foo" should not count
        /* 'bar' should not count either */
      }
      // a constructor call like vec3(1.0) should not add a name
    `;
        const names = extractFunctionNames(src).sort();
        expect(names).toEqual(["bar", "baz", "foo"].sort());
    });
});

describe("replaceIds", () => {
    it("replaces only whole identifiers and skips strings/comments", () => {
        const code = `
      // foo should not change here
      /* foo also not here */
      const char* s = "foo should stay";
      float fooBar = 0.0; // contains foo as prefix but shouldn't match
      float foo = 1.0;
      float v = foo + 1.0;
    `;
        const out = replaceIds(code, { foo: "X_foo" }, new Set());
        expect(out).toContain("float X_foo = 1.0;");
        expect(out).toContain("float fooBar = 0.0;");
        expect(out).toContain('"foo should stay"');
        expect(out).toContain("// foo should not change here");
        expect(out).toContain("/* foo also not here */");
    });
});

describe("namespaceModule: uniforms + helpers", () => {
    it("prefixes uniforms and private helpers; preserves public symbols", () => {
        const fragment: ShaderFragment = {
            uniforms: `
        uniform float exposure;
        uniform vec3 albedo, emission;
      `,
            functions: `
        // private helper
        float luma(vec3 c) { return dot(c, vec3(0.2126,0.7152,0.0722)); }
        // public symbol (must NOT rename)
        vec3 shadePixel(vec2 fragCoord) {
          return albedo * exposure;
        }
      `,
            provides: ["shadePixel"], // public, must be preserved
            requires: [],
            entrypoints: { fragmentMain: "shadePixel" },
        };
        const m = mod("Material", "Lambert", fragment);
        const res = namespaceModule(m, { preserve: ["shadePixel"] });

        // Uniforms renamed in declarations
        expect(res.uniforms).not.toContain("uniform float exposure;");
        expect(res.uniforms).toMatch(/uniform float m[A-Fa-f0-9]{6}_exposure;/);

        // Usage renamed inside code (albedo/exposure should be namespaced)
        expect(res.functions).toMatch(
            /return\s+m[A-Fa-f0-9]{6}_albedo\s*\*\s*m[A-Fa-f0-9]{6}_exposure\s*;/
        );

        // Built-in call must stay unmodified (no renaming of 'dot')
        expect(res.functions).toContain(" dot(");

        // Helper renamed (original name should not appear)
        expect(res.functions).not.toContain(" luma(");

        // Public symbol preserved
        expect(res.functions).toContain("vec3 shadePixel(");

        // Helper mapping exists
        const helperNames = Object.keys(res.helperMappings);
        expect(helperNames).toContain("luma");

        // Uniform mappings present
        const uNames = res.uniformMappings.map((u) => u.logicalName).sort();
        expect(uNames).toEqual(["albedo", "emission", "exposure"].sort());
    });

    it("different modules get different prefixes for same uniform names", () => {
        const f: ShaderFragment = {
            uniforms: `uniform float exposure;`,
            functions: `float foo(){return exposure;}`,
            provides: [],
        };
        const m1 = mod("Material", "A", f);
        const m2 = mod("Material", "B", f);

        const r1 = namespaceModule(m1, { preserve: [] });
        const r2 = namespaceModule(m2, { preserve: [] });

        expect(r1.namespacePrefix).not.toBe(r2.namespacePrefix);
        expect(r1.functions).not.toBe(r2.functions);
    });

    it("throws on duplicate uniform name in one module", () => {
        const f: ShaderFragment = {
            uniforms: `
        uniform float exposure;
        uniform float exposure;
      `,
            functions: ``,
            provides: [],
        };
        const m = mod("Material", "Dup", f);
        expect(() => namespaceModule(m, { preserve: [] })).toThrow(/duplicate uniform "exposure"/);
    });
});


describe("makeModulePrefix", () => {
    it("is deterministic and uses hash prefix", () => {
        const a = makeModulePrefix(id("Geometry", "E"));
        const b = makeModulePrefix(id("Geometry", "E"));
        expect(a).toBe(b);
        expect(a).toMatch(/^m[0-9a-f]{6}_$/);
    });
});
