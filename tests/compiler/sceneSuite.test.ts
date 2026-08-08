import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { sceneSuite as mergedSuite, DEFAULT_SCENE, isAsyncSceneEntry, type SceneSuiteEntry } from '../../pages/registry.js';

// Data-scene thunk entries fetch untracked .inst files — skipped here; their codegen
// coverage is the committed fixture (tests/authoring/instanceCloud.test.ts).
const sceneSuite = Object.fromEntries(
    Object.entries(mergedSuite).filter(([, e]) => !isAsyncSceneEntry(e)),
) as Record<string, SceneSuiteEntry>;

describe('scene suite', () => {
    it('DEFAULT_SCENE is a registered SYNC scene', () => {
        expect(sceneSuite[DEFAULT_SCENE]).toBeDefined();
    });

    // One test per (scene, strategy) pair — a new registry entry is covered automatically.
    for (const [id, entry] of Object.entries(sceneSuite)) {
        for (const strategy of entry.strategies) {
            it(`compiles '${id}' with strategy '${strategy.id}' without throwing`, () => {
                const compiler = new Compiler();
                const renderer = compiler.compile(entry.scene, strategy);
                expect(renderer.shaders.size).toBeGreaterThan(0);
                expect(renderer.pipeline.passes.length).toBeGreaterThan(0);
                // renderer id follows the pinned `${strategy.id}-${scene.id}` convention
                expect(renderer.id).toBe(`${strategy.id}-${entry.scene.id}`);
            });
        }
    }
});
