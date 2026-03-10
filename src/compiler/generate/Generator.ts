// compiler/generate/Generator.ts

import type { SceneDescription, RenderStrategy, CompiledRenderer, SourceMap } from '../types.js';
import type { RenderPlan } from '../plan/types.js';
import type { DiagnosticBag } from '../../errors/core/DiagnosticBag.js';
import { buildShaders } from './ShaderBuilder.js';
import { buildPipeline, buildUniforms, buildParameters, buildExportTargets } from './PipelineBuilder.js';

export function generate(
    plan: RenderPlan,
    scene: SceneDescription,
    strategy: RenderStrategy,
    bag: DiagnosticBag,
): CompiledRenderer {
    const rendererId = `${strategy.id}-${scene.id}`;
    const { shaders, sourceMaps: blockMaps } = buildShaders(plan, rendererId, bag);
    const pipeline = buildPipeline(rendererId, plan);
    const uniforms = buildUniforms(plan);
    const parameters = buildParameters(plan);
    const exportTargets = buildExportTargets();

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
