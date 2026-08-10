// Sphere descriptor — co-located with sphere.glsl (impl-plan-geometry-descriptors).
// Facts only; values arrive resolved, all GLSL emission is framework-derived, and the
// fold is kind-derived (center: point → g·c, radius: length → s·r) — no override.

import type { PrimitiveDescriptor } from '../../descriptors.js';
import sphereGLSL from './sphere.glsl?raw';

export const sphereDescriptor: PrimitiveDescriptor = {
    type: 'sphere',
    params: [
        { name: 'center', kind: 'point', shape: 'vec3', required: false, default: [0, 0, 0] },
        { name: 'radius', kind: 'length', shape: 'number', required: true, constraint: { kind: 'positive' } },
    ],
    glsl: sphereGLSL,
    provides: { sdf: true, analytic: true },
    // The march bound (impl-plan-sdf-as-shape §2.2): its own analytic form bounds it
    // exactly, so a marched arm is confined to precisely this shape's interval.
    marchBound: 'self',
    similarityClosed: true,   // isotropic: R fixes the canonical center — the fold is total
    uvChart: true,            // (θ,φ) chart — sphere_uv (fable-imagery P1)
    samplableAsLight: true,   // §6.2: emissive analytic spheres join the light registry
    bounds(v) {
        const c = (v.center as number[] | undefined) ?? [0, 0, 0];
        const r = v.radius as number;
        return { min: [c[0] - r, c[1] - r, c[2] - r], max: [c[0] + r, c[1] + r, c[2] + r] };
    },
};
