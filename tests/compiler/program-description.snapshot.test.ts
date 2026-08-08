import { describe, it, expect } from 'vitest';
import { analyze } from '../../src/compiler/analyze/Analyzer.js';
import { validate } from '../../src/compiler/analyze/Validator.js';
import { plan } from '../../src/compiler/plan/Planner.js';
import { DiagnosticBag } from '../../src/errors/core/DiagnosticBag.js';
import { witnessSuite } from '../witnesses/index.js';
import { demoSuite } from '../../demos/index.js';
import { isAsyncSceneEntry, type SceneSuiteEntry } from '../witnesses/types.js';

// Codegen coverage spans BOTH registries: the durable witnesses and the demo layer.
// Data-scene thunk entries fetch untracked .inst files — skipped here; their codegen
// coverage is the committed fixture (tests/authoring/instanceCloud.test.ts).
const sceneSuite = Object.fromEntries(
    Object.entries({ ...witnessSuite, ...demoSuite }).filter(([, e]) => !isAsyncSceneEntry(e)),
) as Record<string, SceneSuiteEntry>;

/**
 * Structural snapshot of the ProgramDescription — the compiler's "link map"
 * (impl-plan-decision-hoist T2; fable-strategy-taxonomy.md sections).
 *
 * The ProgramDescription is the complete decision record: every "does this program
 * contain X" fact, resolved once by the Planner. This test freezes those DECISIONS per
 * registry pair, independently of GLSL text — "fog-area under pt-mis has scattering
 * arms + a shadow walker + lighting_pdf" is asserted here as structure, so a Planner
 * change that silently flips a decision fails THIS test with a one-line diff instead
 * of failing a 2000-line GLSL snapshot (or worse, not failing anything until a GPU
 * witness drifts).
 *
 * Iterates the ACTUAL suite registry (every pair the gallery can render), so a new
 * scene/strategy pair is covered the day it's registered.
 */
describe('ProgramDescription structural snapshot (the link map)', () => {
    for (const [key, entry] of Object.entries(sceneSuite)) {
        for (const strategy of entry.strategies) {
            it(`${key} + ${strategy.id}`, () => {
                const bag = new DiagnosticBag('compiler');
                const features = analyze(entry.scene);
                validate(features, entry.scene, strategy, bag);
                bag.throwIfErrors();
                const renderPlan = plan(features, entry.scene, strategy, bag);
                bag.throwIfErrors();
                expect(renderPlan.program).toMatchSnapshot();
            });
        }
    }
});
