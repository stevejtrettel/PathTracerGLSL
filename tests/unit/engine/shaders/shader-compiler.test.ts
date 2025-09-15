import { describe, it, expect } from "vitest";
import type { ComponentID } from "../../../../src/core/ids";
import type { ShaderFragment, ShaderModuleDescriptor } from "../../../../src/core/shader-fragment";
import type { AssemblyRecipe } from "../../../../src/engine/shaders/assembly-recipe";
import { compileRecipe } from "../../../../src/engine/shaders/shader-compiler";

function id(kind: ComponentID["kind"], name: string): ComponentID {
    return { kind, name, version: "1.0.0" };
}

function mod(
    kind: ComponentID["kind"],
    name: string,
    fragment: Partial<ShaderFragment> & { functions?: string }
): ShaderModuleDescriptor {
    // Normalize minimal fragment defaults
    const f: ShaderFragment = {
        uniforms: fragment.uniforms ?? "",
        functions: fragment.functions ?? "",
        mainCode: fragment.mainCode ?? "",
        requires: fragment.requires ?? [],
        provides: fragment.provides ?? [],
        entrypoints: fragment.entrypoints,
    };
    return { id: id(kind, name), fragment: f };
}

function recipe(mods: ShaderModuleDescriptor[], entry: string, constants = {}): AssemblyRecipe {
    return { modules: mods, entry: { name: entry }, constants };
}

describe("shader-compiler", () => {
    it("assembles a trivial recipe into valid-looking GLSL without conditionals", () => {
        const tracer = mod("Tracer", "Flat", {
            provides: ["shadePixel"],
            entrypoints: { fragmentMain: "shadePixel" },
            functions: `
        vec3 shadePixel(vec2 fragCoord) {
          return vec3(1.0, 0.0, 0.0);
        }
      `,
        });

        const out = compileRecipe(recipe([tracer], "shadePixel"));
        expect(out.fragmentSrc).toContain("#version 300 es");
        expect(out.fragmentSrc).toContain("vec3 shadePixel(");
        expect(out.fragmentSrc).toContain("void main()");
        expect(out.fragmentSrc).toContain("outColor");
        expect(out.fragmentSrc).not.toMatch(/#if|#ifdef|#endif/);
        expect(out.manifest.entries.length).toBe(0);
    });

    it("links dependencies, namespaces uniforms, and exposes them via manifest", () => {
        const geom = mod("Geometry", "Euclid", {
            provides: ["geodesic"],
            functions: `vec3 geodesic(vec3 o, vec3 d, float t){ return o + d*t; }`,
        });

        const scene = mod("Scene", "SDF", {
            provides: ["intersectScene"],
            requires: ["geodesic"],
            functions: `bool intersectScene(vec3 ro, vec3 rd, out float t){ t = 0.0; return true; }`,
        });

        const material = mod("Material", "Lambert", {
            provides: ["sampleBSDF", "evalBSDF"],
            uniforms: `uniform float exposure;`,
            functions: `
        vec3 sampleBSDF(vec3 n){ return vec3(0.0); }
        vec3 evalBSDF(vec3 n){ return vec3(1.0) * exposure; }`,
        });

        const tracer = mod("Tracer", "Path", {
            provides: ["shadePixel"],
            requires: ["intersectScene", "sampleBSDF", "evalBSDF"],
            entrypoints: { fragmentMain: "shadePixel" },
            functions: `
        vec3 shadePixel(vec2 frag){
          float t; bool hit = intersectScene(vec3(0.0), vec3(0.0), t);
          return evalBSDF(vec3(0.0));
        }`,
        });

        const out = compileRecipe(recipe([tracer, material, scene, geom], "shadePixel"));
        // Uniform is namespaced in the final shader
        expect(out.fragmentSrc).toMatch(/uniform float m[0-9a-f]{6}_exposure;/);
        // And exposed via manifest
        const entry = out.manifest.entries.find((e) => e.logicalName === "exposure");
        expect(entry).toBeTruthy();
        expect(entry!.namespacedName).toMatch(/^m[0-9a-f]{6}_exposure$/);
    });

    it("injects constants as const declarations", () => {
        const tracer = mod("Tracer", "Flat", {
            provides: ["shadePixel"],
            entrypoints: { fragmentMain: "shadePixel" },
            functions: `vec3 shadePixel(vec2 fragCoord){ return vec3(float(MAX_BOUNCES)); }`,
        });
        const out = compileRecipe(
            recipe([tracer], "shadePixel", { MAX_BOUNCES: 3, USE_DUMMY: true, PROFILE: "dev" })
        );
        expect(out.fragmentSrc).toContain("const int MAX_BOUNCES = 3;");
        expect(out.fragmentSrc).toContain("const bool USE_DUMMY = true;");
        expect(out.fragmentSrc).toContain('// const (string) PROFILE = "dev"');
    });
});
