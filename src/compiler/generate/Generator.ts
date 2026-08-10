// compiler/generate/Generator.ts

import type { SceneDescription, RenderStrategy, CompiledRenderer, SourceMap } from '../types.js';
import type { RenderPlan } from '../plan/types.js';
import type { DiagnosticBag } from '../../errors/core/DiagnosticBag.js';
import { buildShaders } from './ShaderBuilder.js';
import { collectFeatures } from './features/index.js';
import { buildPipeline, buildUniforms, buildExportTargets, buildLdrRecipe } from './PipelineBuilder.js';

export function generate(
    plan: RenderPlan,
    scene: SceneDescription,
    strategy: RenderStrategy,
    bag: DiagnosticBag,
): CompiledRenderer {
    const rendererId = `${strategy.id}-${scene.id}`;

    // Merge every feature's contribution once (§2.10) — the single source of truth the
    // shaders, uniform bindings, and parameter metadata are all built from.
    const merged = collectFeatures(plan, bag);

    const variance = plan.program.estimator.accumulation.type === 'variance';
    const { shaders, sourceMaps: blockMaps } = buildShaders(merged, rendererId, plan.program.view.tonemap, variance);

    // The sampler BUDGET (fable-data-rail §5): count the REAL roster in each assembled
    // program against the WebGL2 spec floor of 16 fragment units — an over-budget program
    // is an itemized compile-time error, never a driver link mystery. Checked here (not
    // the Planner) because the assembled source is the one true roster (feature textures
    // + framebuffer inputs + loaders), so the check can never drift from what ships.
    // Rail v2 makes the count role-shaped (≤ ~13 worst case), so this is the tripwire
    // against future channel/texture creep, not a working constraint.
    const SAMPLER_FLOOR = 16;
    for (const [shaderId, shader] of shaders) {
        // Counts BOTH float and integer samplers (usampler2D shares the same unit pool).
        const samplers = [...shader.fragment.matchAll(/uniform\s+(?:highp\s+)?u?sampler2D\s+(\w+)/g)].map((m) => m[1]);
        if (samplers.length > SAMPLER_FLOOR) {
            bag.error('invalid-setting',
                `Program '${shaderId}' binds ${samplers.length} sampler2D uniforms — over the guaranteed WebGL2 floor of ${SAMPLER_FLOOR} fragment texture units (MAX_TEXTURE_IMAGE_UNITS). Roster: ${samplers.join(', ')}. Scenes must fit the portability floor (fable-data-rail §5).`)
                .add();
        }
    }
    const pipeline = buildPipeline(rendererId, plan, merged.textures);
    // The display pass's own resources ride here, not in a feature: the main program no
    // longer declares u_resolution (nothing in it reads the builtin — exact linkage), but
    // the display fragment ShaderBuilder emits does (gl_FragCoord → uv). ParameterManager
    // binds per-shader by location, so this binding is inert for the main program.
    const uniforms = buildUniforms([
        ...merged.uniforms,
        { name: 'u_resolution', type: 'vec2', parameterPath: 'engine.resolution' },
    ]);
    const parameters = merged.parameters;
    const exportTargets = buildExportTargets(variance);

    // Convert BlockMapping[] to SourceMap objects, including assembled source
    const sourceMaps = new Map<string, SourceMap>();
    for (const [shaderId, blocks] of blockMaps) {
        const shader = shaders.get(shaderId);
        sourceMaps.set(shaderId, {
            shaderId,
            blocks: blocks.map(b => ({
                origin: b.origin,
                startLine: b.startLine,
                endLine: b.endLine,
            })),
            assembledSource: shader?.fragment,
        });
    }

    return {
        id: rendererId,
        shaders,
        pipeline,
        uniforms,
        parameters,
        exportTargets,
        ldrRecipe: buildLdrRecipe(),   // E5: the display re-run as data — the engine reads, never knows
        sourceMaps,
    };
}
