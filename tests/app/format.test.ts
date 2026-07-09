import { describe, it, expect } from 'vitest';
import { formatTime } from '../../src/app/utils/format.js';

describe('formatTime', () => {
    it('formats sub-minute durations as seconds', () => {
        expect(formatTime(5000)).toBe('5s');
        expect(formatTime(0)).toBe('0s');
        expect(formatTime(59_000)).toBe('59s');
    });

    it('formats minute durations as "Xm Ys"', () => {
        expect(formatTime(150_000)).toBe('2m 30s');
        expect(formatTime(60_000)).toBe('1m 0s');
    });

    it('formats hour durations as "Xh Ym" and drops seconds', () => {
        expect(formatTime(3_600_000)).toBe('1h 0m');
        expect(formatTime(3_900_000)).toBe('1h 5m'); // boundary from the doc comment
    });

    it('floors partial seconds', () => {
        expect(formatTime(5_999)).toBe('5s');
    });
});
