// pages/registry.ts — the merged view the PAGES render: witnesses (tests/witnesses/,
// the durable GPU test system) + demos (demos/, the replaceable layer). The merge
// exists solely for display — the gallery lists everything, ?scene=<id> resolves both
// kinds, keys 1-9 bind each entry's strategies. The witness runner iterates
// witnessSuite alone; codegen-coverage tests iterate both registries explicitly.

import { witnessSuite } from '../tests/witnesses/index.js';
import { demoSuite } from '../demos/index.js';
import type { SceneSuiteEntry } from '../tests/witnesses/types.js';

export type { SceneSuiteEntry };
export { witnessSuite, demoSuite };

export const sceneSuite: Record<string, SceneSuiteEntry> = {
    ...witnessSuite,
    ...demoSuite,
};

export const DEFAULT_SCENE = 'two-light';
