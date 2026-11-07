// Henyey–Greenstein descriptor — co-located with hg.glsl (module-anatomy §2;
// volume-scattering models declare into MediumProperties — same schema machinery).
// FORWARD convention: 1+g²−2gc with c = dot(wi, −wo) — do not consult pbrt for this
// function (its +2gc form pairs with the opposite dot; the X-FOG witness guards it).

import type { VolumeScatteringModelDescriptor } from '../../descriptors.js';
import phaseHgGLSL from './hg.glsl?raw';

const body = { origin: 'components/volume_scattering/hg/hg.glsl', source: phaseHgGLSL };

export const hgDescriptor: VolumeScatteringModelDescriptor = {
    id: 'hg',
    // One file, checked in both spaces: it is written against the ambient seam alone.
    glsl: { euclidean: body, hyperbolic: body, spherical: body },
    // Fields read (matches phase_hg.glsl's header): phase_g.
    properties: [
        { name: 'phase_g', glslType: 'float', source: 'phase_g', default: 0, storage: 'field' },
    ],
};
