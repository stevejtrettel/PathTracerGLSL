// src/engine/shaders/program-key.ts
/**
 * program-key.ts — v1
 * ------------------------------------------------------------
 * PURPOSE
 *   Compute a deterministic cache key for an assembled shader program.
 *   The key is derived from the *resolved* (linked) module order, compile-time
 *   constants, and a caller-supplied vertex-template version tag.
 *
 * WHY
 *   - Distinguish programs by exact code shape (no instance params).
 *   - Enable robust shader program caching and hot-swapping.
 *
 * INPUTS
 *   - AssemblyRecipe: for constants (read only).
 *   - LinkReport: for the final, topologically-resolved module order.
 *   - vertexTemplateVersion: string tag (e.g., "v1") that the caller bumps if
 *     the vertex template changes in a way that should break the cache.
 *
 * KEY CONTENTS (conceptual)
 *   {
 *     modules: [ hash(ComponentID in resolved order) ],
 *     constants: [ [key,value], ... ] // keys sorted lexicographically
 *     vertex: "v1"
 *   }
 *
 * OUTPUTS
 *   - key: full 32-bit hex digest (FNV-1a over stable JSON)
 *   - short: first 8 hex chars for logs
 *   - breakdown: human-readable pieces for diagnostics
 *
 * INVARIANTS
 *   - Reordering modules in the *input* recipe does not affect the key; only
 *     the *resolved* order from the linker is used.
 *   - Reordering properties inside `constants` does not affect the key.
 *   - Instance parameter values do NOT affect the key (only code shape).
 *
 * EVOLUTION NOTES
 *   - v1.1 may add a backend/compiler version field if you later support
 *     multiple GLSL backends and want cache segregation per backend.
 */

import type { AssemblyRecipe } from "./assembly-recipe";
import { sortedConstantEntries } from "./assembly-recipe";
import type { LinkReport } from "./dependency-linker";
import { hashComponentID, stableStringify, formatComponentLabel } from "../../core/ids";

export interface ProgramKeyBreakdown {
    modules: ReadonlyArray<{ label: string; hash: string }>;
    constants: ReadonlyArray<readonly [string, number | boolean | string]>;
    vertexTemplateVersion: string;
}

export interface ProgramKeyResult {
    key: string;    // full hex digest
    short: string;  // first 8 chars
    breakdown: ProgramKeyBreakdown;
}

/** Compute a deterministic program key from link result + recipe constants. */
export function computeProgramKey(
    recipe: AssemblyRecipe,
    link: LinkReport,
    vertexTemplateVersion: string
): ProgramKeyResult {
    const modules = link.resolvedOrder.map((m) => ({
        label: formatComponentLabel(m.id),
        hash: hashComponentID(m.id),
    }));
    const constants = sortedConstantEntries(recipe.constants);
    const payload = {
        modules: modules.map((m) => m.hash),
        constants, // already sorted
        vertex: vertexTemplateVersion,
    };
    const json = stableStringify(payload);
    const key = fnv1a32(json);
    return {
        key,
        short: key.slice(0, 8),
        breakdown: { modules, constants, vertexTemplateVersion },
    };
}

/** FNV-1a 32-bit hash (hex) — local copy to keep this file standalone. */
function fnv1a32(input: string): string {
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
}
