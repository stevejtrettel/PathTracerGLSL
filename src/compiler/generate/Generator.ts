// compiler/generate/Generator.ts

import type { SceneDescription, RenderStrategy, CompiledRenderer } from '../types.js';
import type { RenderPlan } from '../plan/types.js';
import { buildShaders } from './ShaderBuilder.js';
import { buildPipeline, buildUniforms, buildParameters, buildExportTargets } from './PipelineBuilder.js';

export function generate(plan: RenderPlan, scene: SceneDescription, strategy: RenderStrategy): CompiledRenderer {
    const rendererId = `${strategy.id}-${scene.id}`;
    const shaders = buildShaders(plan, rendererId);
    const pipeline = buildPipeline(rendererId);
    const uniforms = buildUniforms(plan);
    const parameters = buildParameters(plan);
    const exportTargets = buildExportTargets();

    return {
        id: rendererId,
        shaders,
        pipeline,
        uniforms,
        parameters,
        exportTargets,
    };
}
