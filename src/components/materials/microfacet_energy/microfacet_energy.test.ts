// The microfacet energy table and its gains (build.ts; microfacet_energy.md).
//   1. The stored asset: its hash, size and layout facts (the analytic end slices, R = G on
//      the conductor slice, E_avg constant along a row and equal to its quadrature).
//   2. Reproducibility: random node columns recomputed by build.ts equal the stored floats.
//   3–4. White furnace: at off-grid points, the gain times the true albedo is 1 for an F = 1
//      conductor and for a lossless dielectric on both sides (the table's interpolation error).
//   5. A colored Schlick conductor never gains energy.
//   6. The compensation vanishes where the loss does (smooth surfaces).
// These test the TS lookup; microfacet_energy.glsl is its transcription, and the ms-furnace
// witness checks the GLSL.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    TABLE_SIZE, TABLE_SLICES, conductorAlbedo, conductorAverage, conductorGain,
    dielectricAlbedo, dielectricGain, directionAt, energyTable, microfacetG1, nodeAlpha, nodeColumn, nodeMu,
    nodeZ, ratioOfZ, sampleVndf, schlickAverage, writeColumn, type EnergyTable,
} from './build.js';
import { microfacetEnergyData } from './data.js';

const bytes = readFileSync(join(__dirname, 'data', 'energy.bin'));
const table: EnergyTable = energyTable(bytes, microfacetEnergyData.width, microfacetEnergyData.height);
const at = (i: number, row: number, c: number) => table.data[(row * table.width + i) * 4 + c];

function lcg(seed: number) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 4294967296);
}

describe('microfacet energy table: the stored asset', () => {
    it('matches its recorded hash and size', () => {
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(microfacetEnergyData.sha256);
        expect(table.width).toBe(TABLE_SIZE);
        expect(table.height).toBe(TABLE_SIZE * TABLE_SLICES);
        expect(bytes.byteLength).toBe(table.width * table.height * 16);
    });

    it('holds energy fractions in (0, 1] and A = 0 in the alpha channel', () => {
        for (let t = 0; t < table.width * table.height; t++) {
            for (let c = 0; c < 3; c++) {
                const v = table.data[t * 4 + c];
                expect(Number.isFinite(v) && v > 0 && v <= 1, `texel ${t} channel ${c} = ${v}`).toBe(true);
            }
            expect(table.data[t * 4 + 3]).toBe(0);
        }
    });

    it('slice z = 0 is the index-matched limit G1(mu_o), and on slice z = 1 the two sides agree', () => {
        const last = (TABLE_SLICES - 1) * TABLE_SIZE;
        for (let j = 0; j < TABLE_SIZE; j++) {
            for (let i = 0; i < TABLE_SIZE; i++) {
                const g1 = Math.fround(microfacetG1(directionAt(nodeMu(i)), nodeAlpha(j)));
                expect(at(i, j, 0)).toBe(g1);
                expect(at(i, j, 1)).toBe(g1);
                expect(at(i, last + j, 0)).toBe(at(i, last + j, 1));
            }
        }
    });

    it('E_avg is one value per roughness row, and is 2∫E mu dmu of the conductor slice', () => {
        const last = (TABLE_SLICES - 1) * TABLE_SIZE;
        for (let j = 0; j < TABLE_SIZE; j++) {
            const avg = at(0, j, 2);
            for (let k = 0; k < TABLE_SLICES; k++) {
                for (let i = 0; i < TABLE_SIZE; i++) expect(at(i, k * TABLE_SIZE + j, 2)).toBe(avg);
            }
            // The stored slice, integrated in y = √μ (2∫E μ dμ = 4∫E y³ dy, trapezoid): an
            // independent route to the same number, within the trapezoid's O(h²) error.
            let trap = 0;
            for (let i = 0; i < TABLE_SIZE; i++) {
                const y = i / (TABLE_SIZE - 1);
                trap += (i === 0 || i === TABLE_SIZE - 1 ? 0.5 : 1) * 4 * at(i, last + j, 0) * y ** 3;
            }
            trap /= TABLE_SIZE - 1;
            expect(Math.abs(trap - avg), `row ${j}: trapezoid ${trap} vs stored ${avg}`).toBeLessThan(2e-3);
        }
        // E_avg at roughness 1 (the check5 value 0.3766).
        expect(at(0, TABLE_SIZE - 1, 2)).toBeCloseTo(0.3766, 3);
    });
});

describe('microfacet energy table: reproducible from build.ts', () => {
    it('6 random node columns (every slice, both sides) recompute to the stored float32 values', () => {
        const rand = lcg(2026);
        for (let n = 0; n < 6; n++) {
            const i = Math.floor(rand() * TABLE_SIZE), j = Math.floor(rand() * TABLE_SIZE);
            const data = new Float32Array(table.data.length);
            writeColumn(data, i, j, nodeColumn(i, j), at(0, j, 2));
            for (let k = 0; k < TABLE_SLICES; k++) for (let c = 0; c < 4; c++) {
                const t = ((k * TABLE_SIZE + j) * TABLE_SIZE + i) * 4 + c;
                expect(table.data[t], `node (${i}, ${j}, ${k}) channel ${c}`).toBe(data[t]);
            }
        }
    }, 120_000);

    it('a column node is the plain albedo integral, term for term', () => {
        const column = nodeColumn(9, 21, 32);
        const mu = nodeMu(9), a = nodeAlpha(21);
        for (const k of [1, 12, TABLE_SLICES - 2]) {
            const r = ratioOfZ(nodeZ(k));
            expect(column.enter[k]).toBe(dielectricAlbedo(mu, a, 1 / r, 32));
            expect(column.leave[k]).toBe(dielectricAlbedo(mu, a, r, 32));
        }
        expect(column.enter[TABLE_SLICES - 1]).toBe(conductorAlbedo(mu, a, 32));
    });

    it('E_avg recomputes for three roughness rows', () => {
        for (const j of [3, 17, 31]) expect(at(0, j, 2)).toBe(Math.fround(conductorAverage(nodeAlpha(j))));
    }, 60_000);
});

