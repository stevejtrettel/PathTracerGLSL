// A scene's renderers are compiled together against one shared data layout
// (Compiler.compileScene). The order the strategies are given in must not matter: every renderer
// compiles to the same output, and the scene-data plan is the same. So nothing one renderer's
// compile does may reach another's, and no fact the renderers share may depend on which renderer
// comes first.

import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import type { CompiledScene } from '../../src/compiler/types.js';
import { witnessSuite } from '../witnesses/index.js';
import { demoSuite } from '../../demos/index.js';
import { isAsyncSceneEntry, type SceneSuiteEntry } from '../witnesses/types.js';
import { compiledJson } from '../helpers/compiledJson.js';

const multi = Object.entries({ ...witnessSuite, ...demoSuite })
    .filter((e): e is [string, SceneSuiteEntry] => !isAsyncSceneEntry(e[1]) && e[1].strategies.length >= 2);

const renderersById = (c: CompiledScene) => new Map(c.renderers.map((r) => [r.id, compiledJson(r)]));

describe('compiling a scene does not depend on the order of its strategies', () => {
    const compiler = new Compiler();
    for (const [key, entry] of multi) {
        it(`${key} (${entry.strategies.length} strategies)`, () => {
            const forward = compiler.compileScene(entry.scene, entry.strategies);
            const reversed = compiler.compileScene(entry.scene, [...entry.strategies].reverse());
            expect(renderersById(reversed)).toEqual(renderersById(forward));
            expect(compiledJson(reversed.sceneData)).toBe(compiledJson(forward.sceneData));
            expect(reversed.dataReads).toEqual(forward.dataReads);
            expect([...reversed.warnings].sort()).toEqual([...forward.warnings].sort());
        });
    }
});
