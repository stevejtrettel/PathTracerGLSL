// compiler/plan/curved.ts
// Placement in a curved space (components/ambient/README.md, "Curved spaces"). Every object's
// shape sits canonically at the origin o of its own frame and keeps only its intrinsic rows —
// lengths, and directions as tangent vectors at o. Its placement is one isometry
// g = T(position)·R(rotation)·T(point row): the authored transform applied to the shape first
// moved from o by its anchor (a sphere's center, a quad's center), so in E³ terms the center folds
// into the placement as a pre-translation. A light backed by a primitive region reads the same g:
// its point row becomes g·o and its direction and vector rows g applied to them as tangent vectors
// at o.
// placementIsometry (components/ambient/isometry.ts) is the one function that makes g.

import type { PrimitiveValues } from '../../components/descriptors.js';
import type { LightKindDescriptor, LightRowValue } from '../../components/descriptors.js';
import { canonicalizePrimitiveParameters, primitive } from '../../components/geometry/index.js';
import { IDENTITY_QUAT, similarityFromTransform, type Vec3Tuple } from '../../components/geometry/similarity.js';
import { ORIGIN, mat4Apply, placementIsometry, tangentAtOrigin, type CurvedGeometry, type Mat4 } from '../../components/ambient/isometry.js';
import type { Transform } from '../types.js';

/** The one point row of a set of rows, or undefined when there is none. The shapes and lights
 *  with curved bodies have at most one point row; more would need a design for which one the
 *  placement anchors, so it throws. */
function pointRowName(rows: ReadonlyArray<{ name: string; kind?: string }>, owner: string): string | undefined {
    const points = rows.filter((r) => r.kind === 'point');
    if (points.length > 1) throw new Error(`${owner}: ${points.length} point rows; a curved placement folds at most one`);
    return points[0]?.name;
}

/** A curved object's intrinsic parameters (canonical, point row removed) and its anchor: the
 *  authored point the placement folds in as a pre-translation — the shape's `curvedAnchor` when it
 *  declares one (the quad's center), else its point row (o when there is none). */
export function curvedShape(type: string, rawParameters: PrimitiveValues): { parameters: PrimitiveValues; pre: Vec3Tuple } {
    const canonical = canonicalizePrimitiveParameters(type, rawParameters);
    const d = primitive(type);
    const point = pointRowName(d.params, `primitive '${type}'`);
    const parameters = { ...canonical };
    if (point !== undefined) delete parameters[point];
    const pre = d.curvedAnchor !== undefined ? d.curvedAnchor(canonical)
        : point === undefined ? [0, 0, 0] as Vec3Tuple : canonical[point] as Vec3Tuple;
    return { parameters, pre };
}

/** A curved object's canonical parameters, its anchor `pre` (curvedShape) and its placement
 *  isometry g = T(position)·R(rotation)·T(pre) under a constant transform. */
export function curvedConstantPlacement(geom: CurvedGeometry, type: string, rawParameters: PrimitiveValues, transform: Transform | undefined): { parameters: PrimitiveValues; pre: Vec3Tuple; g: Mat4 } {
    const { parameters, pre } = curvedShape(type, rawParameters);
    const s = similarityFromTransform(transform);
    return { parameters, pre, g: placementIsometry(geom, s.translation, s.rotation, pre) };
}

/** A light's rows in a curved space that name a point or a tangent vector, as world 4-vectors:
 *  its point row (at most one) becomes g·o and its direction and vector rows g·(v, 0), with
 *  g = placementIsometry(position 0, no rotation, anchor) — the isometry its backing region is
 *  placed by. `anchor` is that region's (curvedShape's `pre`), or the point row for a light with
 *  no region. In a curved space a light's point row therefore holds its anchor's image: the quad
 *  light's `corner` row holds the quad's center. */
export function curvedLightWorld(geom: CurvedGeometry, d: LightKindDescriptor, values: Record<string, LightRowValue>, anchor?: Vec3Tuple): Record<string, number[]> {
    const point = pointRowName(d.params, `light kind '${d.kind}'`);
    const at = anchor ?? (point === undefined ? [0, 0, 0] : values[point]) as Vec3Tuple;
    const g = placementIsometry(geom, [0, 0, 0], IDENTITY_QUAT, at);
    const out: Record<string, number[]> = {};
    for (const row of d.params) {
        if (row.kind === 'point') out[row.name] = mat4Apply(g, ORIGIN);
        else if (row.kind === 'direction' || row.kind === 'vector') out[row.name] = mat4Apply(g, tangentAtOrigin(values[row.name] as Vec3Tuple));
    }
    return out;
}
