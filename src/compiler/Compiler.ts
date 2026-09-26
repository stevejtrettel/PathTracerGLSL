// compiler/Compiler.ts

import type { ICompiler, SceneDescription, RenderStrategy, CompiledRenderer, CompiledScene } from './types.js';
import { analyze } from './analyze/Analyzer.js';
import { validate } from './analyze/Validator.js';
import { planRenderers } from './plan/Planner.js';
import { generate } from './generate/Generator.js';
import { sceneDataPlanOf } from './sceneData.js';
import { DiagnosticBag } from '../errors/core/DiagnosticBag.js';
import { validateCompiledRenderer } from '../errors/compiler/validation.js';

export class Compiler implements ICompiler {
    /** One strategy on its own: its data layout holds exactly what it reads. */
    compile(scene: SceneDescription, strategy: RenderStrategy): CompiledRenderer {
        return this.compileScene(scene, [strategy]).renderers[0];
    }

    /**
     * All of a scene's renderers, against ONE shared data layout. They share the scene-data
     * textures, so the layout must hold every optional structure any of them reads — and
     * nothing none of them reads. In order: validate every strategy (any error stops the
     * compile before work is done), plan the scene once and each strategy's decisions against
     * it, lay out the union of what they read (planRenderers), then generate every program
     * against that layout.
     */
    compileScene(scene: SceneDescription, strategies: RenderStrategy[]): CompiledScene {
        const features = analyze(scene);
        const warnings = new Set<string>();
        const keepWarnings = (bag: DiagnosticBag) => { for (const d of bag.getWarnings()) warnings.add(d.message); };

        if (strategies.length === 0) {
            const bag = new DiagnosticBag('compiler');
            bag.error('missing-required', 'compileScene needs at least one strategy').add();
            bag.throwIfErrors();
        }

        // Renderer ids are `${strategy.id}-${scene.id}`: two strategies with one id would
        // silently overwrite each other's programs in the engine.
        const ids = strategies.map((s) => s.id);
        const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
        if (duplicate !== undefined) {
            const bag = new DiagnosticBag('compiler');
            bag.error('invalid-setting', `Two strategies share the id '${duplicate}' — renderer ids must be unique within a scene`).add();
            bag.throwIfErrors();
        }

        for (const strategy of strategies) {
            const bag = new DiagnosticBag('compiler');
            validate(features, scene, strategy, bag);
            bag.throwIfErrors();
            keepWarnings(bag);
        }

        // The Planner emits diagnostics like every stage.
        const planBag = new DiagnosticBag('compiler');
        const { reads, placed, plans } = planRenderers(features, scene, strategies, planBag);
        planBag.throwIfErrors();
        keepWarnings(planBag);

        const renderers = strategies.map((strategy, i) => {
            const bag = new DiagnosticBag('compiler');
            const renderer = generate(plans[i], scene, strategy, bag);
            bag.throwIfErrors();
            // The compiled output's structure, checked before the engine ever sees it.
            validateCompiledRenderer(renderer, bag);
            bag.throwIfErrors();
            keepWarnings(bag);
            return renderer;
        });

        return { renderers, dataReads: reads, sceneData: sceneDataPlanOf(scene, placed), warnings: [...warnings] };
    }
}
