// view.tonemap.whiteBalance: the display pass applies exposure × the white-balance matrix to every
// picture shown through the tonemap view, before safe_color and the curve. These tests read the
// emitted constant back (GLSL mat3 literals are column-major), so a transposed matrix fails.

import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import type { RenderStrategy } from '../../src/compiler/types.js';
import { blackbodyColor } from '../../src/components/color/spectra/blackbody/blackbody.js';
import { minimalScene, minimalStrategy } from '../witnesses/scenes/minimalScene.js';

const withView = (tonemap: Record<string, unknown>, more: Partial<RenderStrategy> = {}): RenderStrategy => ({
    ...minimalStrategy,
    ...more,
    view: { tonemap: { type: 'reinhard', ...tonemap } as RenderStrategy['view']['tonemap'] },
});
const displayOf = (strategy: RenderStrategy) => {
    const r = new Compiler().compile(minimalScene, strategy);
    return r.shaders.get(`${r.id}-display`)!.fragment;
};

/** The DISPLAY_VIEW literal as rows: GLSL fills a mat3 column by column. */
function displayView(fragment: string): number[][] {
    const m = fragment.match(/const mat3 DISPLAY_VIEW = mat3\(([^)]*)\);/);
    if (!m) throw new Error('DISPLAY_VIEW not found');
    const v = m[1].split(',').map((s) => Number(s.trim()));
    expect(v).toHaveLength(9);
    return [0, 1, 2].map((row) => [0, 1, 2].map((col) => v[3 * col + row]));
}

describe('view.tonemap.whiteBalance', () => {
    it('DISPLAY_VIEW · rgb_bb(2700) = exposure · (1, 1, 1), applied before safe_color', () => {
        const frag = displayOf(withView({ exposure: 1.5, whiteBalance: 2700 }));
        const M = displayView(frag);
        const bb = blackbodyColor(2700).rgb;
        for (const row of M) expect(row.reduce((s, m, k) => s + m * bb[k], 0)).toBeCloseTo(1.5, 5);
        expect(frag).toContain('safe_color(DISPLAY_VIEW * texture(u_radiance, uv).rgb)');
        expect(frag).not.toContain('DISPLAY_EXPOSURE');
    });

    it('applies to every tonemap-view picture (the variance picture too)', () => {
        const variance = displayOf(withView({ whiteBalance: 3200 }, {
            estimator: { ...minimalStrategy.estimator, accumulation: { type: 'average', variance: true } },
        }));
        expect(variance).toContain('safe_color(DISPLAY_VIEW * picture)');
        const guides = displayOf(withView({ whiteBalance: 3200 }, {
            measurement: { ...minimalStrategy.measurement, aovs: ['albedo'] },
        }));
        expect(guides).toContain('safe_color(DISPLAY_VIEW * picture)');
        expect(guides).not.toContain('DISPLAY_EXPOSURE');
    });

    it('without whiteBalance the display text keeps the exposure scalar', () => {
        const frag = displayOf(withView({ exposure: 2 }));
        expect(frag).toContain('#define DISPLAY_EXPOSURE 2.0000000');
        expect(frag).toContain('safe_color(texture(u_radiance, uv).rgb) * DISPLAY_EXPOSURE');
        expect(frag).not.toContain('DISPLAY_VIEW');
    });

    it("the raw probe path ('none') applies no view transform", () => {
        const frag = displayOf({ ...withView({}), view: { tonemap: { type: 'none', whiteBalance: 2700 } } });
        expect(frag).not.toContain('DISPLAY_VIEW');
        expect(frag).toContain('#define DISPLAY_EXPOSURE 1.0000000');
    });

    it('rejects a temperature outside the blackbody range or not a number', () => {
        expect(() => displayOf(withView({ whiteBalance: 500 }))).toThrow(/view\.tonemap\.whiteBalance must be a temperature in kelvin in \[1000, 40000\]/);
        expect(() => displayOf(withView({ whiteBalance: Number.NaN }))).toThrow(/view\.tonemap\.whiteBalance/);
        expect(() => displayOf(withView({ whiteBalance: 'warm' }))).toThrow(/view\.tonemap\.whiteBalance/);
    });
});
