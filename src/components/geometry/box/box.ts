// Box descriptor — co-located with box.glsl (impl-plan-geometry-descriptors).
// SDF-only: the axis-aligned box has no analytic intersector; rotation comes from
// the placement wrapper tiers (fable-transforms §5.2 — box params are closed under
// translation+scale but NOT rotation).

import type { PrimitiveDescriptor } from '../../descriptors.js';
import boxGLSL from './box.glsl?raw';

export const boxDescriptor: PrimitiveDescriptor = {
    type: 'box',
    params: [
        { name: 'center', kind: 'point', shape: 'vec3', required: false, default: [0, 0, 0] },
        { name: 'halfSize', kind: 'length', shape: 'vec3', required: true, constraint: { kind: 'positive' } },
    ],
    glsl: boxGLSL,
    provides: { sdf: true, analytic: false },
};
