/**
 * ids.ts — v1
 * ------------------------------------------------------------
 * PURPOSE
 *   Provide stable identities for Components and deterministic hashes that
 *   drive caching, hot-swapping, and reproducible builds.
 *
 * COMPONENT ID SCHEMA
 *   - kind:    Discriminator for the role ("Geometry" | "Camera" | "Scene" |
 *              "Material" | "Light" | "Sampler" | "Tracer" | "Film" |
 *              "Developer" | "Extension").
 *   - name:    Human-readable component name (stable across runs).
 *   - version: Semver-like string that MUST bump on any behavior change that
 *              affects generated GLSL, parameter semantics, or IO layout.
 *   - variantTag?: Optional descriptive tag for human debugging (e.g., "MIS",
 *                  "Naive", "ThinLens"); *not* included in component hashing.
 *
 * PROGRAM KEYING (guidance)
 *   - Program keys are derived later from the *Assembly Recipe* (resolved
 *     module IDs + constants + vertex template version). This file only
 *     supplies per-component hashing utilities.
 *
 * HASHING & STABILITY
 *   - Hash ComponentIDs via deterministic JSON (sorted keys, no variantTag).
 *   - The hash must be deterministic across processes and JS engines.
 *
 * INVALIDATION RULES
 *   - Changing any of (kind, name, version) invalidates caches referencing it.
 *
 * DIAGNOSTICS
 *   - Provide a short stable label for logs (first 8 hex chars) and a human
 *     readable expansion (kind/name@version[+variantTag]).
 *
 * EVOLUTION NOTES
 *   - v1.1 may add `buildMeta` (e.g., compiler version) to program keys (elsewhere)
 *     if shader backend differences need cache segregation.
 */

export type ComponentKind =
    | "Geometry" | "Camera" | "Scene" | "Material" | "Light"
    | "Sampler"  | "Tracer" | "Film"  | "Developer" | "Extension";

export interface ComponentID {
    readonly kind: ComponentKind;
    readonly name: string;       // stable human-readable name
    readonly version: string;    // bump on behavior change that affects code shape
    readonly variantTag?: string; // optional hint; NOT part of identity hash
}

/** Deterministic stringify with sorted object keys. */
export function stableStringify(value: unknown): string {
    const seen = new WeakSet<object>();
    const stringify = (v: unknown): string => {
        if (v === null || typeof v !== "object") {
            return JSON.stringify(v);
        }
        if (seen.has(v as object)) throw new TypeError("stableStringify: cycle detected");
        seen.add(v as object);

        if (Array.isArray(v)) {
            return `[${v.map(stringify).join(",")}]`;
        }
        const obj = v as Record<string, unknown>;
        const keys = Object.keys(obj).sort();
        const entries = keys.map((k) => `${JSON.stringify(k)}:${stringify(obj[k])}`);
        return `{${entries.join(",")}}`;
    };
    return stringify(value);
}

/** FNV-1a 32-bit hash (hex string) for short, stable ids. */
export function fnv1a32(input: string): string {
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        // multiply by FNV prime 16777619 (mod 2^32)
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
}

/**
 * Compute a stable component hash from (kind, name, version), deliberately
 * ignoring `variantTag` so human-facing variant labels don’t perturb identity.
 */
export function hashComponentID(id: ComponentID): string {
    const base = { kind: id.kind, name: id.name, version: id.version };
    return fnv1a32(stableStringify(base));
}

/** Human-readable label like "Tracer/path@1.0.0+MIS#a1b2c3d4". */
export function formatComponentLabel(id: ComponentID): string {
    const tag = id.variantTag ? `+${id.variantTag}` : "";
    return `${id.kind}/${id.name}@${id.version}${tag}#${hashComponentID(id).slice(0, 8)}`;
}
