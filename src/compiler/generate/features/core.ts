// compiler/generate/features/core.ts
// Always-present library code + engine builtin uniforms.

import type { RenderPlan } from '../../plan/types.js';
import { emptyContribution, type FeatureContribution } from './types.js';
import { unionFields, buildPropertiesStruct } from '../schema.js';
import { MATERIAL_MODELS } from '../../../components/materials/index.js';
import { PHASE_MODELS } from '../../../components/volume_scattering/index.js';
import { SAMPLERS } from '../../../components/sampler/index.js';
import { SENSORS } from '../../../components/sensor/index.js';

import structsGLSL from '../../../glsl/core/structs.glsl?raw';
import structsMediaGLSL from '../../../glsl/core/structs_media.glsl?raw';
import interactionGLSL from '../../../glsl/core/interaction.glsl?raw';
import mathGLSL from '../../../glsl/core/math.glsl?raw';
import mathMediaGLSL from '../../../glsl/core/math_media.glsl?raw';
import euclideanGLSL from '../../../components/ambient/euclidean/euclidean.glsl?raw';
import rayGLSL from '../../../glsl/core/ray.glsl?raw';
import type { ShaderBlock } from '../ShaderIR.js';

export function contributeCore(plan: RenderPlan): FeatureContribution {
    // Conditional INCLUSION, not preprocessor gating (item-9 commit D): media-free
    // programs contain no media structs/helpers at all. The last structural defines
    // died with this. (MIS math lives with its only caller: transport/math_mis.glsl.)
    const blocks: ShaderBlock[] = [{ origin: 'glsl/core/structs.glsl', source: structsGLSL }];

    // Scene-scoped properties structs (§3.4, R2): the union of fields declared by the
    // models PRESENT. A Lambert-only program has no transmittance field; roughness
    // returns when GGX's schema declares it.
    const materialFields = unionFields(
        plan.program.materials.models.map((m) => MATERIAL_MODELS[m]?.properties ?? []),
    );
    blocks.push({ origin: 'generated:material-properties', source: buildPropertiesStruct('MaterialProperties', materialFields) });

    if (plan.program.media.present) {
        // MediumProperties = the RTE's own extinction fields (every medium has them —
        // read by the volume-sampling bodies) + the PRESENT scattering models' schema
        // union (§3.4 literal: no field exists until a present model's schema declares
        // it — an absorbing-only program has no phase fields at all). `model` (registry
        // index) drives the dispatch and exists only when scattering models are live.
        const models = plan.program.media.models;
        const mediumFields = unionFields(models.map((m) => PHASE_MODELS[m]?.properties ?? []));
        const extra = ['Spectrum sigma_a;   // absorption', 'Spectrum sigma_s;   // scattering'];
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
        { origin: 'glsl/core/math.glsl', source: mathGLSL },
    );
    if (plan.program.media.present) blocks.push({ origin: 'glsl/core/math_media.glsl', source: mathMediaGLSL });
    blocks.push(
        // Sensor slot (measurement pick-one, We ≡ 1 today): the measurement importance the
        // accumulator main() multiplies into the traced radiance. Sole occupant — a strategy
        // knob arrives with the first real sensor (exposure/vignette/spectral).
        { origin: 'components/sensor/ideal/ideal.glsl', source: SENSORS.ideal.glsl },
        { origin: 'components/ambient/euclidean/euclidean.glsl', source: euclideanGLSL },
        { origin: 'glsl/core/ray.glsl', source: rayGLSL },
    );

    return {
        ...emptyContribution('core'),
        blocks,
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
