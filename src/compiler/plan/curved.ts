// compiler/plan/curved.ts
// Placement in a curved space (components/ambient/README.md, "Curved spaces"). Every object's
// shape sits canonically at the origin o of its own frame and keeps only its intrinsic rows —
// lengths, and directions as tangent vectors at o. Its placement is one isometry
// g = T(position)·R(rotation)·T(point row): the authored transform applied to the shape first
// moved from o by its point row (a sphere's center), so in E³ terms the center folds into the
// placement as a pre-translation. A light backed by a primitive region reads the same g: its
// point row becomes g·o and its direction rows g applied to them as tangent vectors at o.
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

/** A curved object's intrinsic parameters (canonical, point row removed) and the point row's
 *  authored value, which the placement folds in as a pre-translation (o when there is none). */
export function curvedShape(type: string, rawParameters: PrimitiveValues): { parameters: PrimitiveValues; pre: Vec3Tuple } {
    const canonical = canonicalizePrimitiveParameters(type, rawParameters);
    const point = pointRowName(primitive(type).params, `primitive '${type}'`);
    if (point === undefined) return { parameters: canonical, pre: [0, 0, 0] };
    const { [point]: pre, ...parameters } = canonical;
    return { parameters, pre: pre as Vec3Tuple };
}

/** A curved object's canonical parameters and its placement isometry
 *  g = T(position)·R(rotation)·T(point row) under a constant transform. */
export function curvedConstantPlacement(geom: CurvedGeometry, type: string, rawParameters: PrimitiveValues, transform: Transform | undefined): { parameters: PrimitiveValues; g: Mat4 } {
    const { parameters, pre } = curvedShape(type, rawParameters);
    const s = similarityFromTransform(transform);
    return { parameters, g: placementIsometry(geom, s.translation, s.rotation, pre) };
}

/** A light's rows in a curved space: its point row (the anchor, at most one) mapped to g·o and its
 *  direction rows to g·(d, 0), with g = placementIsometry(position 0, no rotation, anchor) — the
 *  same isometry its backing region is placed by. Every other row is unchanged. */
export function curvedLightValues(geom: CurvedGeometry, d: LightKindDescriptor, values: Record<string, LightRowValue>): Record<string, LightRowValue> {
    const point = pointRowName(d.params, `light kind '${d.kind}'`);
    const anchor = (point === undefined ? [0, 0, 0] : values[point]) as Vec3Tuple;
    const g = placementIsometry(geom, [0, 0, 0], IDENTITY_QUAT, anchor);
    const out: Record<string, LightRowValue> = { ...values };
    for (const row of d.params) {
        if (row.kind === 'point') out[row.name] = mat4Apply(g, ORIGIN);
        else if (row.kind === 'direction') out[row.name] = mat4Apply(g, tangentAtOrigin(values[row.name] as Vec3Tuple));
    }
    return out;
}
