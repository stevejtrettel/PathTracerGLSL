import { describe, it, expect } from "vitest";
import type { ComponentID } from "../../../../src/core/ids";
import type { ShaderFragment, ShaderModuleDescriptor } from "../../../../src/core/shader-fragment";
import type { AssemblyRecipe } from "../../../../src/engine/shaders/assembly-recipe";
import { computeProgramKey, type ProgramKeyResult } from "../../../../src/engine/shaders/program-key";
import { linkRecipe } from "../../../../src/engine/shaders/dependency-linker";

function id(kind: ComponentID["kind"], name: string, version = "1.0.0"): ComponentID {
    return { kind, name, version };
}
function mod(kind: ComponentID["kind"], name: string, f: Partial<ShaderFragment> & { functions?: string }): ShaderModuleDescriptor {
    return { id: id(kind, name), fragment: { uniforms: "", functions: f.functions ?? "", provides: f.provides ?? [], requires: f.requires ?? [], entrypoints: f.entrypoints } };
}
function recipe(mods: ShaderModuleDescriptor[], entry: string, constants = {}): AssemblyRecipe {
    return { modules: mods, entry: { name: entry }, constants };
}

describe("program-key", () => {
    it("is stable with constants in different insertion orders", () => {
        const tracer = mod("Tracer", "T", { provides: ["shadePixel"], entrypoints: { fragmentMain: "shadePixel" }, functions: "vec3 shadePixel(vec2 p){return vec3(0.0);}" });
        const r = linkRecipe(recipe([tracer], "shadePixel"));
        const a = computeProgramKey({ modules: [tracer], entry: { name: "shadePixel" }, constants: { B: 2, A: 1 } }, r, "v1");
        const b = computeProgramKey({ modules: [tracer], entry: { name: "shadePixel" }, constants: { A: 1, B: 2 } }, r, "v1");
        expect(a.key).toBe(b.key);
    });

    it("changes when a module version changes", () => {
        const t1 = mod("Tracer", "T", { provides: ["shadePixel"], entrypoints: { fragmentMain: "shadePixel" }, functions: "vec3 shadePixel(vec2 p){return vec3(0.0);}"} );
        const r1 = linkRecipe(recipe([t1], "shadePixel"));
        const k1 = computeProgramKey(recipe([t1], "shadePixel"), r1, "v1");

        const t2: ShaderModuleDescriptor = { ...t1, id: { ...t1.id, version: "1.0.1" } };
        const r2 = linkRecipe(recipe([t2], "shadePixel"));
        const k2 = computeProgramKey(recipe([t2], "shadePixel"), r2, "v1");

        expect(k1.key).not.toBe(k2.key);
    });

    it("changes when vertex template version changes", () => {
        const tracer = mod("Tracer", "T", { provides: ["shadePixel"], entrypoints: { fragmentMain: "shadePixel" }, functions: "vec3 shadePixel(vec2 p){return vec3(0.0);}" });
        const r = linkRecipe(recipe([tracer], "shadePixel"));
        const kA = computeProgramKey(recipe([tracer], "shadePixel"), r, "v1");
        const kB = computeProgramKey(recipe([tracer], "shadePixel"), r, "v2");
        expect(kA.key).not.toBe(kB.key);
    });

    it("is independent of the order modules were supplied in (uses resolved order)", () => {
        const geom = mod("Geometry", "E", { provides: ["geodesic"], functions: "vec3 geodesic(vec3 o, vec3 d, float t){return o+d*t;}" });
        const scene = mod("Scene", "S", { provides: ["intersectScene"], requires: ["geodesic"], functions: "bool intersectScene(vec3 ro, vec3 rd, out float t){t=0.0;return true;}" });
        const tracer = mod("Tracer", "T", { provides: ["shadePixel"], requires: ["intersectScene"], entrypoints: { fragmentMain: "shadePixel" }, functions: "vec3 shadePixel(vec2 p){float t; bool h=intersectScene(vec3(0.0),vec3(0.0), t); return vec3(0.0);}" });

        const r1 = linkRecipe(recipe([tracer, scene, geom], "shadePixel"));
        const r2 = linkRecipe(recipe([geom, tracer, scene], "shadePixel"));

        const k1 = computeProgramKey(recipe([tracer, scene, geom], "shadePixel"), r1, "v1");
        const k2 = computeProgramKey(recipe([geom, tracer, scene], "shadePixel"), r2, "v1");

        expect(k1.key).toBe(k2.key);
    });
});
