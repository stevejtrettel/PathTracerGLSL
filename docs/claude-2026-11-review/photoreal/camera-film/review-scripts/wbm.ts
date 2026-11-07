// Scratch prototype for the camera-film plan: twin warps + χ², witness values, white balance.
// Run from the repo root: npx tsx <this file>
import { cie1931Curves } from '/Users/stevetrettel/Code/PathTracerGLSL/src/components/sensor/cie1931/curves.ts';
import { spectralData } from '/Users/stevetrettel/Code/PathTracerGLSL/src/components/color/spectral/data.ts';
// Transcription of blackbody.ts blackbodyColor (that module imports a ?raw GLSL file, which tsx cannot load).
const planckC2 = 6.62607015e-34 * 299792458 / 1.380649e-23 * 1e9;
const planckShape = (l: number, k: number) => (550 / l) ** 5 * Math.expm1(planckC2 / (550 * k)) / Math.expm1(planckC2 / (l * k));
function blackbodyColor(kelvin: number): { rgb: number[] } {
    const xyz = [0, 0, 0];
    for (let interval = 0; interval < cie1931Curves.length - 1; interval++) for (let sample = 0; sample <= 10; sample++) {
        const fraction = sample / 10, lambda = 360 + 5 * (interval + fraction);
        const weight = 0.5 / 3 * (sample === 0 || sample === 10 ? 1 : sample % 2 ? 4 : 2);
        const value = weight * planckShape(lambda, kelvin) / spectralData.cieYIntegral;
        for (let c = 0; c < 3; c++) xyz[c] += value * (cie1931Curves[interval][c] * (1 - fraction) + cie1931Curves[interval + 1][c] * fraction);
    }
    const rgb = spectralData.xyzToRGB.map(row => row.reduce((s, v, i) => s + v * xyz[i], 0));
    return { rgb: rgb.map(v => v / xyz[1]) };
}

// ---------- RNG (mulberry32) ----------
function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        // top 24 bits, [0,1) — the pcg4d mapping
        return (((t ^ (t >>> 14)) >>> 8) / 16777216);
    };
}
function chi2Crit(dof: number): number { // Wilson–Hilferty, p≈0.001
    const z = 3.0902; const a = 2 / (9 * dof);
    return dof * Math.pow(1 - a + z * Math.sqrt(a), 3);
}
function chi2(obs: number[], exp: number[]): { chi2: number; dof: number } {
    let c = 0, dof = 0, pe = 0, po = 0;
    for (let i = 0; i < obs.length; i++) {
        if (exp[i] < 5) { pe += exp[i]; po += obs[i]; continue; }
        c += (obs[i] - exp[i]) ** 2 / exp[i]; dof++;
    }
    if (pe > 5) { c += (po - pe) ** 2 / pe; dof++; }
    return { chi2: c, dof: dof - 1 };
}

