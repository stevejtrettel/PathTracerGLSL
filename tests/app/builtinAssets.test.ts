import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { BuiltinAssets } from '../../src/app/BuiltinAssets.js';
import { Compiler } from '../../src/compiler/Compiler.js';
import { minimalScene, minimalStrategy } from '../witnesses/scenes/minimalScene.js';

const rgb = new Compiler().compile(minimalScene, minimalStrategy);
const spectral = new Compiler().compile(minimalScene, { ...minimalStrategy, measurement: { ...minimalStrategy.measurement, color: 'spectral' } });
const engine = () => ({ registerDataTexture: vi.fn() });
afterEach(() => vi.unstubAllGlobals());
describe('built-in resource provisioning', () => {
    it('RGB requests no built-in spectral data', async () => {
        const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
        await new BuiltinAssets().upload([rgb], engine());
        expect(fetch).not.toHaveBeenCalled();
    });
    it('deduplicates referenced assets and reuploads cached bytes to a restored context', async () => {
        const fetch = vi.fn(async (url: string) => {
            const file = url.includes('coefficients') ? 'coefficients' : 'curves';
            const bytes = readFileSync(new URL(`../../src/components/color/spectral/data/${file}.bin`, import.meta.url));
            return new Response(bytes);
        });
        vi.stubGlobal('fetch', fetch);
        const assets = new BuiltinAssets(), first = engine(), restored = engine();
        await assets.upload([spectral, rgb, spectral], first);
        await assets.upload([spectral], restored);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(first.registerDataTexture).toHaveBeenCalledTimes(2);
        expect(restored.registerDataTexture).toHaveBeenCalledTimes(2);
        for (let i = 0; i < 2; ++i) {
            const before = first.registerDataTexture.mock.calls[i], after = restored.registerDataTexture.mock.calls[i];
            expect(after[0]).toBe(before[0]);
            expect(after[1]).toBe(before[1]);
            expect(after.slice(2)).toEqual(before.slice(2));
        }
    });
    it('reports missing assets before rendering', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
        await expect(new BuiltinAssets().upload([spectral], engine())).rejects.toThrow(/jh-cie1931-d65-v1-coefficients.*404/);
    });
    it('rejects truncated and corrupted files', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(4))));
        await expect(new BuiltinAssets().upload([spectral], engine())).rejects.toThrow(/byte length/);
        vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(2048*384*16))));
        await expect(new BuiltinAssets().upload([spectral], engine())).rejects.toThrow(/checksum/);
    });
});
