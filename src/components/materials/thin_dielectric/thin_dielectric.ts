// Thin-dielectric descriptor, co-located with thin_dielectric.glsl (module-anatomy §2).

import type { MaterialModelDescriptor } from '../../descriptors.js';
import thinDielectricGLSL from './thin_dielectric.glsl?raw';

export const thinDielectricDescriptor: MaterialModelDescriptor = {
    id: 'thin_dielectric',
    glsl: { euclidean: { origin: 'components/materials/thin_dielectric/thin_dielectric.glsl', source: thinDielectricGLSL } },
    // Fields read (matches thin_dielectric.glsl's header): sheet_eta.
    properties: [
        // η, the sheet's index relative to the medium around it (pbrt's and Mitsuba's
        // convention): a pane in water with glass of 1.5 takes 1.5/1.33. A plain number, not
        // an index-role value: the sheet changes no region, so it has no region-table row,
        // and a dispersive index has no reader here.
        { name: 'sheet_eta', glslType: 'float', source: 'sheet_eta', default: 1.5, storage: 'field',
            constraint: { kind: 'positive' } },
    ],
    albedo: { fn: 'thin_dielectric_albedo' },   // 1, the clear-glass value
    capabilities: {
        nonDeltaLobes: false,   // pure delta: eval ≡ 0, NEE skips (the generated guard)
        // The light leaves into the medium it arrived from: no index change, so no
        // region-table row and no thin-surface warning.
        transmission: false,
        support: 'sphere',      // the transmission lobe scatters to the far side
        emissive: false,        // thin_dielectric_emission ≡ 0
    },
};
