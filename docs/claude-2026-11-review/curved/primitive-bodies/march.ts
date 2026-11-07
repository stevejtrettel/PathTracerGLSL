// Sphere tracing along the geodesic flow (re-flowed from the seed each step: p(t) = flow(p0,v0,t))
// with exact curved SDFs, vs the same configuration in E3. Then finite-difference normals in the
// tangent frame vs the analytic normal.
import { V4, Space, O, dot, flow, dist, pointAt, tangent, frameAt, rng, randDir, lin, F } from './lib.ts';
import { ballHitH3, ballHitS3 } from './ball.ts';

type Sp = Space | 'E3';
const TWO_PI = 2 * Math.PI;
// E3 embedded as (x,y,z,1) with directions (dx,dy,dz,0)
const flowX = (S: Sp, p: V4, v: V4, t: number): V4 => S === 'E3' ? [p[0] + t * v[0], p[1] + t * v[1], p[2] + t * v[2], 1] : flow(S, p, v, t).p;
const ptAt = (S: Sp, u: [number, number, number], r: number): V4 => {
    if (S === 'E3') { const n = Math.hypot(...u); return [u[0] / n * r, u[1] / n * r, u[2] / n * r, 1]; }
    return pointAt(S, u, r);
};
const radial = (S: Sp, p: V4) => { const P = Math.hypot(p[0], p[1], p[2]); return S === 'E3' ? P : S === 'H3' ? Math.asinh(P) : Math.atan2(P, p[3]); };
const ballF = (S: Sp, p: V4, R: number) => radial(S, p) - R;
// torus: chord forms (curved), standard (E3)
function torusF(S: Sp, p: V4, R: number, r: number) {
    const pxz = Math.hypot(p[0], p[2]);
    if (S === 'E3') return Math.hypot(pxz - R, p[1]) - r;
    const ex = pxz > 0 ? p[0] / pxz : 1, ez = pxz > 0 ? p[2] / pxz : 0;
    const sR = S === 'H3' ? Math.sinh(R) : Math.sin(R), cR = S === 'H3' ? Math.cosh(R) : Math.cos(R);
    const dx = p[0] - sR * ex, dy = p[1], dz = p[2] - sR * ez, dw = p[3] - cR;
    const m2 = dx * dx + dy * dy + dz * dz + (S === 'H3' ? -1 : 1) * dw * dw;
    return (S === 'H3' ? 2 * Math.asinh(Math.sqrt(Math.max(0, m2)) / 2) : 2 * Math.asin(Math.min(1, Math.sqrt(m2) / 2))) - r;
}

function march(S: Sp, p: V4, v: V4, f: (q: V4) => number, tMax: number) {
    let t = 0;
    for (let i = 0; i < 2048; i++) {
        const d = f(flowX(S, p, v, t));
        if (d < 1e-4 * (1 + 0)) return { hit: true, t, steps: i + 1 };
        t += d;
        if (t > tMax) return { hit: false, t, steps: i + 1 };
    }
    return { hit: false, t, steps: 2048, stuck: true };
}

// Rays from distance Dc toward O, direction uniform in the cone of the bound (angular radius of radius Rb)
function rayAt(S: Sp, Dc: number, Rb: number, Rg: () => number) {
    const u = randDir(Rg);
    const p = ptAt(S, u, Dc);
    let d0: V4, e1: V4, e2: V4;
    const w = randDir(Rg);
    if (S === 'E3') {
        d0 = [-u[0], -u[1], -u[2], 0];
        let k = w[0] * d0[0] + w[1] * d0[1] + w[2] * d0[2];
        e1 = [w[0] - k * d0[0], w[1] - k * d0[1], w[2] - k * d0[2], 0]; const n = Math.hypot(e1[0], e1[1], e1[2]); e1 = e1.map(x => x / n) as V4;
    } else {
        d0 = tangent(S, p, lin(O, 1, p, 0));
        e1 = lin([w[0], w[1], w[2], 0], 1, d0, -dot(S, [w[0], w[1], w[2], 0], d0)); e1 = tangent(S, p, e1);
    }
    const sinTh = S === 'E3' ? Rb / Dc : S === 'H3' ? Math.sinh(Rb) / Math.sinh(Dc) : Math.sin(Rb) / Math.sin(Dc);
    const th = Math.asin(Math.min(1, sinTh)) * Math.sqrt(Rg());   // uniform-ish over the disk of the cone
    const v = lin(d0, Math.cos(th), e1, Math.sin(th));
    return { p, v };
}

