// Box descriptor — co-located with box.glsl (impl-plan-geometry-descriptors).
// Both backends since placement-fold stage 4 (Aug 10 2026 — the cube-clouds enabler):
// the slab intersector rides the same canonical axis-aligned form the SDF uses;
// rotation stays PLACEMENT (fable-transforms §5.2 — box params are closed under
// translation+scale but NOT rotation: constant rotations take the rigid-residual
// analytic arm, instanced placements the frame tier).

import type { PrimitiveDescriptor } from '../../descriptors.js';
import boxGLSL from './box.glsl?raw';

export const boxDescriptor: PrimitiveDescriptor = {
    type: 'box',
    params: [
        { name: 'center', kind: 'point', shape: 'vec3', required: false, default: [0, 0, 0] },
        { name: 'halfSize', kind: 'length', shape: 'vec3', required: true, constraint: { kind: 'positive' } },
    ],
    glsl: boxGLSL,
    provides: { sdf: true, analytic: true },
    similarityClosed: false,   // axis-aligned canonical form: no row can absorb R (T,s still fold)
    bounds(v) {
        const c = (v.center as number[] | undefined) ?? [0, 0, 0];
        const h = v.halfSize as number[];
        return { min: [c[0] - h[0], c[1] - h[1], c[2] - h[2]], max: [c[0] + h[0], c[1] + h[1], c[2] + h[2]] };
    },
};
