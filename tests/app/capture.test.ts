import { describe, it, expect, vi } from 'vitest';
import { validateSaves } from '../../src/app/capture.js';

// Each saved file is encoded asynchronously; a stop during an encode resizes and clears the
// buffers. So saveAll must read every picture (and its stamp) before awaiting any encode.
let releasePNG!: () => void;
vi.mock('../../src/app/utils/file-export.js', () => ({
    saveHDRFile: vi.fn(),
    savePNGFile: vi.fn(() => new Promise<void>((resolve) => { releasePNG = resolve; })),
}));
const { App } = await import('../../src/app/App.js');
const fileExport = await import('../../src/app/utils/file-export.js');

const pictures = { radiance: ['hdr', 'png'], variance: ['hdr', 'png'] } as const;

describe('validateSaves', () => {
    it('accepts declared pictures in declared formats', () => {
        expect(() => validateSaves(pictures as never, [{ picture: 'variance', format: 'png' }, { picture: 'radiance', format: 'hdr' }])).not.toThrow();
    });

    it('rejects an unknown picture, naming the ones the renderer keeps', () => {
        expect(() => validateSaves(pictures as never, [{ picture: 'albedo', format: 'png' }]))
            .toThrow("Cannot save 'albedo': this renderer keeps radiance, variance");
    });

    it('rejects a format the picture does not declare', () => {
        expect(() => validateSaves({ normal: ['png'] }, [{ picture: 'normal', format: 'hdr' }]))
            .toThrow("Cannot save 'normal' as hdr: it can be saved as png");
    });
});

describe('App.saveAll', () => {
    it('validates the whole list before reading anything, then reads every picture before awaiting any encode', async () => {
        const log: string[] = [];
        const fake = {
            getPictureFormats: () => pictures,
            getCanvasSize: () => [2, 1],
            capture: vi.fn((r: { picture: string; format: string }) => {
                log.push(`capture:${r.picture}.${r.format}`);
                return { format: r.format, pixels: r.format === 'hdr' ? new Float32Array(8) : new Uint8Array(8) };
            }),
            buildRenderStamp: vi.fn((picture: string) => ({ picture })),
            _generateExportFilename: (picture: string, format: string) => `${picture}.${format}`,
        };
        const saveAll = App.prototype.saveAll;

        await expect(saveAll.call(fake as never, [{ picture: 'radiance', format: 'png' }, { picture: 'albedo', format: 'png' }])).rejects.toThrow(/albedo/);
        expect(fake.capture).not.toHaveBeenCalled();

        const done = saveAll.call(fake as never, [
            { picture: 'radiance', format: 'png' },
            { picture: 'variance', format: 'png' },
            { picture: 'radiance', format: 'hdr' },
        ]);
        await vi.waitFor(() => expect(fileExport.savePNGFile).toHaveBeenCalledTimes(1));
        // The first PNG is still encoding: every picture has already been read and stamped.
        expect(log).toEqual(['capture:radiance.png', 'capture:variance.png', 'capture:radiance.hdr']);
        expect(fake.buildRenderStamp.mock.calls.map(([p]) => p)).toEqual(['radiance', 'variance', 'radiance']);
        releasePNG(); await vi.waitFor(() => expect(fileExport.savePNGFile).toHaveBeenCalledTimes(2));
        releasePNG(); await done;
        expect(vi.mocked(fileExport.savePNGFile).mock.calls.map((c) => [c[3], (c[4] as { picture: string }).picture]))
            .toEqual([['radiance.png', 'radiance'], ['variance.png', 'variance']]);
        expect(vi.mocked(fileExport.saveHDRFile).mock.calls.map((c) => c[3])).toEqual(['radiance.hdr']);
    });
});
