// Cylinder descriptor — co-located with cylinder.glsl (the door test: first
// primitive through the descriptor front door). Canonical Y-axis: no axis param —
// orientation comes from the placement arms (box's twin), so all rows are
// separable and the fold is fully kind-derived. Both backends since placement-fold
// stage 4 (Aug 10 2026): the interval intersector (slab ∩ tube).

import type { PrimitiveDescriptor } from '../../descriptors.js';
import { SPHERICAL_HALF_EXTENT } from '../../ambient/spherical/spherical.js';
import cylinderGLSL from './cylinder.glsl?raw';
import cylinderHyperbolicGLSL from './cylinder_hyperbolic.glsl?raw';
import cylinderSphericalGLSL from './cylinder_spherical.glsl?raw';
import cylinderH2xrGLSL from './cylinder_h2xr.glsl?raw';

export const cylinderDescriptor: PrimitiveDescriptor = {
    type: 'cylinder',
    params: [
        { name: 'center', kind: 'point', shape: 'vec3', required: false, default: [0, 0, 0] },
        { name: 'radius', kind: 'length', shape: 'number', required: true, constraint: { kind: 'positive' }, constraintIn: { spherical: SPHERICAL_HALF_EXTENT } },
        { name: 'halfHeight', kind: 'length', shape: 'number', required: true, constraint: { kind: 'positive' }, constraintIn: { spherical: SPHERICAL_HALF_EXTENT } },
    ],
    glsl: {
        euclidean: { origin: 'components/geometry/cylinder/cylinder.glsl', source: cylinderGLSL },
        hyperbolic: { origin: 'components/geometry/cylinder/cylinder_hyperbolic.glsl', source: cylinderHyperbolicGLSL },
        spherical: { origin: 'components/geometry/cylinder/cylinder_spherical.glsl', source: cylinderSphericalGLSL },
        h2xr: { origin: 'components/geometry/cylinder/cylinder_h2xr.glsl', source: cylinderH2xrGLSL },
    },
    provides: { sdf: true, analytic: true },
    // The march bound (impl-plan-sdf-as-shape §2.2): its own analytic form bounds it
    // exactly, so a marched arm is confined to precisely this shape's interval.
    marchBound: 'self',
    similarityClosed: false,   // canonical y-axis, no axis row (orientation-is-placement): R cannot fold
    bounds(v) {
        const c = (v.center as number[] | undefined) ?? [0, 0, 0];
        const r = v.radius as number, h = v.halfHeight as number;
        return { min: [c[0] - r, c[1] - h, c[2] - r], max: [c[0] + r, c[1] + h, c[2] + r] };
    },
};