// ---------- 1. tent (radius r) — inverse CDF, pbrt SampleTent form ----------
function sampleTent(u: number, r: number): number {
    return u < 0.5 ? -r + r * Math.sqrt(2 * u) : r - r * Math.sqrt(2 - 2 * u);
}
const tentCdf = (x: number, r: number) => {
    const t = Math.max(-r, Math.min(r, x)) / r;
    return t <= 0 ? 0.5 * (1 + t) ** 2 : 1 - 0.5 * (1 - t) ** 2;
};
// ---------- 2. Gaussian — Box–Muller (pbrt SampleTwoNormal) ----------
function sampleGauss(u0: number, u1: number, s: number): [number, number] {
    const r = s * Math.sqrt(-2 * Math.log(1 - u0));
    return [r * Math.cos(2 * Math.PI * u1), r * Math.sin(2 * Math.PI * u1)];
}
function erf(x: number): number { // high-accuracy via series/continued fraction (Abramowitz-Stegun 7.1.26 not enough) — use numeric integration
    const n = 4000; let s = 0; const h = x / n;
    for (let i = 0; i <= n; i++) { const t = i * h; s += (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * Math.exp(-t * t); }
    return (2 / Math.sqrt(Math.PI)) * s * h / 3;
}
const Phi = (z: number) => 0.5 * (1 + (z >= 0 ? erf(z / Math.SQRT2) : -erf(-z / Math.SQRT2)));

// ---------- 3. regular n-gon (Cycles regular_polygon_sample) ----------
function samplePolygon(n: number, rot: number, u0: number, v0: number): [number, number] {
    const corner = Math.floor(u0 * n);
    let u = u0 * n - corner;
    u = Math.sqrt(u); const v = v0 * u; u = 1 - u;
    const a = Math.PI / n;
    const px = (u + v) * Math.cos(a), py = (u - v) * Math.sin(a);
    const r = rot + corner * 2 * a;
    return [Math.cos(r) * px - Math.sin(r) * py, Math.sin(r) * px + Math.cos(r) * py];
}
function inPolygon(n: number, rot: number, x: number, y: number): boolean {
    // vertices at angles rot + a + 2πk/n (Cycles: triangle k spans rot+2ka ± a, vertices at ±a)
    const a = Math.PI / n;
    for (let k = 0; k < n; k++) {
        const t0 = rot + 2 * k * a - a, t1 = rot + 2 * k * a + a;
        const x0 = Math.cos(t0), y0 = Math.sin(t0), x1 = Math.cos(t1), y1 = Math.sin(t1);
        if ((x1 - x0) * (y - y0) - (y1 - y0) * (x - x0) < 0) return false;
    }
    return true;
}

// exact area of (convex cell ∩ convex polygon) by Sutherland–Hodgman
function clipArea(n: number, rot: number, poly: number[][]): number {
    const a = Math.PI / n;
    for (let k = 0; k < n; k++) {
        const t0 = rot + 2 * k * a - a, t1 = rot + 2 * k * a + a;
        const ax = Math.cos(t0), ay = Math.sin(t0), bx = Math.cos(t1), by = Math.sin(t1);
        const side = (p: number[]) => (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax);
        const res: number[][] = [];
        for (let i = 0; i < poly.length; i++) {
            const P = poly[i], Q = poly[(i + 1) % poly.length], sp = side(P), sq = side(Q);
            if (sp >= 0) res.push(P);
            if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); res.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]); }
        }
        poly = res; if (poly.length === 0) return 0;
    }
    let A = 0; for (let i = 0; i < poly.length; i++) { const P = poly[i], Q = poly[(i + 1) % poly.length]; A += P[0] * Q[1] - Q[0] * P[1]; }
    return Math.abs(A) / 2;
}
const out: string[] = [];
const log = (s: string) => { out.push(s); console.log(s); };

