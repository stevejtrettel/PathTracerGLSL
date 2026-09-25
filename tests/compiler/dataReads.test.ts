// Exact linkage for scene data (docs/claude-data-exact-linkage.md): an optional data
// structure — the CWBVH, the light tree, the object table — is laid out and built only when
// some renderer on the scene reads it. A scene's renderers share one layout, sized by the
// union of what they read (Compiler.compileScene).

import { describe, it, expect } from 'vitest';
import { analyze } from '../../src/compiler/analyze/Analyzer.js';
import { validate } from '../../src/compiler/analyze/Validator.js';
import { plan, programDecisions } from '../../src/compiler/plan/Planner.js';
import { Compiler } from '../../src/compiler/Compiler.js';
import { DiagnosticBag } from '../../src/errors/core/DiagnosticBag.js';
import { packInstanceBatch } from '../../src/components/intersection/instancing/instancing.js';
import { witnessSuite } from '../witnesses/index.js';
import { demoSuite } from '../../demos/index.js';
import { isAsyncSceneEntry, type SceneSuiteEntry } from '../witnesses/types.js';
import type { SceneDescription, RenderStrategy, DataReads } from '../../src/compiler/types.js';

const suite = Object.fromEntries(
    Object.entries({ ...witnessSuite, ...demoSuite }).filter(([, e]) => !isAsyncSceneEntry(e)),
) as Record<string, SceneSuiteEntry>;

function planned(scene: SceneDescription, strategy: RenderStrategy, reads?: DataReads) {
    const features = analyze(scene);
    const bag = new DiagnosticBag('test');
    validate(features, scene, strategy, bag);
    bag.throwIfErrors();
    return plan(features, scene, strategy, bag, reads);
}

describe('decisions do not depend on the data layout', () => {
    // compileScene decides each strategy first (planning against a layout with EVERY optional
    // structure), then lays out only what the decisions read. That is sound only if the
    // decisions come out identical against the smaller layout — checked for every suite pair.
    for (const [key, entry] of Object.entries(suite)) {
        for (const strategy of entry.strategies) {
            it(`${key} + ${strategy.id}`, () => {
                const features = analyze(entry.scene);
                expect(planned(entry.scene, strategy).program).toEqual(programDecisions(features, entry.scene, strategy));
            });
        }
    }
});

describe('optional structures are laid out only when a renderer reads them', () => {
    const compiler = new Compiler();

    it('CWBVH: absent for a TLAS renderer alone; present when a sibling selects it; the TLAS renderer\'s own offsets unchanged', () => {
        const entry = witnessSuite['instance-params-twin'];
        const [tlas, cwbvh] = entry.strategies;
        expect(cwbvh.estimator.instanceAccel).toBe('cwbvh');

        const alone = compiler.compileScene(entry.scene, [tlas]);
        expect(alone.dataReads.cwbvh).toBe(false);
        const aloneBatch = planned(entry.scene, tlas, alone.dataReads).instanceBatches[0];
        expect(aloneBatch.slot.cwbvhNodesBase).toBe(-1);
        expect(aloneBatch.slot.cwbvhRecordsBase).toBe(-1);

        const both = compiler.compileScene(entry.scene, [tlas, cwbvh]);
        expect(both.dataReads.cwbvh).toBe(true);
        const bothBatch = planned(entry.scene, tlas, both.dataReads).instanceBatches[0];
        expect(bothBatch.slot.cwbvhNodesBase).toBeGreaterThanOrEqual(0);
        // A sibling's optional structure never moves this renderer's always-built regions,
        // so its compiled program is the same text either way.
        expect({ ...bothBatch.slot, cwbvhNodesBase: -1, cwbvhRecordsBase: -1 }).toEqual(aloneBatch.slot);
        expect(both.renderers[0].shaders).toEqual(alone.renderers[0].shaders);
    });

    it('light tree: absent under power selection alone; present when a sibling selects the tree', () => {
        const entry = witnessSuite['hundred-spheres'];
        const power = entry.strategies.find((s) => s.estimator.lightSelection !== 'bvh')!;
        const tree = entry.strategies.find((s) => s.estimator.lightSelection === 'bvh')!;
        expect(compiler.compileScene(entry.scene, [power]).dataReads.lightTree).toBe(false);
        expect(planned(entry.scene, power).lightTree).toBeUndefined();
        const both = compiler.compileScene(entry.scene, [power, tree]);
        expect(both.dataReads.lightTree).toBe(true);
        expect(planned(entry.scene, tree, both.dataReads).lightTree).toBeDefined();
    });

    it('object table: absent under unrolled dispatch alone; present when a sibling uses table dispatch', () => {
        const entry = witnessSuite.bazaar;
        const [table, unrolled] = entry.strategies;
        expect(unrolled.estimator.objectDispatch).toBe('unrolled');
        expect(compiler.compileScene(entry.scene, [unrolled]).dataReads.sceneTable).toBe(false);
        expect(planned(entry.scene, unrolled).sceneTable).toBeUndefined();
        const both = compiler.compileScene(entry.scene, [table, unrolled]);
        expect(both.dataReads.sceneTable).toBe(true);
        expect(planned(entry.scene, table, both.dataReads).sceneTable).toBeDefined();
    });

    it('the instance packer builds a CWBVH only when asked', () => {
        const box = { min: [-1, -1, -1] as [number, number, number], max: [1, 1, 1] as [number, number, number] };
        const placements = { count: 3, positions: new Float32Array([0, 0, 0, 3, 0, 0, 0, 3, 0]) };
        const sphere = { type: 'sphere', parameters: { center: [0, 0, 0], radius: 1 } };
        expect(packInstanceBatch(box, placements, undefined, sphere).cwbvh).toBeUndefined();
        expect(packInstanceBatch(box, placements, undefined, sphere, true).cwbvh).toBeDefined();
    });
});
