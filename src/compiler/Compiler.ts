// compiler/Compiler.ts

import type { ICompiler, SceneDescription, RenderStrategy, CompiledRenderer } from './types.js';
import { analyze } from './analyze/Analyzer.js';
import { plan } from './plan/Planner.js';
import { generate } from './generate/Generator.js';

export class Compiler implements ICompiler {
    compile(scene: SceneDescription, strategy: RenderStrategy): CompiledRenderer {
        const features = analyze(scene, strategy);
        const renderPlan = plan(features, scene, strategy);
        return generate(renderPlan, scene, strategy);
    }
}
