// Which frame should a curved-space intersection run in? H3 ball of radius R whose centre is at
// distance d from a ray origin placed at the world origin. float32 emulation.
//  (B) object frame: ray transformed by the object's inverse boost (f32 matrix), body at the origin.
//  (C) ray frame:   object centre as an f32 4-vector in the ray-origin frame, body with the centre folded in.
// Reference: f64 closed form in exact arithmetic.
import { V4, O, dot, flow, dist, pointAt, rng, randDir, F } from './lib.ts';
import { ballHitH3 } from './ball.ts';

type M4 = number[][]; // row-major, acts on column vectors
function boost(u: [number, number, number], d: number): M4 {
    // Boost taking O to (sinh d u, cosh d), u unit.
    const c = Math.cosh(d), s = Math.sinh(d);
    const M: M4 = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) M[i][j] += (c - 1) * u[i] * u[j];
        M[i][3] = s * u[i]; M[3][i] = s * u[i];
    }
    M[3][3] = c;
    return M;
}
const apply32 = (M: M4, x: V4): V4 => [0, 1, 2, 3].map(i => {
    let acc = 0;
    for (let j = 0; j < 4; j++) acc = F(acc + F(F(M[i][j]) * F(x[j])));
    return acc;
}) as V4;

function robust32(a: number, b: number, cx: number, cy: number, cz: number, P2: number, R: number) {
    const C = F(Math.cosh(R)), Sr = F(Math.sinh(R));
    const cr = F(F(F(cx * cx) + F(cy * cy)) + F(cz * cz));
    const D = F(F(Sr * Sr) - cr);
    if (D < 0) return null;
    const s = F(a + Math.abs(b)), o = F(F(1 + cr) / s);
    const apb = b >= 0 ? s : o, amb = b >= 0 ? o : s;
    const q = F(C + F(Math.sqrt(D)));
    const x1 = F(q / apb), x0 = F(amb / q);
    const inside = P2 < F(Sr * Sr);
    const t = F(Math.log(inside ? x1 : x0));
    return t > 0 ? t : null;
}

for (const R of [0.1, 0.01]) for (const d of [2, 4, 6, 8]) {
    const Rg = rng(5);
    let badB = 0, badC = 0, errB = 0, errC = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
        const u = randDir(Rg);
        const M = boost(u, d), Minv = boost(u, -d);
        // ray from O, direction near the silhouette (angle 0.9..1.1 x angular radius)
        const th = Math.asin(Math.sinh(R) / Math.sinh(d)) * (0.9 + 0.2 * Rg());
        let e = randDir(Rg); const k = e[0] * u[0] + e[1] * u[1] + e[2] * u[2];
        e = [e[0] - k * u[0], e[1] - k * u[1], e[2] - k * u[2]]; const ne = Math.hypot(...e); e = [e[0] / ne, e[1] / ne, e[2] / ne];
        const dir: [number, number, number] = [Math.cos(th) * u[0] + Math.sin(th) * e[0], Math.cos(th) * u[1] + Math.sin(th) * e[1], Math.cos(th) * u[2] + Math.sin(th) * e[2]];
        const p: V4 = [0, 0, 0, 1], v: V4 = [dir[0], dir[1], dir[2], 0];
        // exact reference in the object frame (f64)
        const pl = Minv.map(r => r[0] * p[0] + r[1] * p[1] + r[2] * p[2] + r[3] * p[3]) as V4;
        const vl = Minv.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2] + r[3] * v[3]) as V4;
        const ref = ballHitH3(pl, vl, R);
        // (B)
        const pb = apply32(Minv, p), vb = apply32(Minv, v);
        const tb = robust32(pb[3], vb[3],
            F(F(pb[1] * vb[2]) - F(pb[2] * vb[1])), F(F(pb[2] * vb[0]) - F(pb[0] * vb[2])), F(F(pb[0] * vb[1]) - F(pb[1] * vb[0])),
            F(F(F(pb[0] * pb[0]) + F(pb[1] * pb[1])) + F(pb[2] * pb[2])), R);
        // (C) centre c = M O in the ray frame; with p = O: a = c4, b = -C.v, cross = C x v
        const c = apply32(M, O as V4), vf = [F(v[0]), F(v[1]), F(v[2])];
        const b = F(-F(F(F(c[0] * vf[0]) + F(c[1] * vf[1])) + F(c[2] * vf[2])));
        const tc = robust32(c[3], b,
            F(F(c[1] * vf[2]) - F(c[2] * vf[1])), F(F(c[2] * vf[0]) - F(c[0] * vf[2])), F(F(c[0] * vf[1]) - F(c[1] * vf[0])),
            F(F(F(c[0] * c[0]) + F(c[1] * c[1])) + F(c[2] * c[2])), R); // inside test: |C| < sinh R  (origin inside ball)
        const ev = (t: number | null) => t === null || ref === null ? 0 : dist('H3', flow('H3', pl, vl, ref).p, flow('H3', pl, vl, t).p) / R;
        if ((tb === null) !== (ref === null)) badB++; else errB = Math.max(errB, ev(tb));
        if ((tc === null) !== (ref === null)) badC++; else errC = Math.max(errC, ev(tc));
    }
    console.log(`R=${R} d=${d}: object-frame wrong=${(100 * badB / N).toFixed(2)}% err/R=${errB.toExponential(1)} | ray-frame wrong=${(100 * badC / N).toFixed(2)}% err/R=${errC.toExponential(1)}`);
}
