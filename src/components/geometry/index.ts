// Geometry-primitive parameter schemas (impl-plan-descriptor-reorg R3; review C7).
// The generator arms read these parameters with defaults — which is exactly how
// `{ r: 2 }` silently rendered a unit sphere. The Validator checks authored parameters
// against this table: unknown keys warn (typo class), missing required error, wrong
// shape errors. Adding a primitive = its GLSL + a dispatch arm + one row here.

import {
    similarityApplyDirection,
    similarityApplyPoint,
    similarityApplyVector,
    type Similarity,
    type Vec3Tuple,
} from './similarity.js';

export interface PrimitiveParam {
    name: string;
    shape: 'number' | 'vec3';
    /** Required = no sensible default exists (a sphere without a radius is a typo,
     *  not a unit sphere). Optional params have documented generator defaults. */
    required: boolean;
    /** Mathematical domain required by the primitive implementation. This is compiler-
     *  agnostic data: Validator interprets it generically instead of naming primitives. */
    constraint?:
        | { kind: 'positive' }
        | { kind: 'positive-components' }
        | { kind: 'min-length'; value: number };
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

/** Canonical unit-normal form of dot(p,n)+offset=0. Dividing both terms by |n|
 *  preserves the plane and makes the expression a true signed-distance bound. */
export function canonicalPlane(normal: number[], offset = 0): { normal: [number, number, number]; offset: number } {
    const invLen = 1 / Math.hypot(normal[0], normal[1], normal[2]);
    return {
        normal: [normal[0] * invLen, normal[1] * invLen, normal[2] * invLen],
        offset: offset * invLen,
    };
}

/**
 * Constant-transform lowering for the analytic backend (fable-transforms §5.1): the
 * analytic primitive set is CLOSED under similarities, so a constant placement folds
 * entirely into canonical parameters at plan time — no wrapper, no GLSL churn, and
 * every downstream reader (light desugar, power CDF, sampler/pdf arms, signed
 * distance) inherits the transform from the one folded parameter set.
 *
 *   sphere (center, r)   → (g·center, s·r)
 *   quad   (corner, e₁, e₂) → (g·corner, sR·e₁, sR·e₂)   [normal orientation preserved: s>0, det R = 1]
 *   plane  (n̂, d)        → (R·n̂, s·d − ⟨t, R·n̂⟩)         [canonicalized first]
 *
 * Identity placements pass through these formulas exactly (IEEE: +0 adds, ×1 are
 * exact), which is what makes the byte gate hold without special-casing.
 */
export function foldAnalyticParameters(
    type: 'sphere' | 'plane' | 'quad',
    parameters: Record<string, number | number[]>,
    g: Similarity,
): Record<string, number | number[]> {
    if (type === 'sphere') {
        const center = (parameters.center as number[] | undefined) ?? [0, 0, 0];
        return {
            ...parameters,
            center: similarityApplyPoint(g, center as Vec3Tuple),
            radius: g.scale * (parameters.radius as number),
        };
    }
    if (type === 'quad') {
        return {
            ...parameters,
            corner: similarityApplyPoint(g, parameters.corner as Vec3Tuple),
            edge1: similarityApplyVector(g, parameters.edge1 as Vec3Tuple),
            edge2: similarityApplyVector(g, parameters.edge2 as Vec3Tuple),
        };
    }
    // plane: canonicalize, rotate the unit normal, transform the offset.
    const plane = canonicalPlane(parameters.normal as number[], parameters.offset as number | undefined);
    const n = similarityApplyDirection(g, plane.normal);
    const t = g.translation;
    return {
        ...parameters,
        normal: n,
        offset: g.scale * plane.offset - (t[0] * n[0] + t[1] * n[1] + t[2] * n[2]),
    };
}

export const PRIMITIVE_PARAMS: Record<string, PrimitiveParam[]> = {
    // SDF backend
    'sdf:sphere': [
        { name: 'center', shape: 'vec3', required: false },   // default origin; folded into translation
        { name: 'radius', shape: 'number', required: true, constraint: { kind: 'positive' } },
    ],
    'sdf:plane': [
        { name: 'normal', shape: 'vec3', required: true, constraint: { kind: 'min-length', value: 1e-8 } },
        { name: 'offset', shape: 'number', required: false },  // default 0
    ],
    'sdf:box': [
        { name: 'center', shape: 'vec3', required: false },
        { name: 'halfSize', shape: 'vec3', required: true, constraint: { kind: 'positive-components' } },
    ],
    // Analytic backend
    'analytic:sphere': [
        { name: 'center', shape: 'vec3', required: false },
        { name: 'radius', shape: 'number', required: true, constraint: { kind: 'positive' } },
    ],
    'analytic:plane': [
        { name: 'normal', shape: 'vec3', required: true, constraint: { kind: 'min-length', value: 1e-8 } },
        { name: 'offset', shape: 'number', required: false },
    ],
    'analytic:quad': [
        { name: 'corner', shape: 'vec3', required: true },
        { name: 'edge1', shape: 'vec3', required: true },
        { name: 'edge2', shape: 'vec3', required: true },
    ],
};
