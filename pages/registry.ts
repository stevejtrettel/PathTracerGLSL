// pages/registry.ts — the merged view the PAGES render: witnesses (tests/witnesses/,
// the durable GPU test system) + demos (demos/, the replaceable layer). The merge
// exists solely for display — the gallery lists everything, ?scene=<id> resolves both
// kinds, keys 1-9 bind each entry's strategies. The witness runner iterates
// witnessSuite alone; codegen-coverage tests iterate both registries explicitly.

import { witnessSuite } from '../tests/witnesses/index.js';
import { demoSuite } from '../demos/index.js';
import type { SceneSuiteEntry, AnySceneSuiteEntry } from '../tests/witnesses/types.js';
export { isAsyncSceneEntry } from '../tests/witnesses/types.js';

export type { SceneSuiteEntry, AnySceneSuiteEntry };
export { witnessSuite, demoSuite };

// A demo key colliding with a witness key would silently WIN in this merge (audit
// P5) — fail loudly instead; suiteIntegrity.test.ts enforces the same rule statically.
for (const key of Object.keys(demoSuite)) {
    if (key in witnessSuite) {
        throw new Error(`registry: demo scene id '${key}' collides with a witness scene id — the merge would silently shadow the witness`);
    }
}

export const sceneSuite: Record<string, AnySceneSuiteEntry> = {
    ...witnessSuite,
    ...demoSuite,
};

export const DEFAULT_SCENE = 'two-light';
