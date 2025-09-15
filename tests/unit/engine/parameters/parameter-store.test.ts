import { describe, it, expect, beforeEach } from "vitest";
import ParameterStore, { type ParamDescriptor, type ParamValue } from "../../../../src/engine/parameters/parameter-store";

describe("ParameterStore", () => {
    let store: ParameterStore;
    const scope = "Material/Lambert@1.0.0";

    beforeEach(() => {
        store = new ParameterStore();
    });

    function regs(): ParamDescriptor[] {
        return [
            { logical: "albedo", default: [1, 1, 1], kind: "vec3", resetPolicy: "accumulation" },
            { logical: "exposure", default: 1.0, kind: "float", resetPolicy: "none", min: 0.0, max: 10.0 },
            { logical: "bounces", default: 4, kind: "int", resetPolicy: "program" },
            { logical: "enabled", default: true, kind: "bool" },
            { logical: "uvScale", default: [1, 1], kind: "vec2" },
            { logical: "clip", default: [0, 1, 0, 1], kind: "vec4" },
            { logical: "M4", default: new Float32Array(16), kind: "mat4" },
        ];
    }

    it("registers descriptors and exposes defaults", () => {
        store.register(scope, regs());
        expect(store.has(scope, "albedo")).toBe(true);
        expect(store.get(scope, "albedo")).toEqual([1, 1, 1]);
        expect(store.get(scope, "exposure")).toBe(1.0);
    });

    it("marks params dirty on change and collects them", () => {
        store.register(scope, regs());
        store.set(scope, "albedo", [0.8, 0.2, 0.2]);
        store.set(scope, "enabled", false);

        const dirty = store.collectDirty().sort((a, b) => a.logical.localeCompare(b.logical));
        expect(dirty.map((d) => d.logical)).toEqual(["albedo", "enabled"]);
        const alb = dirty.find((d) => d.logical === "albedo")!;
        expect(alb.kind).toBe("vec3");
        expect(alb.resetPolicy).toBe("accumulation");

        store.markClean(scope, ["albedo"]);
        const after = store.collectDirty().map((d) => d.logical);
        expect(after).toEqual(["enabled"]);
    });

    it("validates types and ranges; rejects invalid sets", () => {
        store.register(scope, regs());

        // wrong type for vec3
        store.set(scope, "albedo", [1, 2] as unknown as ParamValue);
        expect(store.collectDirty().length).toBe(0);

        // out of range exposure
        store.set(scope, "exposure", 100);
        expect(store.collectDirty().length).toBe(0);

        // correct set
        store.set(scope, "exposure", 2.0);
        expect(store.collectDirty().map((d) => d.logical)).toEqual(["exposure"]);
    });

    it("supports serialize/deserialize without marking dirty", () => {
        store.register(scope, regs());
        store.set(scope, "exposure", 2.5);
        store.set(scope, "enabled", false);
        const snapshot = store.serialize();

        // New store, same schema
        const s2 = new ParameterStore();
        s2.register(scope, regs());
        s2.deserialize(snapshot);

        expect(s2.get(scope, "exposure")).toBe(2.5);
        expect(s2.get(scope, "enabled")).toBe(false);
        expect(s2.collectDirty().length).toBe(0);
    });

    it("deserialize can mark as dirty when requested", () => {
        store.register(scope, regs());
        const data = { [scope]: { exposure: 1.23 } };
        store.deserialize(data, true);
        const dirty = store.collectDirty();
        expect(dirty.length).toBe(1);
        expect(dirty[0].logical).toBe("exposure");
    });

    it("updating descriptors preserves values", () => {
        store.register(scope, [{ logical: "exposure", default: 1.0, kind: "float" }]);
        store.set(scope, "exposure", 3.0);
        store.register(scope, [{ logical: "exposure", default: 0.5, kind: "float", min: 0, max: 5 }]);
        expect(store.get(scope, "exposure")).toBe(3.0);
        // constraint now applied
        store.set(scope, "exposure", 10.0);
        expect(store.get(scope, "exposure")).toBe(3.0); // unchanged due to max=5
    });

    it("collects across multiple scopes", () => {
        store.register("Material/A@1.0.0", [{ logical: "albedo", default: [1,1,1], kind: "vec3" }]);
        store.register("Material/B@1.0.0", [{ logical: "albedo", default: [0,0,0], kind: "vec3" }]);

        store.set("Material/A@1.0.0", "albedo", [0.9,0.9,0.9]);
        store.set("Material/B@1.0.0", "albedo", [0.1,0.1,0.1]);

        const dirty = store.collectDirty().map(d => `${d.scope}:${d.logical}`).sort();
        expect(dirty).toEqual(["Material/A@1.0.0:albedo", "Material/B@1.0.0:albedo"]);
    });
});
