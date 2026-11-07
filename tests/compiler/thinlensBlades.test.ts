// The thin lens's bladed aperture: `blades` (and its `bladeRotation`) select the polygonal pupil at
// compile time; without `blades` the lens is the disk and the program is the unbladed one.

import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import type { RenderStrategy } from '../../src/compiler/types.js';
import { minimalScene, minimalStrategy } from '../witnesses/scenes/minimalScene.js';

const thinlens = (extra: Record<string, unknown>): RenderStrategy => ({
    ...minimalStrategy,
    measurement: {
        ...minimalStrategy.measurement,
        camera: { type: 'thinlens', fov: 0.8, aperture: 0.1, focusDistance: 4, ...extra },
    },
});
const fragmentOf = (strategy: RenderStrategy) => {
    const r = new Compiler().compile(minimalScene, strategy);
    return r.shaders.get(`${r.id}-main`)!.fragment;
};

describe('thin-lens blades', () => {
    it('without blades: no blade defines, the disk sample', () => {
        const frag = fragmentOf(thinlens({}));
        expect(frag).not.toMatch(/#define LENS_BLADES/);
        expect(frag).toContain('concentric_disk(xiLens) * u_aperture');
    });

    it('blades: 6 defines the count and the rotation (0 when not authored)', () => {
        const frag = fragmentOf(thinlens({ blades: 6 }));
        expect(frag).toMatch(/#define LENS_BLADES 6\.0\n/);
        expect(frag).toMatch(/#define LENS_BLADE_ROTATION 0\.0\n/);
    });

    it('bladeRotation is baked into the program', () => {
        expect(fragmentOf(thinlens({ blades: 5, bladeRotation: 0.25 }))).toMatch(/#define LENS_BLADE_ROTATION 0\.25\n/);
    });

    it('rejects a blade count that is not an integer ≥ 3', () => {
        expect(() => fragmentOf(thinlens({ blades: 2 }))).toThrow(/blades must be an integer ≥ 3/);
        expect(() => fragmentOf(thinlens({ blades: 6.5 }))).toThrow(/blades must be an integer ≥ 3/);
        expect(() => fragmentOf(thinlens({ blades: '6' }))).toThrow(/field 'blades' must be a finite number/);
    });
});