// χ² tent (marginal x, 64 bins on [-1,1])
{
    const R = rng(1), N = 2_000_000, B = 64, r = 1;
    const obs = new Array(B).fill(0);
    for (let i = 0; i < N; i++) { const x = sampleTent(R(), r); obs[Math.min(B - 1, Math.floor((x + r) / (2 * r) * B))]++; }
    const exp = obs.map((_, b) => N * (tentCdf(-r + 2 * r * (b + 1) / B, r) - tentCdf(-r + 2 * r * b / B, r)));
    const c = chi2(obs, exp); log(`tent r=1: chi2=${c.chi2.toFixed(1)} dof=${c.dof} crit=${chi2Crit(c.dof).toFixed(1)}`);
}
// χ² gaussian (2D grid over [-2,2]^2 32x32 plus outside bin), σ=0.5
{
    const R = rng(2), N = 4_000_000, B = 32, L = 2, s = 0.5;
    const obs = new Array(B * B + 1).fill(0);
    for (let i = 0; i < N; i++) {
        const [x, y] = sampleGauss(R(), R(), s);
        if (Math.abs(x) >= L || Math.abs(y) >= L) { obs[B * B]++; continue; }
        obs[Math.floor((y + L) / (2 * L) * B) * B + Math.floor((x + L) / (2 * L) * B)]++;
    }
    const F = (z: number) => Phi(z / s);
    const exp: number[] = [];
    for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
        const x0 = -L + 2 * L * i / B, x1 = x0 + 2 * L / B, y0 = -L + 2 * L * j / B, y1 = y0 + 2 * L / B;
        exp.push(N * (F(x1) - F(x0)) * (F(y1) - F(y0)));
    }
    exp.push(N - exp.reduce((a, b) => a + b, 0));
    const c = chi2(obs, exp); log(`gaussian σ=0.5 (Box–Muller): chi2=${c.chi2.toFixed(1)} dof=${c.dof} crit=${chi2Crit(c.dof).toFixed(1)}`);
    log(`  max Box–Muller radius at 24-bit xi: ${(s * Math.sqrt(-2 * Math.log(2 ** -24))).toFixed(3)} px; tail mass beyond it ${(2 ** -24).toExponential(2)}`);
}
// χ² polygon: uniform over polygon (grid 40x40 over [-1,1]^2, cell polygon area by 20x20 subsampling)
for (const [n, rot] of [[5, 0.3], [6, 0], [9, 1.1]] as [number, number][]) {
    const R = rng(3 + n), N = 3_000_000, B = 40;
    const obs = new Array(B * B).fill(0);
    let outside = 0;
    for (let i = 0; i < N; i++) {
        const [x, y] = samplePolygon(n, rot, R(), R());
        if (!inPolygon(n, rot, x * 0.999999, y * 0.999999)) outside++;
        obs[Math.min(B - 1, Math.floor((y + 1) / 2 * B)) * B + Math.min(B - 1, Math.floor((x + 1) / 2 * B))]++;
    }
    const area = (n / 2) * Math.sin(2 * Math.PI / n);
    const exp: number[] = []; const S = 20;
    for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
        const x0 = -1 + 2 * i / B, x1 = x0 + 2 / B, y0 = -1 + 2 * j / B, y1 = y0 + 2 / B;
        exp.push(N * clipArea(n, rot, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) / area); void S;
    }
    const c = chi2(obs, exp);
    log(`polygon n=${n} rot=${rot}: chi2=${c.chi2.toFixed(1)} dof=${c.dof} crit=${chi2Crit(c.dof).toFixed(1)} outside=${outside} (expected-count sum ${exp.reduce((a, b) => a + b, 0).toFixed(0)} of ${N}; quadrature of cell areas)`);
}

