import { describe, it, expect } from 'vitest';
import { annotateWithProvenance } from '../generate/ShaderProvenance.js';
import type { SourceMap } from '../types.js';

describe('annotateWithProvenance', () => {
    const src = ['a', 'b', 'c', 'd'].join('\n'); // 4 lines
    const sm: SourceMap = {
        shaderId: 'x',
        blocks: [
            { origin: 'glsl/first', startLine: 1, endLine: 2 },
            { origin: 'generated:second', startLine: 3, endLine: 4 },
        ],
    };

    it('inserts a BLOCK marker before each block start', () => {
        const out = annotateWithProvenance(src, sm);
        expect(out).toContain('// ╔══ BLOCK: glsl/first  [lines 1–2]');
        expect(out).toContain('// ╔══ BLOCK: generated:second  [lines 3–4]');

        const lines = out.split('\n');
        // each marker immediately precedes its block's first line
        const m1 = lines.findIndex((l) => l.includes('glsl/first'));
        expect(lines[m1 + 1]).toBe('a');
        const m2 = lines.findIndex((l) => l.includes('generated:second'));
        expect(lines[m2 + 1]).toBe('c');
    });

    it('preserves the original content in order (markers/blank lines aside)', () => {
        const kept = annotateWithProvenance(src, sm)
            .split('\n')
            .filter((l) => l !== '' && !l.startsWith('// ╔══ BLOCK'));
        expect(kept).toEqual(['a', 'b', 'c', 'd']);
    });

    it('returns source unchanged when there is no source map', () => {
        expect(annotateWithProvenance(src, undefined)).toBe(src);
    });
});
