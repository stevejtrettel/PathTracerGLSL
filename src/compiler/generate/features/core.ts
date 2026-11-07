// compiler/generate/features/core.ts
// Always-present library code + engine builtin uniforms.

import type { RenderPlan } from '../../plan/types.js';
import { emptyContribution, type FeatureContribution } from './types.js';
import { unionFields, buildPropertiesStruct } from '../schema.js';
import { MATERIAL_MODELS, modelStructFields } from '../../../components/materials/index.js';
import { VOLUME_SCATTERING_MODELS } from '../../../components/volume_scattering/index.js';
import { SAMPLERS } from '../../../components/sampler/index.js';
import { SENSORS } from '../../../components/sensor/index.js';
import { COLOR_MODELS } from '../../../components/color/index.js';
import { kindById } from '../../../components/color/spectra/index.js';
import spectrumGLSL from '../../../components/color/spectrum.glsl?raw';

import structsGLSL from '../../../glsl/core/structs.glsl?raw';
import structsMediaGLSL from '../../../glsl/core/structs_media.glsl?raw';
import interactionGLSL from '../../../glsl/core/interaction.glsl?raw';
import mathGLSL from '../../../glsl/core/math.glsl?raw';
import mathMediaGLSL from '../../../glsl/core/math_media.glsl?raw';
import microfacetGLSL from '../../../glsl/core/microfacet.glsl?raw';
import microfacetEnergyGLSL from '../../../components/materials/microfacet_energy/microfacet_energy.glsl?raw';
import { microfacetEnergyAsset } from '../../../components/materials/microfacet_energy/assets.js';
import { AMBIENT_SPACES } from '../../../components/ambient/index.js';

/** The ambient occupant's block, from the registry (D3) — throws on an unregistered
 *  type as an unreachable backstop (the Validator rejects upstream). */
function ambientBlock(type: string): { origin: string; source: string } {
    const d = AMBIENT_SPACES[type];
    if (d === undefined) throw new Error(`ambient space '${type}' has no occupant (Validator should have rejected it)`);
    return { origin: `components/ambient/${d.type}/${d.type}.glsl`, source: d.glsl };
}
import rayGLSL from '../../../glsl/core/ray.glsl?raw';
import type { ShaderBlock } from '../ShaderIR.js';

/** The energy gains under measurement.microfacet 'single-scattering': the constant 1, which
 *  folds out of the models' eval and sample. */
const SINGLE_SCATTERING_GAINS = {
    conductor: [
        'Spectrum microfacet_conductor_gain(float mu_o, float a, Spectrum f_avg) {',
        '    return SPECTRUM_ONE;   // single scattering: no compensation',
        '}',
    ].join('\n'),
    dielectric: [
        'float microfacet_dielectric_gain(float mu_o, float a, float eta) {',
        '    return 1.0;   // single scattering: no compensation',
        '}',
    ].join('\n'),
};

