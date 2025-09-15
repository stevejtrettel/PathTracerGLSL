import { describe, it, expect } from "vitest";
import type { ComponentID } from "../../../../src/core/ids";
import type { ShaderFragment, ShaderModuleDescriptor } from "../../../../src/core/shader-fragment";
import {
    isAssemblyRecipe,
    sortedConstantEntries,
    type AssemblyRecipe,
} from "../../../../src/engine/shaders/assembly-recipe";

function dummyID(kind: ComponentID["kind"], name = "Dummy", version = "1.0.0"): ComponentID {
    return { kind, name, version };
}

function mod(kind: ComponentID["kind"], provides?: string, entry?: string): ShaderModuleDescriptor {
    const fragment: ShaderFragment = {
        functions: provides ? `void ${provides}(){}` : "",
        provides: provides ? [provides] : [],
        entrypoints: entry ? { fragmentMain: entry } : undefined,
    };
    return { id: dummyID(kind), fragment };
}

describe("AssemblyRecipe shape", () => {
    it("accepts a minimal valid recipe", () => {
        const recipe: AssemblyRecipe = {
            modules: [mod("Tracer", "shadePixel", "shadePixel")],
            entry: { name: "shadePixel" },
        };
        expect(isAssemblyRecipe(recipe)).toBe(true);
    });

    it("rejects missing or malformed entry", () => {
        // @ts-expect-error
        const bad1: AssemblyRecipe = { modules: [], entry: undefined as any };
        // @ts-expect-error
        const bad2: any = { modules: [], entry: { name: 42 } };
        expect(isAssemblyRecipe(bad1)).toBe(false);
        expect(isAssemblyRecipe(bad2)).toBe(false);
    });

    it("rejects constants with non-primitive values", () => {
        const ok: AssemblyRecipe = {
            modules: [mod("Tracer", "shadePixel", "shadePixel")],
            entry: { name: "shadePixel" },
            constants: { MAX_BOUNCES: 3, USE_FOO: true, PROFILE: "dev" },
        };
        expect(isAssemblyRecipe(ok)).toBe(true);

        const bad: any = {
            modules: [mod("Tracer", "shadePixel", "shadePixel")],
            entry: { name: "shadePixel" },
            constants: { OBJ: { nested: true } },
        };
        expect(isAssemblyRecipe(bad)).toBe(false);
    });
});

describe("sortedConstantEntries", () => {
    it("returns empty for undefined constants", () => {
        expect(sortedConstantEntries(undefined)).toEqual([]);
    });

    it("sorts keys deterministically", () => {
        const c = { B: 2, A: 1, Z: 0, PROFILE: "dev" };
        const entries = sortedConstantEntries(c);
        expect(entries.map(([k]) => k)).toEqual(["A", "B", "PROFILE", "Z"]);
    });
});
