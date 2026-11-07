// tests/witnesses/scenes/derivedRoughnessWitness.ts — roughness that varies over the surface.
// The microfacet models read α = max(1e-3, roughness²), a derived field computed on the host
// for a constant or {param} roughness and per hit, in the material lookup, for an expression.
//
//   rough-furnace-expr — rough-furnace with each sphere's roughness authored as a formula that
//     evaluates to its constant. Twin of rough-furnace: the per-hit α equals the host α up to
//     float rounding, and both scenes draw the same random numbers, so the images agree to
//     within rounding (the expr-const pattern, on rough_dielectric).
//   veach-mis-varying — the veach-mis geometry with ONE ggx material on all four plates whose
//     roughness rises along x from 0.05 to 0.6. pt-mis, pt-nee and pt estimate the same
//     integral, so they converge to the same image only if eval, sample and pdf read the same
//     per-hit α at every scoring site.

import type { SceneDescription } from '../../../src/compiler/types.js';
import { roughFurnace } from './roughDielectricWitness.js';
import { veachMis } from './ggxScenes.js';

export const roughFurnaceExpr: SceneDescription = {
    ...roughFurnace,
    id: 'rough-furnace-expr',
    name: 'Rough glass white furnace, roughness as formulas',
    materials: {
        g005: { model: 'rough_dielectric', ior: 1.5, roughness: { kind: 'glsl', source: '0.05' } },
        g02: { model: 'rough_dielectric', ior: 1.5, roughness: { kind: 'glsl', source: '0.2' } },
        g05: { model: 'rough_dielectric', ior: 1.5, roughness: { kind: 'glsl', source: '0.5' } },
    },
};

/** Roughness 0.05 at the plates' left edge (x = −1.8) rising linearly to 0.6 at the right (x = 1.8). */
const PLATE_ROUGHNESS = '0.05 + 0.55 * clamp((p.x + 1.8) / 3.6, 0.0, 1.0)';

export const veachMisVarying: SceneDescription = {
    ...veachMis,
    id: 'veach-mis-varying',
    name: 'Veach MIS, roughness varying along the plates',
    objects: veachMis.objects.map((o) => ('material' in o && o.material.startsWith('plate') ? { ...o, material: 'plate' } : o)),
    materials: {
        plate: { model: 'ggx', f0: [0.95, 0.93, 0.88], roughness: { kind: 'glsl', source: PLATE_ROUGHNESS } },
        floor: veachMis.materials.floor,
    },
};
