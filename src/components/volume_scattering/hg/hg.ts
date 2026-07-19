// Henyey–Greenstein descriptor — co-located with hg.glsl (module-anatomy §2;
// volume-scattering models declare into MediumProperties — same schema machinery).
// FORWARD convention: 1+g²−2gc with c = dot(wi, −wo) — do not consult pbrt for this
// function (its +2gc form pairs with the opposite dot; the X-FOG witness guards it).

import type { VolumeScatteringModelDescriptor } from '../../descriptors.js';
import phaseHgGLSL from './hg.glsl?raw';

export const hgDescriptor: VolumeScatteringModelDescriptor = {
    id: 'hg',
    glsl: phaseHgGLSL,
    // Fields read (matches phase_hg.glsl's header): phase_g.
    properties: [
        { name: 'phase_g', glslType: 'float', semantic: 'geometric', source: 'phase_g', default: 0, storage: 'field' },
    ],
};
