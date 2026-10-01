import { describe, it, expect, vi } from 'vitest';
import { TiledRenderer } from '../../src/app/TiledRenderer.js';
import type { SaveRequest } from '../../src/app/capture.js';
import type { RenderStamp } from '../../src/app/utils/file-export.js';

const writer = vi.hoisted(() => vi.fn());
vi.mock('../../src/app/utils/file-export.js', async (original) => ({
    ...await original(), saveImageFile: writer,
}));

describe('tiled saves', () => {
    it('keeps declarations and snapshots all stamps before unlocking or encoding', async () => {
        let locked = false;
        let scene = 'rendered';
        const save: SaveRequest[] = [
            { picture: 'radiance', format: 'png' }, { picture: 'variance', format: 'hdr' },
        ];
        const captures: string[] = [];
        const app = {
            getPictureFormats: () => ({ radiance: ['png', 'hdr'], variance: ['png', 'hdr'] }),
            getPinnedResetSalt: () => null, getResetSalt: () => 1, pinResetSalt: vi.fn(),
            capture: (request: SaveRequest) => {
                captures.push(request.picture);
                return request.format === 'png'
                    ? { format: 'png', pixels: new Uint8Array(64 * 64 * 4) }
                    : { format: 'hdr', pixels: new Float32Array(64 * 64 * 4) };
            },
            buildRenderStamp: vi.fn((picture: string, image: { resolution: number[]; spp: number }) => {
                expect(locked).toBe(true);
                return { picture, scene, ...image } as RenderStamp;
            }),
        };
        const production = {
            async renderTiles(_size: unknown, tiles: unknown[], _spp: number, onTile: (tile: unknown, i: number) => void) {
                locked = true;
                onTile(tiles[0], 0);
                await Promise.resolve();
                save[0].picture = 'variance';
                save[1].format = 'png';
                onTile(tiles[1], 1);
                locked = false;
                scene = 'after-render';
            },
        };
        writer.mockReset().mockImplementation(async () => {
            expect(app.buildRenderStamp).toHaveBeenCalledTimes(2);
            scene = 'during-encode';
            await Promise.resolve();
        });
        const renderer = new TiledRenderer(app as never, production as never, { emit() {} } as never);
        await renderer.render({ width: 128, height: 64, spp: 4, tileSize: 64, save });
        expect(captures).toEqual(['radiance', 'variance', 'radiance', 'variance']);
        expect(writer.mock.calls.map(([format, , , , name, stamp]) => [format, name.split('_')[3], stamp.picture, stamp.scene, stamp.resolution, stamp.spp]))
            .toEqual([
                ['png', 'radiance', 'radiance', 'rendered', [128, 64], 4],
                ['hdr', 'variance', 'variance', 'rendered', [128, 64], 4],
            ]);
    });
});
