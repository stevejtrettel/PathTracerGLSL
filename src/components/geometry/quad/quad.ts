// Quad descriptor — co-located with quad.glsl (impl-plan-geometry-descriptors).
// Fold is kind-derived (corner: point → g·c, edges: vector → sR·e — normal
// orientation preserved: s>0, det R = 1). Hosts quadNormal: the one-sided pin
// requires hit side and light-sample side to agree — ONE formula, compile-time,
// shared by this descriptor's derived struct field and the quad light's descriptor
// (components/lights/quad).

import type { PrimitiveDescriptor } from '../../descriptors.js';
import quadGLSL from './quad.glsl?raw';

/** Unit cross(edge1, edge2) — a quad's emitting-side normal, precomputed at compile
 *  time (must stay a compile-time value so hit side and sample side agree
 *  bit-exactly — never recompute it per-fragment). */
export function quadNormal(edge1: number[], edge2: number[]): [number, number, number] {
    const cx = edge1[1] * edge2[2] - edge1[2] * edge2[1];
    const cy = edge1[2] * edge2[0] - edge1[0] * edge2[2];
    const cz = edge1[0] * edge2[1] - edge1[1] * edge2[0];
    const len = Math.hypot(cx, cy, cz);
    return [cx / len, cy / len, cz / len];
}

export const quadDescriptor: PrimitiveDescriptor = {
    type: 'quad',
    params: [
        { name: 'corner', kind: 'point', shape: 'vec3', required: true, default: [0, 0, 0] },
        { name: 'edge1', kind: 'vector', shape: 'vec3', required: true, default: [1, 0, 0] },
        { name: 'edge2', kind: 'vector', shape: 'vec3', required: true, default: [0, 0, 1] },
    ],
    glsl: quadGLSL,
    provides: { sdf: false, analytic: true },
    // Zero-thickness: never claims containment in scene_region_at — which is exactly
    // what makes it ONE-SIDED under region_to emission (and why back-face hits need
    // the entering-side probe, audit H2).
    thin: true,
    samplableAsLight: true,   // §6.2: emissive analytic quads join the light registry
    // Quad.normal — the precompiled emitting side (unit cross is scale-invariant
    // under s>0, so it is never scaled).
    derivedCtorFields: (v) => [quadNormal(v.edge1 as number[], v.edge2 as number[])],
};
