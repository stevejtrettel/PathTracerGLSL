import { describe, it, expect } from "vitest";
import { registerModuleParams, formatComponentScope, type ModuleParamSchema } from "../../../../src/engine/parameters/register-module-params";
import type { ComponentID } from "../../../../src/core/ids";
import type { ParameterDescriptor, ParameterValue } from "../../../../src/engine/parameters/parameter-store";
import type { ParameterStoreReg } from "../../../../src/engine/parameters/register-module-params";

// --- Mocks ---

class MockStore implements ParameterStoreReg {
    public registrations: Array<{ scope: string; descriptors: ParameterDescriptor[] }> = [];
    public values = new Map<string, Map<string, ParameterValue>>();
    public listeners = new Map<string, Map<string, Set<(v: any, o: any) => void>>>();

    register(scope: string, descriptors: ParameterDescriptor[]): void {
        this.registrations.push({ scope, descriptors });
        if (!this.values.has(scope)) this.values.set(scope, new Map());
        if (!this.listeners.has(scope)) this.listeners.set(scope, new Map());
        const ns = this.values.get(scope)!;
        const ls = this.listeners.get(scope)!;
        for (const d of descriptors) {
            if (!ns.has(d.logical)) ns.set(d.logical, d.default);
            if (!ls.has(d.logical)) ls.set(d.logical, new Set());
        }
    }

    set(scope: string, logical: string, value: ParameterValue): void {
        const ns = this.values.get(scope);
        if (!ns) throw new Error(`set: unknown scope ${scope}`);
        const old = ns.get(logical);
        ns.set(logical, value);
        const ls = this.listeners.get(scope)?.get(logical);
        if (ls) for (const cb of ls) cb(value, old);
    }

    get(scope: string, logical: string): ParameterValue | undefined {
        return this.values.get(scope)?.get(logical);
    }

    onChange(scope: string, logical: string, cb: (v: any, o: any) => void): void {
        const s = this.listeners.get(scope);
        if (!s) return;
        const set = s.get(logical);
        if (!set) return;
        set.add(cb);
    }
}

function id(kind: ComponentID["kind"], name: string, version = "1.0.0"): ComponentID {
    return { kind, name, version };
}

describe("registerModuleParams", () => {
    it("formats canonical scope label", () => {
        const scope = formatComponentScope(id("Material", "Lambert", "2.3.1"));
        expect(scope).toBe("Material/Lambert@2.3.1");
    });

    it("registers descriptors, sets defaults, and returns a scoped view", () => {
        const store = new MockStore();

        const schema: ModuleParamSchema = [
            { name: "exposure", kind: "float", default: 1.0, min: 0.0, max: 8.0, resetPolicy: "accumulation" },
            { name: "albedo",   kind: "vec3",  default: [1, 1, 1], resetPolicy: "accumulation" },
            { name: "enabled",  kind: "boolean", default: true, resetPolicy: "none" },
        ];

        const view = registerModuleParams(store, id("Material", "Lambert"), schema);

        expect(view.scope).toBe("Material/Lambert@1.0.0");
        expect(view.names.sort()).toEqual(["exposure", "albedo", "enabled"].sort());

        // Store got called once with full descriptors
        expect(store.registrations.length).toBe(1);
        const d = store.registrations[0].descriptors;
        const byName = new Map(d.map((x) => [x.logical, x]));
        expect(byName.get("exposure")?.kind).toBe("float");
        expect(byName.get("exposure")?.resetPolicy).toBe("accumulation");
        expect(byName.get("albedo")?.kind).toBe("vec3");
        expect(byName.get("enabled")?.default).toBe(true);

        // Defaults applied
        expect(store.get(view.scope, "exposure")).toBe(1.0);
        expect(store.get(view.scope, "albedo")).toEqual([1, 1, 1]);
        expect(store.get(view.scope, "enabled")).toBe(true);

        // Scoped get/set works
        view.set("exposure", 2.5);
        expect(view.get("exposure")).toBe(2.5);

        // onChange wiring
        let seen: any = null;
        view.onChange("exposure", (v) => (seen = v));
        view.set("exposure", 3.0);
        expect(seen).toBe(3.0);
    });

    it("rejects duplicate parameter names in a schema", () => {
        const store = new MockStore();
        const schema: ModuleParamSchema = [
            { name: "exposure", kind: "float", default: 1.0 },
            { name: "exposure", kind: "float", default: 2.0 },
        ];
        expect(() => registerModuleParams(store, id("Film", "Simple"), schema))
            .toThrow(/duplicate parameter "exposure"/);
    });

    it("sets persistent default to true when unspecified", () => {
        const store = new MockStore();
        const schema: ModuleParamSchema = [
            { name: "foo", kind: "float", default: 0.5 },              // persistent default: true
            { name: "bar", kind: "float", default: 0.5, persistent: false }, // explicit false
        ];
        const view = registerModuleParams(store, id("Sampler", "Random"), schema);
        const reg = store.registrations.find(r => r.scope === view.scope)!;
        const byName = new Map(reg.descriptors.map(x => [x.logical, x]));
        expect(byName.get("foo")?.persistent).toBe(true);
        expect(byName.get("bar")?.persistent).toBe(false);
    });
});