console.log('Sphere tracing, eps 1e-4, rays filling the cone of a bounding ball of radius 1.25x the object:');
for (const [label, Dc, mk] of [
    ['ball R=0.5', 2.5, (S: Sp) => (q: V4) => ballF(S, q, 0.5)],
    ['torus R=0.8 r=0.25', 2.5, (S: Sp) => (q: V4) => torusF(S, q, 0.8, 0.25)],
] as [string, number, (S: Sp) => (q: V4) => number][]) {
    for (const S of ['E3', 'H3', 'S3'] as Sp[]) {
        const Rg = rng(21);
        const f = mk(S);
        const Rb = label.startsWith('ball') ? 0.625 : 1.3;
        let nh = 0, nm = 0, sh = 0, sm = 0, maxh = 0, maxm = 0, terr = 0, stuck = 0;
        for (let i = 0; i < 3000; i++) {
            const { p, v } = rayAt(S, Dc, Rb, Rg);
            const tMax = S === 'S3' ? TWO_PI : Dc + Rb + 0.5;
            const r = march(S, p, v, f, tMax);
            if ((r as any).stuck) stuck++;
            if (r.hit) { nh++; sh += r.steps; maxh = Math.max(maxh, r.steps);
                if (label.startsWith('ball') && S !== 'E3') { const tc = S === 'H3' ? ballHitH3(p, v, 0.5) : ballHitS3(p, v, 0.5); if (tc !== null) terr = Math.max(terr, Math.abs(tc - r.t)); else terr = Infinity; } }
            else { nm++; sm += r.steps; maxm = Math.max(maxm, r.steps); }
        }
        console.log(`  ${label} ${S}: hits ${nh} mean ${(sh / Math.max(nh, 1)).toFixed(1)} max ${maxh} steps | misses ${nm} mean ${(sm / Math.max(nm, 1)).toFixed(1)} max ${maxm} | stuck ${stuck}${terr ? ` | max |t_march - t_closed| ${terr.toExponential(1)}` : ''}`);
    }
}

// S3: rays that miss locally but wrap around: misses must march up to 2pi; count steps for full-period misses.
{
    const Rg = rng(22);
    let sm = 0, n = 0, mx = 0;
    for (let i = 0; i < 2000; i++) {
        const p = pointAt('S3', randDir(Rg), 2.5);
        const v = tangent('S3', p, [...randDir(Rg), 0] as V4);
        const r = march('S3', p, v, q => ballF('S3', q, 0.5), TWO_PI);
        if (!r.hit) { sm += r.steps; n++; mx = Math.max(mx, r.steps); }
    }
    console.log(`  S3 ball R=0.5, random directions, misses marched to 2pi: ${n} rays, mean ${(sm / n).toFixed(1)} max ${mx} steps`);
}

// ---------- FD normals ----------
// Analytic normal of the torus at q: unit tangent pointing away from the nearest core-circle point c.
function torusNormal(S: Space, q: V4, R: number): V4 {
    const pxz = Math.hypot(q[0], q[2]);
    const c = pointAt(S, [q[0] / pxz, 0, q[2] / pxz], R);
    return lin(tangent(S, q, c), -1, O, 0);
}
function fdNormal(S: Space, q: V4, f: (x: V4) => number, h: number, mode: 'exp' | 'linear', round = false): V4 {
    const fr = frameAt(S, q);
    const K = [[1, -1, -1], [-1, -1, 1], [-1, 1, -1], [1, 1, 1]].map(k => k.map(x => x * 0.5773));
    const g = [0, 0, 0];
    for (const k of K) {
        let dir = lin(lin(fr[0], k[0], fr[1], k[1]), 1, fr[2], k[2]);
        let tap = mode === 'exp' ? flow(S, q, mul1(dir, 1 / norm(S, dir)), h * norm(S, dir)).p : lin(q, 1, dir, h);
        if (round) tap = tap.map(F) as V4;
        const val = round ? F(f(tap)) : f(tap);
        for (let j = 0; j < 3; j++) g[j] += k[j] * val;
    }
    const n = lin(lin(fr[0], g[0], fr[1], g[1]), 1, fr[2], g[2]);
    return mul1(n, 1 / norm(S, n));
}
const mul1 = (a: V4, s: number): V4 => a.map(x => x * s) as V4;
const norm = (S: Space, a: V4) => Math.sqrt(dot(S, a, a));
console.log('\nFD normal (4-tap tetrahedral in an orthonormal tangent frame) vs analytic, torus R=0.8 r=0.25, angle error (rad), max over 2000 surface points:');
for (const S of ['H3', 'S3'] as Space[]) for (const h of [1e-3, 1e-4]) {
    const Rg = rng(23);
    const res: Record<string, number> = { exp: 0, linear: 0, exp_f32: 0 };
    for (let i = 0; i < 2000; i++) {
        const th = TWO_PI * Rg();
        const c = pointAt(S, [Math.cos(th), 0, Math.sin(th)], 0.8);
        const tang = tangent(S, c, [-Math.sin(th), 0, Math.cos(th), 0]);
        let w = tangent(S, c, [...randDir(Rg), 0] as V4);
        w = tangent(S, c, lin(w, 1, tang, -dot(S, w, tang)));
        const q = flow(S, c, w, 0.25).p;
        const na = torusNormal(S, q, 0.8);
        const f = (x: V4) => torusF(S, x, 0.8, 0.25);
        for (const [key, mode, round] of [['exp', 'exp', false], ['linear', 'linear', false], ['exp_f32', 'exp', true]] as const) {
            const n = fdNormal(S, q, f, h, mode, round);
            res[key] = Math.max(res[key], Math.acos(Math.min(1, dot(S, n, na))));
        }
    }
    console.log(`  ${S} h=${h}: exp-taps ${res.exp.toExponential(1)} | linear taps q + h k (off the manifold) ${res.linear.toExponential(1)} | exp-taps, f32-rounded taps+values ${res.exp_f32.toExponential(1)}`);
}
