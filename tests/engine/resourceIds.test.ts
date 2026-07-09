import { describe, it, expect } from 'vitest';
import { parseResourceId, resolveBufferIndex } from '../../src/engine/ResourceManager.js';

describe('parseResourceId', () => {
    it('parses a bare id', () => {
        expect(parseResourceId('accumulation')).toEqual({ baseId: 'accumulation', qualifier: null, attachment: 0 });
    });
    it('parses a _current / _previous qualifier', () => {
        expect(parseResourceId('accumulation_current')).toEqual({ baseId: 'accumulation', qualifier: 'current', attachment: 0 });
        expect(parseResourceId('accumulation_previous')).toEqual({ baseId: 'accumulation', qualifier: 'previous', attachment: 0 });
    });
    it('parses a combined qualifier + attachment', () => {
        expect(parseResourceId('accumulation_previous:1')).toEqual({ baseId: 'accumulation', qualifier: 'previous', attachment: 1 });
    });
    it('parses an attachment on a bare id', () => {
        expect(parseResourceId('myBuffer:2')).toEqual({ baseId: 'myBuffer', qualifier: null, attachment: 2 });
    });
    it('keeps underscores in a multi-word base id', () => {
        expect(parseResourceId('my_buffer_current')).toEqual({ baseId: 'my_buffer', qualifier: 'current', attachment: 0 });
    });
    it('leaves a non-numeric :suffix attached to the base id (attachment stays 0)', () => {
        expect(parseResourceId('buffer:x')).toEqual({ baseId: 'buffer:x', qualifier: null, attachment: 0 });
    });
});

describe('resolveBufferIndex', () => {
    it('current / null → currentIndex; previous → the other', () => {
        expect(resolveBufferIndex(0, 'current')).toBe(0);
        expect(resolveBufferIndex(0, null)).toBe(0);
        expect(resolveBufferIndex(0, 'previous')).toBe(1);
        expect(resolveBufferIndex(1, 'previous')).toBe(0);
    });

    it('ping-pong stays consistent across swaps (current and previous never alias)', () => {
        let currentIndex = 0;
        for (let frame = 0; frame < 4; frame++) {
            const cur = resolveBufferIndex(currentIndex, 'current');
            const prev = resolveBufferIndex(currentIndex, 'previous');
            expect(cur).not.toBe(prev);
            currentIndex = 1 - currentIndex; // executeSwap flips currentIndex
        }
    });
});
