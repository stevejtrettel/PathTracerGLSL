// Box descriptor — co-located with box.glsl (impl-plan-geometry-descriptors).
// Both backends since placement-fold stage 4 (Aug 10 2026 — the cube-clouds enabler):
// the slab intersector rides the same canonical axis-aligned form the SDF uses;
// rotation stays PLACEMENT (fable-transforms §5.2 — box params are closed under
// translation+scale but NOT rotation: constant rotations take the rigid-residual
// analytic arm, instanced placements the frame tier).

import type { PrimitiveDescriptor } from '../../descriptors.js';
import { SPHERICAL_HALF_EXTENT } from '../../ambient/spherical/spherical.js';
import boxGLSL from './box.glsl?raw';
import boxHyperbolicGLSL from './box_hyperbolic.glsl?raw';
import boxSphericalGLSL from './box_spherical.glsl?raw';

export const boxDescriptor: PrimitiveDescriptor = {
    type: 'box',
    params: [
        { name: 'center', kind: 'point', shape: 'vec3', required: false, default: [0, 0, 0] },
        { name: 'halfSize', kind: 'length', shape: 'vec3', required: true, constraint: { kind: 'positive' }, constraintIn: { spherical: SPHERICAL_HALF_EXTENT } },
    ],
    glsl: {
        euclidean: { origin: 'components/geometry/box/box.glsl', source: boxGLSL },
        hyperbolic: { origin: 'components/geometry/box/box_hyperbolic.glsl', source: boxHyperbolicGLSL },
        spherical: { origin: 'components/geometry/box/box_spherical.glsl', source: boxSphericalGLSL },
    },
    // In H³ the three slabs bound a box (its corners exist) only when Σ tanh² hᵢ < 1.
    validateValuesIn: {
        hyperbolic(v) {
            const h = v.halfSize as number[];
            const k = h.reduce((s, x) => s + Math.tanh(x) ** 2, 0);
            return k >= 1 ? [`halfSize: Σ tanh²(halfSize) = ${+k.toFixed(6)} must be < 1 (otherwise the box's corners lie at or beyond the sphere at infinity)`] : [];
        },
    },
    provides: { sdf: true, analytic: true },
    // The march bound (impl-plan-sdf-as-shape §2.2): its own analytic form bounds it
    // exactly, so a marched arm is confined to precisely this shape's interval.
    marchBound: 'self',
    similarityClosed: false,   // axis-aligned canonical form: no row can absorb R (T,s still fold)
    bounds(v) {
        const c = (v.center as number[] | undefined) ?? [0, 0, 0];
        const h = v.halfSize as number[];
        return { min: [c[0] - h[0], c[1] - h[1], c[2] - h[2]], max: [c[0] + h[0], c[1] + h[1], c[2] + h[2]] };
    },
};
