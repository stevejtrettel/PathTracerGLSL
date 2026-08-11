// Apollonian descriptor. Unlike every other shape here the bound cannot be read off the
// construction — an IFS has no closed-form envelope — so it is MEASURED with the TS twin
// (tests/components/fieldTwins.ts, the same transcription the containment gate runs) and
// fitted with margin. Half-extents of the thickened set over a 200³ grid, thickness 0.05:
//
//     morph  0.8   1.2   1.4   1.5
//     extent 2.14  2.32  2.56  2.68      (max |p| ≈ 3.1 — the set is roughly cubical)
//
// ⇒ 1.6 + 0.8·morph covers all of it with ~15% slack, in size units, plus the thickness
// in world units. A BOX bound, not a sphere: the set fills its cube's corners, so a
// sphere would be 2.7× the volume and every grazing ray would march the difference.

import type { PrimitiveDescriptor, PrimitiveValues } from '../../descriptors.js';
import apollonianGLSL from './apollonian.glsl?raw';

/** Half-extent of the bounding cube, in world units (the fit above). */
const apollonianExtent = (v: PrimitiveValues): number =>
    (v.size as number) * (1.6 + 0.8 * (v.morph as number)) + (v.thickness as number);

export const apollonianDescriptor: PrimitiveDescriptor = {
    type: 'apollonian',
    // CANONICAL (fable-sdf-contract §2): origin-centred; no center row, no bounds()
    // (the AABB derives from the marchBound cube).
    params: [
        { name: 'size', kind: 'length', shape: 'number', required: true, constraint: { kind: 'positive' } },
        // The inversion radius² — the morph dial. 1.2 is the classic still.
        { name: 'morph', kind: 'scalar', shape: 'number', required: false, default: 1.2, constraint: { kind: 'positive' } },
        // The declared ε-neighbourhood of the limit set (apollonian.glsl's header): what
        // makes this a solid with an interior rather than a picture of the marcher's
        // tolerance. A world length, so it scales with a driven placement like `size`.
        { name: 'thickness', kind: 'length', shape: 'number', required: false, default: 0.012, constraint: { kind: 'positive' } },
        { name: 'iterations', kind: 'scalar', shape: 'number', required: false, default: 8, constraint: { kind: 'positive' } },
    ],
    glsl: apollonianGLSL,
    provides: { sdf: true, analytic: false },
    marchBound: {
        type: 'box',
        values: (v) => {
            const h = apollonianExtent(v);
            return { halfSize: [h, h, h] };
        },
    },
    similarityClosed: false,   // the ±1 cell fold has canonical axes
    // `morph` outside the fitted band would walk the shape out of its bound (the extent
    // grows roughly linearly in it) — rejected rather than silently clipped. Iterations
    // past ~12 add structure below any sane thickness and only cost march steps.
    validateValues(v) {
        const out: string[] = [];
        const morph = v.morph as number, n = v.iterations as number;
        if (morph < 0.7 || morph > 1.5) out.push(`apollonian: morph (${morph}) must be in 0.7…1.5 — the bound fit (apollonian.ts) is measured over that band, and outside it the gasket grows past its own envelope`);
        if (!Number.isInteger(n) || n < 1 || n > 12) out.push(`apollonian: iterations (${n}) must be a whole number in 1…12`);
        return out;
    },
};
