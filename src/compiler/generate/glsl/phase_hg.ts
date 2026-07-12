// Henyey–Greenstein descriptor — co-located with phase_hg.glsl (module-anatomy §2;
// phase models declare into MediumProperties — same schema machinery, second family).
// FORWARD convention: 1+g²−2gc with c = dot(wi, −wo) — do not consult pbrt for this
// function (its +2gc form pairs with the opposite dot; the X-FOG witness guards it).

import type { PhaseModelDescriptor } from '../descriptors.js';
import phaseHgGLSL from './phase_hg.glsl?raw';

export const hgDescriptor: PhaseModelDescriptor = {
    id: 'hg',
    glsl: phaseHgGLSL,
    // Fields read (matches phase_hg.glsl's header): phase_g.
    properties: [
        { name: 'phase_g', glslType: 'float', semantic: 'geometric', source: 'phase_g', default: '0.0', storage: 'field' },
    ],
};
