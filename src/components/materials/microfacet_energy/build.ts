// The microfacet energy table: how it is built and how it is read (microfacet_energy.md).
// One answer for the generator (tools/microfacet-energy/generate.ts) and the tests.
//
// The single-scattering models lose the energy that bounces between microfacets more than
// once. The table holds the energy each keeps, A(μₒ, α, η) = ∫ f_ss(ωᵢ, ωₒ) |cos θᵢ| dωᵢ with
// the η² radiance factor of the transmission lobe undone (energy, not radiance), and the
// compensated models multiply f_ss by a gain read from it (Turquin 2019; Blender Cycles'
// microfacet_ggx_preserve_energy).
//
// The model math below transcribes glsl/core/microfacet.glsl (D, Smith G₁, VNDF),
// dielectric_fresnel (glsl/core/math.glsl) and the sampling branches of ggx.glsl and
// rough_dielectric.glsl in the local frame (n = +z, ωₒ in the upper hemisphere). The lookup
// and the gains transcribe microfacet_energy.glsl. Change one, change both.
//
// Layout: an RGBA float texture TABLE_SIZE wide and TABLE_SIZE · TABLE_SLICES high. Texel
// (i, k·TABLE_SIZE + j) is node (μ_i, α_j, z_k) with √μ_i = i/(TABLE_SIZE−1),
// √α_j = j/(TABLE_SIZE−1), z_k = k/(TABLE_SLICES−1); μ is floored at MU_MIN, and α_j is the
// models' own α at roughness j/(TABLE_SIZE−1) (floored at 1e-3).
// z = √((r−1)/(r+1)) with r = max(η, 1/η) (Cycles' ior_to_z_index), so z = 0 is an
// index-matched interface and z = 1 a perfect mirror's Fresnel (F ≡ 1).
//   R: A with ωₒ on the rarer side (η = n_i/n_t < 1)
//   G: A with ωₒ on the denser side (η > 1; total internal reflection live)
//   B: E_avg(α_j) = 2∫₀¹ E(μ, α_j) μ dμ, E the F = 1 conductor's albedo (the same in every
//      texel of a row)
//   A: 0
// At z = 1 both R and G are the F = 1 conductor's E(μ, α), so the conductor reads that slice.

import { microfacetAlpha } from '../microfacet.js';

export const TABLE_SIZE = 32;
export const TABLE_SLICES = 32;
/** Midpoint-rule resolution per axis over the VNDF's (u₁, u₂) square. */
export const QUADRATURE_N = 256;
/** Midpoint-rule nodes in μ for E_avg. */
export const AVERAGE_NODES = 64;
const MU_MIN = 1e-4;

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };

// ── Model math ──────────────────────────────────────────────────────────────────

export function microfacetG1(v: V3, a: number): number {
    const c = Math.abs(v[2]);
    return 2 * c / (c + Math.sqrt(a * a + (1 - a * a) * c * c));
}

/** microfacet_sample_vndf: the visible normal for ωₒ (upper hemisphere). */
export function sampleVndf(wo: V3, a: number, u1: number, u2: number): V3 {
    const vh = norm([a * wo[0], a * wo[1], wo[2]]);
    const lensq = vh[0] * vh[0] + vh[1] * vh[1];
    const T1: V3 = lensq > 0 ? [-vh[1] / Math.sqrt(lensq), vh[0] / Math.sqrt(lensq), 0] : [1, 0, 0];
    const T2: V3 = [vh[1] * T1[2] - vh[2] * T1[1], vh[2] * T1[0] - vh[0] * T1[2], vh[0] * T1[1] - vh[1] * T1[0]];
    const r = Math.sqrt(u1), phi = 2 * Math.PI * u2;
    const t1 = r * Math.cos(phi);
    let t2 = r * Math.sin(phi);
    const s = 0.5 * (1 + vh[2]);
    t2 = (1 - s) * Math.sqrt(Math.max(0, 1 - t1 * t1)) + s * t2;
    const tz = Math.sqrt(Math.max(0, 1 - t1 * t1 - t2 * t2));
    const nh: V3 = [t1 * T1[0] + t2 * T2[0] + tz * vh[0], t1 * T1[1] + t2 * T2[1] + tz * vh[1], t1 * T1[2] + t2 * T2[2] + tz * vh[2]];
    return norm([a * nh[0], a * nh[1], Math.max(1e-6, nh[2])]);
}

/** dielectric_fresnel: η = n_i/n_t, cos_i ≥ 0; 1 under total internal reflection. */
export function dielectricFresnel(cosI: number, eta: number): number {
    const sin2t = eta * eta * (1 - cosI * cosI);
    if (sin2t >= 1) return 1;
    const cosT = Math.sqrt(1 - sin2t);
    const rPar = (cosI - eta * cosT) / (cosI + eta * cosT);
    const rPerp = (eta * cosI - cosT) / (eta * cosI + cosT);
    return 0.5 * (rPar * rPar + rPerp * rPerp);
}

