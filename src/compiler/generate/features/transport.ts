// compiler/generate/features/transport.ts
// Transport integrator: the path-trace loop + its #defines (bounce budget, NEE, RR).

import type { RenderPlan } from '../../plan/types.js';
import { emptyContribution, type FeatureContribution } from './types.js';

import pathTraceGLSL from '../glsl/path_trace.glsl?raw';

export function contributeTransport(plan: RenderPlan): FeatureContribution {
    const program = plan.program;

    // Flag defines carry an empty value → emitted as `#define NAME` (no value).
    const defines: Record<string, string> = {
        MAX_BOUNCES: String(program.measurement.maxBounces),
    };
    if (program.estimator.lighting !== null) {
        defines['ENABLE_NEE'] = '';
        // MIS = NEE + the reference-§8 weights; both estimators share every other line (§11.2's
        // premise — anything else differing between the generated loops is a bug).
        if (program.estimator.lighting.method === 'mis') defines['ENABLE_MIS'] = '';
    }
    if (program.estimator.russianRoulette) {
        defines['ENABLE_RUSSIAN_ROULETTE'] = '';
        defines['RR_START_DEPTH'] = String(program.estimator.russianRoulette.startDepth);
    }

    // T4 seams: what the loop calls, conditioned exactly like the template's #ifdef lattice
    // (the item-9 split will emit these conditions instead of listing them).
    const requires = [
        'scene_intersect', 'material_of', 'scene_material_properties',
        'interaction_surface_sample', 'interaction_surface_emission',
        'material_is_emissive', 'environment_radiance',
    ];
    const lighting = program.estimator.lighting;
    if (lighting !== null) {
        requires.push('lighting_sample', 'shadow_transmittance', 'material_has_nondelta_lobes', 'interaction_surface_eval');
        if (lighting.method === 'mis') requires.push('interaction_surface_pdf');
        if (program.emitters.samplable) requires.push('light_of');
    }
    if (program.emitters.lightingPdf) requires.push('lighting_pdf');
    if (program.media.present) requires.push('material_has_medium', 'medium_sample', 'scene_region_at');
    if (program.media.scatteringArms) {
        requires.push('scene_medium_properties', 'hg_sample');
        if (lighting !== null) requires.push('hg_eval');
        if (lighting?.method === 'mis') requires.push('hg_pdf');
    }
    if (program.media.nullInterfaces) requires.push('is_null_interface');
    if (program.materials.models.includes('dielectric')) requires.push('ior_of');
    if (program.environmentSamplable && lighting?.method === 'mis') requires.push('environment_pdf');

    return {
        ...emptyContribution('transport'),
        defines,
        blocks: [{ origin: 'glsl/path_trace.glsl', source: pathTraceGLSL }],
        provides: [{ name: 'transport_trace', signature: 'Radiance transport_trace(Ray ray)' }],
        requires,
    };
}
