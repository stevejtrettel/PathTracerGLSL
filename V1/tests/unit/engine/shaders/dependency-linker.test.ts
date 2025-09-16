import { describe, it, expect } from "vitest";
import type { ComponentID } from "../../../../src/core/ids";
import type { ShaderFragment, ShaderModuleDescriptor } from "../../../../src/core/shader-fragment";
import type { AssemblyRecipe } from "../../../../src/engine/shaders/assembly-recipe";
import { linkRecipe, type LinkReport } from "../../../../src/engine/shaders/dependency-linker";

function id(kind: ComponentID["kind"], name: string): ComponentID {
    return { kind, name, version: "1.0.0" };
}

function mod(
    kind: ComponentID["kind"],
    name: string,
    opts: {
        provides?: string[];
        requires?: string[];
        entry?: string;
        priority?: number;
    } = {}
): ShaderModuleDescriptor {
    const fragment: ShaderFragment = {
        provides: opts.provides ?? [],
        requires: opts.requires ?? [],
        functions: "// stub",
        entrypoints: opts.entry ? { fragmentMain: opts.entry } : undefined,
    };
    return { id: id(kind, name), fragment, priority: opts.priority };
}

function recipe(mods: ShaderModuleDescriptor[], entry: string, constants = {}): AssemblyRecipe {
    return { modules: mods, entry: { name: entry }, constants };
}

describe("dependency-linker: happy paths", () => {
    it("resolves a simple chain Geometry -> Scene -> Tracer", () => {
        const geom = mod("Geometry", "Euclid", { provides: ["geodesic"] });
        const scene = mod("Scene", "SDF", { provides: ["intersectScene"], requires: ["geodesic"] });
        const tracer = mod("Tracer", "Path", {
            provides: ["shadePixel"],
            requires: ["intersectScene"],
            entry: "shadePixel",
        });

        const r: LinkReport = linkRecipe(recipe([tracer, scene, geom], "shadePixel"));
        expect(r.resolvedOrder.map((m) => m.id.kind)).toEqual(["Geometry", "Scene", "Tracer"]);
        expect(Object.keys(r.symbolTable).sort()).toEqual(["geodesic", "intersectScene", "shadePixel"]);
        expect(r.entryProvider.kind).toBe("Tracer");
        expect(r.warnings.length).toBe(0);
    });

    it("prunes modules not reachable from entry", () => {
        const tracer = mod("Tracer", "Direct", { provides: ["shadePixel"], entry: "shadePixel" });
        const unused = mod("Extension", "Profiler", { provides: ["beginProfile", "endProfile"] });

        const r = linkRecipe(recipe([tracer, unused], "shadePixel"));
        expect(r.resolvedOrder.map((m) => m.id.name)).toEqual(["Direct"]);
        expect(r.warnings[0]).toContain("pruned unreachable modules");
        expect(r.warnings[0]).toContain("Extension/Profiler");
    });

    it("uses priority to break ties deterministically", () => {
        // Two independent libs both required by tracer; both start with indegree 0.
        const libA = mod("Material", "A", { provides: ["foo"], priority: 1 });
        const libB = mod("Material", "B", { provides: ["bar"], priority: 2 });
        const tracer = mod("Tracer", "T", {
            provides: ["shadePixel"],
            requires: ["foo", "bar"],
            entry: "shadePixel",
        });

        const r = linkRecipe(recipe([tracer, libB, libA], "shadePixel"));
        expect(r.resolvedOrder.map((m) => m.id.name)).toEqual(["A", "B", "T"]); // A (priority 1) before B (2)
    });
});

describe("dependency-linker: failures", () => {
    it("errors when entry symbol is missing", () => {
        const geom = mod("Geometry", "E", { provides: ["geodesic"] });
        expect(() => linkRecipe(recipe([geom], "shadePixel"))).toThrow(/entry symbol .* has no provider/);
    });

    it("errors on ambiguous entry providers", () => {
        const t1 = mod("Tracer", "T1", { provides: ["shadePixel"], entry: "shadePixel" });
        const t2 = mod("Tracer", "T2", { provides: ["shadePixel"] });
        expect(() => linkRecipe(recipe([t1, t2], "shadePixel"))).toThrow(/provided by multiple modules/);
    });

    it("errors when a required symbol is missing", () => {
        const tracer = mod("Tracer", "T", { provides: ["shadePixel"], requires: ["intersectScene"], entry: "shadePixel" });
        expect(() => linkRecipe(recipe([tracer], "shadePixel"))).toThrow(/requires symbol "intersectScene".*not provided/);
    });

    it("errors on ambiguous providers for any symbol", () => {
        const a = mod("Scene", "A", { provides: ["intersectScene"] });
        const b = mod("Scene", "B", { provides: ["intersectScene"] });
        const tracer = mod("Tracer", "T", { provides: ["shadePixel"], requires: ["intersectScene"], entry: "shadePixel" });
        expect(() => linkRecipe(recipe([tracer, a, b], "shadePixel"))).toThrow(/symbol "intersectScene".*multiple modules/);
    });

    it("errors on cycles", () => {
        const a = mod("Material", "A", { provides: ["alpha"], requires: ["beta"] });
        const b = mod("Material", "B", { provides: ["beta"], requires: ["alpha"] });
        const tracer = mod("Tracer", "T", { provides: ["shadePixel"], requires: ["alpha"], entry: "shadePixel" });

        expect(() => linkRecipe(recipe([tracer, a, b], "shadePixel"))).toThrow(/cyclic dependencies/);
    });

    it("errors on self-dependency (provides and requires same symbol)", () => {
        const bad = mod("Material", "Bad", { provides: ["foo"], requires: ["foo"] });
        const tracer = mod("Tracer", "T", { provides: ["shadePixel"], requires: ["foo"], entry: "shadePixel" });
        expect(() => linkRecipe(recipe([tracer, bad], "shadePixel"))).toThrow(/self-dependency/);
    });
});

