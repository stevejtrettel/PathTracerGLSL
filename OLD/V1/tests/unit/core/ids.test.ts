import { describe, it, expect } from "vitest";
import {
    stableStringify,
    fnv1a32,
    hashComponentID,
    formatComponentLabel,
    type ComponentID,
} from "../../../src/core/ids";

describe("stableStringify", () => {
    it("sorts object keys deterministically", () => {
        const a = { b: 2, a: 1 };
        const b = { a: 1, b: 2 };
        expect(stableStringify(a)).toBe(stableStringify(b));
    });

    it("handles arrays and primitives", () => {
        expect(stableStringify([1, "x", true])).toBe("[1,\"x\",true]");
        expect(stableStringify(null)).toBe("null");
    });
});

describe("hashing", () => {
    it("fnv1a32 is stable", () => {
        expect(fnv1a32("hello")).toBe(fnv1a32("hello"));
    });

    it("component hash ignores variantTag", () => {
        const a: ComponentID = { kind: "Tracer", name: "Path", version: "1.0.0", variantTag: "MIS" };
        const b: ComponentID = { kind: "Tracer", name: "Path", version: "1.0.0", variantTag: "Naive" };
        expect(hashComponentID(a)).toBe(hashComponentID(b));
    });

    it("component hash changes with version", () => {
        const v1: ComponentID = { kind: "Material", name: "Lambert", version: "1.0.0" };
        const v2: ComponentID = { kind: "Material", name: "Lambert", version: "1.0.1" };
        expect(hashComponentID(v1)).not.toBe(hashComponentID(v2));
    });

    it("formats human-readable labels", () => {
        const id: ComponentID = { kind: "Geometry", name: "Euclidean", version: "1.2.3", variantTag: "Default" };
        const label = formatComponentLabel(id);
        expect(label.startsWith("Geometry/Euclidean@1.2.3+Default#")).toBe(true);
        expect(label.length).toBeGreaterThan(20);
    });
});
