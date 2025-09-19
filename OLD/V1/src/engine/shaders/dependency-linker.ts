// src/engine/shaders/dependency-linker.ts
/**
 * dependency-linker.ts — v1
 * ------------------------------------------------------------
 * PURPOSE
 *   Resolve `requires`/`provides` across ShaderFragments into a consistent,
 *   unambiguous program graph; compute reachability from the chosen entrypoint;
 *   and produce the resolved module order for assembly.
 *
 * INPUTS
 *   - AssemblyRecipe (modules, constants, entry symbol).
 *   - Each module’s `provides`/`requires` lists.
 *
 * OUTPUTS
 *   - LinkReport:
 *       • resolvedOrder: modules in a topologically valid, deterministic order
 *       • symbolTable: map publicSymbol → { provider ComponentID }
 *       • reachableModules: list of ComponentIDs needed for the entrypoint
 *       • warnings: e.g., providers that were pruned as unreachable
 *       • entryProvider: ComponentID that supplies the entry symbol
 *
 * LINKING RULES
 *   - Each required symbol must be provided by exactly one module.
 *   - Multiple providers for the same symbol is an error (ambiguity).
 *   - Modules with no provided symbols reachable from the entrypoint are pruned.
 *   - Deterministic ordering: break ties by (priority asc, kind, name, version).
 *
 * INVARIANTS
 *   - Public symbol names are matched exactly (case-sensitive).
 *   - Results are pure and reproducible for the same inputs.
 *
 * ERROR HANDLING
 *   - Missing required symbol → throw with a message naming the requiring and
 *     candidate modules.
 *   - Ambiguous providers → throw listing all conflicting providers.
 *   - Multiple entry providers or none → throw with guidance.
 *   - Cycles in the module dependency graph → throw with the cycle members.
 *
 * TESTING GUIDANCE
 *   - Single-chain dependency resolves with exact order.
 *   - Diamond dependency prunes unused branch when not referenced by entry.
 *   - Ambiguity and missing-provider cases produce clear, module-named errors.
 *
 * EVOLUTION NOTES
 *   - v1.1 may add “optional requires” for soft features, surfaced as warnings.
 *   - v2 may support namespaced public symbols (`geom::intersect`) if needed.
 */

import type { AssemblyRecipe } from "./assembly-recipe";
import type { ShaderModuleDescriptor } from "../../core/shader-fragment";
import type { ComponentID } from "../../core/ids";
import { formatComponentLabel, hashComponentID } from "../../core/ids";

export interface LinkReport {
    readonly resolvedOrder: readonly ShaderModuleDescriptor[];
    readonly symbolTable: Readonly<Record<string, ComponentID>>;
    readonly reachableModules: readonly ComponentID[];
    readonly warnings: readonly string[];
    readonly entryProvider: ComponentID;
}