export function contributeCore(plan: RenderPlan): FeatureContribution {
    // Conditional INCLUSION, not preprocessor gating (item-9 commit D): media-free
    // programs contain no media structs/helpers at all. The last structural defines
    // died with this. (MIS math lives with its only caller: transport/math_mis.glsl.)
    const color = COLOR_MODELS[plan.program.measurement.color];
    const blocks: ShaderBlock[] = [
        { origin: `components/color/${color.id}/types.glsl`, source: color.typesGLSL },
        { origin: 'glsl/core/structs.glsl', source: structsGLSL },
    ];

    // Scene-scoped properties structs (§3.4, R2): the union of fields declared by the
    // models PRESENT. A Lambert-only program has no transmittance field; roughness
    // returns when GGX's schema declares it.
    const materialFields = unionFields(
        // Rows + DERIVED pseudo-rows (D4) — ONE list per model (modelStructFields), so
        // the struct, the lookup defaults, and the resolver can never disagree.
        plan.program.materials.models.map((m) => {
            const d = MATERIAL_MODELS[m];
            return d !== undefined ? modelStructFields(d) : [];
        }),
    );
    blocks.push({ origin: 'generated:material-properties', source: buildPropertiesStruct('MaterialProperties', materialFields) });

    if (plan.program.media.present) {
        // MediumProperties = the RTE's own extinction fields (every medium has them —
        // read by the volume-sampling bodies) + the PRESENT scattering models' schema
        // union (§3.4 literal: no field exists until a present model's schema declares
        // it — an absorbing-only program has no phase fields at all). `model` (registry
        // index) drives the dispatch and exists only when scattering models are live.
        const models = plan.program.media.models;
        const mediumFields = unionFields(models.map((m) => VOLUME_SCATTERING_MODELS[m]?.properties ?? []));
        const extra = ['Spectrum sigma_a;   // absorption', 'Spectrum sigma_s;   // scattering'];
        // Emission ε joins the RTE core iff some medium emits (impl-plan-medium-emission;
        // the exact-linkage rule — the field, its accessor, and its readers co-exist).
        if (plan.program.media.emission) extra.push('Spectrum emission;   // volume emission coefficient ε (W·sr⁻¹·m⁻³, dL/ds = ε)');
        // NB: IOR is NOT a MediumProperties field — it is consumed by its GRADIENT (the ray
        // bends by ∇n, evaluated at many nearby points per step), not by value at a collision
        // like σ_a/σ_s/ε. It lives in its own `ior_at(med, p)` accessor (fable-variable-ior).
        if (models.length > 0) extra.push('int model;   // volume_scattering registry index (interaction_medium_* dispatch)');
        blocks.push({
            origin: 'generated:medium-properties',
            source: buildPropertiesStruct('MediumProperties', mediumFields, extra),
        });
        blocks.push({ origin: 'glsl/core/structs_media.glsl', source: structsMediaGLSL });
    }
    blocks.push(
        { origin: 'glsl/core/interaction.glsl', source: interactionGLSL },
        // Sampler slot (pick-one): sole occupant today; a strategy knob arrives with the
        // second occupant (fable-components §3 — the Owen–Sobol record).
        { origin: 'components/sampler/pcg4d/pcg4d.glsl', source: SAMPLERS.pcg4d.glsl },
        { origin: 'components/color/spectrum.glsl', source: spectrumGLSL },
        { origin: 'glsl/core/math.glsl', source: mathGLSL },
    );
    if (plan.program.media.present) blocks.push({ origin: 'glsl/core/math_media.glsl', source: mathMediaGLSL });
    if (color.supportGLSL) blocks.push({ origin: `components/color/${color.id}/lookup.glsl`, source: color.supportGLSL });
    if (color.wavelengthSamplers) blocks.push({
        origin: `components/color/${color.id}/${plan.program.estimator.wavelengths}.glsl`,
        source: color.wavelengthSamplers[plan.program.estimator.wavelengths!],
    });
    const sensor = SENSORS[plan.program.measurement.sensor];
    blocks.push(
        // The colour projection calls the sensor's measurement response.
        { origin: `components/sensor/${sensor.id}/${sensor.id}.glsl`, source: sensor.glsl },
        { origin: `components/color/${color.id}/${color.id}.glsl`, source: color.glsl },
        // Ambient occupant from the registry (D3: the non-Euclidean door) — the plan's
        // measurement.ambient decision picks it; origin derived from the key.
        ambientBlock(plan.program.measurement.ambient),
        { origin: 'glsl/core/ray.glsl', source: rayGLSL },
    );
    // Helpers of the spectrum kinds this program evaluates at wavelengths (Planck, index formulas).
    for (const id of plan.program.spectrumKinds) {
        const helpers = kindById(id).glsl;
        if (helpers !== undefined) blocks.push(helpers);
    }
    // Microfacet stdlib (fable-rough-dielectric §4): D / Smith G₁ / VNDF / the frame maps,
    // shared by every microfacet MODEL. Gated on the descriptors' declared fact — a
    // program with no microfacet occupant carries none of it, and one with several
    // carries it once. AFTER the ambient occupant (the frame maps call ambient_dot).
    // Then the energy gains those models call (materials/microfacet_energy): the table
    // lookups under 'energy-compensated', otherwise a gain of 1 for each kind present.
    const textures = [...(color.textures ?? [])];
    const gains = [...new Set(plan.program.materials.models.flatMap((m) => MATERIAL_MODELS[m]?.microfacet?.energy ?? []))];
    if (gains.length > 0) {
        blocks.push({ origin: 'glsl/core/microfacet.glsl', source: microfacetGLSL });
        if (plan.program.measurement.microfacet === 'energy-compensated') {
            blocks.push({ origin: 'components/materials/microfacet_energy/microfacet_energy.glsl', source: microfacetEnergyGLSL });
            textures.push({ name: 'u_microfacetEnergy', source: `extern:${microfacetEnergyAsset.id}`, precision: 'highp' });
        } else {
            blocks.push({ origin: 'generated:microfacet-gains', source: gains.map((gain) => SINGLE_SCATTERING_GAINS[gain]).join('\n') });
        }
    }

    return {
        ...emptyContribution('core'),
        textures,
        blocks,
        provides: [
            { name: 'wavelengths_sample', signature: 'WavelengthSample wavelengths_sample()', componentScoped: true },
            { name: 'color_to_pixel', signature: 'vec3 color_to_pixel(vec2 film, Direction ray_dir, Radiance L, WavelengthSample camera_sample)', componentScoped: true },
        ],
        uniforms: [
            // Engine builtins are declared where READ (exact linkage): nothing in the main
            // program reads u_resolution (pixel/camera use u_imageSize) or u_time today —
            // the display pass declares its own u_resolution, bound by the Generator.
            // An animated feature declares u_time when it arrives.
            // RNG salt: bumped per accumulation reset so the seed doesn't replay (§2.11).
            { name: 'u_resetSalt', type: 'int', parameterPath: 'engine.resetSalt' },
        ],
    };
}
