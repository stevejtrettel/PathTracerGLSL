// Power-CDF invariants (audit H6.1): the area-aware selection math in
// generate/features/lighting.ts is pure TS that the snapshots only byte-freeze —
// these tests pin the INVARIANTS (pitfalls 4/5/6/11 of impl-plan-area-lights).

import { describe, it, expect } from 'vitest';
import { lightPower, computeSelectPdf } from '../../src/compiler/generate/features/lighting.js';
import type { PlannedLight } from '../../src/compiler/plan/types.js';

const point = (intensity: number, color: [number, number, number] = [1, 1, 1]): PlannedLight =>
    ({ id: 0, kind: "point", values: { position: [0, 5, 0], intensity: [color[0] * intensity, color[1] * intensity, color[2] * intensity] } });
const quad = (intensity: number, e1: [number, number, number], e2: [number, number, number]): PlannedLight =>
    ({ id: 0, kind: "quad", regionId: 0, values: { corner: [0, 0, 0], edge1: e1, edge2: e2, radiance: [intensity, intensity, intensity] } });
const sphere = (intensity: number, radius: number): PlannedLight =>
    ({ id: 0, kind: "sphere", regionId: 0, values: { center: [0, 0, 0], radius, radiance: [intensity, intensity, intensity] } });

describe('lightPower — pbrt PowerLightSampler formulas', () => {
    it('point: 4π · avg(color·intensity)', () => {
        expect(lightPower(point(10))).toBeCloseTo(4 * Math.PI * 10, 10);
        // spectrum average, not luminance: avg([3,0,0]) = 1
        expect(lightPower(point(1, [3, 0, 0]))).toBeCloseTo(4 * Math.PI * 1, 10);
    });

    it('quad: π · A · avg, with A = |edge1 × edge2| (area-aware, pitfall 6)', () => {
        // 2×3 rectangle, A = 6
        expect(lightPower(quad(5, [2, 0, 0], [0, 3, 0]))).toBeCloseTo(Math.PI * 6 * 5, 10);
        // non-axis-aligned parallelogram: A = |cross([1,0,0],[1,1,0])| = 1
        expect(lightPower(quad(1, [1, 0, 0], [1, 1, 0]))).toBeCloseTo(Math.PI * 1 * 1, 10);
    });

    it('sphere: 4π² r² · avg', () => {
        expect(lightPower(sphere(2, 3))).toBeCloseTo(Math.PI * 4 * Math.PI * 9 * 2, 8);
    });

    it('area-awareness: a big dim panel outweighs a tiny bright one of equal luminance·area product asymmetry', () => {
        const bigDim = lightPower(quad(1, [10, 0, 0], [0, 10, 0]));   // A=100, Le=1 → 100π
        const tinyBright = lightPower(quad(50, [1, 0, 0], [0, 1, 0])); // A=1, Le=50 → 50π
        expect(bigDim).toBeGreaterThan(tinyBright);
    });

    it('zero-power light floors at 1e-8 (never 0, never NaN)', () => {
        const p = lightPower(point(0));
        expect(p).toBe(1e-8);
        expect(Number.isFinite(p)).toBe(true);
    });
});

describe('computeSelectPdf — selection pdfs shared by sampler and lighting_pdf', () => {
    it('sums to 1 under power selection', () => {
        const pdfs = computeSelectPdf([point(10), quad(5, [2, 0, 0], [0, 3, 0]), sphere(2, 1)], 'power');
        expect(pdfs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
        expect(pdfs.every((p) => p > 0)).toBe(true);
    });

    it('sums to 1 under uniform selection with equal weights', () => {
        const pdfs = computeSelectPdf([point(1), point(100), point(0.01)], 'uniform');
        expect(pdfs).toEqual([1 / 3, 1 / 3, 1 / 3]);
    });

    it('is proportional to lightPower under power selection', () => {
        const lights = [point(1), point(3)];
        const [a, b] = computeSelectPdf(lights, 'power');
        expect(b / a).toBeCloseTo(lightPower(lights[1]) / lightPower(lights[0]), 10);
    });

    it('single light → [1] exactly', () => {
        expect(computeSelectPdf([point(7)], 'power')).toEqual([1]);
        expect(computeSelectPdf([point(7)], 'uniform')).toEqual([1]);
    });

    it('no lights → [] (NEE self-disables, no division by zero)', () => {
        expect(computeSelectPdf([], 'power')).toEqual([]);
    });

    it('a zero-power light among bright ones keeps a nonzero floor probability and total 1', () => {
        const pdfs = computeSelectPdf([point(0), point(100)], 'power');
        expect(pdfs[0]).toBeGreaterThan(0);
        expect(pdfs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    });
});