const reflectAbout = (wo: V3, m: V3): V3 => { const d = 2 * dot(wo, m); return [d * m[0] - wo[0], d * m[1] - wo[1], d * m[2] - wo[2]]; };

/** The outgoing direction at cosine μ (azimuth 0: the models are isotropic). */
export const directionAt = (mu: number): V3 => [Math.sqrt(Math.max(0, 1 - mu * mu)), 0, mu];

/** The F = 1 conductor's sample weight for one visible normal: G₁(ωᵢ), 0 below the horizon
 *  (ggx_sample with F = 1). Its VNDF mean is E(μₒ, α). */
export function conductorWeight(wo: V3, a: number, u1: number, u2: number): number {
    const wi = reflectAbout(wo, sampleVndf(wo, a, u1, u2));
    return wi[2] <= 0 ? 0 : microfacetG1(wi, a);
}

/** G₁ of the direction refracted through microfacet m, 0 when it fails to cross
 *  (rough_dielectric_sample's transmission branch; cosOm = ωₒ·m, F < 1). */
function refractedG1(wo: V3, m: V3, cosOm: number, eta: number, a: number): number {
    const cosT = Math.sqrt(Math.max(0, 1 - eta * eta * (1 - cosOm * cosOm)));
    const c = eta * cosOm - cosT;
    const wt = norm([-eta * wo[0] + c * m[0], -eta * wo[1] + c * m[1], -eta * wo[2] + c * m[2]]);
    return wt[2] < 0 ? microfacetG1(wt, a) : 0;
}

/** The rough dielectric's energy weight for one visible normal, the lobe choice integrated
 *  out: F·G₁(ωᵣ) + (1 − F)·G₁(ωₜ) (rough_dielectric_sample's two branches with the η² factor
 *  and the tint left out). Its VNDF mean is A(μₒ, α, η). */
export function dielectricWeight(wo: V3, a: number, eta: number, u1: number, u2: number): number {
    const m = sampleVndf(wo, a, u1, u2);
    const cosOm = Math.min(1, Math.max(1e-6, dot(wo, m)));
    const wr = reflectAbout(wo, m);
    return dielectricWeightAt(wo, m, cosOm, wr[2] > 0 ? microfacetG1(wr, a) : 0, a, eta);
}

/** dielectricWeight given the visible normal m, its cosine and G₁ of the reflected
 *  direction (0 below the horizon), which do not depend on η. */
function dielectricWeightAt(wo: V3, m: V3, cosOm: number, g1Reflected: number, a: number, eta: number): number {
    const F = dielectricFresnel(cosOm, eta);
    let w = F * g1Reflected;
    if (F < 1) w += (1 - F) * refractedG1(wo, m, cosOm, eta, a);
    return w;
}

/** Midpoint rule on an n × n grid over (u₁, u₂): the VNDF mean of a weight. */
function vndfMean(weight: (u1: number, u2: number) => number, n: number): number {
    let sum = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) sum += weight((i + 0.5) / n, (j + 0.5) / n);
    return sum / (n * n);
}

/** E(μ, α): the F = 1 conductor's directional albedo. */
export function conductorAlbedo(mu: number, a: number, n = QUADRATURE_N): number {
    const wo = directionAt(mu);
    return vndfMean((u1, u2) => conductorWeight(wo, a, u1, u2), n);
}

/** A(μ, α, η): the rough dielectric's energy albedo (η = n_i/n_t on ωₒ's side). */
export function dielectricAlbedo(mu: number, a: number, eta: number, n = QUADRATURE_N): number {
    const wo = directionAt(mu);
    return vndfMean((u1, u2) => dielectricWeight(wo, a, eta, u1, u2), n);
}

/** E_avg(α) = 2∫₀¹ E(μ, α) μ dμ by the midpoint rule in μ. */
export function conductorAverage(a: number, n = QUADRATURE_N, nodes = AVERAGE_NODES): number {
    let sum = 0;
    for (let i = 0; i < nodes; i++) {
        const mu = (i + 0.5) / nodes;
        sum += 2 * mu * conductorAlbedo(mu, a, n);
    }
    return sum / nodes;
}

// ── Grid ────────────────────────────────────────────────────────────────────────

export const nodeMu = (i: number) => Math.max(MU_MIN, (i / (TABLE_SIZE - 1)) ** 2);
export const nodeAlpha = (j: number) => microfacetAlpha.fn({ roughness: j / (TABLE_SIZE - 1) }) as number;
export const nodeZ = (k: number) => k / (TABLE_SLICES - 1);
/** The index ratio r = max(η, 1/η) ≥ 1 at slice coordinate z ∈ [0, 1). */
export const ratioOfZ = (z: number) => (1 + z * z) / (1 - z * z);

/** The column of table nodes at (μ_i, α_j): A on both sides for every slice, by one pass over
 *  the VNDF samples (the visible normals and the reflected G₁ do not depend on η). Slice
 *  z = 0 is the index-matched limit A = G₁(ωₒ) (every microfacet passes ωₒ straight
 *  through); slice z = 1 is F ≡ 1, the conductor's E on both sides. Between them each node
 *  equals dielectricAlbedo(μ_i, α_j, η, n) term for term. */
