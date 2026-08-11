// Menger sponge descriptor. The bound is the enclosing cube, exactly: the construction
// only ever MAXes (carves), so the sponge is a subset of the cube it starts from — the
// same free-bound argument the eroded shapes make, and the reason a fractal costs the
// marcher no more envelope than a box does.

import type { PrimitiveDescriptor } from '../../descriptors.js';
import mengerGLSL from './menger.glsl?raw';

export const mengerDescriptor: PrimitiveDescriptor = {
    type: 'menger',
    // CANONICAL (fable-sdf-contract §2): origin-centred; no center row, no bounds()
    // (the AABB derives from the marchBound cube).
    params: [
        // Half-extent of the enclosing cube (the sponge spans [−size, size]³).
        { name: 'size', kind: 'length', shape: 'number', required: true, constraint: { kind: 'positive' } },
        { name: 'iterations', kind: 'scalar', shape: 'number', required: false, default: 5, constraint: { kind: 'positive' } },
    ],
    glsl: mengerGLSL,
    provides: { sdf: true, analytic: false },
    marchBound: {
        type: 'box',
        values: (v) => ({ halfSize: [v.size as number, v.size as number, v.size as number] }),
    },
    similarityClosed: false,   // the 3×3×3 fold has canonical axes: no row absorbs R
    // Each level triples the frequency, so the cost is linear in iterations while the
    // feature size falls as 3⁻ⁿ. Past ~7 the finest tubes are far below a pixel at any
    // sane framing and the marcher just burns steps resolving them.
    validateValues(v) {
        const n = v.iterations as number;
        return (!Number.isInteger(n) || n < 1 || n > 8)
            ? [`menger: iterations (${n}) must be a whole number in 1…8 — level n has feature size 3⁻ⁿ, and past 8 that is far below a pixel`]
            : [];
    },
};
