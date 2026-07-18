// Disk area-light descriptor — co-located with disk.glsl. ONE-SIDED: emits from the
// +normal side. The normal is normalized through geometry's shared unitVec3 — the ONE
// formula the disk primitive's canonicalize also applies, so the light struct and the
// hit-side geometry carry bit-identical normals (the one-sided pin, quadNormal's
// precedent). Authored `position` maps to the row `center` (sphere light's precedent);
// `normal` is optional (defaults up — a flat panel), the one optional authored field
// in the library so far.

import type { LightKindDescriptor } from '../../descriptors.js';
import { unitVec3 } from '../../geometry/index.js';
import { radiantScalar } from '../index.js';
import lightDiskGLSL from './disk.glsl?raw';

const DEFAULT_NORMAL: [number, number, number] = [0, 1, 0];

export const diskLightDescriptor: LightKindDescriptor = {
    kind: 'disk',
    glsl: lightDiskGLSL,
    delta: false,
    // Authored input (besides kind/emission): position → row `center`; optional normal.
    authoredParams: [
        { name: 'position', shape: 'vec3', required: true },
        { name: 'radius', shape: 'number', required: true },
        { name: 'normal', shape: 'vec3', required: false },
    ],
    params: [
        { name: 'center', shape: 'vec3', semantic: 'geometric', kind: 'point' },
        { name: 'radius', shape: 'number', semantic: 'geometric', kind: 'length' },
        { name: 'normal', shape: 'vec3', semantic: 'geometric', kind: 'direction' },
        { name: 'radiance', shape: 'vec3', semantic: 'radiometric' },   // Le, precomputed product
    ],
    // pbrt PowerLightSampler: one-sided disk π·A·Le = π·(π r²)·Le.
    power(v) {
        const r = v.radius as number;
        return Math.max(1e-8, Math.PI * Math.PI * r * r * radiantScalar(v.radiance as number[]));
    },
    // Desugar (A3): hittable — a backing disk region + the registry entry from the
    // SAME authored fields. The region's raw normal is canonicalized by the framework
    // (canonicalizePrimitiveParameters at the desugar site) through the SAME unitVec3
    // this toValues applies — bit-identical by construction.
    toValues: (a, product) => ({
        center: a.position as number[],
        radius: a.radius as number,
        normal: unitVec3((a.normal as number[] | undefined) ?? DEFAULT_NORMAL),
        radiance: product,
    }),
    region: {
        primitive: 'disk',
        parameters: (a) => ({
            center: a.position as number[],
            radius: a.radius as number,
            normal: (a.normal as number[] | undefined) ?? DEFAULT_NORMAL,
        }),
    },
    valuesFromRegion: (p, Le) => ({ center: p.center, radius: p.radius, normal: p.normal, radiance: Le }),
    validateAuthored(a) {
        const msgs: string[] = [];
        if ((a.radius as number) <= 0) msgs.push('disk light radius must be > 0');
        const n = a.normal as number[] | undefined;
        if (n !== undefined && Math.hypot(n[0], n[1], n[2]) < 1e-8) {
            msgs.push('disk light normal must be a nonzero vector');
        }
        return msgs;
    },
};
