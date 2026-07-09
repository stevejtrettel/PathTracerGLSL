import { describe, it, expect } from 'vitest';
import {
    resolveSDFPositioning,
    resolveColorProperty,
    resolveScalarProperty,
} from '../../src/compiler/plan/Planner.js';
import type { StandardSDF, GlslExpression, ValueParam, Vec3 } from '../../src/compiler/types.js';

const glsl: GlslExpression = { kind: 'glsl', source: 'vec3(1.0)' };
const param: ValueParam<Vec3> = { param: 'mat.albedo' };

describe('resolveSDFPositioning', () => {
    it('folds a sphere center into translation and zeroes center in parameters', () => {
        const sdf: StandardSDF = { type: 'sphere', parameters: { center: [1, 2, 3], radius: 1 } };
        const { parameters, translation } = resolveSDFPositioning(sdf, undefined);
        expect(translation).toEqual([1, 2, 3]);
        expect(parameters.center).toEqual([0, 0, 0]);
        expect(parameters.radius).toBe(1);
    });

    it('sums transform.position and center into a single translation', () => {
        const sdf: StandardSDF = { type: 'box', parameters: { center: [1, 1, 1], half: [0.5, 0.5, 0.5] } };
        const { translation } = resolveSDFPositioning(sdf, [10, 20, 30]);
        expect(translation).toEqual([11, 21, 31]);
    });

    it('exempts planes — center is not folded, parameters pass through unchanged', () => {
        const sdf: StandardSDF = { type: 'plane', parameters: { normal: [0, 1, 0], offset: 1, center: [5, 5, 5] } };
        const { parameters, translation } = resolveSDFPositioning(sdf, [1, 0, 0]);
        expect(parameters).toBe(sdf.parameters); // passthrough (same reference)
        expect(translation).toEqual([1, 0, 0]);
    });

    it('passes parameters through when there is no center', () => {
        const sdf: StandardSDF = { type: 'sphere', parameters: { radius: 2 } };
        const { parameters, translation } = resolveSDFPositioning(sdf, [1, 2, 3]);
        expect(parameters).toBe(sdf.parameters);
        expect(translation).toEqual([1, 2, 3]);
    });
});

describe('resolveColorProperty', () => {
    it('returns the fallback when undefined', () => {
        expect(resolveColorProperty(undefined, [0.8, 0.8, 0.8])).toEqual([0.8, 0.8, 0.8]);
    });
    it('broadcasts a scalar number to a vec3', () => {
        expect(resolveColorProperty(0.5, [0, 0, 0])).toEqual([0.5, 0.5, 0.5]);
    });
    it('passes a Vec3 through', () => {
        expect(resolveColorProperty([0.1, 0.2, 0.3], [0, 0, 0])).toEqual([0.1, 0.2, 0.3]);
    });
    it('preserves GlslExpression and ValueParam (emitted as uniforms)', () => {
        expect(resolveColorProperty(glsl, [0, 0, 0])).toBe(glsl);
        expect(resolveColorProperty(param, [0, 0, 0])).toBe(param);
    });
});

describe('resolveScalarProperty', () => {
    it('returns the fallback when undefined', () => {
        expect(resolveScalarProperty(undefined, 1.0)).toBe(1.0);
    });
    it('passes a number through', () => {
        expect(resolveScalarProperty(0.4, 1.0)).toBe(0.4);
    });
    it('silently truncates a Vec3 to its first component', () => {
        expect(resolveScalarProperty([0.7, 0.2, 0.9], 1.0)).toBe(0.7);
    });
    it('preserves GlslExpression and ValueParam', () => {
        expect(resolveScalarProperty(glsl, 1.0)).toBe(glsl);
        const p: ValueParam<number> = { param: 'mat.roughness' };
        expect(resolveScalarProperty(p, 1.0)).toBe(p);
    });
});
