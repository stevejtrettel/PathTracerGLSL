import { describe, it, expect, vi } from 'vitest';
import { shouldResetAccumulation } from '../../src/app/events.js';

describe('shouldResetAccumulation', () => {
    it('resets for camera / scene / material / light changes', () => {
        expect(shouldResetAccumulation('camera.position')).toBe(true);
        expect(shouldResetAccumulation('scene.foo')).toBe(true);
        expect(shouldResetAccumulation('material.albedo')).toBe(true);
        expect(shouldResetAccumulation('light.intensity')).toBe(true);
    });

    it('does NOT reset for developer / debug / renderer.displayMode', () => {
        expect(shouldResetAccumulation('developer.showStats')).toBe(false);
        expect(shouldResetAccumulation('debug.displayMode')).toBe(false);
        expect(shouldResetAccumulation('renderer.displayMode')).toBe(false);
    });

    it('resets (to be safe) for an unknown prefix, with a warning', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(shouldResetAccumulation('mystery.thing')).toBe(true);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});