// ---------- 4. Witness values ----------
// filter-edge: emitter covers film x > 0 (pixel boundary). Pixel centred d px inside (d<0 outside).
for (const d of [-1.5, -0.5, 0.5, 1.5]) {
    const box = d > 0 ? 1 : 0; // box support [d-0.5,d+0.5] — value = fraction of support >0
    const boxV = Math.max(0, Math.min(1, d + 0.5));
    const tentV = tentCdf(d, 1); // P(d + X > 0) = P(X > -d) = 1 - F(-d) = F(d) by symmetry
    const gV = Phi(d / 0.5);
    log(`filter-edge column d=${d}: box ${boxV.toFixed(6)} tent(r=1) ${tentV.toFixed(6)} gaussian(σ=.5) ${gV.toFixed(6)}`);
    void box;
}
// bokeh-edge: thin lens radius R, focus F, emitter half-plane at depth Z=2F covering hit_x < -c.
// hit_x = 2 s - p_x (s = film offset at the focus plane) → lit iff p_x > c + 2 s.
const R0 = 0.5;
const diskFrac = (c: number) => { const t = Math.acos(c / R0); return (t - Math.sin(t) * Math.cos(t)) / Math.PI; };
log(`bokeh-edge c=R/2: disk fraction ${diskFrac(R0 / 2).toFixed(6)}; hexagon (vertex on +x) exact 1/6 = ${(1 / 6).toFixed(6)}`);
// Monte Carlo of the full geometry for the two centre columns, with the box pixel filter and fov 0.8, 160x120.
{
    const W = 160, H = 120, tanF = Math.tan(0.4), aspect = W / H, F = 2, Z = 4, c = R0 / 2;
    for (const shape of ['disk', 'hex'] as const) {
        const Rr = rng(shape === 'disk' ? 101 : 202); let sum = 0, cnt = 0;
        for (const col of [79, 80]) for (let row = 0; row < H; row += 7) for (let k = 0; k < 60000; k++) {
            const fx = col + Rr(), fy = row + Rr();
            const nx = (2 * fx / W - 1) * aspect, ny = 2 * fy / H - 1;
            const dir = [nx * tanF, ny * tanF, 1];
            const fp = [dir[0] * F, dir[1] * F, F]; // focus point (dir·fwd = 1)
            let lx: number, ly: number;
            if (shape === 'disk') { // concentric disk
                const ox = 2 * Rr() - 1, oy = 2 * Rr() - 1; let r: number, th: number;
                if (ox === 0 && oy === 0) { r = 0; th = 0; } else if (Math.abs(ox) > Math.abs(oy)) { r = ox; th = Math.PI / 4 * (oy / ox); } else { r = oy; th = Math.PI / 2 - Math.PI / 4 * (ox / oy); }
                lx = r * Math.cos(th) * R0; ly = r * Math.sin(th) * R0;
            } else {
                // hexagon with a VERTEX on +x: Cycles puts vertices at rot ± π/n, so rot = π/6 → vertex at 0? (rot - a = 0)
                [lx, ly] = samplePolygon(6, Math.PI / 6, Rr(), Rr()); lx *= R0; ly *= R0;
            }
            const t = (Z - 0) / (fp[2] - 0);
            const hx = lx + (fp[0] - lx) * t;
            sum += hx < -c ? 1 : 0; cnt++;
            void ly;
        }
        log(`bokeh-edge MC (${shape}, columns 79-80, full pixel jitter): ${(sum / cnt).toFixed(4)} ± ${(Math.sqrt((sum / cnt) * (1 - sum / cnt) / cnt)).toFixed(4)}`);
    }
}

// ---------- 5. White balance: Bradford (pbrt util/color.h:546-566) ----------
type M3 = number[][];
const mul = (a: M3, b: M3): M3 => a.map(r => b[0].map((_, j) => r.reduce((s, v, k) => s + v * b[k][j], 0)));
const mv = (a: M3, v: number[]) => a.map(r => r.reduce((s, x, k) => s + x * v[k], 0));
const LMSFromXYZ: M3 = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];
const XYZFromLMS: M3 = [[0.986993, -0.147054, 0.159963], [0.432305, 0.51836, 0.0492912], [-0.00852866, 0.0400428, 0.968487]];
function wbRGB(kelvin: number): M3 {
    const src = mv(spectralData.rgbToXYZ, blackbodyColor(kelvin).rgb); // Y = 1
    const dst = spectralData.white;                                     // D65, Y = 1
    const s = mv(LMSFromXYZ, src), d = mv(LMSFromXYZ, dst);
    const D: M3 = [[d[0] / s[0], 0, 0], [0, d[1] / s[1], 0], [0, 0, d[2] / s[2]]];
    return mul(spectralData.xyzToRGB, mul(XYZFromLMS, mul(D, mul(LMSFromXYZ, spectralData.rgbToXYZ))));
}
for (const T of [2700, 3200, 5000, 6504]) {
    const M = wbRGB(T); const bb = blackbodyColor(T).rgb; const w = mv(M, bb);
    log(`WB ${T}K: blackbody rgb ${bb.map(v => v.toFixed(4)).join(',')} → ${w.map(v => v.toFixed(6)).join(',')}`);
}
// Bradford round-trip: XYZFromLMS·LMSFromXYZ ≈ I?
const I = mul(XYZFromLMS, LMSFromXYZ);
log(`Bradford pair product max |I - P| = ${Math.max(...I.flatMap((r, i) => r.map((v, j) => Math.abs(v - (i === j ? 1 : 0))))).toExponential(2)}`);

for (const T of [2700, 6504, 10000]) { const M = wbRGB(T); console.log("M", T, M.map(r=>r.map(v=>v.toFixed(4)).join(" ")).join(" | ")); }
