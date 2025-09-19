import { describe, it, expect } from "vitest";
import type { ShaderFragment, ShaderModuleDescriptor } from "../../../../src/core/shader-fragment";
import type { AssemblyRecipe } from "../../../../src/engine/shaders/assembly-recipe";
import { compileRecipe } from "../../../../src/engine/shaders/shader-compiler";

// Small helpers mirroring your other shader tests
function id(kind: "Geometry" | "Scene" | "Material" | "Light" | "Camera" | "Sampler" | "Tracer" | "Film", name: string, version = "1.0.0") {
    return { kind, name, version };
}
function mod(kind: ShaderModuleDescriptor["id"]["kind"], name: string, f: Partial<ShaderFragment> & { functions?: string }): ShaderModuleDescriptor {
    return {
        id: id(kind as any, name),
        fragment: {
            uniforms: f.uniforms ?? "",
            functions: f.functions ?? "",
            mainCode: f.mainCode ?? "",
            provides: f.provides ?? [],
            requires: f.requires ?? [],
            entrypoints: f.entrypoints,
        },
    };
}
function recipe(mods: ShaderModuleDescriptor[], entry: string, constants = {}): AssemblyRecipe {
    return { modules: mods, entry: { name: entry }, constants };
}

describe("shader-compiler: sampler manifest", () => {
    it("discovers a single sampler and excludes it from byLogical", () => {
        const tracer = mod("Tracer", "Direct", {
            provides: ["integrateSample"],
            functions: `vec3 integrateSample(vec2 frag){ return vec3(0.5); }`,
        });
        const mat = mod("Material", "Textured", {
            uniforms: `uniform sampler2D albedo; uniform float exposure;`,
            provides: ["shadePixel"],
            requires: ["integrateSample"],
            entrypoints: { fragmentMain: "shadePixel" },
            functions: `
        vec3 shadePixel(vec2 frag){
          // pretend to sample albedo; we don't need real sampling for the test
          vec3 c = integrateSample(frag) * exposure;
          return c;
        }
      `,
        });

        const rec = recipe([mat, tracer], "shadePixel");
        const compiled = compileRecipe(rec);

        // samplers present
        expect(compiled.manifest.samplers.length).toBe(1);
        const s0 = compiled.manifest.samplers[0];
        expect(s0.logical).toBe("albedo");
        expect(s0.type).toBe("sampler2D");
        expect(s0.namespaced).toMatch(/^m[0-9a-f]{6}_albedo$/i);

        // non-sampler stays in byLogical; sampler excluded from byLogical
        expect(compiled.manifest.byLogical["exposure"]).toMatch(/^m[0-9a-f]{6}_exposure$/i);
        expect(compiled.manifest.byLogical["albedo"]).toBeUndefined();
    });

    it("handles multiple and comma-separated sampler declarations with different types", () => {
        const tracer = mod("Tracer", "Direct", {
            provides: ["integrateSample"],
            functions: `vec3 integrateSample(vec2 frag){ return vec3(1.0); }`,
        });
        const mat = mod("Material", "MultiTex", {
            uniforms: `
        uniform sampler2D  a, b;
        uniform samplerCube sky;
        uniform sampler3D  lut3d;
        uniform float      exposure;`,
            provides: ["shadePixel"],
            requires: ["integrateSample"],
            entrypoints: { fragmentMain: "shadePixel" },
            functions: `vec3 shadePixel(vec2 frag){ return integrateSample(frag) * exposure; }`,
        });

        const rec = recipe([mat, tracer], "shadePixel");
        const compiled = compileRecipe(rec);

        // samplers captured with correct types
        const kinds = compiled.manifest.samplers.map(s => s.type).sort();
        expect(kinds).toEqual(["sampler2D", "sampler2D", "sampler3D", "samplerCube"].sort());

        // namespaced names look correct
        for (const s of compiled.manifest.samplers) {
            expect(s.namespaced).toMatch(/^m[0-9a-f]{6}_[A-Za-z_]\w*$/i);
        }

        // exposure is non-sampler; exists in byLogical
        expect(compiled.manifest.byLogical["exposure"]).toMatch(/^m[0-9a-f]{6}_exposure$/i);

        // samplers do NOT appear in byLogical
        expect(compiled.manifest.byLogical["a"]).toBeUndefined();
        expect(compiled.manifest.byLogical["b"]).toBeUndefined();
        expect(compiled.manifest.byLogical["sky"]).toBeUndefined();
        expect(compiled.manifest.byLogical["lut3d"]).toBeUndefined();
    });

    it("includes shadow samplers when declared (kept out of byLogical)", () => {
        const tracer = mod("Tracer", "Direct", {
            provides: ["integrateSample"],
            functions: `vec3 integrateSample(vec2 frag){ return vec3(1.0); }`,
        });
        const mat = mod("Material", "Shadows", {
            uniforms: `
        uniform sampler2DShadow shadowMap;
        uniform samplerCubeShadow cubeShadows;
        uniform vec3 tint;`,
            provides: ["shadePixel"],
            requires: ["integrateSample"],
            entrypoints: { fragmentMain: "shadePixel" },
            functions: `vec3 shadePixel(vec2 frag){ return integrateSample(frag) * tint; }`,
        });

        const rec = recipe([mat, tracer], "shadePixel");
        const compiled = compileRecipe(rec);

        const types = compiled.manifest.samplers.map(s => s.type).sort();
        expect(types).toEqual(["sampler2DShadow", "samplerCubeShadow"].sort());

        expect(compiled.manifest.byLogical["tint"]).toMatch(/^m[0-9a-f]{6}_tint$/i);
        expect(compiled.manifest.byLogical["shadowMap"]).toBeUndefined();
        expect(compiled.manifest.byLogical["cubeShadows"]).toBeUndefined();
    });
});
