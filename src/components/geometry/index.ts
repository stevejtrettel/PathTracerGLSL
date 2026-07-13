// Geometry-primitive parameter schemas (impl-plan-descriptor-reorg R3; review C7).
// The generator arms read these parameters with defaults — which is exactly how
// `{ r: 2 }` silently rendered a unit sphere. The Validator checks authored parameters
// against this table: unknown keys warn (typo class), missing required error, wrong
// shape errors. Adding a primitive = its GLSL + a dispatch arm + one row here.

export interface PrimitiveParam {
    name: string;
    shape: 'number' | 'vec3';
    /** Required = no sensible default exists (a sphere without a radius is a typo,
     *  not a unit sphere). Optional params have documented generator defaults. */
    required: boolean;
}

/** Unit cross(edge1, edge2) — a quad's emitting-side normal, precomputed at compile
 *  time. Quad math shared by the analytic backend's arms and the quad light descriptor
 *  (the one-sided pin requires hit side and sample side to agree — one formula, two
 *  readers). */
export function quadNormal(edge1: number[], edge2: number[]): [number, number, number] {
    const cx = edge1[1] * edge2[2] - edge1[2] * edge2[1];
    const cy = edge1[2] * edge2[0] - edge1[0] * edge2[2];
    const cz = edge1[0] * edge2[1] - edge1[1] * edge2[0];
    const len = Math.hypot(cx, cy, cz);
    return [cx / len, cy / len, cz / len];
}

export const PRIMITIVE_PARAMS: Record<string, PrimitiveParam[]> = {
    // SDF backend
    'sdf:sphere': [
        { name: 'center', shape: 'vec3', required: false },   // default origin; folded into translation
        { name: 'radius', shape: 'number', required: true },
    ],
    'sdf:plane': [
        { name: 'normal', shape: 'vec3', required: true },
        { name: 'offset', shape: 'number', required: false },  // default 0
    ],
    'sdf:box': [
        { name: 'center', shape: 'vec3', required: false },
        { name: 'halfSize', shape: 'vec3', required: true },
    ],
    // Analytic backend
    'analytic:sphere': [
        { name: 'center', shape: 'vec3', required: false },
        { name: 'radius', shape: 'number', required: true },
    ],
    'analytic:plane': [
        { name: 'normal', shape: 'vec3', required: true },
        { name: 'offset', shape: 'number', required: false },
    ],
    'analytic:quad': [
        { name: 'corner', shape: 'vec3', required: true },
        { name: 'edge1', shape: 'vec3', required: true },
        { name: 'edge2', shape: 'vec3', required: true },
    ],
};
