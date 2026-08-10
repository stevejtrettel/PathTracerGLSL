// Soft-beam descriptor — co-located with softbeam.glsl (fable-emitter-profiles.md v0:
// the finite-divergence laser as a standalone hittable kind; the profile AXIS stays a
// future possibility). Authored as {position (aperture center), direction (propagation
// = the one-sided normal), radius, divergence (cone half-angle, radians), emission}.
// `emission` authors Le — the B2 area-kind word (in-cone radiance); the aperture
// irradiance is E = Le·π·sin²δ, so δ → 0 at fixed E is the delta `beam` kind's limit.
// Validator pins divergence ∈ (0, π/2): δ = 0 is the delta beam's job — no silent
// kind-crossing at the limit.

import type { LightKindDescriptor } from '../../descriptors.js';
import { unitVec3 } from '../../geometry/index.js';
import { radiantScalar } from '../power.js';
import lightSoftbeamGLSL from './softbeam.glsl?raw';

export const softbeamLightDescriptor: LightKindDescriptor = {
    kind: 'softbeam',
    glsl: lightSoftbeamGLSL,
    delta: false,
    authoredParams: [
        { name: 'position', shape: 'vec3', required: true, kind: 'point' },
        { name: 'direction', shape: 'vec3', required: true, kind: 'direction', constraint: { kind: 'min-length', value: 1e-8 } },
        { name: 'radius', shape: 'number', required: true, kind: 'length', constraint: { kind: 'positive' } },
        { name: 'divergence', shape: 'number', required: true, kind: 'angle', constraint: { kind: 'positive' } },
    ],
    params: [
        { name: 'position', shape: 'vec3', semantic: 'geometric', kind: 'point' },
        { name: 'direction', shape: 'vec3', semantic: 'geometric', kind: 'direction' },
        { name: 'radius', shape: 'number', semantic: 'geometric', kind: 'length' },
        { name: 'cos_divergence', shape: 'number', semantic: 'geometric', kind: 'angle' },
        { name: 'radiance', shape: 'vec3', semantic: 'radiometric' },   // Le inside the cone, precomputed product
    ],
    // Φ = Le·A·∫_cone cosθ dω = Le·(π r²)·(π sin²δ) — exact, not small-angle.
    power(v) {
        const r = v.radius as number;
        const c = v.cos_divergence as number;
        return Math.max(1e-8, Math.PI * Math.PI * r * r * (1 - c * c) * radiantScalar(v.radiance as number[]));
    },
    toValues: (a, product) => ({
        position: a.position as number[],
        direction: unitVec3(a.direction as number[]),
        radius: a.radius as number,
        cos_divergence: Math.cos(a.divergence as number),
        radiance: product,
    }),
    // Hittable: the backing aperture disk (one-sided; normal = the propagation axis —
    // the SAME unitVec3 formula toValues applies, via canonicalize at the desugar site).
    // Deliberately NO valuesFromRegion: an emissive disk OBJECT is a disk light — the
    // sampleAsLight inverse maps by primitive over kinds that DECLARE the inverse.
    region: {
        primitive: 'disk',
        parameters: (a) => ({
            center: a.position as number[],
            radius: a.radius as number,
            normal: a.direction as number[],
        }),
    },
    // The directional-emission fact (the profile miniature): the hit-side dispatch
    // gates this kind's backing material by the SAME cone the sampler's step() reads.
    emissionCone: (v) => ({
        direction: v.direction as [number, number, number],
        cosDivergence: v.cos_divergence as number,
    }),
    // Coupled rule: the (0, π/2) upper bound (positivity is the row's).
    validateAuthored(a) {
        const d = a.divergence as number;
        return d >= Math.PI / 2
            ? ['softbeam divergence (cone half-angle, radians) must be in (0, π/2) — a hemispherical emitter is a disk light; δ = 0 is the delta beam kind']
            : [];
    },
    // Light-tree leaf box (fable-light-bvh §5): the aperture disk, center ± r
    // (conservative box; the beam's directionality is the deferred cone term).
    treeBounds(v) {
        const c = v.position as [number, number, number];
        const r = v.radius as number;
        return { min: [c[0] - r, c[1] - r, c[2] - r], max: [c[0] + r, c[1] + r, c[2] + r] };
    },
};
