// tools/gen-bluenoise.mjs — generate a tileable RGB blue-noise dither tile via the
// void-and-cluster method (Ulichney 1993), and verify each channel's spectrum is actually
// blue (a low-frequency "hole") before emitting it.
//
// THREE INDEPENDENT tiles (different seeds) are packed into R/G/B, so each color channel
// dithers with its own blue-noise pattern and the channels are decorrelated — the correct
// way to dither RGB (a single shared value would correlate the three channels' quantization
// error along the luminance diagonal).
//
// Output: src/engine/resources/blueNoise.ts — a base64 RGB8 tile (no PNG encode, no async
// fetch; the engine decodes it to a GL texture at startup). Deterministic (seeded RNG).
//
//   node tools/gen-bluenoise.mjs

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SIZE = 64;
const N = SIZE * SIZE;
const SIGMA = 1.9;                 // Ulichney's recommended filter width
const R = Math.ceil(SIGMA * 3);    // energy window radius (contribution ~0 beyond)

function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const ix = (x, y) => y * SIZE + x;
// Precompute the toroidal Gaussian window once (shared across channels).
const win = [];
for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++)
        win.push([dx, dy, Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA))]);

// Generate one void-and-cluster tile → { bytes: Uint8Array(N), ratio } (blue-noise check).
function genTile(seed) {
    const rand = mulberry32(seed);
    const energy = new Float64Array(N);
    const pattern = new Uint8Array(N);

    function contribute(p, sign) {
        const x0 = p % SIZE, y0 = (p / SIZE) | 0;
        for (const [dx, dy, g] of win) {
            const x = (x0 + dx + SIZE) % SIZE;
            const y = (y0 + dy + SIZE) % SIZE;
            energy[ix(x, y)] += sign * g;
        }
    }
    const set = (p, v) => { pattern[p] = v; contribute(p, v ? 1 : -1); };
    const tightestCluster = () => { let b = -1, bv = -Infinity; for (let i = 0; i < N; i++) if (pattern[i] === 1 && energy[i] > bv) { bv = energy[i]; b = i; } return b; };
    const largestVoid = () => { let b = -1, bv = Infinity; for (let i = 0; i < N; i++) if (pattern[i] === 0 && energy[i] < bv) { bv = energy[i]; b = i; } return b; };

    const ones = Math.floor(N * 0.1);
    for (let placed = 0; placed < ones;) { const p = (rand() * N) | 0; if (pattern[p] === 0) { set(p, 1); placed++; } }
    for (;;) { const tc = tightestCluster(); set(tc, 0); const lv = largestVoid(); if (lv === tc) { set(tc, 1); break; } set(lv, 1); }

    const ibp = pattern.slice(), ibpEnergy = energy.slice();
    const rank = new Int32Array(N).fill(-1);
    pattern.set(ibp); energy.set(ibpEnergy);
    for (let r = ones - 1; r >= 0; r--) { const tc = tightestCluster(); set(tc, 0); rank[tc] = r; }
    pattern.set(ibp); energy.set(ibpEnergy);
    for (let r = ones; r < N; r++) { const lv = largestVoid(); set(lv, 1); rank[lv] = r; }

    const bytes = new Uint8Array(N);
    for (let i = 0; i < N; i++) bytes[i] = Math.min(255, Math.floor(((rank[i] + 0.5) / N) * 256));

    // Blue-noise check: radially-averaged power of the (value - mean) field.
    const val = new Float64Array(N); let mean = 0;
    for (let i = 0; i < N; i++) { val[i] = (rank[i] + 0.5) / N; mean += val[i]; }
    mean /= N;
    for (let i = 0; i < N; i++) val[i] -= mean;
    const nbins = (SIZE / 2) | 0;
    const rpow = new Float64Array(nbins), rcnt = new Int32Array(nbins);
    for (let fy = 0; fy < SIZE; fy++) for (let fx = 0; fx < SIZE; fx++) {
        if (fx === 0 && fy === 0) continue;
        let re = 0, im = 0;
        for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
            const ph = -2 * Math.PI * ((fx * x) / SIZE + (fy * y) / SIZE);
            const v = val[ix(x, y)]; re += v * Math.cos(ph); im += v * Math.sin(ph);
        }
        const wx = fx <= SIZE / 2 ? fx : SIZE - fx, wy = fy <= SIZE / 2 ? fy : SIZE - fy;
        const rr = Math.round(Math.hypot(wx, wy));
        if (rr >= 1 && rr < nbins) { rpow[rr] += re * re + im * im; rcnt[rr]++; }
    }
    const prof = [];
    for (let r = 1; r < nbins; r++) prof.push(rcnt[r] ? rpow[r] / rcnt[r] : 0);
    const low = (prof[0] + prof[1] + prof[2]) / 3;
    const hiN = Math.floor(prof.length / 3);
    const high = prof.slice(-hiN).reduce((a, b) => a + b, 0) / hiN;
    return { bytes, ratio: high / low };
}

// Three independent channels (distinct seeds).
const seeds = [0x9E3779B9, 0x85EBCA6B, 0xC2B2AE35];
const ratios = [];
const channels = seeds.map((s, i) => {
    const t = genTile(s);
    console.log(`channel ${'RGB'[i]}: high/low radial-power ratio ${t.ratio.toFixed(0)}x  (blue ⇒ ≫ 1)`);
    if (t.ratio < 5) { console.error(`channel ${'RGB'[i]} NOT blue enough — aborting`); process.exit(1); }
    ratios.push(t.ratio.toFixed(0) + 'x');
    return t.bytes;
});

// Interleave into RGB8, row-major.
const rgb = new Uint8Array(N * 3);
for (let i = 0; i < N; i++) { rgb[i * 3] = channels[0][i]; rgb[i * 3 + 1] = channels[1][i]; rgb[i * 3 + 2] = channels[2][i]; }

const b64 = Buffer.from(rgb).toString('base64');
const out = `// GENERATED by tools/gen-bluenoise.mjs — do not edit by hand.
// A ${SIZE}x${SIZE} tileable RGB blue-noise dither tile (void-and-cluster, Ulichney 1993).
// Three INDEPENDENT channels (distinct seeds) so RGB dither is decorrelated per channel.
// RGB8, row-major. Per-channel high/low radial-power ratios: ${ratios.join(', ')}.
export const BLUE_NOISE_SIZE = ${SIZE};
export const BLUE_NOISE_BASE64 =
    '${b64}';
`;
const here = dirname(fileURLToPath(import.meta.url));
const dest = join(here, '..', 'src', 'engine', 'resources', 'blueNoise.ts');
writeFileSync(dest, out);
console.log(`wrote ${dest} (${rgb.length} bytes RGB → ${b64.length} b64 chars)`);
