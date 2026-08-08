// tests/authoring/instFormat.test.ts — THE `.inst` format contract gate
// (fable-instance-clouds §6): encoder (tools/inst-format.mjs, the write-side layout
// truth) round-trips through parseInstances (the read side) exactly — the two cannot
// drift silently. Plus loader error cases and the committed fixture's shape.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// eslint-disable-next-line
// @ts-expect-error — plain-JS module (shared with node converter scripts, no types)
import { encodeInstances } from '../../tools/inst-format.mjs';
import { parseInstances } from '../../src/authoring/loadInstances.js';

/** A small full-featured table with awkward float values (exact f32 round-trip). */
function sampleTable() {
    const positions = new Float32Array([0, 0, 0, 1.5, -2.25, 3, -10, 0.1, 7, 0.3, 0.3, 0.3]);
    return {
        positions,
        sizes: new Float32Array([0.01, 1, 0.0225, 4096]),
        colors: new Float32Array([1, 0.5, 0.25, 0, 0, 0, 0.912, 0.912, 0.912, 1, 1, 1]),
        orientations: new Float32Array([0, 0, 0, 1, 0.5, 0.5, 0.5, 0.5, 0, 1, 0, 0, 0, 0, 1, 0]),
        scalars: { height: new Float32Array([1, 97, 9189.978, 255476]) },
        provenance: 'instFormat.test sample — ünïcode ok',
    };
}

describe('inst format round-trip (encoder ↔ parseInstances)', () => {
    it('round-trips every column exactly', () => {
        const t = sampleTable();
        const parsed = parseInstances(encodeInstances(t));
        expect(parsed.count).toBe(4);
        expect(Array.from(parsed.positions)).toEqual(Array.from(t.positions));
        expect(Array.from(parsed.sizes!)).toEqual(Array.from(t.sizes));
        expect(Array.from(parsed.colors!)).toEqual(Array.from(t.colors));
        expect(Array.from(parsed.orientations!)).toEqual(Array.from(t.orientations));
        expect(Object.keys(parsed.scalars)).toEqual(['height']);
        expect(Array.from(parsed.scalars.height)).toEqual(Array.from(Float32Array.from(t.scalars.height)));
        expect(parsed.provenance).toBe(t.provenance);
        // Header AABB is POSITIONS-ONLY (hook-invariant — format doc §2). f32 storage,
        // so literals go through fround.
        expect(parsed.aabb.min).toEqual([-10, -2.25, 0].map(Math.fround));
        expect(parsed.aabb.max).toEqual([1.5, 0.3, 7].map(Math.fround));
    });

    it('round-trips a positions-only file (all flags off, K=0, empty provenance)', () => {
        const parsed = parseInstances(encodeInstances({ positions: new Float32Array([1, 2, 3, 4, 5, 6]) }));
        expect(parsed.count).toBe(2);
        expect(parsed.sizes).toBeUndefined();
        expect(parsed.colors).toBeUndefined();
        expect(parsed.orientations).toBeUndefined();
        expect(parsed.scalars).toEqual({});
        expect(parsed.provenance).toBe('');
    });

    it('round-trips multiple scalar columns in insertion order', () => {
        const parsed = parseInstances(encodeInstances({
            positions: new Float32Array([0, 0, 0]),
            scalars: { height: new Float32Array([5]), mass: new Float32Array([7]) },
        }));
        expect(Object.keys(parsed.scalars)).toEqual(['height', 'mass']);
        expect(parsed.scalars.mass[0]).toBe(7);
    });
});

describe('parseInstances rejects corrupt input loudly', () => {
    const good = () => encodeInstances(sampleTable());

    it('bad magic', () => {
        const buf = good();
        new DataView(buf).setUint32(0, 0xdeadbeef, true);
        expect(() => parseInstances(buf)).toThrow(/bad magic/);
    });

    it('unsupported version', () => {
        const buf = good();
        new DataView(buf).setUint32(4, 99, true);
        expect(() => parseInstances(buf)).toThrow(/version 99/);
    });

    it('truncated payload (length arithmetic)', () => {
        expect(() => parseInstances(good().slice(0, good().byteLength - 8))).toThrow(/does not match header arithmetic/);
    });

    it('tiny buffer', () => {
        expect(() => parseInstances(new ArrayBuffer(10))).toThrow(/too small/);
    });

    it('zero count', () => {
        const buf = good();
        new DataView(buf).setUint32(8, 0, true);
        expect(() => parseInstances(buf)).toThrow(/count is 0/);
    });

    it('unknown flag bits (a newer writer), not the misleading length error', () => {
        const buf = good();
        const view = new DataView(buf);
        view.setUint32(12, view.getUint32(12, true) | 0x8, true);
        expect(() => parseInstances(buf)).toThrow(/unknown flag bits 0x8.*newer format version/);
    });
});

describe('encoder input validation', () => {
    it('rejects mismatched column lengths', () => {
        expect(() => encodeInstances({ positions: new Float32Array(6), sizes: new Float32Array(3) }))
            .toThrow(/sizes/);
    });
    it('rejects over-long column names', () => {
        expect(() => encodeInstances({
            positions: new Float32Array(3),
            scalars: { ['x'.repeat(40)]: new Float32Array(1) },
        })).toThrow(/1\.\.31/);
    });
    it('rejects non-finite positions (NaN would silently escape the header AABB)', () => {
        expect(() => encodeInstances({ positions: new Float32Array([0, 0, 0, 1, NaN, 2]) }))
            .toThrow(/positions\[4\] \(instance 1\) is not finite/);
    });
});

describe('the committed fixture', () => {
    it('parses with every column and the height scalar', () => {
        const raw = readFileSync(join(__dirname, '..', 'fixtures', 'cloud-500.inst'));
        const parsed = parseInstances(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
        expect(parsed.count).toBe(500);
        expect(parsed.sizes).toHaveLength(500);
        expect(parsed.colors).toHaveLength(1500);
        expect(parsed.orientations).toHaveLength(2000);
        expect(Object.keys(parsed.scalars)).toEqual(['height']);
        expect(parsed.provenance).toContain('make-inst-fixture');
        // Orientations are unit quaternions.
        for (let i = 0; i < 500; i += 97) {
            const q = parsed.orientations!.subarray(4 * i, 4 * i + 4);
            expect(Math.hypot(q[0], q[1], q[2], q[3])).toBeCloseTo(1, 5);
        }
    });
});
