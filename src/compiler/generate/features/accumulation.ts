// compiler/generate/features/accumulation.ts
// Progressive accumulation: the generated main() that traces one camera sample and folds it
// into every planned picture, + its uniforms. The folding arithmetic is static GLSL — each
// mode's and statistic's update rule (components/accumulator) — so this file writes only
// plumbing: the camera sample, the previous-value fetches, the calls and the writes.

import type { RenderPlan, PlannedPicture } from '../../plan/types.js';
import type { DiagnosticBag } from '../../../errors/core/DiagnosticBag.js';
import { emptyContribution, type FeatureContribution } from './types.js';
import { ACCUMULATORS, requestedStatistic } from '../../../components/accumulator/index.js';

/** One camera sample, traced and converted to film RGB (`color`). */
const CAMERA_SAMPLE = `    vec2 pixel = gl_FragCoord.xy + u_pixelOffset;
    // Seed with the GLOBAL pixel (tile offset included) — seeding with the local
    // gl_FragCoord replays the identical RNG stream in every tile of a tiled render.
    // sampleCount decorrelates samples within a render; resetSalt (bumped per
    // accumulation reset) decorrelates across resets (§2.11).
    rng_init(uvec2(pixel), uint(u_sampleCount), uint(u_resetSalt));

    vec2 film = pixel_sample(pixel, random2());   // sub-pixel placement (pixel/ footprint)
    vec2 xiLens = random2();                       // lens-disk sample — cameras without aperture ignore it
    WavelengthSample camera_sample = wavelengths_sample();
    Ray ray = camera_generateRay(film, xiLens, camera_sample.wl);
    Radiance L = transport_trace(ray);
    vec3 color = color_to_pixel(film, ray.direction, L, camera_sample);`;

/** The main(): fetch each picture's previous value (when the mode reads history), compute
 *  each new value by its update rule in list order — the main picture first, so a statistic
 *  can read its new value — then write every picture to its output. */
function generateMain(pictures: PlannedPicture[]): string {
    const main = pictures[0];
    const lines = ['void main() {', CAMERA_SAMPLE, ''];
    const history = pictures.filter((p) => p.previous !== null);
    if (history.length > 0) {
        lines.push('    ivec2 coord = ivec2(gl_FragCoord.xy);');
        for (const p of history) lines.push(`    vec3 ${p.name}_previous = texelFetch(${p.previous}, coord, 0).rgb;`);
    }
    for (const p of pictures) {
        const args = p.role === 'main'
            ? (p.previous !== null ? `${p.name}_previous, color, u_sampleCount` : 'color')
            : `${p.name}_previous, ${main.name}_previous, ${main.name}_new, color, u_sampleCount`;
        lines.push(`    vec3 ${p.name}_new = ${p.update}(${args});`);
    }
    for (const p of pictures) lines.push(`    ${p.output} = vec4(${p.name}_new, 1.0);`);
    lines.push('}');
    return lines.join('\n');
}

export function contributeAccumulation(plan: RenderPlan, bag: DiagnosticBag): FeatureContribution {
    const type = plan.program.estimator.accumulation.type;
    const d = ACCUMULATORS[type];
    if (d === undefined) {
        // Backstop — the Validator gates the type against the same registry.
        bag.error('invalid-setting', `Accumulation type '${type}' not yet supported`).add();
        return { ...emptyContribution('accumulation'), blocks: [{ origin: `generated:main-${type}`, source: '// unsupported accumulation' }] };
    }
    const statName = requestedStatistic(plan.program.estimator.accumulation);

    // Each picture's previous-frame sampler, declared HERE because main() reads it — the same
    // planned list the pass inputs are bound from, so declaration and binding cannot differ.
    // A mode that reads no history (oneshot) has none: its programs carry no dead sampler.
    const inputDecls = plan.pipeline.pictures
        .filter((p) => p.previous !== null)
        .map((p) => `uniform sampler2D ${p.previous};`);

    return {
        ...emptyContribution('accumulation'),
        blocks: [
            ...(inputDecls.length
                ? [{ origin: 'generated:accumulation-inputs', source: inputDecls.join('\n') }]
                : []),
            // The update rules main() calls: the mode's, then the requested statistic's.
            { origin: `components/accumulator/${d.type}/${d.type}.glsl`, source: d.glsl },
            ...(statName !== null
                ? [{ origin: `components/accumulator/${statName}/${statName}.glsl`, source: d.statistics[statName].glsl }]
                : []),
            { origin: 'generated:accumulation-main', source: generateMain(plan.pipeline.pictures) },
        ],
        // Engine builtins declared where READ (the core.ts discipline).
        uniforms: [
            { name: 'u_sampleCount', type: 'int', parameterPath: 'engine.sampleCount' },
            { name: 'u_pixelOffset', type: 'vec2', parameterPath: 'engine.pixelOffset', default: [0, 0] },
        ],
        requires: ['pixel_sample', 'camera_generateRay', 'wavelengths_sample', 'transport_trace', 'color_to_pixel'],
    };
}
