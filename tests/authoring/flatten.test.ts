// flatten-equivalence tests (fable-transforms §8): flattenGroups output matches
// hand-composed similarities; provenance paths; document order; pass-through
// identity; aliased-node duplication; the §4 static-composition rule.

import { describe, it, expect } from 'vitest';
import { flattenGroups, transformFromSimilarity, type SceneNode, type GroupNode } from '../../src/authoring/flatten.js';
import { similarityApplyPoint, similarityFromTransform } from '../../src/components/geometry/similarity.js';
import type { ObjectDescription, PrimitiveObject, Vec3 } from '../../src/compiler/types.js';

const RY90 = { axis: [0, 1, 0] as Vec3, angle: Math.PI / 2 };

function sphere(over: Partial<PrimitiveObject> = {}): PrimitiveObject {
    return { type: 'sphere', parameters: { radius: 1 }, material: 'm', ...over };
}
function group(over: Partial<GroupNode> & { children: SceneNode[] }): GroupNode {
    return { kind: 'group', ...over };
}

/** World image of a local point under the leaf's flattened transform. */
function mapPoint(leaf: ObjectDescription, p: Vec3): Vec3 {
    return similarityApplyPoint(similarityFromTransform(leaf.transform), p) as Vec3;
}

describe('flattenGroups (fable-transforms §4)', () => {
    it('flat scenes pass through by reference (flatten is the identity on them)', () => {
        const a = sphere();
        const b = sphere({ transform: { position: [1, 2, 3] } });
        const out = flattenGroups([a, b]);
        expect(out[0]).toBe(a);
        expect(out[1]).toBe(b);
    });

    it('composes group ∘ leaf: T(p) group over S(2) leaf = TRS(p, id, 2)', () => {
        const out = flattenGroups([
            group({ name: 'ball', transform: { position: [-1, -0.3, 0] }, children: [sphere({ transform: { scale: 2 } })] }),
        ]);
        expect(out[0].transform).toEqual({ position: [-1, -0.3, 0], scale: 2 });
    });

    it('nested translations sum; identity components are omitted from the output', () => {
        const out = flattenGroups([
            group({ transform: { position: [0.5, 0, 0] }, children: [
                group({ transform: { position: [0, 0, 0.3] }, children: [sphere()] }),
            ] }),
        ]);
        expect(out[0].transform).toEqual({ position: [0.5, 0, 0.3] });
        expect(out[0].transform).not.toHaveProperty('rotation');
        expect(out[0].transform).not.toHaveProperty('scale');
    });

    it('the doc §8 worked compound: outer T(10,0,0)Rz90 ∘ inner T(2,0,0)Rz90 ∘ leaf T(0,1,0)', () => {
        const RZ90 = { axis: [0, 0, 1] as Vec3, angle: Math.PI / 2 };
        const out = flattenGroups([
            group({ name: 'outer', transform: { position: [10, 0, 0], rotation: RZ90 }, children: [
                group({ name: 'inner', transform: { position: [2, 0, 0], rotation: RZ90 }, children: [
                    sphere({ name: 'ball', transform: { position: [0, 1, 0] } }),
                ] }),
            ] }),
        ]);
        // Composed rotation = 180°; leaf origin lands at (10,1,0); local (1,0,0) at (9,1,0).
        const origin = mapPoint(out[0], [0, 0, 0]);
        const px = mapPoint(out[0], [1, 0, 0]);
        expect(origin[0]).toBeCloseTo(10, 9); expect(origin[1]).toBeCloseTo(1, 9); expect(origin[2]).toBeCloseTo(0, 9);
        expect(px[0]).toBeCloseTo(9, 9); expect(px[1]).toBeCloseTo(1, 9); expect(px[2]).toBeCloseTo(0, 9);
    });

    it('scale composes through rotation: group T·Ry90·s=2 over leaf T', () => {
        const out = flattenGroups([
            group({ transform: { position: [1, 0, 0], rotation: RY90, scale: 2 }, children: [
                sphere({ transform: { position: [1, 0, 0] } }),
            ] }),
        ]);
        // leaf origin: 2·Ry90(1,0,0) + (1,0,0) = (1,0,-2)
        const o = mapPoint(out[0], [0, 0, 0]);
        expect(o[0]).toBeCloseTo(1, 9); expect(o[1]).toBeCloseTo(0, 9); expect(o[2]).toBeCloseTo(-2, 9);
        expect((out[0].transform as { scale?: number }).scale).toBeCloseTo(2, 12);
    });

    it('stamps provenance paths (authored names + positional segments), keeps document order', () => {
        const out = flattenGroups([
            sphere({ name: 'first' }),
            group({ name: 'table', transform: { position: [0, 1, 0] }, children: [
                sphere({ name: 'top' }),
                group({ children: [sphere()] }),           // unnamed group, unnamed leaf
            ] }),
        ]);
        // D5: a leaf's authored name is a PATH SEGMENT like a group's — two 'ball'
        // leaves in different groups flatten to distinct provenance paths (the old
        // name-replaces-path rule collided them). Root-level leaves keep bare names.
        expect(out.map((o) => o.name)).toEqual(['first', 'table/top', 'table/#1/#0']);
    });

    it('an aliased node under two parents becomes two independent leaves', () => {
        const shared = sphere();
        const out = flattenGroups([
            group({ name: 'a', transform: { position: [1, 0, 0] }, children: [shared] }),
            group({ name: 'b', transform: { position: [2, 0, 0] }, children: [shared] }),
        ]);
        expect(out).toHaveLength(2);
        expect(out[0]).not.toBe(out[1]);
        expect((out[0].transform as { position: Vec3 }).position).toEqual([1, 0, 0]);
        expect((out[1].transform as { position: Vec3 }).position).toEqual([2, 0, 0]);
    });

    it('rejects a driven GROUP transform (static-composition rule)', () => {
        expect(() => flattenGroups([
            group({ name: 'turntable', transform: { rotation: { axis: [0, 1, 0], angle: { param: 'spin' } as any } }, children: [sphere()] }),
        ])).toThrow(/driven|runtime graph/i);
    });

    it('rejects a driven LEAF under a transformed group; passes it under identity ancestors', () => {
        const driven = sphere({ transform: { position: { param: 'crane.tip' } as any } });
        expect(() => flattenGroups([
            group({ transform: { position: [1, 0, 0] }, children: [driven] }),
        ])).toThrow(/driven|compose/i);
        // identity ancestors: passes through, path stamped
        const out = flattenGroups([group({ name: 'rig', children: [driven] })]);
        expect(out[0].transform).toBe(driven.transform);
        expect(out[0].name).toBe('rig/#0');
    });

    it('transformFromSimilarity: identity → undefined', () => {
        expect(transformFromSimilarity(similarityFromTransform(undefined))).toBeUndefined();
    });
});
