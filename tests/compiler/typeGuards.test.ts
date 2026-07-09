import { describe, it, expect } from 'vitest';
import { isValueParam, isGlslExpression } from '../../src/compiler/types.js';

describe('isValueParam', () => {
    it('is true for a {param} object', () => {
        expect(isValueParam({ param: 'camera.fov' })).toBe(true);
        expect(isValueParam({ param: 'a', default: 1, min: 0, max: 2 })).toBe(true);
    });
    it('is false for plain numbers and arrays (Vec3 is not a param)', () => {
        expect(isValueParam(0.5 as never)).toBe(false);
        expect(isValueParam([1, 2, 3] as never)).toBe(false);
    });
    it('is false for objects without a param field and for null', () => {
        expect(isValueParam({ foo: 1 } as never)).toBe(false);
        expect(isValueParam(null as never)).toBe(false);
    });
});

describe('isGlslExpression', () => {
    it('is true only for { kind: "glsl" } objects', () => {
        expect(isGlslExpression({ kind: 'glsl', source: 'x' })).toBe(true);
    });
    it('is false for other objects, null, and primitives', () => {
        expect(isGlslExpression({ kind: 'other' })).toBe(false);
        expect(isGlslExpression({ param: 'x' })).toBe(false);
        expect(isGlslExpression(null)).toBe(false);
        expect(isGlslExpression(0.5)).toBe(false);
        expect(isGlslExpression([1, 2, 3])).toBe(false);
    });
});
