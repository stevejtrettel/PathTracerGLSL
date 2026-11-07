// The conductor Fresnel term and the rough conductor (fable-reference-implementations §7c).
// conductorFresnel (materials/conductor/fresnel.ts) is the line-for-line twin of
// conductor_fresnel in glsl/core/math.glsl, which conductor.glsl and rough_conductor.glsl call.
// rough_conductor is the shared F-free GGX lobe (twin: components/materials/microfacetTwin.ts) times
// that F at the lobe's half-vector cosine, so its §11.3 checks run the shared harness with this F.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { conductorFresnel } from '../conductor/fresnel.js';
import { dielectricFresnel } from '../microfacet_energy/build.js';
import { measuredNames, measuredRole, measuredValue } from '../../color/spectra/measured/measured.js';
import {
    type V3, type TwinSample, alphaOf, dirOf, lcg, reflectEval, reflectPdf, reflectSample, samplerConsistency,
} from '../microfacetTwin.js';

const METALS = ['Ag', 'Al', 'Au', 'Cu', 'CuZn'];
const optical = (metal: string, lambda: number) => [measuredValue(`metal-${metal}-eta`, lambda), measuredValue(`metal-${metal}-k`, lambda)];

// pbrt-v4's FrComplex (src/pbrt/util/scattering.h): complex arithmetic spelled out, an
// independent form of the same reflectance.
type C = [number, number];
const cmul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a: C, b: C): C => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const csqrt = (z: C): C => { const r = Math.hypot(z[0], z[1]); return [Math.sqrt(0.5 * (r + z[0])), Math.sqrt(0.5 * (r - z[0])) * (z[1] < 0 ? -1 : 1)]; };
const cnorm = (z: C) => z[0] * z[0] + z[1] * z[1];
function frComplex(cosI: number, eta: number, k: number): number {
    const e: C = [eta, k];
    const sin2t = cdiv([1 - cosI * cosI, 0], cmul(e, e));
    const cost = csqrt([1 - sin2t[0], -sin2t[1]]);
    const ec = cmul(e, [cosI, 0]);
    const rPar = cdiv([ec[0] - cost[0], ec[1] - cost[1]], [ec[0] + cost[0], ec[1] + cost[1]]);
    const ect = cmul(e, cost);
    const rPerp = cdiv([cosI - ect[0], -ect[1]], [cosI + ect[0], ect[1]]);
    return (cnorm(rPar) + cnorm(rPerp)) / 2;
}

// The transcription evaluated in float32, rounding after every operation as the GPU does.
const f = Math.fround;
function conductorFresnel32(cosI: number, eta: number, k: number): number {
    cosI = f(cosI); eta = f(eta); k = f(k);
    const c2 = f(cosI * cosI);
    const s2 = f(1 - c2);
    const s4 = f(s2 * s2);
    const t = f(f(f(eta * eta) - f(k * k)) - s2);
    const A = f(Math.sqrt(f(f(t * t) + f(f(f(4 * eta) * eta) * f(k * k)))));
    const a = f(Math.sqrt(Math.max(f(0.5 * f(A + t)), 0)));
    const term1 = f(A + c2);
    const term2 = f(f(2 * cosI) * a);
    const rS = f(f(term1 - term2) / f(term1 + term2));
    const term3 = f(f(A * c2) + s4);
    const term4 = f(term2 * s2);
    const rP = f(f(rS * f(term3 - term4)) / f(term3 + term4));
    return f(0.5 * f(rS + rP));
}

describe('conductor_fresnel (twin)', () => {
    it('equals pbrt-v4\'s complex FrComplex to 1e-12 over five metals, 360–830 nm, cos 0..1', () => {
        let worst = 0;
        for (const metal of METALS) for (let lambda = 360; lambda <= 830; lambda += 2) {
            const [eta, k] = optical(metal, lambda);
            for (let c = 0; c <= 1.0000001; c += 0.01) worst = Math.max(worst, Math.abs(conductorFresnel(c, eta, k) - frComplex(c, eta, k)));
        }
        expect(worst).toBeLessThan(1e-12);
    });

    it('in float32 it stays within 4e-6 of double precision (metals, and eta 0.05, kappa 8)', () => {
        let worst = 0;
        const cases: Array<[number, number]> = [[0.05, 8]];
        for (const metal of METALS) for (let lambda = 360; lambda <= 830; lambda += 5) cases.push(optical(metal, lambda) as [number, number]);
        for (const [eta, k] of cases) for (let c = 0; c <= 1.0000001; c += 0.005) {
            worst = Math.max(worst, Math.abs(conductorFresnel32(c, eta, k) - conductorFresnel(c, eta, k)));
        }
        expect(worst).toBeLessThan(4e-6);
    });

    it('limits: normal incidence, grazing, the perfect mirror, the dielectric limit, and 0 ≤ F ≤ 1', () => {
        for (const metal of METALS) for (let lambda = 360; lambda <= 830; lambda += 10) {
            const [eta, k] = optical(metal, lambda);
            const normal = ((eta - 1) ** 2 + k * k) / ((eta + 1) ** 2 + k * k);
            expect(Math.abs(conductorFresnel(1, eta, k) - normal)).toBeLessThan(1e-14);
            expect(conductorFresnel(0, eta, k)).toBe(1);
        }
        for (const k of [0.1, 1, 3, 8]) for (let c = 0; c <= 1.0000001; c += 0.01) {
            expect(conductorFresnel32(c, 0, k), `kappa ${k} cos ${c}`).toBe(1);
        }
        // κ → 0 with η > 1: a dielectric seen from outside (dielectric_fresnel takes n_i/n_t = 1/η).
        for (const eta of [1.2, 1.5, 2.4]) for (let c = 0.01; c <= 1; c += 0.01) {
            expect(Math.abs(conductorFresnel(c, eta, 1e-9) - dielectricFresnel(c, 1 / eta))).toBeLessThan(1e-7);
        }
        for (let eta = 0; eta <= 4; eta += 0.25) for (let k = 0.01; k <= 9; k += 0.5) for (let c = 0; c <= 1.0000001; c += 0.05) {
            const F = conductorFresnel32(c, eta, k);
            expect(F >= 0 && F <= 1, `eta ${eta} kappa ${k} cos ${c}: ${F}`).toBe(true);
        }
    });

    it('is the formula math.glsl writes: one clamped root, Spectrum arithmetic', () => {
        const math = readFileSync(new URL('../../../glsl/core/math.glsl', import.meta.url), 'utf8');
        expect(math).toContain('Spectrum conductor_fresnel(float cos_i, Spectrum eta, Spectrum k)');
        expect(math).toContain('sqrt(max(0.5 * (A + t), 0.0))');
    });
});

