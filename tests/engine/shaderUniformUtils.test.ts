import { describe, it, expect } from 'vitest';
import { uniformValuesEqual } from '../../src/engine/utils/shader-uniform-utils.js';

const EPSILON = 0.00001;

describe('uniformValuesEqual — fast path & null', () => {
    it('is true for identical references', () => {
        const v = [1, 2, 3];
        expect(uniformValuesEqual(v, v, 'vec3')).toBe(true);
    });
    it('is false when exactly one side is null', () => {
        expect(uniformValuesEqual(null, [1], 'vec3')).toBe(false);
        expect(uniformValuesEqual([1], null, 'vec3')).toBe(false);
    });
});

describe('uniformValuesEqual — typed floats', () => {
    it('treats sub-epsilon differences as equal, super-epsilon as different', () => {
        expect(uniformValuesEqual(1.0, 1.0 + EPSILON / 2, 'float')).toBe(true);
        expect(uniformValuesEqual(1.0, 1.0 + EPSILON * 2, 'float')).toBe(false);
    });
    it('compares int and sampler types by strict equality', () => {
        expect(uniformValuesEqual(3, 3, 'int')).toBe(true);
        expect(uniformValuesEqual(3, 4, 'int')).toBe(false);
        expect(uniformValuesEqual(1, 1, 'sampler2D')).toBe(true);
    });
});

describe('uniformValuesEqual — arrays', () => {
    it('compares vec components elementwise', () => {
        expect(uniformValuesEqual([1, 2, 3], [1, 2, 3], 'vec3')).toBe(true);
        expect(uniformValuesEqual([1, 2, 3], [1, 2, 3.1], 'vec3')).toBe(false);
    });
    it('untyped comparison rejects length mismatches', () => {
        expect(uniformValuesEqual([1, 2], [1, 2, 3])).toBe(false);
    });
    it('untyped comparison of equal arrays is true', () => {
        expect(uniformValuesEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    });

    it('documents the epsilon-boundary inconsistency between typed (>=) and untyped (>) paths', () => {
        // arrayEquals (typed path) uses `>= EPSILON`, so an exactly-epsilon diff is NOT equal.
        expect(uniformValuesEqual([0, 0], [EPSILON, 0], 'vec2')).toBe(false);
        // valuesEqualUntyped uses `> EPSILON`, so the same exactly-epsilon diff IS equal.
        expect(uniformValuesEqual([0, 0], [EPSILON, 0])).toBe(true);
    });
});
