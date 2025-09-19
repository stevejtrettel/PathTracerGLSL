// src/engine/bindings/texture-unit-pool.ts
/**
 * texture-unit-pool.ts — v1
 * ------------------------------------------------------------
 * PURPOSE
 *   Manage a fixed range of WebGL texture units and assign them to
 *   logical samplers deterministically:
 *     - Stable mapping per logical name
 *     - LRU eviction when pool is full
 *     - Pinning to protect units (not evicted)
 *     - Base-unit offset support (e.g., reserve low units for engine)
 *
 * SCOPE
 *   - Pure CPU book-keeping; does not call WebGL.
 *   - Resource binding (gl.activeTexture/bindTexture + setting sampler uniforms)
 *     will be handled in a separate ResourceBinder.
 */

export interface TextureUnitPoolOptions {
    /** First unit index to use (e.g., 0 or 2 if you reserve 0–1 for engine). Default: 0. */
    baseUnit?: number;
    /** Number of units managed by the pool. Must be >= 1. */
    size: number;
}

interface Entry {
    unit: number;         // absolute unit index (baseUnit + offset)
    lastUsed: number;     // monotonic tick for LRU
    pinned: boolean;      // true → cannot be evicted
}

/**
 * TextureUnitPool
 * - acquire(logical, {pin?}) → returns a GL unit index
 * - release(logical) → frees mapping
 * - pin/unpin(logical) → toggle eviction protection on an existing mapping
 * - reset() → clears all mappings
 */
export default class TextureUnitPool {
    private readonly baseUnit: number;
    private readonly size: number;

    // logical -> entry
    private map = new Map<string, Entry>();
    // unit -> logical
    private byUnit = new Map<number, string>();
    // LRU tick
    private tick = 0;

    constructor(opts: TextureUnitPoolOptions) {
        if (!opts || typeof opts.size !== "number" || opts.size < 1) {
            throw new Error("TextureUnitPool: options.size must be >= 1");
        }
        this.baseUnit = opts.baseUnit ?? 0;
        this.size = opts.size;
    }

    /** First managed unit index. */
    get first(): number { return this.baseUnit; }
    /** One past the last managed unit index. */
    get end(): number { return this.baseUnit + this.size; }
    /** Total units managed. */
    get capacity(): number { return this.size; }
    /** Currently assigned logical count. */
    get count(): number { return this.map.size; }

    /**
     * Acquire a unit for a logical name.
     * - If already assigned → returns existing unit (and marks recent).
     * - Else assigns a free unit if available.
     * - Else evicts the least-recently-used *unpinned* mapping and reuses its unit.
     * Throws if eviction is required but all units are pinned.
     */
    acquire(logical: string, opts?: { pin?: boolean }): number {
        const pin = !!opts?.pin;

        // Existing mapping: refresh LRU + pin if requested
        const existing = this.map.get(logical);
        if (existing) {
            existing.lastUsed = ++this.tick;
            if (pin) existing.pinned = true;
            return existing.unit;
        }

        // Try to find a free unit in range [baseUnit, baseUnit+size)
        for (let u = this.baseUnit; u < this.baseUnit + this.size; u++) {
            if (!this.byUnit.has(u)) {
                // assign fresh
                const e: Entry = { unit: u, lastUsed: ++this.tick, pinned: pin };
                this.map.set(logical, e);
                this.byUnit.set(u, logical);
                return u;
            }
        }

        // No free units → evict LRU among unpinned
        let evictLogical: string | null = null;
        let evictEntry: Entry | null = null;
        for (const [name, e] of this.map.entries()) {
            if (e.pinned) continue;
            if (!evictEntry || e.lastUsed < evictEntry.lastUsed) {
                evictEntry = e;
                evictLogical = name;
            }
        }
        if (!evictEntry || evictLogical === null) {
            throw new Error("TextureUnitPool: no available texture units (all pinned)");
        }

        // Reuse the evicted unit
        const unit = evictEntry.unit;
        this.map.delete(evictLogical);
        this.byUnit.delete(unit);

        const newEntry: Entry = { unit, lastUsed: ++this.tick, pinned: pin };
        this.map.set(logical, newEntry);
        this.byUnit.set(unit, logical);
        return unit;
    }

    /** Release an assignment for a logical name. Returns the freed unit or undefined. */
    release(logical: string): number | undefined {
        const e = this.map.get(logical);
        if (!e) return undefined;
        this.map.delete(logical);
        this.byUnit.delete(e.unit);
        return e.unit;
    }

    /** Mark an existing mapping as recently used (affects LRU). */
    touch(logical: string): void {
        const e = this.map.get(logical);
        if (e) e.lastUsed = ++this.tick;
    }

    /** Protect an existing mapping from eviction. Returns false if mapping doesn't exist. */
    pin(logical: string): boolean {
        const e = this.map.get(logical);
        if (!e) return false;
        e.pinned = true;
        return true;
    }

    /** Allow an existing mapping to be evicted later. Returns false if mapping doesn't exist. */
    unpin(logical: string): boolean {
        const e = this.map.get(logical);
        if (!e) return false;
        e.pinned = false;
        return true;
    }

    /** Query whether an existing mapping is pinned. */
    isPinned(logical: string): boolean {
        return !!this.map.get(logical)?.pinned;
    }

    /** Get the unit assigned to a logical name, if any. */
    unitOf(logical: string): number | undefined {
        return this.map.get(logical)?.unit;
    }

    /** Get the logical name assigned to a unit, if any. */
    logicalOf(unit: number): string | undefined {
        return this.byUnit.get(unit);
    }

    /** Clear all mappings (tick preserved for monotonicity). */
    reset(): void {
        this.map.clear();
        this.byUnit.clear();
    }

    /** Debug snapshot for tests or tooling. */
    debugState(): Array<{ logical: string; unit: number; pinned: boolean; lastUsed: number }> {
        return Array.from(this.map.entries()).map(([logical, e]) => ({
            logical, unit: e.unit, pinned: e.pinned, lastUsed: e.lastUsed,
        })).sort((a, b) => a.unit - b.unit);
    }
}
