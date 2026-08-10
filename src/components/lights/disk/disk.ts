// Disk area-light descriptor — co-located with disk.glsl. ONE-SIDED: emits from the
// +normal side. The normal is normalized through geometry's shared unitVec3 — the ONE
// formula the disk primitive's canonicalize also applies, so the light struct and the
// hit-side geometry carry bit-identical normals (the one-sided pin, quadNormal's
// precedent). Authored `position` maps to the row `center` (sphere light's precedent);
// `normal` is optional (defaults up — a flat panel), the one optional authored field
// in the library so far.

import type { LightKindDescriptor } from '../../descriptors.js';
import { unitVec3 } from '../../geometry/index.js';
import { radiantScalar } from '../power.js';
import lightDiskGLSL from './disk.glsl?raw';

export const diskLightDescriptor: LightKindDescriptor = {
    kind: 'disk',
    glsl: lightDiskGLSL,
    delta: false,
    // Authored input (besides kind/emission): position → row `center`; optional normal.
    // The normal's default lives ON THE ROW (D1) — applied once by the framework, so
    // toValues and region.parameters below read a plain value and cannot disagree.
    authoredParams: [
        { name: 'position', shape: 'vec3', required: true, kind: 'point' },
        { name: 'radius', shape: 'number', required: true, kind: 'length', constraint: { kind: 'positive' } },
        { name: 'normal', shape: 'vec3', required: false, kind: 'direction', default: [0, 1, 0], constraint: { kind: 'min-length', value: 1e-8 } },
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
        normal: unitVec3(a.normal as number[]),   // row default pre-applied (D1)
        radiance: product,
    }),
    region: {
        primitive: 'disk',
        parameters: (a) => ({
            center: a.position as number[],
            radius: a.radius as number,
            normal: a.normal as number[],         // row default pre-applied (D1)
        }),
    },
    valuesFromRegion: (p, Le) => ({ center: p.center, radius: p.radius, normal: p.normal, radiance: Le }),
    // No validateAuthored: every rule is separable and lives on the rows (D1).
    // Light-tree leaf box (fable-light-bvh §5): center ± r (conservative — ignores the
    // orientation's slab-thinning, like the tree ignores the cone).
    treeBounds(v) {
        const c = v.center as [number, number, number];
        const r = v.radius as number;
        return { min: [c[0] - r, c[1] - r, c[2] - r], max: [c[0] + r, c[1] + r, c[2] + r] };
    },
};
