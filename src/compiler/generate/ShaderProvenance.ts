// ShaderProvenance — annotate an assembled shader with its source-map block origins.
//
// The forward twin of ShaderErrorMapper: that maps a GPU error line *back* to its origin
// block; this walks the same SourceMap *forward*, inserting `// ╔══ BLOCK: <origin>`
// markers so a human reading the assembled GLSL can trace every line to the .glsl file or
// generated block that produced it. Pure — consumed by the dump-shaders CLI (and any other
// debug surface that wants a readable, traceable shader).

import type { SourceMap } from '../types.js';

/**
 * Interleave BLOCK provenance markers into `source` using `sourceMap`.
 * Returns `source` unchanged when no map is available.
 */
export function annotateWithProvenance(source: string, sourceMap: SourceMap | undefined): string {
    if (!sourceMap) return source;

    const lines = source.split('\n');
    const startAt = new Map<number, { origin: string; endLine: number }>();
    for (const b of sourceMap.blocks) startAt.set(b.startLine, { origin: b.origin, endLine: b.endLine });

    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        const b = startAt.get(i + 1); // block starts are 1-based
        if (b) {
            out.push('');
            out.push(`// ╔══ BLOCK: ${b.origin}  [lines ${i + 1}–${b.endLine}]`);
        }
        out.push(lines[i]);
    }
    return out.join('\n');
}
