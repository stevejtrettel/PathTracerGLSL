// compiler/generate/Generator.ts

import type { SceneDescription, RenderStrategy, CompiledRenderer, SourceMap } from '../types.js';
import type { RenderPlan } from '../plan/types.js';
import type { DiagnosticBag } from '../../errors/core/DiagnosticBag.js';
import { buildShaders } from './ShaderBuilder.js';
import { collectFeatures } from './features/index.js';
import { buildPipeline, buildUniforms, buildExportTargets } from './PipelineBuilder.js';

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
    const pipeline = buildPipeline(rendererId, plan, merged.textures);
    const uniforms = buildUniforms(merged.uniforms);
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
        sourceMaps,
    };
}
