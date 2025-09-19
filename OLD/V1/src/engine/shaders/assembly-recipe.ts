// src/engine/shaders/assembly-recipe.ts
/**
 * assembly-recipe.ts — v1
 * ------------------------------------------------------------
 * PURPOSE
 *   Define the immutable "AssemblyRecipe": the full specification of what
 *   shader code should be built for a single render program. Recipes drive
 *   reproducible, branch-free shader compilation.
 *
 * ROLE IN PIPELINE
 *   - Created by the RenderEngine when asked to render a World + Photography.
 *   - Passed to the ShaderCompiler, which resolves dependencies, namespaces,
 *     and emits GLSL.
 *   - Serves as the canonical input to ProgramKey hashing and shader caching.
 *
 * STRUCTURE
 *   modules:   Ordered list of ShaderModuleDescriptors (pair of ComponentID +
 *              ShaderFragment). The list expresses preferred order, but the
 *              compiler may reorder slightly to satisfy dependencies.
 *
 *   constants: Map of inlined compile-time constants (e.g., MAX_BOUNCES, PI).
 *              Emitted as `const` declarations or literal replacements.
 *              Deterministically serialized for ProgramKey hashing.
 *
 *   entry:     Link target describing which provided symbol is the final
 *              program entrypoint (e.g., "shadePixel"). The compiler generates
 *              a canonical `main()` that forwards here.
 *
 * INVARIANTS
 *   - Recipes are immutable once constructed.
 *   - Every required symbol from every module must be satisfied within the
 *     recipe or by built-in templates; otherwise compilation fails.
 *   - Exactly one entrypoint must be reachable.
 *
 * CACHE INTEGRATION
 *   - ProgramKey is derived from (resolved module ComponentIDs in final order
 *     + constants blob). This makes caching deterministic and variant-safe.
 *
 * DIAGNOSTICS
 *   - Recipes should be easy to pretty-print: list of module names/versions,
 *     constants table, entry symbol.
 *
 * NON-GOALS
 *   - No runtime parameter values (instance-level). Only code-shape inputs
 *     (modules + constants).
 *   - No multi-pass orchestration (handled at a higher pipeline level).
 *
 * TESTING GUIDANCE
 *   - Constructing two Recipes with the same inputs yields identical ProgramKey.
 *   - Changing module list, entry symbol, or constants changes ProgramKey.
 *   - Invalid recipes (e.g., multiple entrypoints, missing required symbol)
 *     fail compilation with precise diagnostics (enforced by linker/compiler).
 *
 * EVOLUTION NOTES
 *   - v1.1 may extend constants to typed literals (vec3, mat4).
 *   - v2 may allow Recipes to encode multi-pass DAGs, not just single-pass.
 */

import type { ShaderModuleDescriptor } from "../../core/shader-fragment";

/** Compile-time constants injected into the program. */
export type RecipeConstants = Readonly<Record<string, number | boolean | string>>;

/** Entry specification for the fragment stage (name of the entry symbol). */
export interface EntrySpec {
    readonly name: string; // e.g., "shadePixel"
}

/** Immutable, deterministic specification for one assembled program. */
export interface AssemblyRecipe {
    readonly modules: readonly ShaderModuleDescriptor[];
    readonly constants?: RecipeConstants;
    readonly entry: EntrySpec;
}

/** Lightweight schema guard (shape-only; no deep semantic checks). */
export function isAssemblyRecipe(x: unknown): x is AssemblyRecipe {
    if (typeof x !== "object" || x === null) return false;
    const r = x as Record<string, unknown>;
    if (!Array.isArray(r.modules)) return false;

    // entry.name must be a string
    const entry = r.entry as EntrySpec | undefined;
    if (!entry || typeof entry !== "object" || typeof entry.name !== "string") {
        return false;
    }

    // constants, if present, must be a plain object with primitive values
    if (r.constants !== undefined) {
        const c = r.constants as Record<string, unknown>;
        if (typeof c !== "object" || c === null || Array.isArray(c)) return false;
        for (const [k, v] of Object.entries(c)) {
            const t = typeof v;
            if (!(t === "number" || t === "boolean" || t === "string")) {
                // eslint-disable-next-line no-console
                console.warn(`AssemblyRecipe.constants["${k}"] is not a number|boolean|string`);
                return false;
            }
        }
    }

    return true;
}

/**
 * Produce a stable, sorted view of constants suitable for hashing or pretty-printing.
 * Keys are sorted lexicographically; values are passed through unchanged.
 */
export function sortedConstantEntries(
    constants: RecipeConstants | undefined
): ReadonlyArray<readonly [string, number | boolean | string]> {
    if (!constants) return [];
    const keys = Object.keys(constants).sort();
    return keys.map((k) => [k, constants[k]] as const);
}
