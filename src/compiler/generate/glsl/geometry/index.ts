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
