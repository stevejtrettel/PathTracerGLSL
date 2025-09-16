// src/engine/resources/resource-directory.ts
/**
 * resource-directory.ts — v1
 * ------------------------------------------------------------
 * PURPOSE
 *   Minimal registry of *logical* sampler bindings that modules expect.
 *   The app fills this directory (once or per-frame). The engine takes
 *   a snapshot and lets ResourceBinder allocate/bind texture units.
 *
 * API
 *   set(logical, { texture, target, pin? })
 *   remove(logical)
 *   clear()
 *   has(logical)
 *   get(logical)           // returns a copy, not the live entry
 *   snapshot()             // plain object of shallow-frozen entry copies
 *
 * NOTES
 *   - `pin?: true` hints the binder to keep this sampler on a stable unit.
 *   - `target` is the GL enum (e.g., gl.TEXTURE_2D, gl.TEXTURE_CUBE_MAP).
 */

export interface SamplerResource {
    texture: WebGLTexture;
    target: number;   // GL enum for texture target
    pin?: boolean;    // optional: request unit pinning
}

export type ResourceDirectorySnapshot = Record<
    string,
    { texture: WebGLTexture; target: number; pin?: boolean }
    >;

interface Entry {
    texture: WebGLTexture;
    target: number;
    pin: boolean; // stored as concrete boolean
}

export default class ResourceDirectory {
    private table = new Map<string, Entry>();

    /** Add or replace a logical sampler binding. */
    set(logical: string, res: SamplerResource): void {
        this.table.set(logical, {
            texture: res.texture,
            target: res.target | 0,
            pin: !!res.pin,
        });
    }

    /** Remove a logical binding (no-op if absent). */
    remove(logical: string): void {
        this.table.delete(logical);
    }

    /** Clear all bindings. */
    clear(): void {
        this.table.clear();
    }

    /** True if a binding exists. */
    has(logical: string): boolean {
        return this.table.has(logical);
    }

    /**
     * Get a *copy* of a binding (so callers can't mutate internal state).
     * Returns undefined if not present.
     */
    get(logical: string): { texture: WebGLTexture; target: number; pin: boolean } | undefined {
        const e = this.table.get(logical);
        if (!e) return undefined;
        return { texture: e.texture, target: e.target, pin: e.pin };
    }

    /**
     * Produce a snapshot suitable for passing to ResourceBinder.bind(...).
     * Returns a new plain object each call; entries are *copies* (not frozen),
     * so external mutation won’t affect internal state and won’t throw.
     * If pin is false, the property is omitted.
     */
    snapshot(): ResourceDirectorySnapshot {
        const out: ResourceDirectorySnapshot = Object.create(null);
        for (const [logical, e] of this.table) {
            const record: { texture: WebGLTexture; target: number; pin?: boolean } = {
                texture: e.texture,
                target: e.target,
            };
            if (e.pin) record.pin = true;
            out[logical] = record;
        }
        return out;
    }

}
