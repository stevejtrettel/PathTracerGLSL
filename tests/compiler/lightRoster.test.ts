// The roster ⇄ plan invariant (fable-light-bvh §5): lightRosterOf(scene) — the
// scene-side census the lightTree tenant and the App's table/tree/trails pack consume —
// must mirror the Planner's three desugar routes EXACTLY. The Planner's runtime assert
// checks kinds; this test pins VALUES too (mesh entries excepted — their geometry lives
// in the rail; radiance/area pin like every other kind since mesh treeBounds), across every registry pair.

import { describe, it, expect } from 'vitest';
import { analyze } from '../../src/compiler/analyze/Analyzer.js';
import { validate } from '../../src/compiler/analyze/Validator.js';
import { plan } from '../../src/compiler/plan/Planner.js';
import { DiagnosticBag } from '../../src/errors/core/DiagnosticBag.js';
import { lightRosterOf } from '../../src/compiler/plan/dataTenants.js';
import { witnessSuite } from '../witnesses/index.js';
import { demoSuite } from '../../demos/index.js';
import { isAsyncSceneEntry, type SceneSuiteEntry } from '../witnesses/types.js';

const sceneSuite = Object.fromEntries(
    Object.entries({ ...witnessSuite, ...demoSuite }).filter(([, e]) => !isAsyncSceneEntry(e)),
) as Record<string, SceneSuiteEntry>;

describe('light roster mirrors the planned lights (fable-light-bvh §5)', () => {
    for (const [key, entry] of Object.entries(sceneSuite)) {
        // One strategy suffices — the roster and the desugar are both scene-only.
        const strategy = entry.strategies[0];
        it(`${key}`, () => {
            const bag = new DiagnosticBag('compiler');
            const features = analyze(entry.scene);
            validate(features, entry.scene, strategy, bag);
            bag.throwIfErrors();
            const renderPlan = plan(features, entry.scene, strategy, bag);
            bag.throwIfErrors();

            const roster = lightRosterOf(entry.scene);
            expect(roster.map((l) => l.kind)).toEqual(renderPlan.lights.map((l) => l.kind));
            roster.forEach((l, i) => {
                // Mesh entries pin too since treeBounds landed (radiance/area are real
                // row values feeding the table and Φ) — no exceptions left.
                expect(l.values, `${key}: light ${i} (${l.kind}) values drift`).toEqual(renderPlan.lights[i].values);
            });
        });
    }
});
