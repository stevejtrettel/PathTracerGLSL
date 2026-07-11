// compiler/Compiler.ts

import type { ICompiler, SceneDescription, RenderStrategy, CompiledRenderer } from './types.js';
import { analyze } from './analyze/Analyzer.js';
import { validate } from './analyze/Validator.js';
import { plan } from './plan/Planner.js';
import { generate } from './generate/Generator.js';
import { DiagnosticBag } from '../errors/core/DiagnosticBag.js';
import { validateCompiledRenderer } from '../errors/compiler/validation.js';

export class Compiler implements ICompiler {
    compile(scene: SceneDescription, strategy: RenderStrategy): CompiledRenderer {
        const bag = new DiagnosticBag('compiler');

        const features = analyze(scene);

        // Phase 1: Validate scene + strategy
        validate(features, scene, strategy, bag);
        bag.throwIfErrors();

        // Phase 2: Plan (passes bag — review C8: the Planner emits diagnostics like every stage)
        const renderPlan = plan(features, scene, strategy, bag);
        bag.throwIfErrors();

        // Phase 3: Generate (passes bag for shader build errors)
        const renderer = generate(renderPlan, scene, strategy, bag);
        bag.throwIfErrors();

        // Phase 4: Validate the compiled output structure
        validateCompiledRenderer(renderer, bag);
        bag.throwIfErrors();

        return renderer;
    }
}
