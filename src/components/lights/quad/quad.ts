// Quad area-light descriptor — co-located with quad.glsl (struct-alignment batch).
// ONE-SIDED (pinned deviation from the §6.2 two-sided aside — hit side and sample side
// must agree). The derived normal is computed by geometry's quadNormal — ONE formula,
// compile-time, so the light's emitting side and the analytic quad's hit side agree
// bit-exactly by construction. Struct order = rows then derived:
// corner/edge1/edge2/radiance + normal/area (contract-test-checked).

import type { LightKindDescriptor } from '../../descriptors.js';
import { quadCross, quadNormal } from '../../geometry/index.js';
import { radiantScalar } from '../index.js';
import lightQuadGLSL from './quad.glsl?raw';

function quadArea(edge1: number[], edge2: number[]): number {
    return Math.hypot(...quadCross(edge1, edge2));
}

export const quadLightDescriptor: LightKindDescriptor = {
    kind: 'quad',
    glsl: lightQuadGLSL,
    delta: false,
    // Authored input (besides kind/emission) — same names as the registry rows for quad.
    authoredParams: [
        { name: 'corner', shape: 'vec3', required: true },
        { name: 'edge1', shape: 'vec3', required: true },
        { name: 'edge2', shape: 'vec3', required: true },
    ],
    params: [
        { name: 'corner', shape: 'vec3', semantic: 'geometric', kind: 'point' },
        { name: 'edge1', shape: 'vec3', semantic: 'geometric', kind: 'vector' },
        { name: 'edge2', shape: 'vec3', semantic: 'geometric', kind: 'vector' },
        { name: 'radiance', shape: 'vec3', semantic: 'radiometric' },   // Le, precomputed product
    ],
    // QuadLight.normal + QuadLight.area — compile-time data (the one-sided pin).
    derivedFields: [
        { name: 'normal', kind: 'direction', shape: 'vec3' },
        { name: 'area', kind: 'length', shape: 'number' },
    ],
    derivedCtorFields(v) {
        const e1 = v.edge1 as number[], e2 = v.edge2 as number[];
        return [quadNormal(e1, e2), quadArea(e1, e2)];
    },
    // pbrt PowerLightSampler: one-sided quad π·A·Le (area-aware — pitfall 6: luminance-only
    // weighting mis-prioritizes a big dim panel vs a tiny bright one).
    power(v) {
        return Math.max(1e-8, Math.PI * quadArea(v.edge1 as number[], v.edge2 as number[]) * radiantScalar(v.radiance as number[]));
    },
    // Desugar (A3): hittable — a backing quad region + the registry entry, both from
    // the SAME authored fields; the sampleAsLight inverse reads the FOLDED region.
    toValues: (a, product) => ({
        corner: a.corner as number[], edge1: a.edge1 as number[], edge2: a.edge2 as number[], radiance: product,
    }),
    region: {
        primitive: 'quad',
        parameters: (a) => ({ corner: a.corner as number[], edge1: a.edge1 as number[], edge2: a.edge2 as number[] }),
    },
    valuesFromRegion: (p, Le) => ({ corner: p.corner, edge1: p.edge1, edge2: p.edge2, radiance: Le }),
    validateAuthored(a) {
        const area = quadArea(a.edge1 as number[], a.edge2 as number[]);
        return area < 1e-8
            ? [`quad edges are parallel or near-parallel — area |edge1 × edge2| must be >= 1e-8`]
            : [];
    },
};
