// Torus descriptor — the first occupant whose march bound is a DIFFERENT primitive
// (impl-plan-sdf-as-shape §2.2, the case the machinery was built for and the
// containment vitest was written to exercise for real rather than synthetically).

import type { PrimitiveDescriptor } from '../../descriptors.js';
import torusGLSL from './torus.glsl?raw';

export const torusDescriptor: PrimitiveDescriptor = {
    type: 'torus',
    // CANONICAL (fable-sdf-contract §2): origin-centred, ring about Y — position and
    // orientation are placement's alone, so there is no center row and no bounds()
    // (the AABB derives from the marchBound cylinder).
    params: [
        { name: 'ringRadius', kind: 'length', shape: 'number', required: true, constraint: { kind: 'positive' } },
        { name: 'tubeRadius', kind: 'length', shape: 'number', required: true, constraint: { kind: 'positive' } },
    ],
    glsl: torusGLSL,
    provides: { sdf: true, analytic: false },
    // The bound: a cylinder of radius R+r and half-height r, which is the TIGHT one —
    // the torus touches it on the rim and on both flat faces (the "bound is reached"
    // half of the containment test). A sphere of radius R+r would also be legal and
    // rotation-invariant, but it is mostly empty: the marched arm would run over a
    // long interval of nothing on every grazing ray.
    marchBound: {
        type: 'cylinder',
        values: (v) => ({
            radius: (v.ringRadius as number) + (v.tubeRadius as number),
            halfHeight: v.tubeRadius as number,
        }),
    },
    // The canonical ring axis is Y: no row can absorb a rotation (s still folds).
    similarityClosed: false,
    uvChart: true,            // (ring, tube) angles — torus_uv
    // A ring whose tube is thicker than its radius is a solid blob with a self-
    // intersecting cross-section — the field stops being the distance to a torus.
    validateValues(v) {
        return (v.tubeRadius as number) >= (v.ringRadius as number)
            ? [`torus: tubeRadius (${v.tubeRadius as number}) must be smaller than ringRadius (${v.ringRadius as number}) — the tube would swallow the hole`]
            : [];
    },
};