describe('microfacet energy: white furnace through the lookup', () => {
    // Reference albedos at a finer quadrature than the table's (256² per node).
    const REF_N = 512;

    it('F = 1 conductor: gain × E = 1 (max < 5e-3, mean < 5e-4)', () => {
        const rand = lcg(12345);
        let worst = 0, sum = 0, where = '';
        const M = 150;
        for (let m = 0; m < M; m++) {
            const mu = Math.max(0.005, rand()), r = Math.max(0.03, rand()), a = Math.max(1e-3, r * r);
            const err = Math.abs(conductorGain(table, mu, a, 1) * conductorAlbedo(mu, a, REF_N) - 1);
            sum += err;
            if (err > worst) { worst = err; where = `mu=${mu.toFixed(3)} roughness=${r.toFixed(3)}`; }
        }
        expect(worst, `worst at ${where}`).toBeLessThan(5e-3);
        expect(sum / M).toBeLessThan(5e-4);
    }, 120_000);

    for (const side of ['enter', 'leave'] as const) {
        it(`lossless dielectric, ${side} side: gain × A = 1 (max < 8e-3, mean < 1e-3)`, () => {
            const rand = lcg(side === 'enter' ? 777 : 778);
            const indices = [1.1, 1.33, 1.5, 1.7, 2.0, 2.42, 1.5 / 1.33];
            let worst = 0, sum = 0, where = '';
            const M = 70;
            for (let m = 0; m < M; m++) {
                const mu = Math.max(0.005, rand()), r = Math.max(0.03, rand()), a = Math.max(1e-3, r * r);
                const n = indices[Math.floor(rand() * indices.length)];
                const eta = side === 'enter' ? 1 / n : n;
                const err = Math.abs(dielectricGain(table, mu, a, eta) * dielectricAlbedo(mu, a, eta, 384) - 1);
                sum += err;
                if (err > worst) { worst = err; where = `mu=${mu.toFixed(3)} roughness=${r.toFixed(3)} n=${n.toFixed(3)}`; }
            }
            expect(worst, `worst at ${where}`).toBeLessThan(8e-3);
            expect(sum / M).toBeLessThan(1e-3);
        }, 120_000);
    }
});

describe('microfacet energy: the gains in limits', () => {
    /** The single-scattering albedo of a Schlick conductor (ggx with scalar f0). */
    function schlickAlbedo(mu: number, a: number, f0: number, n: number): number {
        const wo = directionAt(mu);
        let sum = 0;
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
            const m = sampleVndf(wo, a, (i + 0.5) / n, (j + 0.5) / n);
            const d = 2 * (wo[0] * m[0] + wo[1] * m[1] + wo[2] * m[2]);
            const wi: [number, number, number] = [d * m[0] - wo[0], d * m[1] - wo[1], d * m[2] - wo[2]];
            if (wi[2] <= 0) continue;
            const F = f0 + (1 - f0) * Math.pow(1 - Math.abs(d / 2), 5);
            sum += F * microfacetG1(wi, a);
        }
        return sum / (n * n);
    }

    it('a colored conductor never gains energy: gain × E_F ≤ 1 + 1e-3', () => {
        for (const r of [0.3, 0.6, 1.0]) for (const f0 of [0.04, 0.5, 0.9, 1.0]) for (const mu of [0.05, 0.3, 0.7, 1.0]) {
            const a = r * r;
            const total = conductorGain(table, mu, a, schlickAverage(f0)) * schlickAlbedo(mu, a, f0, 256);
            expect(total, `roughness ${r} f0 ${f0} mu ${mu}`).toBeLessThan(1 + 1e-3);
        }
    }, 60_000);

    it('smooth surfaces are left alone: |gain − 1| < 1e-3 at roughness ≤ 0.05', () => {
        for (const r of [0.03, 0.05]) for (const mu of [0.1, 0.3, 0.6, 1.0]) {
            const a = Math.max(1e-3, r * r);
            expect(Math.abs(conductorGain(table, mu, a, 1) - 1), `conductor r ${r} mu ${mu}`).toBeLessThan(1e-3);
            for (const eta of [1 / 1.5, 1.5, 1 / 1.1, 1.1, 2.42]) {
                expect(Math.abs(dielectricGain(table, mu, a, eta) - 1), `dielectric r ${r} mu ${mu} eta ${eta}`).toBeLessThan(1e-3);
            }
        }
    });

    it('the known values: E(1, roughness 1) = 1 − ln 2 and the rough_dielectric.md table', () => {
        expect(1 / conductorGain(table, 1, 1, 1)).toBeCloseTo(1 - Math.LN2, 3);
        // rough_dielectric.md: air→glass cos 0.70 r 0.5 → 0.9791; glass→air cos 0.40 r 0.5 → 0.8064.
        expect(1 / dielectricGain(table, 0.7, 0.25, 1 / 1.5)).toBeCloseTo(0.9791, 2);
        expect(1 / dielectricGain(table, 0.4, 0.25, 1.5)).toBeCloseTo(0.8064, 2);
    });
});
