// Knob descriptor (VENDORED model — licence and port notes at the head of knob.glsl).
//
// THE BOUND, which is the whole TS-side job for a vendored shape. The corpus documents
// no per-model extent ("most models ≤ 1.5" and nothing else), and a guessed bound is the
// one failure mode that is silent — too tight and the model loses a face with no error
// anywhere. So it is DERIVED from the vendored constants and then CONFIRMED by sampling
// the transcribed field:
//
//   radial : the base's bounding cylinder, radius 1.1, × the model's internal 0.8 scale
//            = 0.88.  (measured max radial extent: 0.878)
//   top    : the unit sphere, × 0.8 = 0.80.                (measured: 0.791)
//   bottom : the base cylinder's underside, −0.775 − 0.3 = −1.075, × 0.8 = −0.86.
//            Conservative: the cones and the ×0.7 in knob_base pull the real underside
//            up to −0.816 (measured), and this bound does not try to model that.
//
// All three scale with `radius`, the model's authored unit-sphere size.

import type { PrimitiveDescriptor, PrimitiveValues } from '../../descriptors.js';
import knobGLSL from './knob.glsl?raw';

const KNOB_RADIAL = 0.88;    // 1.1 × 0.8
const KNOB_TOP = 0.80;       // 1.0 × 0.8
const KNOB_BOTTOM = -0.86;   // (−0.775 − 0.3) × 0.8

export const knobDescriptor: PrimitiveDescriptor = {
    type: 'knob',
    // CANONICAL (fable-sdf-contract §2): origin at the model's unit-sphere centre; no
    // center row, no bounds() — the AABB derives from the marchBound cylinder.
    params: [
        { name: 'radius', kind: 'length', shape: 'number', required: true, constraint: { kind: 'positive' } },
    ],
    glsl: knobGLSL,
    provides: { sdf: true, analytic: false },
    // A solid of revolution (bar the pie-slice cut in the base), so a cylinder is the
    // natural bound: it is 3.4× tighter than the sphere the corpus's own scenes use
    // (which would need radius 1.20 — the corner of the base disc, not the top of the ball).
    marchBound: {
        type: 'cylinder',
        values: (v: PrimitiveValues) => {
            const r = v.radius as number;
            return {
                center: [0, r * (KNOB_TOP + KNOB_BOTTOM) / 2, 0],
                radius: r * KNOB_RADIAL,
                halfHeight: r * (KNOB_TOP - KNOB_BOTTOM) / 2,
            };
        },
    },
    similarityClosed: false,   // the model has a canonical axis and a canonical facing
};
