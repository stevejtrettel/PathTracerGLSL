// Closedness facts (fable-mesh-containment): the Validator's proof machinery, unit-tested
// on known-good and known-broken geometry — including the POSITION-WELDING case (the box
// fixture pushes 4 verts per face, 24 total, so raw-index edge accounting would call a
// geometrically closed cube "full of holes").

import { describe, it, expect } from 'vitest';
import { meshClosedness, meshLocalBox } from '../../src/components/intersection/mesh/topology.js';
import { boxMesh } from '../witnesses/scenes/meshWitness.js';

describe('mesh topology (closedness facts)', () => {
    it('an outward cube (split corners — 24 verts) is watertight, consistent, outward, with the exact volume', () => {
        const { positions, indices } = boxMesh(0.5, false);
        expect(positions.length / 3).toBe(24);   // the welding case: 4 verts per face
        const c = meshClosedness(positions, indices);
        expect(c.watertight).toBe(true);
        expect(c.consistent).toBe(true);
        expect(c.outward).toBe(true);
        expect(c.volume).toBeCloseTo(1.0, 6);    // (2·0.5)³
    });

    it('an inward cube is consistent but NOT outward (negative volume)', () => {
        const { positions, indices } = boxMesh(0.5, true);
        const c = meshClosedness(positions, indices);
        expect(c.watertight).toBe(true);
        expect(c.consistent).toBe(true);
        expect(c.outward).toBe(false);
        expect(c.volume).toBeCloseTo(-1.0, 6);
    });

    it('removing one triangle opens 3 boundary edges (not watertight)', () => {
        const { positions, indices } = boxMesh(0.5, false);
        const holed = indices.slice(0, indices.length - 3);
        const c = meshClosedness(positions, holed);
        expect(c.watertight).toBe(false);
        expect(c.boundaryEdges).toBe(3);
    });

    it('flipping one triangle breaks winding consistency on its 3 edges', () => {
        const { positions, indices } = boxMesh(0.5, false);
        const flipped = new Uint32Array(indices);
        [flipped[0], flipped[1]] = [flipped[1], flipped[0]];   // reverse one face's winding
        const c = meshClosedness(positions, flipped);
        expect(c.watertight).toBe(true);
        expect(c.consistent).toBe(false);
        expect(c.flippedEdges).toBe(3);
    });

    it('meshLocalBox spans the positions exactly', () => {
        const { positions } = boxMesh(0.5, false);   // 0.5 is exactly representable in f32
        const box = meshLocalBox(positions);
        expect(box.min).toEqual([-0.5, -0.5, -0.5]);
        expect(box.max).toEqual([0.5, 0.5, 0.5]);
    });
});
