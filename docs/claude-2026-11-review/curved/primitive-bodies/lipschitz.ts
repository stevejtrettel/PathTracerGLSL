// Can a EUCLIDEAN field f_E (menger, bottle, knob, ...) be evaluated on chart coordinates x = phi(p)
// and stay a valid underestimator of the curved distance?  If |d phi| <= L (operator norm, curved
// metric -> Euclidean) on a geodesically convex region holding the march, then
//   f_E(phi(p)) <= dist_E(phi(p), phi(Surf)) <= L * dist(p, Surf)   so  f_E(phi(p)) / L  is valid.
// Measured: max and min of |d phi(u)| over unit tangents u at points within radius rho of O.
import { V4, Space, flow, dist, pointAt, tangent, rng, randDir } from './lib.ts';

type Chart = (p: V4) => [number, number, number];
const charts: Record<Space, Record<string, Chart>> = {
    H3: {
        klein: p => [p[0] / p[3], p[1] / p[3], p[2] / p[3]],
        exp: p => { const P = Math.hypot(p[0], p[1], p[2]); const s = P > 0 ? Math.asinh(P) / P : 1; return [p[0] * s, p[1] * s, p[2] * s]; },
        poincare2: p => [2 * p[0] / (1 + p[3]), 2 * p[1] / (1 + p[3]), 2 * p[2] / (1 + p[3])],
    },
    S3: {
        gnomonic: p => [p[0] / p[3], p[1] / p[3], p[2] / p[3]],
        exp: p => { const P = Math.hypot(p[0], p[1], p[2]); const s = P > 0 ? Math.atan2(P, p[3]) / P : 1; return [p[0] * s, p[1] * s, p[2] * s]; },
        stereo2: p => [2 * p[0] / (1 + p[3]), 2 * p[1] / (1 + p[3]), 2 * p[2] / (1 + p[3])],
    },
};
const predicted: Record<string, (r: number) => [number, number]> = {
    'H3/klein': r => [1 / Math.cosh(r) ** 2, 1],
    'H3/exp': r => [r > 0 ? r / Math.sinh(r) : 1, 1],
    'H3/poincare2': r => [1 / Math.cosh(r / 2) ** 2, 1],
    'S3/gnomonic': r => [1, 1 / Math.cos(r) ** 2],
    'S3/exp': r => [1, r > 0 ? r / Math.sin(r) : 1],
    'S3/stereo2': r => [1, 1 / Math.cos(r / 2) ** 2],
};

const Rg = rng(9);
for (const S of ['H3', 'S3'] as Space[]) for (const [name, phi] of Object.entries(charts[S])) {
    for (const rho of [0.5, 1, 2]) {
        let mx = 0, mn = Infinity;
        for (let i = 0; i < 20000; i++) {
            const p = pointAt(S, randDir(Rg), rho * Math.cbrt(Rg()));
            const u = tangent(S, p, [...randDir(Rg), 0] as V4);
            const e = 1e-6, q = flow(S, p, u, e).p;
            const a = phi(p), b = phi(q);
            const r = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / e;
            mx = Math.max(mx, r); mn = Math.min(mn, r);
        }
        const [pl, pu] = predicted[`${S}/${name}`](rho);
        console.log(`${S} ${name.padEnd(9)} rho=${rho}: |dphi| in [${mn.toFixed(4)}, ${mx.toFixed(4)}]  predicted [${pl.toFixed(4)}, ${pu.toFixed(4)}]`);
    }
}

// Direct check: a Euclidean box field evaluated in the chart, divided by L(rho), never exceeds the true
// curved distance to the chart-box's preimage (surface sampled in the chart and mapped back).
const inv: Record<string, (x: number[]) => V4> = {
    'H3/klein': x => { const w = 1 / Math.sqrt(1 - x[0] ** 2 - x[1] ** 2 - x[2] ** 2); return [x[0] * w, x[1] * w, x[2] * w, w]; },
    'H3/poincare2': x => { const y = x.map(c => c / 2); const n2 = y[0] ** 2 + y[1] ** 2 + y[2] ** 2; const d = 1 - n2; return [2 * y[0] / d, 2 * y[1] / d, 2 * y[2] / d, (1 + n2) / d]; },
    'S3/gnomonic': x => { const w = 1 / Math.sqrt(1 + x[0] ** 2 + x[1] ** 2 + x[2] ** 2); return [x[0] * w, x[1] * w, x[2] * w, w]; },
    'S3/stereo2': x => { const y = x.map(c => c / 2); const n2 = y[0] ** 2 + y[1] ** 2 + y[2] ** 2; const d = 1 + n2; return [2 * y[0] / d, 2 * y[1] / d, 2 * y[2] / d, (1 - n2) / d]; },
};
const boxE = (x: number[], b: number[]) => {
    const d = x.map((c, i) => Math.abs(c) - b[i]);
    return Math.hypot(Math.max(d[0], 0), Math.max(d[1], 0), Math.max(d[2], 0)) + Math.min(Math.max(d[0], d[1], d[2]), 0);
};
for (const key of Object.keys(inv)) {
    const [S, name] = key.split('/') as [Space, string];
    const phi = charts[S][name], back = inv[key];
    const b = [0.5, 0.35, 0.4];
    const rho = 1.2;          // all test points and the box lie in the ball of radius rho
    const L = predicted[key](rho)[1];
    // surface samples
    const surf: V4[] = [];
    for (let i = 0; i < 60000; i++) {
        const f = Math.floor(Rg() * 3), sg = Rg() < 0.5 ? -1 : 1;
        const x = b.map(c => (2 * Rg() - 1) * c); x[f] = sg * b[f];
        surf.push(back(x));
    }
    let worst = -Infinity, ratioMin = Infinity;
    for (let i = 0; i < 300; i++) {
        let p: V4;
        do { p = pointAt(S, randDir(Rg), rho * Math.cbrt(Rg())); } while (false);
        const x = phi(p);
        const fE = boxE(x, b) / L;
        let m = Infinity; for (const q of surf) m = Math.min(m, dist(S, p, q));
        worst = Math.max(worst, Math.abs(fE) - m);     // > 0 would be an overestimate (beyond sampling error)
        if (Math.abs(fE) > 1e-3) ratioMin = Math.min(ratioMin, Math.abs(fE) / m);
    }
    console.log(`${key}: |f_E(phi(p))|/L - true distance, max = ${worst.toExponential(1)} (<= ~sampling error means valid); min ratio |f|/dist = ${ratioMin.toFixed(3)} (step efficiency), L=${L.toFixed(3)}`);
}
