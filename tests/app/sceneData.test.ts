// The scene-data textures, byte for byte. For every suite scene, pack its data exactly as the
// App does for that scene's renderers (compiled together, so the layout holds what they read)
// and fingerprint each texture. A change in these hashes means different bytes reach the GPU:
// intended changes regenerate the snapshot; a refactor of the packing must not move them.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { Compiler } from '../../src/compiler/Compiler.js';
import { packSceneData } from '../../src/app/sceneData.js';
import { witnessSuite } from '../witnesses/index.js';
import { demoSuite } from '../../demos/index.js';
import { isAsyncSceneEntry, type SceneSuiteEntry } from '../witnesses/types.js';

const suite = Object.fromEntries(
    Object.entries({ ...witnessSuite, ...demoSuite }).filter(([, e]) => !isAsyncSceneEntry(e)),
) as Record<string, SceneSuiteEntry>;

const hash = (a: ArrayBufferView): string =>
    createHash('sha256').update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest('hex').slice(0, 16);

describe('scene-data textures (byte fingerprints)', () => {
    const compiler = new Compiler();
    for (const [key, entry] of Object.entries(suite)) {
        it(key, async () => {
            const { sceneData } = compiler.compileScene(entry.scene, entry.strategies);
            const packed = await packSceneData(sceneData);
            const fingerprint = packed === null ? null : {
                ...Object.fromEntries(Object.entries(packed.channels).map(([c, ch]) => [c, `${ch.width}x${ch.height} ${hash(ch.data)}`])),
                ...(packed.nodesq !== null ? { nodesq: `${packed.nodesq.width}x${packed.nodesq.height} ${hash(packed.nodesq.data)}` } : {}),
            };
            expect(fingerprint).toMatchSnapshot();
        }, 60_000);
    }
});
