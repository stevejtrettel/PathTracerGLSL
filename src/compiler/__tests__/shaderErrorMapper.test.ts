import { describe, it, expect } from 'vitest';
import { mapShaderErrors, mapEngineShaderError } from '../generate/ShaderErrorMapper.js';
import type { BlockMapping } from '../generate/ShaderIR.js';
import type { SourceMap } from '../types.js';

// Test block map: header (1-5), structs (6-20), sdf-dispatch (21-30)
const testBlockMap: BlockMapping[] = [
    { origin: 'generated:header', startLine: 1, endLine: 5 },
    { origin: 'glsl/structs.glsl', startLine: 6, endLine: 20 },
    { origin: 'generated:sdf-dispatch', startLine: 21, endLine: 30 },
];

describe('mapShaderErrors', () => {
    it('parses ERROR format and maps through source map', () => {
        const log = "ERROR: 0:23: 'foo' : undeclared identifier";
        const bag = mapShaderErrors(log, 'test-shader', testBlockMap);

        const errors = bag.getErrors();
        expect(errors.length).toBe(1);
        expect(errors[0].message).toBe("'foo' : undeclared identifier");
        expect(errors[0].location?.file).toBe('test-shader');
        expect(errors[0].location?.line).toBe(23);
        expect(errors[0].location?.originalLocation?.source).toBe('generated:sdf-dispatch');
        expect(errors[0].location?.originalLocation?.path).toEqual(['line:3']);
    });

    it('parses WARNING format', () => {
        const log = "WARNING: 0:10: 'x' : unused variable";
        const bag = mapShaderErrors(log, 'test-shader', testBlockMap);

        const warnings = bag.getWarnings();
        expect(warnings.length).toBe(1);
        expect(warnings[0].message).toBe("'x' : unused variable");
        expect(warnings[0].location?.originalLocation?.source).toBe('glsl/structs.glsl');
        expect(warnings[0].location?.originalLocation?.path).toEqual(['line:5']);
    });

    it('handles multiple errors', () => {
        const log = [
            "ERROR: 0:3: 'a' : undeclared",
            "ERROR: 0:22: 'b' : type mismatch",
        ].join('\n');
        const bag = mapShaderErrors(log, 'test-shader', testBlockMap);

        const errors = bag.getErrors();
        expect(errors.length).toBe(2);
        expect(errors[0].location?.originalLocation?.source).toBe('generated:header');
        expect(errors[1].location?.originalLocation?.source).toBe('generated:sdf-dispatch');
    });

    it('skips unparseable lines silently', () => {
        const log = 'some weird driver message';
        const bag = mapShaderErrors(log, 'test-shader', testBlockMap);

        expect(bag.isEmpty()).toBe(true);
    });

    it('handles line outside block map range', () => {
        const log = "ERROR: 0:999: 'z' : error";
        const bag = mapShaderErrors(log, 'test-shader', testBlockMap);

        const errors = bag.getErrors();
        expect(errors.length).toBe(1);
        expect(errors[0].location?.line).toBe(999);
        expect(errors[0].location?.originalLocation).toBeUndefined();
    });
});

describe('mapEngineShaderError', () => {
    const sourceMaps = new Map<string, SourceMap>([
        ['test-main', { shaderId: 'test-main', blocks: testBlockMap }],
    ]);

    it('extracts shader ID and maps errors', () => {
        const msg = "Shader compilation failed (test-main): ERROR: 0:7: 'x' : undeclared";
        const bag = mapEngineShaderError(msg, sourceMaps);

        expect(bag).not.toBeNull();
        const errors = bag!.getErrors();
        expect(errors.length).toBe(1);
        expect(errors[0].location?.originalLocation?.source).toBe('glsl/structs.glsl');
    });

    it('returns null for non-matching format', () => {
        const bag = mapEngineShaderError('some other error', sourceMaps);
        expect(bag).toBeNull();
    });

    it('handles unknown shader ID gracefully', () => {
        const msg = "Shader compilation failed (unknown-shader): ERROR: 0:1: bad";
        const bag = mapEngineShaderError(msg, sourceMaps);

        expect(bag).not.toBeNull();
        expect(bag!.getErrors().length).toBe(1);
    });
});
