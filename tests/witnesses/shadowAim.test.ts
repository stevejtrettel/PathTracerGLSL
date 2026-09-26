// tests/witnesses/shadowAim.test.ts — the shadow-aim witnesses' expected values and geometry.
//
// The fog scene's value is a quadrature in the fixture (shadowAimWitness.ts); here it is checked
// against the closed form it must reduce to without fog. The fog scene's value also assumes that
// every line from the viewed floor patch to the disk enters the slab through its bottom face and
// leaves through its top face, so it crosses exactly the slab's thickness at its angle; that is
// checked against the slab the scene actually authors.

import { describe, it, expect } from 'vitest';
import {
    aimFloorRadiance, AIM_OPEN, AIM_RHO, AIM_LE, AIM_R, AIM_H, AIM_U0, AIM_FILM, AIM_FOG_CAMERA_Y,
    shadowAimFog,
} from './scenes/shadowAimWitness.js';
import type { Vec3 } from '../../src/compiler/types.js';

describe('shadow-aim expected values', () => {
    it('the quadrature without fog is the coaxial-disk closed form ρ·Le·R²/(R²+h²)', () => {
        expect(aimFloorRadiance(0)).toBeCloseTo(AIM_OPEN, 12);
        expect(AIM_OPEN).toBeCloseTo(AIM_RHO * AIM_LE * (1 - AIM_U0 * AIM_U0), 12);
        expect(AIM_OPEN).toBeCloseTo(64 / 65, 12);
    });

    it('absorption only lowers the value', () => {
        expect(aimFloorRadiance(0.02)).toBeLessThan(AIM_OPEN);
        expect(aimFloorRadiance(0.02)).toBeGreaterThan(AIM_OPEN * Math.exp(-0.02 / AIM_U0));
    });
});

describe('shadow-aim-fog geometry', () => {
    const slab = shadowAimFog.objects.find((o) => o.name === 'slab');
    if (slab === undefined || !('parameters' in slab)) throw new Error('fog fixture: no slab object');
    const { center, halfSize } = slab.parameters as { center: Vec3; halfSize: Vec3 };
    const bottom = center[1] - halfSize[1];
    const top = center[1] + halfSize[1];

    it('the slab lies between the camera and the disk', () => {
        expect(AIM_FOG_CAMERA_Y).toBeLessThan(bottom);
        expect(top).toBeLessThan(AIM_H);
    });

    it('every line from the viewed patch to the disk crosses the slab through its horizontal faces', () => {
        // The patch's farthest point from the axis: the film corner (160×120 frame, aspect 4/3).
        const patch = AIM_FILM * Math.hypot(160 / 120, 1);
        // A line from a patch point at radius ≤ patch to a disk point at radius ≤ R stays within
        // radius patch·(1 − y/h) + R·y/h at height y; the widest point inside the slab is its top.
        const reach = patch * (1 - top / AIM_H) + AIM_R * (top / AIM_H);
        expect(reach).toBeLessThan(Math.min(halfSize[0], halfSize[2]));
    });
});
