// tests/components/instancingPacked.test.ts — the S2 equality gate
// (fable-instance-clouds §9.2): packInstanceBatch over the SAME data must be
// BYTE-IDENTICAL between the Similarity[] arm (authored Transform[] lowering) and the
// packed struct-of-arrays arm — same boxes, same SAH permutation, same records, same
// attribute reorder. Both arms feed one loop via a per-instance accessor, so a
// divergence here means the accessor lies.

import { describe, it, expect } from 'vitest';
import { packInstanceBatch, placementCount, isPackedPlacements, type AttributeRowSpec } from '../../src/components/intersection/instancing/instancing.js';
import { similarityFromTransform, rigidInverse, type Similarity } from '../../src/components/geometry/similarity.js';
import type { PackedPlacements, Transform } from '../../src/compiler/types.js';

const LOCAL_BOX = { min: [-1, -1, -1] as [number, number, number], max: [1, 1, 1] as [number, number, number] };

/** Seeded cloud in BOTH forms from the same f32 values (f32 first so the arms see
 *  bit-identical inputs). */
function cloud(n: number, withOrientations: boolean): { packed: PackedPlacements; transforms: Transform[] } {
    let s = 777 >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const positions = new Float32Array(3 * n);
    const sizes = new Float32Array(n);
    const orientations = withOrientations ? new Float32Array(4 * n) : undefined;
    for (let i = 0; i < n; i++) {
        positions[3 * i] = (rnd() * 2 - 1) * 20;
        positions[3 * i + 1] = (rnd() * 2 - 1) * 20;
        positions[3 * i + 2] = (rnd() * 2 - 1) * 20;
        sizes[i] = 0.05 + rnd();
        if (orientations !== undefined) {
            const u1 = rnd(), u2 = rnd() * 2 * Math.PI, u3 = rnd() * 2 * Math.PI;
            const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
            orientations[4 * i] = Math.fround(a * Math.sin(u2));
            orientations[4 * i + 1] = Math.fround(a * Math.cos(u2));
            orientations[4 * i + 2] = Math.fround(b * Math.sin(u3));
            orientations[4 * i + 3] = Math.fround(b * Math.cos(u3));
        }
    }
    const transforms: Transform[] = [];
    for (let i = 0; i < n; i++) {
        transforms.push({
            position: [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]],
            scale: sizes[i],
            ...(orientations !== undefined
                ? { rotation: [orientations[4 * i], orientations[4 * i + 1], orientations[4 * i + 2], orientations[4 * i + 3]] as [number, number, number, number] }
                : {}),
        });
    }
    return {
        packed: { count: n, positions, sizes, ...(orientations !== undefined ? { orientations } : {}) },
        transforms,
    };
}

describe('packInstanceBatch: packed arm ≡ Similarity[] arm', () => {
    for (const withOrientations of [false, true]) {
        it(`byte-identical records + nodes (orientations: ${withOrientations})`, () => {
            const { packed, transforms } = cloud(64, withOrientations);
            const sims: Similarity[] = transforms.map((t) => similarityFromTransform(t));
            const a = packInstanceBatch(LOCAL_BOX, sims);
            const b = packInstanceBatch(LOCAL_BOX, packed);
            expect(b.nodeCount).toBe(a.nodeCount);
            expect(Array.from(b.placements)).toEqual(Array.from(a.placements));
            expect(Array.from(b.nodes)).toEqual(Array.from(a.nodes));
        });
    }

    it('reorders packed Float32Array attributes by the same leaf permutation as literal arrays', () => {
        const { packed, transforms } = cloud(32, false);
        const n = 32;
        const vec = new Float32Array(3 * n);
        const flt = new Float32Array(n);
        const vecLit: [number, number, number][] = [];
        const fltLit: number[] = [];
        for (let i = 0; i < n; i++) {
            vec[3 * i] = i; vec[3 * i + 1] = i + 0.5; vec[3 * i + 2] = i + 0.25;
            flt[i] = 100 + i;
            vecLit.push([vec[3 * i], vec[3 * i + 1], vec[3 * i + 2]]);
            fltLit.push(flt[i]);
        }
        const rowsPacked: AttributeRowSpec[] = [{ shape: 'vec3', values: vec }, { shape: 'float', values: flt }];
        const rowsLit: AttributeRowSpec[] = [{ shape: 'vec3', values: vecLit }, { shape: 'float', values: fltLit }];
        const a = packInstanceBatch(LOCAL_BOX, transforms.map((t) => similarityFromTransform(t)), rowsLit);
        const b = packInstanceBatch(LOCAL_BOX, packed, rowsPacked);
        expect(Array.from(b.attributes!)).toEqual(Array.from(a.attributes!));
    });
});

describe('packInstanceBatch: flat record transcription', () => {
    it('a single-instance record equals rigidInverse of the placement (the op-for-op gate)', () => {
        // n = 1 → the TLAS permutation is trivially [0], so record 0 addresses placement 0.
        const q: [number, number, number, number] = [0.1, -0.4, 0.2, 0.88];
        const packed: PackedPlacements = {
            count: 1,
            positions: new Float32Array([1.5, -2.25, 3.125]),
            sizes: new Float32Array([0.75]),
            orientations: new Float32Array(q),
        };
        const b = packInstanceBatch(LOCAL_BOX, packed);
        const g = similarityFromTransform({
            position: [1.5, -2.25, 3.125],
            scale: 0.75,
            rotation: [Math.fround(q[0]), Math.fround(q[1]), Math.fround(q[2]), Math.fround(q[3])],
        });
        const inv = rigidInverse(g);
        expect(Array.from(b.placements)).toEqual([...inv.q, ...inv.ts].map(Math.fround));
    });
});

describe('placement-form helpers', () => {
    it('placementCount and isPackedPlacements discriminate both forms', () => {
        const { packed, transforms } = cloud(5, false);
        expect(placementCount(transforms)).toBe(5);
        expect(placementCount(packed)).toBe(5);
        expect(isPackedPlacements(packed)).toBe(true);
        expect(isPackedPlacements(transforms)).toBe(false);
    });
});
