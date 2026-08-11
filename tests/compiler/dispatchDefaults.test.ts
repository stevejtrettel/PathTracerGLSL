// No registry strategy may INHERIT the scene-dependent dispatch default
// (impl-plan-sdf-as-shape T6).
//
// The default for `estimator.objectDispatch` depends on the SCENE: past
// MARCHED_TABLE_THRESHOLD marched objects it becomes 'table', because the unrolled
// regime emits one march loop per object and the shader stops compiling. That default
// is right for authoring and wrong for A/B fixtures — an arm that relies on it stops
// being the control the moment the scene grows.
//
// It already happened once: sdf-table-twin's "unrolled" arm silently became a second
// table arm, and the twin passed at 0.00%/0.00% comparing the table against itself.
// A witness that cannot fail is worse than no witness, so this makes the silent case
// impossible: any scene at or over the threshold must state the axis on every strategy
// it ships.

import { describe, it, expect } from 'vitest';
import { sceneSuite } from '../../pages/registry.js';
import { MARCHED_TABLE_THRESHOLD } from '../../src/components/intersection/index.js';
import { resolveBackend } from '../../src/components/geometry/index.js';
import { isPrimitiveObject } from '../../src/compiler/types.js';
import type { SceneDescription } from '../../src/compiler/types.js';

const marchedCount = (scene: SceneDescription): number =>
    scene.objects.filter((o) => isPrimitiveObject(o) && resolveBackend(o.type, o.backend) === 'sdf').length;

describe('scene-dependent dispatch default is never inherited by a registry strategy', () => {
    for (const [id, entry] of Object.entries(sceneSuite)) {
        // Async data scenes carry a THUNK here, not a scene — the registry-iterating
        // convention (skipped like everywhere else).
        const scene = (entry as { scene?: SceneDescription }).scene;
        if (scene === undefined || !Array.isArray(scene.objects)) continue;
        const marched = marchedCount(scene);
        if (marched < MARCHED_TABLE_THRESHOLD) continue;

        it(`${id} (${marched} marched objects) states objectDispatch on every strategy`, () => {
            const missing = (entry.strategies ?? [])
                .filter((s) => s.estimator.objectDispatch === undefined)
                .map((s) => s.id);
            expect(missing,
                `${id} has ${marched} marched objects, so the dispatch default is scene-dependent: `
                + `strategies [${missing.join(', ')}] would inherit 'table' silently. State it explicitly.`)
                .toEqual([]);
        });
    }
});
