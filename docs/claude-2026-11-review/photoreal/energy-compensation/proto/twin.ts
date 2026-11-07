// Scratch prototype: TS twin of glsl/core/microfacet.glsl + ggx/rough_dielectric single-scatter
// energy albedos, used to size the energy tables. Transcribed from:
//   src/glsl/core/microfacet.glsl:29-54, ggx.glsl sample, rough_dielectric.glsl:73-133.
export type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function D(h: V3, a: number) { const t = h[2] * h[2] * (a * a - 1) + 1; return a * a / (Math.PI * t * t); }
export function G1(v: V3, a: number) { const c = Math.abs(v[2]); return 2 * c / (c + Math.sqrt(a * a + (1 - a * a) * c * c)); }
export function vndf(wo: V3, a: number, u1: number, u2: number): V3 {
    const vh = norm([a * wo[0], a * wo[1], wo[2]]);
    const lensq = vh[0] * vh[0] + vh[1] * vh[1];
    const T1: V3 = lensq > 0 ? [-vh[1] / Math.sqrt(lensq), vh[0] / Math.sqrt(lensq), 0] : [1, 0, 0];
    const T2 = cross(vh, T1);
    const r = Math.sqrt(u1), phi = 2 * Math.PI * u2;
    const t1 = r * Math.cos(phi); let t2 = r * Math.sin(phi);
    const s = 0.5 * (1 + vh[2]);
    t2 = (1 - s) * Math.sqrt(Math.max(0, 1 - t1 * t1)) + s * t2;
    const nz = Math.sqrt(Math.max(0, 1 - t1 * t1 - t2 * t2));
    const nh: V3 = [t1 * T1[0] + t2 * T2[0] + nz * vh[0], t1 * T1[1] + t2 * T2[1] + nz * vh[1], t1 * T1[2] + t2 * T2[2] + nz * vh[2]];
    return norm([a * nh[0], a * nh[1], Math.max(1e-6, nh[2])]);
}
export function fresnelDielectric(cosI: number, eta: number) {
    const s2 = eta * eta * (1 - cosI * cosI); if (s2 >= 1) return 1;
    const ct = Math.sqrt(1 - s2);
    const rp = (cosI - eta * ct) / (cosI + eta * ct), rs = (eta * cosI - ct) / (eta * cosI + ct);
    return 0.5 * (rp * rp + rs * rs);
}
const refl = (wo: V3, m: V3): V3 => { const d = 2 * dot(wo, m); return [d * m[0] - wo[0], d * m[1] - wo[1], d * m[2] - wo[2]]; };

/** Expected sample weight (F=1 conductor) for one VNDF microfacet: G1(wi)·[wi above]. */
export function condWeight(wo: V3, a: number, u1: number, u2: number) {
    const m = vndf(wo, a, u1, u2); const wi = refl(wo, m);
    return wi[2] <= 0 ? 0 : G1(wi, a);
}
/** Expected ENERGY weight of one VNDF microfacet for the dielectric, uc integrated out:
 *  F·G1(wR)[wR up] + (1−F)·G1(wT)[wT down] — the η² radiance factor undone (energy measure). */
export function dielWeight(wo: V3, a: number, eta: number, u1: number, u2: number) {
    const m = vndf(wo, a, u1, u2);
    const com = Math.min(1, Math.max(1e-6, dot(wo, m)));
    const F = fresnelDielectric(com, eta);
    let w = 0;
    const wr = refl(wo, m); if (wr[2] > 0) w += F * G1(wr, a);
    if (F < 1) {
        const s2 = eta * eta * (1 - com * com); const ct = Math.sqrt(Math.max(0, 1 - s2));
        const wt = norm([-eta * wo[0] + (eta * com - ct) * m[0], -eta * wo[1] + (eta * com - ct) * m[1], -eta * wo[2] + (eta * com - ct) * m[2]]);
        if (wt[2] < 0) w += (1 - F) * G1(wt, a);
    }
    return w;
}
/** Midpoint rule on an N×N grid over (u1,u2): the VNDF integral E_m[w]. */
export function quad(f: (u1: number, u2: number) => number, N: number) {
    let s = 0; for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) s += f((i + 0.5) / N, (j + 0.5) / N);
    return s / (N * N);
}
export const woOf = (mu: number): V3 => [Math.sqrt(Math.max(0, 1 - mu * mu)), 0, mu];
export const E_cond = (mu: number, a: number, N: number) => quad((u1, u2) => condWeight(woOf(mu), a, u1, u2), N);
export const A_diel = (mu: number, a: number, eta: number, N: number) => quad((u1, u2) => dielWeight(woOf(mu), a, eta, u1, u2), N);
