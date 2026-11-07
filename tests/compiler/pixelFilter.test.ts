// measurement.pixel: which pixel filter (components/pixel) a program links. Box is the default
// and is recorded in the resolved measurement (and so in export stamps) even when not authored.

import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { resolveMeasurement } from '../../src/compiler/plan/measurement.js';
import { PIXEL_MODELS } from '../../src/components/pixel/index.js';
import type { RenderStrategy } from '../../src/compiler/types.js';
import { minimalScene, minimalStrategy } from '../witnesses/scenes/minimalScene.js';

const withPixel = (pixel: unknown, color: 'rgb' | 'spectral' = 'rgb'): RenderStrategy =>
    ({ ...minimalStrategy, measurement: { ...minimalStrategy.measurement, pixel: pixel as string, color } });
const fragmentOf = (strategy: RenderStrategy) => {
    const r = new Compiler().compile(minimalScene, strategy);
    return r.shaders.get(`${r.id}-main`)!.fragment;
};

describe('measurement.pixel', () => {
    it('defaults to box, recorded in the resolved measurement', () => {
        expect(resolveMeasurement(minimalScene, minimalStrategy).pixel).toBe('box');
        expect(resolveMeasurement(minimalScene, withPixel('gaussian')).pixel).toBe('gaussian');
    });

    it('box authored or defaulted links the same program text', () => {
        expect(fragmentOf(withPixel('box'))).toBe(fragmentOf(minimalStrategy));
        expect(fragmentOf(minimalStrategy)).toContain(PIXEL_MODELS.box.glsl.trim());
    });

    for (const color of ['rgb', 'spectral'] as const) {
        it(`gaussian links the gaussian filter and not the box (${color})`, () => {
            const frag = fragmentOf(withPixel('gaussian', color));
            expect(frag).toContain(PIXEL_MODELS.gaussian.glsl.trim());
            expect(frag).not.toContain(PIXEL_MODELS.box.glsl.trim());
            expect(frag.match(/vec2 pixel_sample\(vec2 coord, vec2 xi\) \{/g)).toHaveLength(1);
        });
    }

    it('rejects a value that is not a pixel filter', () => {
        expect(() => fragmentOf(withPixel('tent'))).toThrow(/measurement\.pixel must be one of 'box' \| 'gaussian' \(got "tent"\)/);
        expect(() => fragmentOf(withPixel(3))).toThrow(/measurement\.pixel/);
    });
});
