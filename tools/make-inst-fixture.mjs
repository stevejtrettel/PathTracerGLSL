// tools/make-inst-fixture.mjs — writes THE committed `.inst` fixture
// (tests/fixtures/cloud-500.inst, fable-instance-clouds §6): ~500 instances with EVERY
// optional column + one scalar column, deterministic (seeded LCG) so regeneration is
// byte-identical. Vitest exercises the real loader + packed-placement compile path on
// this at toy scale — codegen is count-invariant, so the 50 MB files never enter tests.
//
// Run: node tools/make-inst-fixture.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeInstances } from './inst-format.mjs';

const N = 500;
let s = 12345 >>> 0;
const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };

const positions = new Float32Array(3 * N);
const sizes = new Float32Array(N);
const colors = new Float32Array(3 * N);
const orientations = new Float32Array(4 * N);
const height = new Float32Array(N);

for (let i = 0; i < N; i++) {
    positions[3 * i] = (rnd() * 2 - 1) * 5;
    positions[3 * i + 1] = (rnd() * 2 - 1) * 5;
    positions[3 * i + 2] = (rnd() * 2 - 1) * 5;
    height[i] = 1 + rnd() * 999;
    sizes[i] = Math.max(0.05, 0.5 / Math.sqrt(height[i]));
    colors[3 * i] = rnd(); colors[3 * i + 1] = rnd(); colors[3 * i + 2] = rnd();
    // Random unit quaternion (Shoemake) — [x, y, z, w].
    const u1 = rnd(), u2 = rnd() * 2 * Math.PI, u3 = rnd() * 2 * Math.PI;
    const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
    orientations[4 * i] = a * Math.sin(u2);
    orientations[4 * i + 1] = a * Math.cos(u2);
    orientations[4 * i + 2] = b * Math.sin(u3);
    orientations[4 * i + 3] = b * Math.cos(u3);
}

const buffer = encodeInstances({
    positions, sizes, colors, orientations,
    scalars: { height },
    provenance: 'make-inst-fixture v1 (seeded LCG 12345, N=500)',
});

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'cloud-500.inst');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(buffer));
console.log(`wrote ${out} (${buffer.byteLength} bytes, ${N} instances)`);
