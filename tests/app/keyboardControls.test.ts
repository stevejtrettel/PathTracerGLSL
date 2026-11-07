import { describe, it, expect } from 'vitest';
import { KeyboardControls } from '../../src/app/extensions/KeyboardControls.js';

type Vec3 = [number, number, number];

/**
 * Drives the extension's pose update with one key held for one tick, without installing it
 * (install needs window and requestAnimationFrame). The camera starts at the origin looking
 * down −z with +y up, so screen right is +x.
 */
function poseAfter(code: string): { position: Vec3; forward: Vec3 } {
    let written: Record<string, unknown> = {};
    const controls = new KeyboardControls();
    const inner = controls as unknown as {
        app: unknown; bus: unknown;
        onKeyDown(e: KeyboardEvent): void;
        update(dt: number): void;
    };
    inner.app = { setParameters: (p: Record<string, unknown>) => { written = p; } };
    inner.bus = { emit: () => {} };
    controls.setPosition([0, 0, 0]);
    controls.lookAt([0, 0, -1]);
    inner.onKeyDown({ code, target: { tagName: 'CANVAS' } } as unknown as KeyboardEvent);
    inner.update(0.05);
    const position = written['camera.position'] as Vec3;
    const target = written['camera.target'] as Vec3;
    const d: Vec3 = [target[0] - position[0], target[1] - position[1], target[2] - position[2]];
    const n = Math.hypot(...d);
    return { position, forward: [d[0] / n, d[1] / n, d[2] / n] };
}

describe('KeyboardControls pose update', () => {
    it('ArrowUp moves forward and ArrowDown moves backward', () => {
        expect(poseAfter('ArrowUp').position[2]).toBeLessThan(0);
        expect(poseAfter('ArrowDown').position[2]).toBeGreaterThan(0);
    });

    it('ArrowRight moves right and Quote moves up', () => {
        expect(poseAfter('ArrowRight').position[0]).toBeGreaterThan(0);
        expect(poseAfter('Quote').position[1]).toBeGreaterThan(0);
    });

    it('W pitches up and S pitches down', () => {
        expect(poseAfter('KeyW').forward[1]).toBeGreaterThan(0);
        expect(poseAfter('KeyS').forward[1]).toBeLessThan(0);
    });

    it('A yaws left and D yaws right', () => {
        expect(poseAfter('KeyA').forward[0]).toBeLessThan(0);
        expect(poseAfter('KeyD').forward[0]).toBeGreaterThan(0);
    });
});
