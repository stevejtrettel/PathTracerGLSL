// Cylinder descriptor — co-located with cylinder.glsl (the door test: first
// primitive through the descriptor front door). Canonical Y-axis: no axis param —
// orientation comes from the placement wrapper tiers (box's twin), so all rows are
// separable and the fold is fully kind-derived.

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
    provides: { sdf: true, analytic: false },
    similarityClosed: false,   // canonical y-axis, no axis row (orientation-is-placement): R cannot fold
};
