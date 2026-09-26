// tests/authoring/loadOBJ.test.ts — the Wavefront OBJ parser (impl-plan-meshes).

import { describe, it, expect } from 'vitest';
import { parseOBJ } from '../../src/authoring/loadOBJ.js';

describe('parseOBJ', () => {
    it('parses a single triangle (positions only → no normals/uvs)', () => {
        const m = parseOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n', { material: 'm' });
        expect(m.kind).toBe('mesh');
        expect(Array.from(m.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
        expect(Array.from(m.indices)).toEqual([0, 1, 2]);
        expect(m.normals).toBeUndefined();
        expect(m.uvs).toBeUndefined();
        expect(m.material).toBe('m');
    });

    it('fan-triangulates a quad face', () => {
        const m = parseOBJ('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n', { material: 'm' });
        expect(Array.from(m.indices)).toEqual([0, 1, 2, 0, 2, 3]);
    });

    it('unifies distinct (v/vt/vn) corners and carries normals + uvs', () => {
        const src = [
            'v 0 0 0', 'v 1 0 0', 'v 0 1 0',
            'vt 0 0', 'vt 1 0', 'vt 0 1',
            'vn 0 0 1',
            'f 1/1/1 2/2/1 3/3/1',
        ].join('\n');
        const m = parseOBJ(src, { material: 'm' });
        expect(m.positions.length).toBe(9);
        expect(m.normals).toBeDefined();
        expect(Array.from(m.normals!)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
        expect(m.uvs).toBeDefined();
        expect(Array.from(m.uvs!)).toEqual([0, 0, 1, 0, 0, 1]);
        expect(Array.from(m.indices)).toEqual([0, 1, 2]);
    });

    it('resolves negative (relative) indices', () => {
        const m = parseOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\n', { material: 'm' });
        expect(Array.from(m.indices)).toEqual([0, 1, 2]);
    });

    it('deduplicates a shared corner across two faces', () => {
        // A quad as two faces sharing the edge 1-3: corners 1 and 3 must be reused, not duplicated.
        const src = 'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3\nf 1 3 4\n';
        const m = parseOBJ(src, { material: 'm' });
        expect(m.positions.length / 3).toBe(4);          // 4 unique vertices, not 6
        expect(Array.from(m.indices)).toEqual([0, 1, 2, 0, 2, 3]);
    });

    it('throws on an OBJ with no faces', () => {
        expect(() => parseOBJ('v 0 0 0\n', { material: 'm' })).toThrow(/no faces/);
    });
});

describe('parseOBJ — Sep 25 audit', () => {
    it('resolves relative indices per occurrence (two blocks each using -3 -2 -1)', () => {
        const text = [
            'v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f -3 -2 -1',
            'v 5 0 0', 'v 6 0 0', 'v 5 1 0', 'f -3 -2 -1',
        ].join('\n');
        const m = parseOBJ(text, { material: 'm' });
        const tri = (t: number) => [0, 1, 2].map((k) => Array.from(m.positions.subarray(3 * m.indices[3 * t + k], 3 * m.indices[3 * t + k] + 3)));
        expect(tri(0)).toEqual([[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
        expect(tri(1)).toEqual([[5, 0, 0], [6, 0, 0], [5, 1, 0]]);
    });

    it('gives corners without a file normal a real normal when others have one', () => {
        const text = [
            'v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'v 1 1 0', 'vn 0 0 1',
            'f 1//1 2//1 3//1',   // with normals
            'f 2 4 3',            // bare corners (vertex 4 appears only here)
        ].join('\n');
        const m = parseOBJ(text, { material: 'm' });
        for (let i = 0; i < m.normals!.length; i += 3) {
            const len = Math.hypot(m.normals![i], m.normals![i + 1], m.normals![i + 2]);
            expect(len).toBeCloseTo(1, 5);
        }
    });
});

describe('parseOBJ — synthesized normals where adjacent faces cancel', () => {
    it('gives every vertex a finite unit normal (a face normal), never (0,0,0)', () => {
        // Two triangles back to back on the same three vertices: their face normals sum to zero.
        const m = parseOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\nf 1 3 2\n', { material: 'm', smoothNormals: true });
        const n = m.normals!;
        for (let i = 0; i < n.length; i += 3) {
            const len = Math.hypot(n[i], n[i + 1], n[i + 2]);
            expect(len).toBeCloseTo(1, 6);
            // One of the two faces' normals: ±z.
            expect(Math.abs(n[i + 2])).toBeCloseTo(1, 6);
        }
    });
});
