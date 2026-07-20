// Disk descriptor — co-located with disk.glsl. UNLIKE the cylinder (SDF-backed:
// orientation via placement wrappers), the disk is ANALYTIC and must be
// similarity-CLOSED for constant folds (fable-transforms §5.1) — a canonical-+Y disk
// cannot absorb a rotation into center+radius, so the normal is a real parameter
// (plane's precedent). The fold is then fully KIND-DERIVED (point/length/direction —
// the first primitive whose direction-kind row folds through the derived path).
// Hosts unitVec3: the ONE normalize formula shared by this descriptor's canonicalize
// and the disk light's toValues/valuesFromRegion — hit side and sample side must
// agree bit-exactly (the one-sided pin, quadNormal's precedent).

import type { PrimitiveDescriptor } from '../../descriptors.js';
import diskGLSL from './disk.glsl?raw';

/** The shared unit-vector formula (invLen multiply, canonicalPlane's op pattern) —
 *  compile-time, one source: geometry canonicalize AND the disk light's desugar. */
export function unitVec3(v: number[]): [number, number, number] {
    const invLen = 1 / Math.hypot(v[0], v[1], v[2]);
    return [v[0] * invLen, v[1] * invLen, v[2] * invLen];
}

export const diskDescriptor: PrimitiveDescriptor = {
    type: 'disk',
    params: [
        { name: 'center', kind: 'point', shape: 'vec3', required: false, default: [0, 0, 0] },
        { name: 'radius', kind: 'length', shape: 'number', required: true, constraint: { kind: 'positive' } },   // bounds() below reads center+radius
        // A flat (+Y) disk is a sensible disk — normal defaults rather than requires
        // (plane's normal stays required: it IS the plane's identity).
        { name: 'normal', kind: 'direction', shape: 'vec3', required: false, default: [0, 1, 0], constraint: { kind: 'min-length', value: 1e-8 } },
    ],
    glsl: diskGLSL,
    provides: { sdf: false, analytic: true },
    // Zero-thickness (the dichotomy: no sdf ⇒ thin): never claims containment, so it
    // is one-sided under region_to emission; back-face hits probe the entering side.
    thin: true,
    samplableAsLight: true,   // §6.2: emissive analytic disks join the light registry
    // Unit normal — framework-applied ONCE per parameter set; folds preserve it
    // (direction kinds transform by R alone).
    canonicalize: (v) => ({ ...v, normal: unitVec3(v.normal as number[]) }),
    // Conservative box: the disk lies within radius of its center in every axis.
    bounds(v) {
        const c = (v.center as number[] | undefined) ?? [0, 0, 0];
        const r = v.radius as number;
        return { min: [c[0] - r, c[1] - r, c[2] - r], max: [c[0] + r, c[1] + r, c[2] + r] };
    },
};
