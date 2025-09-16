import { describe, it, expect } from "vitest";
import TextureUnitPool from "../../../../src/engine/bindings/texture-unit-pool";

describe("TextureUnitPool", () => {
    it("allocates sequentially within [base, base+size)", () => {
        const pool = new TextureUnitPool({ baseUnit: 3, size: 4 });
        expect(pool.acquire("a")).toBe(3);
        expect(pool.acquire("b")).toBe(4);
        expect(pool.acquire("c")).toBe(5);

        // Reacquire returns same unit
        expect(pool.acquire("a")).toBe(3);

        // Map query helpers
        expect(pool.unitOf("b")).toBe(4);
        expect(pool.logicalOf(5)).toBe("c");

        // Capacity info
        expect(pool.first).toBe(3);
        expect(pool.end).toBe(7);
        expect(pool.capacity).toBe(4);
        expect(pool.count).toBe(3);
    });

    it("evicts least-recently-used when full (unpinned only)", () => {
        const pool = new TextureUnitPool({ baseUnit: 0, size: 2 });
        const uA = pool.acquire("a"); // 0
        const uB = pool.acquire("b"); // 1
        expect([uA, uB]).toEqual([0, 1]);

        // Touch 'a' so 'b' is least-recently-used
        pool.touch("a");

        const uC = pool.acquire("c"); // should evict 'b'
        expect(uC).toBe(1);
        expect(pool.logicalOf(0)).toBe("a");
        expect(pool.logicalOf(1)).toBe("c");
        expect(pool.unitOf("b")).toBeUndefined();
    });

    it("respects pinning: evicts unpinned first; throws if all pinned", () => {
        const pool = new TextureUnitPool({ baseUnit: 5, size: 2 });
        const uA = pool.acquire("a", { pin: true }); // 5 pinned
        const uB = pool.acquire("b");                // 6 unpinned
        expect([uA, uB]).toEqual([5, 6]);

        // Next acquire should evict 'b', not 'a'
        const uC = pool.acquire("c");
        expect(uC).toBe(6);
        expect(pool.logicalOf(5)).toBe("a");
        expect(pool.logicalOf(6)).toBe("c");
        expect(pool.unitOf("b")).toBeUndefined();

        // Pin 'c' too; now both pinned → acquiring new should throw
        expect(pool.pin("c")).toBe(true);
        expect(() => pool.acquire("d")).toThrow(/all pinned/);
    });

    it("release frees a unit for reuse (lowest free wins by scan order)", () => {
        const pool = new TextureUnitPool({ baseUnit: 2, size: 3 });
        const uA = pool.acquire("a"); // 2
        const uB = pool.acquire("b"); // 3
        const uC = pool.acquire("c"); // 4
        expect([uA, uB, uC]).toEqual([2, 3, 4]);

        // release 'b' (unit 3) then acquire 'd' → should reuse 3
        expect(pool.release("b")).toBe(3);
        const uD = pool.acquire("d");
        expect(uD).toBe(3);
        expect(pool.logicalOf(3)).toBe("d");
        expect(pool.unitOf("b")).toBeUndefined();
    });

    it("unpin allows later eviction", () => {
        const pool = new TextureUnitPool({ baseUnit: 0, size: 2 });
        pool.acquire("a", { pin: true }); // 0 pinned
        pool.acquire("b");                // 1

        // Unpin 'a' then acquire 'c' → 'a' is LRU (if we don't touch it) → evicted
        expect(pool.unpin("a")).toBe(true);
        const uC = pool.acquire("c");
        expect([pool.logicalOf(0), pool.logicalOf(1)].sort()).toEqual(["b", "c"].sort());
        expect(pool.unitOf("a")).toBeUndefined();
    });

    it("reset clears all mappings (tick preserved; not observable here)", () => {
        const pool = new TextureUnitPool({ baseUnit: 4, size: 2 });
        pool.acquire("x"); // 4
        pool.acquire("y"); // 5
        expect(pool.count).toBe(2);

        pool.reset();
        expect(pool.count).toBe(0);
        expect(pool.unitOf("x")).toBeUndefined();

        // Allocation restarts with base unit
        expect(pool.acquire("z")).toBe(4);
    });
});