// ── rough_conductor: the lobe times F(|ωₒ·h|) per lane ───────────────────────────────

function roughEval(wi: V3, wo: V3, roughness: number, eta: number, k: number): number {
    const l = reflectEval(wi, wo, alphaOf(roughness));
    if (l.f === 0.0) return 0.0;
    return conductorFresnel(l.cosH, eta, k) * l.f;
}
function roughPdf(wi: V3, wo: V3, roughness: number): number {
    return reflectPdf(wi, wo, alphaOf(roughness));
}
function roughSample(wo: V3, roughness: number, eta: number, k: number, u1: number, u2: number): TwinSample {
    const l = reflectSample(wo, alphaOf(roughness), u1, u2);
    return { wi: l.wi, weight: conductorFresnel(l.cosH, eta, k) * l.weight, pdf: l.pdf, rejected: l.pdf === 0 };
}

describe('rough_conductor §11.3 (twin of rough_conductor.glsl through the shared lobe)', () => {
    // Lanes: gold in the blue and the red, aluminium in the green, and the F = 1 mirror.
    const lanes: Array<[string, number, number]> = [
        ['Au 450 nm', ...optical('Au', 450) as [number, number]],
        ['Au 650 nm', ...optical('Au', 650) as [number, number]],
        ['Al 550 nm', ...optical('Al', 550) as [number, number]],
        ['eta 0, kappa 1', 0, 1],
    ];
    for (const [name, eta, k] of lanes) for (const [cosO, r] of [[0.9, 0.1], [0.5, 0.4], [0.1, 0.8]]) {
        it(`${name}, cosθo=${cosO}, roughness=${r}: χ² histogram, weight·pdf = eval·|cos θi|, sample pdf = pdf`, () => {
            const wo = dirOf(cosO, 0);
            const c = samplerConsistency(1 << 16, lcg(7654321 + cosO * 1000 + r * 100 + eta * 10),
                (u1, u2) => roughSample(wo, r, eta, k, u1, u2),
                (wi) => roughEval(wi, wo, r, eta, k) * Math.abs(wi[2]),
                (wi) => roughPdf(wi, wo, r));
            expect(c.worstTriple).toBeLessThan(1e-4);
            expect(c.worstPdfAgree).toBeLessThan(1e-3);
            expect(c.chi2, `χ²=${c.chi2.toFixed(1)} over ${c.cells} cells (crit ${c.crit.toFixed(1)})`).toBeLessThan(c.crit);
        });
    }

    it('reciprocity: eval(wi, wo) = eval(wo, wi)', () => {
        const rand = lcg(11);
        const [eta, k] = optical('Cu', 600);
        for (let i = 0; i < 1000; i++) {
            const a = dirOf(rand(), 2 * Math.PI * rand());
            const b = dirOf(rand(), 2 * Math.PI * rand());
            const r = 0.05 + 0.9 * rand();
            const x = roughEval(a, b, r, eta, k), y = roughEval(b, a, r, eta, k);
            expect(Math.abs(x - y)).toBeLessThan(1e-9 * Math.max(1, x));
        }
    });

    it('rough_conductor.glsl reaches the distribution only through the lobe, and differs from ggx.glsl in F', () => {
        const strip = (src: string) => src.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
        const code = strip(readFileSync(new URL('./rough_conductor.glsl', import.meta.url), 'utf8'));
        expect(code).not.toMatch(/microfacet_(D|G1|sample_vndf|to_local|from_local)\s*\(/);
        for (const fn of ['microfacet_reflect_eval', 'microfacet_reflect_pdf', 'microfacet_reflect_sample']) expect(code).toContain(`${fn}(`);
        expect(code).toContain('conductor_fresnel(cos_h, mp.eta, mp.k)');
        expect(code).toContain('conductor_fresnel(r.cos_h, mp.eta, mp.k)');
        expect(code).not.toContain('schlick_fresnel');
    });

    it('every measured optical table is an optical constant the formula accepts (eta ≥ 0, kappa > 0)', () => {
        for (const name of measuredNames.filter(n => measuredRole(n) === 'optical')) for (let lambda = 360; lambda <= 830; lambda += 1) {
            expect(measuredValue(name, lambda)).toBeGreaterThan(0);
        }
    });
});
