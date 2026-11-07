// Rough-dielectric descriptor — co-located with rough_dielectric.glsl (module-anatomy §2).
// Design authority: docs/fable-rough-dielectric.md. The delta/rough PAIR of `dielectric`,
// exactly as `ggx` is the pair of `mirror`: true smooth glass is authored as `dielectric`
// (the α floor makes it unreachable here, and a runtime delta flip would break the
// compile-time NEE guard).

import type { MaterialModelDescriptor } from '../../descriptors.js';
import { microfacetAlpha } from '../microfacet.js';
import roughDielectricGLSL from './rough_dielectric.glsl?raw';

export const roughDielectricDescriptor: MaterialModelDescriptor = {
    id: 'rough_dielectric',
    glsl: roughDielectricGLSL,
    // Every row is SHARED (§3.4 union dedupe): roughness with ggx, transmittance + the
    // region-table ior with dielectric — so this model adds NO field to
    // MaterialProperties. No f0: a dielectric's Fresnel is exact, not a Schlick fit.
    properties: [
        { name: 'roughness', glslType: 'float', source: 'roughness', default: 0.2, storage: 'field' },
        { name: 'transmittance', glslType: 'Spectrum', role: 'reflectance', source: 'transmittance', default: 1, storage: 'field' },
        { name: 'ior', glslType: 'float', role: 'index', source: 'ior', default: 1.5, storage: 'region-table', constraint: { kind: 'positive' } },
    ],
    // alpha = max(1e-3, roughness²): the declaration ggx uses too, so the struct union
    // holds one field and the two models agree on the floor.
    derived: [microfacetAlpha],
    usesMicrofacet: true,
    albedo: { row: 'transmittance' },   // 1 for clear glass, the tint for tinted glass
    capabilities: {
        nonDeltaLobes: true,    // glossy on BOTH lobes: NEE samples it, MIS weights against the pdf
        transmission: true,     // crosses the interface: ior row, eta_scale, current_medium
        // THE combination the capability split exists for (fable-rough-dielectric §3.1):
        // the first model that is both sphere-support and non-delta, so NEE runs at a
        // receiver that can be lit from below its shading normal and the light tree's
        // horizon cull must disarm. One word here drives the whole policy.
        support: 'sphere',
        emissive: false,        // rough_dielectric_emission ≡ 0
    },
};
