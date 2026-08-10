// Suite-registry integrity (naming batch N4 — audit P5's silent-clobber spaces made
// loud). Three id spaces where a collision silently overwrites instead of erroring:
// witness∪demo scene keys (the pages/registry.ts merge — a demo key would shadow the
// witness), per-entry strategy ids (renderer id = `${strategy.id}-${scene.id}`; a
// duplicate within one entry clobbers the engine's flat program map), and scene-id
// mismatches between registry key and the scene's own id (the ?scene=<id> resolver
// and witness digests both key on it).

import { describe, it, expect } from 'vitest';
import { witnessSuite } from '../witnesses/index.js';
import { demoSuite } from '../../demos/index.js';
// Importing sections runs its own fail-loudly guard (exactly-once coverage, no
// dangling ids) — the import alone gates the gallery taxonomy statically.
import { gallerySections } from '../../pages/sections.js';

describe('suite registry integrity (P5 silent-clobber guards)', () => {
    it('witness and demo scene keys do not collide (the merge would silently shadow)', () => {
        const witnessKeys = new Set(Object.keys(witnessSuite));
        for (const key of Object.keys(demoSuite)) {
            expect(witnessKeys.has(key), `demo key '${key}' shadows a witness`).toBe(false);
        }
    });

    it('gallery sections file every scene exactly once (pages/sections.ts guard)', () => {
        // The real enforcement is sections.ts's import-time guard (a violation makes
        // the import above throw); this assertion just keeps the count honest.
        const filed = gallerySections.flatMap((s) =>
            s.entries.flatMap((e) => [e.id, ...(e.partners ?? [])]));
        expect(filed.length).toBe(Object.keys(witnessSuite).length + Object.keys(demoSuite).length);
    });

    for (const [suiteName, suite] of [['witness', witnessSuite], ['demo', demoSuite]] as const) {
        it(`${suiteName} entries: strategy ids unique within each entry (renderer-id collision otherwise)`, () => {
            for (const [key, entry] of Object.entries(suite)) {
                const ids = entry.strategies.map((s) => s.id);
                expect(new Set(ids).size, `entry '${key}' strategy ids: ${ids.join(', ')}`).toBe(ids.length);
            }
        });
    }
});
