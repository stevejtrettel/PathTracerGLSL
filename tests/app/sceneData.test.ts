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
import { instanceLightsTwin, instanceLightsNeeStrategy } from '../witnesses/scenes/instanceLightsWitness.js';
import type { SceneDescription } from '../../src/compiler/types.js';

const suite = Object.fromEntries(
    Object.entries({ ...witnessSuite, ...demoSuite }).filter(([, e]) => !isAsyncSceneEntry(e)),
) as Record<string, SceneSuiteEntry>;

const hash = (a: ArrayBufferView): string =>
    createHash('sha256').update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest('hex').slice(0, 16);

const fingerprintOf = (packed: Awaited<ReturnType<typeof packSceneData>>) => packed === null ? null : {
    ...Object.fromEntries(Object.entries(packed.channels).map(([c, ch]) => [c, `${ch.width}x${ch.height} ${hash(ch.data)}`])),
    ...(packed.nodesq !== null ? { nodesq: `${packed.nodesq.width}x${packed.nodesq.height} ${hash(packed.nodesq.data)}` } : {}),
};

describe('scene-data textures (byte fingerprints)', () => {
    const compiler = new Compiler();
    for (const [key, entry] of Object.entries(suite)) {
        it(key, async () => {
            const { sceneData } = compiler.compileScene(entry.scene, entry.strategies);
            expect(fingerprintOf(await packSceneData(sceneData))).toMatchSnapshot();
        }, 60_000);
    }
});

describe('scene-data textures — instanced sphere lights with per-instance emission', () => {
    // No synchronous suite scene gives instanced sphere lights their own emission colours (only
    // the loaded data-cloud demos do), so this pins that packing path: each light's tree box and
    // power come from its placement record and its emission attribute.
    it('instance-lights with an emission attribute', async () => {
        const count = 64;
        const emission = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            emission[3 * i] = 1 + (i % 5);
            emission[3 * i + 1] = 0.5 + (i % 3);
            emission[3 * i + 2] = 2 + 0.25 * (i % 7);
        }
        const scene: SceneDescription = {
            ...instanceLightsTwin,
            id: 'instance-lights-attr',
            objects: instanceLightsTwin.objects.map((o) => ('kind' in o && o.kind === 'instanced' ? { ...o, attributes: { emission } } : o)),
        };
        const { sceneData } = new Compiler().compileScene(scene, [instanceLightsNeeStrategy]);
        expect(sceneData.lightTree?.batchLights[0]?.emission).toHaveProperty('attribute');   // the per-instance branch
        expect(fingerprintOf(await packSceneData(sceneData))).toMatchSnapshot();
    }, 60_000);
});
