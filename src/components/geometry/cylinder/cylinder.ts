// Cylinder descriptor — co-located with cylinder.glsl (the door test: first
// primitive through the descriptor front door). Canonical Y-axis: no axis param —
// orientation comes from the placement arms (box's twin), so all rows are
// separable and the fold is fully kind-derived. Both backends since placement-fold
// stage 4 (Aug 10 2026): the interval intersector (slab ∩ tube).

import type { PrimitiveDescriptor } from '../../descriptors.js';
import cylinderGLSL from './cylinder.glsl?raw';

export const cylinderDescriptor: PrimitiveDescriptor = {
    type: 'cylinder',
    params: [
        { name: 'center', kind: 'point', shape: 'vec3', required: false, default: [0, 0, 0] },
        { name: 'radius', kind: 'length', shape: 'number', required: true, constraint: { kind: 'positive' } },
        { name: 'halfHeight', kind: 'length', shape: 'number', required: true, constraint: { kind: 'positive' } },
    ],
    glsl: cylinderGLSL,
    provides: { sdf: true, analytic: true },
    similarityClosed: false,   // canonical y-axis, no axis row (orientation-is-placement): R cannot fold
    bounds(v) {
        const c = (v.center as number[] | undefined) ?? [0, 0, 0];
        const r = v.radius as number, h = v.halfHeight as number;
        return { min: [c[0] - r, c[1] - h, c[2] - r], max: [c[0] + r, c[1] + h, c[2] + r] };
    },
};
