// Quad descriptor — co-located with quad.glsl (impl-plan-geometry-descriptors).
// Fold is kind-derived (corner: point → g·c, edges: vector → sR·e — normal
// orientation preserved: s>0, det R = 1). Hosts quadNormal: the one-sided pin
// requires hit side and light-sample side to agree — ONE formula, compile-time,
// shared by this descriptor's derived struct field and the quad light's descriptor
// (components/lights/quad).

import type { PrimitiveDescriptor } from '../../descriptors.js';
import quadGLSL from './quad.glsl?raw';

/** cross(edge1, edge2) — the one formula behind BOTH the quad's normal and its area
 *  (the quad light's |cross| weighting shares it; one source, no near-duplicate). */
export function quadCross(edge1: number[], edge2: number[]): [number, number, number] {
    return [
        edge1[1] * edge2[2] - edge1[2] * edge2[1],
        edge1[2] * edge2[0] - edge1[0] * edge2[2],
        edge1[0] * edge2[1] - edge1[1] * edge2[0],
    ];
}

/** Unit cross(edge1, edge2) — a quad's emitting-side normal, precomputed at compile
 *  time (must stay a compile-time value so hit side and sample side agree
 *  bit-exactly — never recompute it per-fragment). */
export function quadNormal(edge1: number[], edge2: number[]): [number, number, number] {
    const [cx, cy, cz] = quadCross(edge1, edge2);
    const len = Math.hypot(cx, cy, cz);
    return [cx / len, cy / len, cz / len];
}

export const quadDescriptor: PrimitiveDescriptor = {
    type: 'quad',
    params: [
        { name: 'corner', kind: 'point', shape: 'vec3', required: true },
        { name: 'edge1', kind: 'vector', shape: 'vec3', required: true },
        { name: 'edge2', kind: 'vector', shape: 'vec3', required: true },
    ],
    glsl: quadGLSL,
    provides: { sdf: false, analytic: true },
    uvChart: true,            // natural [0,1]² along the edges — quad_uv (fable-imagery P1)
    // Zero-thickness: never claims containment in scene_region_at — which is exactly
    // what makes it ONE-SIDED under region_to emission (and why back-face hits need
    // the entering-side probe, audit H2).
    thin: true,
    samplableAsLight: true,   // §6.2: emissive analytic quads join the light registry
    // Quad.normal — the precompiled emitting side (unit cross is scale-invariant
    // under s>0, so it is never scaled).
    derivedFields: [{ name: 'normal', kind: 'direction', shape: 'vec3' }],
    derivedCtorFields: (v) => [quadNormal(v.edge1 as number[], v.edge2 as number[])],
    // COUPLED rule (C5): area relates edge1 AND edge2 — a zero cross product is NaN in
    // the normal formatter; near-zero areas make Inf pdfs if emissive. ONE formula
    // (quadCross) with the quad LIGHT's identical rule (both routes, one truth).
    validateValues(v) {
        const c = quadCross(v.edge1 as number[], v.edge2 as number[]);
        return Math.hypot(c[0], c[1], c[2]) < 1e-8
            ? ['edges are parallel or near-parallel — area |edge1 × edge2| must be >= 1e-8']
            : [];
    },
    // AABB of the four corners: corner, +edge1, +edge2, +edge1+edge2.
    bounds(v) {
        const p = v.corner as number[], e1 = v.edge1 as number[], e2 = v.edge2 as number[];
        const corners = [p, [p[0] + e1[0], p[1] + e1[1], p[2] + e1[2]], [p[0] + e2[0], p[1] + e2[1], p[2] + e2[2]], [p[0] + e1[0] + e2[0], p[1] + e1[1] + e2[1], p[2] + e1[2] + e2[2]]];
        const min: [number, number, number] = [Infinity, Infinity, Infinity];
        const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
        for (const q of corners) for (let a = 0; a < 3; a++) { if (q[a] < min[a]) min[a] = q[a]; if (q[a] > max[a]) max[a] = q[a]; }
        return { min, max };
    },
};
