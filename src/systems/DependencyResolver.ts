import type { GLSLChunk } from "../core/types";

/**
 * Topologically sort GLSL chunks by their declared dependencies (Kahn’s algorithm).
 * Throws on unknown deps or cycles.
 */
export function topoSortChunks(chunks: GLSLChunk[]): GLSLChunk[] {
    const byName = new Map<string, GLSLChunk>();
    const incoming = new Map<string, number>();          // unmet dep count per node
    const dependents = new Map<string, string[]>();      // name -> nodes that depend on it

    for (const c of chunks) {
        byName.set(c.name, c);
        const deps = c.deps ?? [];
        incoming.set(c.name, deps.length);
        for (const d of deps) {
            const arr = dependents.get(d) ?? [];
            arr.push(c.name);
            dependents.set(d, arr);
        }
    }

    // Seed with nodes that have no incoming edges
    const queue: string[] = [];
    for (const [name, count] of incoming.entries()) {
        if (count === 0) queue.push(name);
    }

    const result: GLSLChunk[] = [];
    while (queue.length) {
        const name = queue.shift()!;
        const node = byName.get(name);
        if (node) result.push(node);

        const outs = dependents.get(name) ?? [];
        for (const depName of outs) {
            if (!incoming.has(depName)) {
                throw new Error(`DependencyResolver: unknown chunk "${depName}" in graph.`);
            }
            const next = (incoming.get(depName) ?? 0) - 1;
            incoming.set(depName, next);
            if (next === 0) queue.push(depName);
        }
    }

    // Any remaining nodes have cycles / unresolved deps
    const remaining = [...incoming.entries()].filter(([, v]) => v! > 0);
    if (remaining.length) {
        const names = remaining.map(([n]) => n).join(", ");
        throw new Error(`DependencyResolver: cyclic or unresolved dependencies among: ${names}`);
    }

    return result;
}
