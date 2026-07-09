import { describe, it, expect } from 'vitest';
import { assembleBlocks, lookupLine } from '../../src/compiler/generate/ShaderIR.js';

describe('assembleBlocks', () => {
    it('joins blocks with newlines and computes correct line ranges', () => {
        const result = assembleBlocks([
            { origin: 'a', source: 'line1\nline2' },
            { origin: 'b', source: 'line3' },
            { origin: 'c', source: 'line4\nline5\nline6' },
        ]);
        expect(result.source).toBe('line1\nline2\nline3\nline4\nline5\nline6');
        expect(result.blockMap).toEqual([
            { origin: 'a', startLine: 1, endLine: 2 },
            { origin: 'b', startLine: 3, endLine: 3 },
            { origin: 'c', startLine: 4, endLine: 6 },
        ]);
    });

    it('handles single-line blocks', () => {
        const result = assembleBlocks([
            { origin: 'x', source: 'only' },
            { origin: 'y', source: 'two' },
        ]);
        expect(result.source).toBe('only\ntwo');
        expect(result.blockMap).toEqual([
            { origin: 'x', startLine: 1, endLine: 1 },
            { origin: 'y', startLine: 2, endLine: 2 },
        ]);
    });

    it('handles a single block', () => {
        const result = assembleBlocks([
            { origin: 'solo', source: 'a\nb\nc' },
        ]);
        expect(result.source).toBe('a\nb\nc');
        expect(result.blockMap).toEqual([
            { origin: 'solo', startLine: 1, endLine: 3 },
        ]);
    });

    it('handles empty blocks', () => {
        const result = assembleBlocks([
            { origin: 'empty', source: '' },
            { origin: 'content', source: 'hello' },
        ]);
        expect(result.source).toBe('\nhello');
        expect(result.blockMap).toEqual([
            { origin: 'empty', startLine: 1, endLine: 1 },
            { origin: 'content', startLine: 2, endLine: 2 },
        ]);
    });

    it('block map has no gaps', () => {
        const result = assembleBlocks([
            { origin: 'a', source: '#version 300 es\nprecision highp float;' },
            { origin: 'b', source: 'struct Ray {\n  vec3 o;\n  vec3 d;\n};' },
            { origin: 'c', source: 'void main() {\n}' },
        ]);
        for (let i = 1; i < result.blockMap.length; i++) {
            expect(result.blockMap[i].startLine).toBe(result.blockMap[i - 1].endLine + 1);
        }
        const totalLines = result.source.split('\n').length;
        expect(result.blockMap[result.blockMap.length - 1].endLine).toBe(totalLines);
    });
});

describe('lookupLine', () => {
    const blockMap = [
        { origin: 'header', startLine: 1, endLine: 5 },
        { origin: 'glsl/structs.glsl', startLine: 6, endLine: 50 },
        { origin: 'generated:sdf-dispatch', startLine: 51, endLine: 80 },
    ];

    it('maps first line of first block', () => {
        expect(lookupLine(blockMap, 1)).toEqual({ origin: 'header', localLine: 1 });
    });

    it('maps last line of first block', () => {
        expect(lookupLine(blockMap, 5)).toEqual({ origin: 'header', localLine: 5 });
    });

    it('maps first line of second block', () => {
        expect(lookupLine(blockMap, 6)).toEqual({ origin: 'glsl/structs.glsl', localLine: 1 });
    });

    it('maps middle of third block', () => {
        expect(lookupLine(blockMap, 55)).toEqual({ origin: 'generated:sdf-dispatch', localLine: 5 });
    });

    it('returns null for out-of-range lines', () => {
        expect(lookupLine(blockMap, 0)).toBeNull();
        expect(lookupLine(blockMap, 81)).toBeNull();
        expect(lookupLine(blockMap, 999)).toBeNull();
    });
});
