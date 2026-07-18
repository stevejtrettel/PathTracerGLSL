// Plane descriptor — co-located with plane.glsl (impl-plan-geometry-descriptors).
// The ONE fold override in the library: the transformed offset couples the
// translation with the ALREADY-ROTATED normal (s·d − ⟨t, R·n̂⟩), so no per-parameter
// kind rule can produce it (fable-transforms §5.1). Hosts canonicalPlane: the
// unit-normal canonical form is plane-specific math with two readers (the Planner's
// normalization pass and this fold).

import type { PrimitiveDescriptor } from '../../descriptors.js';
import { similarityApplyDirection } from '../similarity.js';
import planeGLSL from './plane.glsl?raw';

/** Canonical unit-normal form of dot(p,n)+offset=0. Dividing both terms by |n|
 *  preserves the plane and makes the expression a true signed-distance bound. */
export function canonicalPlane(normal: number[], offset = 0): { normal: [number, number, number]; offset: number } {
    const invLen = 1 / Math.hypot(normal[0], normal[1], normal[2]);
    return {
        normal: [normal[0] * invLen, normal[1] * invLen, normal[2] * invLen],
        offset: offset * invLen,
    };
}

export const planeDescriptor: PrimitiveDescriptor = {
    type: 'plane',
    params: [
        { name: 'normal', kind: 'direction', shape: 'vec3', required: true, constraint: { kind: 'min-length', value: 1e-8 } },
        { name: 'offset', kind: 'length', shape: 'number', required: false, default: 0.0 },
    ],
    glsl: planeGLSL,
    provides: { sdf: true, analytic: true },
    // Canonical form: unit normal + rescaled offset (the framework applies this ONCE
    // on every Planner path — the SDF expression is a true distance bound only then).
    canonicalize: (v) => ({ ...v, ...canonicalPlane(v.normal as number[], v.offset as number | undefined) }),
    // (R·n̂, s·d − ⟨t, R·n̂⟩) — the coupled rule, over already-canonical values.
    fold: (v, g) => {
        const n = similarityApplyDirection(g, v.normal as [number, number, number]);
        const t = g.translation;
        return {
            ...v,
            normal: n,
            offset: g.scale * (v.offset as number) - (t[0] * n[0] + t[1] * n[1] + t[2] * n[2]),
        };
    },
};