export function nodeColumn(i: number, j: number, n = QUADRATURE_N): { enter: Float64Array; leave: Float64Array } {
    const mu = nodeMu(i), a = nodeAlpha(j), wo = directionAt(mu);
    const last = TABLE_SLICES - 1;
    const etas: number[] = [];
    for (let k = 1; k < last; k++) { const r = ratioOfZ(nodeZ(k)); etas.push(1 / r, r); }
    const sums = new Float64Array(etas.length);
    let conductor = 0;
    for (let s = 0; s < n; s++) for (let t = 0; t < n; t++) {
        const m = sampleVndf(wo, a, (s + 0.5) / n, (t + 0.5) / n);
        const cosOm = Math.min(1, Math.max(1e-6, dot(wo, m)));
        const wr = reflectAbout(wo, m);
        const g1r = wr[2] > 0 ? microfacetG1(wr, a) : 0;   // conductorWeight
        conductor += g1r;
        for (let e = 0; e < etas.length; e++) sums[e] += dielectricWeightAt(wo, m, cosOm, g1r, a, etas[e]);
    }
    const enter = new Float64Array(TABLE_SLICES), leave = new Float64Array(TABLE_SLICES);
    enter[0] = leave[0] = microfacetG1(wo, a);
    enter[last] = leave[last] = conductor / (n * n);
    for (let k = 1; k < last; k++) {
        enter[k] = sums[2 * (k - 1)] / (n * n);
        leave[k] = sums[2 * (k - 1) + 1] / (n * n);
    }
    return { enter, leave };
}

/** Write the column at (μ_i, α_j) into a table's RGBA data; `average` is E_avg(α_j). */
export function writeColumn(data: Float32Array, i: number, j: number, column: { enter: Float64Array; leave: Float64Array }, average: number): void {
    for (let k = 0; k < TABLE_SLICES; k++) {
        data.set([column.enter[k], column.leave[k], average, 0], ((k * TABLE_SIZE + j) * TABLE_SIZE + i) * 4);
    }
}

// ── Lookup (the twin of microfacet_energy.glsl) ─────────────────────────────────

export interface EnergyTable { data: Float32Array; width: number; height: number }

/** The table from the bytes of data/energy.bin (little-endian float32 RGBA). */
export function energyTable(bytes: Uint8Array, width: number, height: number): EnergyTable {
    return { data: new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), width, height };
}

const texel = (t: EnergyTable, i: number, row: number) => t.data.subarray((row * t.width + i) * 4, (row * t.width + i) * 4 + 4);
const mix4 = (x: ArrayLike<number>, y: ArrayLike<number>, s: number) => [0, 1, 2, 3].map((c) => x[c] * (1 - s) + y[c] * s);

/** microfacet_energy_slice: bilinear in (√μ, √α) on slice k. */
export function lookupSlice(t: EnergyTable, k: number, mu: number, a: number): number[] {
    const n = t.width;
    const fy = Math.sqrt(mu) * (n - 1), fx = Math.sqrt(a) * (n - 1);
    const i0 = Math.min(Math.trunc(fy), n - 2), j0 = Math.min(Math.trunc(fx), n - 2);
    const ty = fy - i0, tx = fx - j0;
    const row = k * n + j0;
    const lo = mix4(texel(t, i0, row), texel(t, i0 + 1, row), ty);
    const hi = mix4(texel(t, i0, row + 1), texel(t, i0 + 1, row + 1), ty);
    return mix4(lo, hi, tx);
}

/** microfacet_conductor_gain for one lane: 1 + F_ms (1 − E)/E with
 *  F_ms = F_avg E_avg / (1 − F_avg (1 − E_avg)) (Turquin Eqs. 10, 12). */
export function conductorGain(t: EnergyTable, mu: number, a: number, fAvg: number): number {
    const v = lookupSlice(t, t.height / t.width - 1, mu, a);
    const e = v[0], eAvg = v[2];
    const fMs = fAvg * eAvg / (1 - fAvg * (1 - eAvg));
    return 1 + fMs * ((1 - e) / e);
}

/** microfacet_dielectric_gain: 1/A, trilinear in (√μ, √α, z), the channel by η's side. */
export function dielectricGain(t: EnergyTable, mu: number, a: number, eta: number): number {
    const slices = t.height / t.width;
    const r = Math.max(eta, 1 / eta);
    const fz = Math.sqrt((r - 1) / (r + 1)) * (slices - 1);
    const k0 = Math.min(Math.trunc(fz), slices - 2);
    const v = mix4(lookupSlice(t, k0, mu, a), lookupSlice(t, k0 + 1, mu, a), fz - k0);
    return 1 / (eta < 1 ? v[0] : v[1]);
}

/** Schlick's hemispherical average 2∫₀¹ F(μ) μ dμ = f0 + (1 − f0)/21 (ggx.glsl's F_avg). */
export const schlickAverage = (f0: number) => f0 + (1 - f0) / 21;