/** Resolve a recipe into a deterministic module order and symbol table. */
export function linkRecipe(recipe: AssemblyRecipe): LinkReport {
    const modules = recipe.modules.slice(); // shallow copy (read-only outside)
    const providesBySymbol = new Map<string, ShaderModuleDescriptor[]>();

    // Index providers
    for (const m of modules) {
        const provides = m.fragment.provides ?? [];
        for (const sym of provides) {
            const arr = providesBySymbol.get(sym) ?? [];
            arr.push(m);
            providesBySymbol.set(sym, arr);
        }
    }

    // Entry resolution
    const entrySym = recipe.entry.name;
    const entryProviders = providesBySymbol.get(entrySym) ?? [];
    if (entryProviders.length === 0) {
        throw new Error(
            `Linker: entry symbol "${entrySym}" has no provider in the recipe.`
        );
    }
    if (entryProviders.length > 1) {
        const names = entryProviders.map((m) => formatComponentLabel(m.id)).join(", ");
        throw new Error(
            `Linker: entry symbol "${entrySym}" is provided by multiple modules: ${names}.`
        );
    }
    const entryModule = entryProviders[0];

    // Ambiguity guard (strict): any symbol with >1 providers is an error.
    for (const [sym, provs] of providesBySymbol.entries()) {
        if (provs.length > 1) {
            const names = provs.map((m) => formatComponentLabel(m.id)).join(", ");
            throw new Error(
                `Linker: symbol "${sym}" is provided by multiple modules: ${names}. ` +
                `Remove duplicates or split variants into separate recipes.`
            );
        }
    }

    // Reachability: starting from the entry provider, recursively include providers
    // of all required symbols.
    const reachable = new Set<ShaderModuleDescriptor>();
    const stack: ShaderModuleDescriptor[] = [entryModule];

    while (stack.length) {
        const m = stack.pop()!;
        if (reachable.has(m)) continue;
        reachable.add(m);

        for (const req of m.fragment.requires ?? []) {
            const provs = providesBySymbol.get(req);
            if (!provs || provs.length === 0) {
                throw new Error(
                    `Linker: module ${formatComponentLabel(m.id)} requires symbol "${req}" ` +
                    `which is not provided by any module in the recipe.`
                );
            }
            // provs.length > 1 is already guarded above (ambiguity).
            const provider = provs[0]!;
            stack.push(provider);
        }
    }

    // Build dependency edges among reachable modules (provider -> dependent).
    // Also compute in-degree.
    const reachableArr = Array.from(reachable);
    const indegree = new Map<ShaderModuleDescriptor, number>();
    const outgoing = new Map<ShaderModuleDescriptor, ShaderModuleDescriptor[]>();
    for (const m of reachableArr) {
        indegree.set(m, 0);
        outgoing.set(m, []);
    }

    for (const m of reachableArr) {
        for (const req of m.fragment.requires ?? []) {
            const provider = (providesBySymbol.get(req) ?? [])[0];
            if (!provider) continue; // should not happen due to earlier checks
            if (!reachable.has(provider)) continue; // also shouldn't happen
            // Self-edge is harmless but counts as a cycle; disallow
            if (provider === m) {
                throw new Error(
                    `Linker: module ${formatComponentLabel(m.id)} both requires and provides ` +
                    `symbol "${req}", creating a self-dependency.`
                );
            }
            outgoing.get(provider)!.push(m);
            indegree.set(m, (indegree.get(m) ?? 0) + 1);
        }
    }

    // Deterministic Kahn's algorithm with a stable comparator.
    const queue: ShaderModuleDescriptor[] = [];
    for (const m of reachableArr) {
        if ((indegree.get(m) ?? 0) === 0) queue.push(m);
    }
    queue.sort(compareModules);

    const ordered: ShaderModuleDescriptor[] = [];
    while (queue.length) {
        const m = queue.shift()!;
        ordered.push(m);
        for (const dep of outgoing.get(m) ?? []) {
            const next = (indegree.get(dep) ?? 0) - 1;
            indegree.set(dep, next);
            if (next === 0) {
                queue.push(dep);
                queue.sort(compareModules);
            }
        }
    }

    if (ordered.length !== reachable.size) {
        // Find members still with indegree > 0
        const stuck = reachableArr.filter((m) => (indegree.get(m) ?? 0) > 0);
        const names = stuck.map((m) => formatComponentLabel(m.id)).join(", ");
        throw new Error(`Linker: cyclic dependencies among: ${names}`);
    }

    // Symbol table (reachable-only)
    const symbolTable: Record<string, ComponentID> = {};
    for (const [sym, provs] of providesBySymbol.entries()) {
        const provider = provs[0];
        if (provider && reachable.has(provider)) {
            symbolTable[sym] = provider.id;
        }
    }

    // Warnings for pruned modules
    const reachableSet = new Set(ordered); // same as reachable but ordered-based
    const pruned = modules.filter((m) => !reachableSet.has(m));
    const warnings: string[] = [];
    if (pruned.length) {
        const list = pruned.map((m) => formatComponentLabel(m.id)).join(", ");
        warnings.push(`Linker: pruned unreachable modules: ${list}`);
    }

    return {
        resolvedOrder: ordered,
        symbolTable,
        reachableModules: ordered.map((m) => m.id),
        warnings,
        entryProvider: entryModule.id,
    };
}

/** Stable comparator for Kahn queue: (priority asc, kind, name, version, id-hash). */
function compareModules(a: ShaderModuleDescriptor, b: ShaderModuleDescriptor): number {
    const pa = a.priority ?? 0;
    const pb = b.priority ?? 0;
    if (pa !== pb) return pa - pb;

    const ka = a.id.kind.localeCompare(b.id.kind);
    if (ka !== 0) return ka;

    const na = a.id.name.localeCompare(b.id.name);
    if (na !== 0) return na;

    const va = a.id.version.localeCompare(b.id.version);
    if (va !== 0) return va;

    // tie-breaker: stable hash of ComponentID
    const ha = hashComponentID(a.id);
    const hb = hashComponentID(b.id);
    return ha.localeCompare(hb);
}
