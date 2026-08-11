// Bottle descriptor. Eight moduli, one bound DERIVED from them — the interesting part
// of this occupant on the TS side, because the bound of a blended shape is not the
// bound of its parts (bottle.glsl: a smooth union grows the solid by up to k/4, an
// onion by `thickness`, a smooth intersection never grows it at all).

import type { PrimitiveDescriptor, PrimitiveValues } from '../../descriptors.js';
import bottleGLSL from './bottle.glsl?raw';

/** The bound's moduli, derived once and read by BOTH marchBound and bounds() (the
 *  same numbers, expressed twice, is how a bound silently starts clipping). Local
 *  frame per bottle.glsl: origin at the body centre.
 *
 *  radial:  body radius, + the smooth join's k/4 bulge, + the onion's thickness.
 *  top:     the chop plane — a smooth INTERSECTION, so the lip cannot exceed it.
 *  bottom:  the body's underside, + the onion's thickness, + the join's k/4 (the punt
 *           only ever removes material, so it contributes nothing). */
function bottleExtent(v: PrimitiveValues): { radius: number; yTop: number; yBot: number } {
    const baseRadius = v.baseRadius as number, baseHeight = v.baseHeight as number;
    const neckHeight = v.neckHeight as number, thickness = v.thickness as number;
    const join = v.smoothJoin as number;
    return {
        radius: baseRadius + thickness + 0.25 * join,
        yTop: baseHeight + neckHeight + neckHeight / 3.0,
        yBot: -(baseHeight + thickness + 0.25 * join),
    };
}

export const bottleDescriptor: PrimitiveDescriptor = {
    type: 'bottle',
    // CANONICAL (fable-sdf-contract §2): origin at the body centre; no center row, no
    // bounds() — the AABB derives from the marchBound cylinder, which carries the one
    // asymmetry (the neck's y-offset) in the shape's own frame.
    params: [
        { name: 'baseRadius', kind: 'length', shape: 'number', required: true, constraint: { kind: 'positive' } },
        { name: 'baseHeight', kind: 'length', shape: 'number', required: true, constraint: { kind: 'positive' } },
        { name: 'neckRadius', kind: 'length', shape: 'number', required: true, constraint: { kind: 'positive' } },
        { name: 'neckHeight', kind: 'length', shape: 'number', required: true, constraint: { kind: 'positive' } },
        { name: 'thickness', kind: 'length', shape: 'number', required: false, default: 0.03, constraint: { kind: 'positive' } },
        { name: 'rounded', kind: 'length', shape: 'number', required: false, default: 0.05, constraint: { kind: 'nonnegative' } },
        { name: 'smoothJoin', kind: 'length', shape: 'number', required: false, default: 0.3, constraint: { kind: 'positive' } },
        { name: 'punt', kind: 'length', shape: 'number', required: false, default: 0, constraint: { kind: 'nonnegative' } },
    ],
    glsl: bottleGLSL,
    provides: { sdf: true, analytic: false },
    // A cylinder about the shape's own axis: the body IS one, so the bound is tight
    // where it matters and loose only over the neck (a cheap, mostly-empty slab).
    marchBound: {
        type: 'cylinder',
        values: (v) => {
            const e = bottleExtent(v);
            return {
                center: [0, (e.yTop + e.yBot) / 2, 0],
                radius: e.radius,
                halfHeight: (e.yTop - e.yBot) / 2,
            };
        },
    },
    similarityClosed: false,   // canonical +Y axis: no row absorbs a rotation
    // Coupled rules the separable row constraints cannot state (C5 / the validateValues
    // slot): the fillet is inset from both extents (bottle.glsl's convention), the wall
    // must fit inside the neck, and the neck must be the narrower of the two.
    validateValues(v) {
        const out: string[] = [];
        const rounded = v.rounded as number;
        const neckRadius = v.neckRadius as number, baseRadius = v.baseRadius as number;
        const thickness = v.thickness as number;
        const minExtent = Math.min(baseRadius, v.baseHeight as number, neckRadius, v.neckHeight as number);
        if (rounded > minExtent) out.push(`bottle: rounded (${rounded}) exceeds the smallest half-extent (${minExtent}) — the fillet is inset from both, so it cannot be larger`);
        if (thickness >= neckRadius) out.push(`bottle: thickness (${thickness}) must be less than neckRadius (${neckRadius}) — the wall would close the bore`);
        if (neckRadius > baseRadius) out.push(`bottle: neckRadius (${neckRadius}) must not exceed baseRadius (${baseRadius}) — the neck is the narrow end`);
        if ((v.punt as number) > 0 && (v.punt as number) >= (v.baseHeight as number)) out.push(`bottle: punt (${v.punt as number}) must be less than baseHeight (${v.baseHeight as number}) — the dimple would push through the shoulder`);
        return out;
    },
};
