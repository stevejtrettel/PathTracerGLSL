import { describe, it, expect } from 'vitest';
import { uniformValuesEqual } from '../../src/engine/utils/shader-uniform-utils.js';

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
    it('compares exactly: any change uploads, however small (no tolerance)', () => {
        expect(uniformValuesEqual(1.0, 1.0, 'float')).toBe(true);
        expect(uniformValuesEqual(1.0, 1.0 + 1e-9, 'float')).toBe(false);
        expect(uniformValuesEqual(2e-6, 9e-6, 'float')).toBe(false);   // a small parameter's change is real
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

    it('compares float[] arrays elementwise at any length (driven-lights CDF arrays)', () => {
        expect(uniformValuesEqual([0.2, 0.5, 0.3], [0.2, 0.5, 0.3], 'float[]')).toBe(true);
        expect(uniformValuesEqual([0.2, 0.5, 0.3], [0.2, 0.5, 0.31], 'float[]')).toBe(false);
        expect(uniformValuesEqual([0.4, 0.6], [0.4, 0.6], 'float[]')).toBe(true);
        expect(uniformValuesEqual([0.4, 0.6], [0.4, 0.6, 0.0], 'float[]')).toBe(false);
    });

    it('typed and untyped array paths agree: exact comparison', () => {
        expect(uniformValuesEqual([0, 0], [1e-6, 0], 'vec2')).toBe(false);
        expect(uniformValuesEqual([0, 0], [1e-6, 0])).toBe(false);
    });
});
