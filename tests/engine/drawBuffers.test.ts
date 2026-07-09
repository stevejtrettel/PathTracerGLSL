import { describe, it, expect } from 'vitest';
import { computeDrawBuffers } from '../../src/engine/RenderExecutor.js';

const A0 = 0x8ce0; // gl.COLOR_ATTACHMENT0

describe('computeDrawBuffers', () => {
    it('parses and sorts :N attachment suffixes ascending', () => {
        expect(computeDrawBuffers(['b:2', 'b:0', 'b:1'], A0)).toEqual([A0 + 0, A0 + 1, A0 + 2]);
    });
    it('defaults a suffix-less output to attachment 0', () => {
        expect(computeDrawBuffers(['b'], A0)).toEqual([A0]);
    });
    it('treats a non-numeric suffix as attachment 0', () => {
        expect(computeDrawBuffers(['b:x'], A0)).toEqual([A0]);
    });
    it('maps a single MRT set relative to COLOR_ATTACHMENT0', () => {
        expect(computeDrawBuffers(['x:0', 'x:1'], A0)).toEqual([A0, A0 + 1]);
    });
});
