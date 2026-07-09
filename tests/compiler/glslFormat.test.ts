import { describe, it, expect } from 'vitest';
import { formatFloat, formatVec3 } from '../../src/compiler/generate/features/glsl-format.js';

describe('formatFloat', () => {
    it('appends .0 to integer-valued numbers so GLSL reads them as floats', () => {
        expect(formatFloat(1)).toBe('1.0');
        expect(formatFloat(0)).toBe('0.0');
        expect(formatFloat(-5)).toBe('-5.0');
    });

    it('leaves already-fractional numbers untouched', () => {
        expect(formatFloat(1.5)).toBe('1.5');
        expect(formatFloat(-0.25)).toBe('-0.25');
    });

    it('treats negative zero as zero (no throw, formatted as 0.0)', () => {
        expect(formatFloat(-0)).toBe('0.0');
    });

    it('uses exponential notation for values that stringify with an exponent', () => {
        // 1e-7 stringifies as "1e-7"; the formatter routes it through toExponential.
        expect(formatFloat(1e-7)).toContain('e');
        expect(formatFloat(1e21)).toContain('e');
    });

    it('throws on non-finite values instead of emitting invalid GLSL', () => {
        expect(() => formatFloat(NaN)).toThrow(/non-finite/);
        expect(() => formatFloat(Infinity)).toThrow(/non-finite/);
        expect(() => formatFloat(-Infinity)).toThrow(/non-finite/);
    });
});

describe('formatVec3', () => {
    it('formats each component through formatFloat', () => {
        expect(formatVec3([1, 2.5, 0])).toBe('vec3(1.0, 2.5, 0.0)');
    });

    it('propagates the non-finite throw from any component', () => {
        expect(() => formatVec3([1, NaN, 3])).toThrow(/non-finite/);
    });
});
