// Plane, disk, quad, tube (capped cylinder), box, torus in H3 / S3 local frames: SDFs and
// closed-form intersections checked against brute force (f64).
import { V4, Space, O, dot, flow, dist, pointAt, tangent, rng, randDir, bruteFirstRoot, lin, F, f32 } from './lib.ts';

const TWO_PI = 2 * Math.PI;
const mod = (x: number, m: number) => x - m * Math.floor(x / m);
const ch = (S: Space, x: number) => S === 'H3' ? Math.cosh(x) : Math.cos(x);
const sh = (S: Space, x: number) => S === 'H3' ? Math.sinh(x) : Math.sin(x);
const ash = (S: Space, x: number) => S === 'H3' ? Math.asinh(x) : Math.asin(Math.max(-1, Math.min(1, x)));

// ---- roots of  P cosh t + W sinh t = 0  (H3)  /  P cos t + W sin t = 0 (S3), all in (0, Tmax) ----
// i.e. the geodesic crossing the linear hyperplane <x,N> = 0 with P = <p,N>, W = <v,N>.
function planeRoots(S: Space, P: number, W: number): number[] {
    if (S === 'H3') {
        const r = (W - P) / (W + P);          // e^{2t}
        if (!(r > 1)) return [];
        return [0.5 * Math.log(r)];
    }
    const th = Math.atan2(-P, W);             // P cos th + W sin th = 0
    const t0 = mod(th, Math.PI);
    return t0 > 0 ? [t0, t0 + Math.PI] : [Math.PI];
}

// ---- random rays: origin at distance in [0.2, Dmax] from O, direction aimed roughly at O ----
function randomRay(S: Space, Rg: () => number, Dmin: number, Dmax: number, spread: number) {
    const p = pointAt(S, randDir(Rg), Dmin + (Dmax - Dmin) * Rg());
    const d0 = tangent(S, p, lin(O, 1, p, 0));
    const w = randDir(Rg);
    const v = tangent(S, p, lin(d0, 1, [w[0], w[1], w[2], 0], spread));
    return { p, v };
}

// Brute min distance from p to a parametrised surface: random samples + local shrink refinement.
function bruteDist(S: Space, p: V4, surf: (u: number[]) => V4, dim: number, ranges: [number, number][], Rg: () => number) {
    let best = Infinity, bu: number[] = [];
    for (let i = 0; i < 3000; i++) {
        const u = ranges.map(([a, b]) => a + (b - a) * Rg());
        const d = dist(S, p, surf(u));
        if (d < best) { best = d; bu = u; }
    }
    let step = ranges.map(([a, b]) => (b - a) * 0.05);
    for (let it = 0; it < 4000; it++) {
        const u = bu.map((x, k) => Math.min(ranges[k][1], Math.max(ranges[k][0], x + step[k] * (2 * Rg() - 1))));
        const d = dist(S, p, surf(u));
        if (d < best) { best = d; bu = u; }
        if (it % 400 === 399) step = step.map(s => s * 0.5);
    }
    return best;
}

const log = console.log;

// ===================== PLANE  (local frame: plane through O with normal e_y) =====================
{
    const Rg = rng(1);
    for (const S of ['H3', 'S3'] as Space[]) {
        const N: V4 = [0, 1, 0, 0];
        const sdf = (p: V4) => ash(S, p[1]);   // <p,N> = p_y in both spaces
        let eSdf = 0, mism = 0, eT = 0, hits = 0;
        const planePt = (u: number[]) => pointAt(S, [Math.cos(u[0]), 0, Math.sin(u[0])], u[1]);
        for (let i = 0; i < 60; i++) {
            const p = pointAt(S, randDir(Rg), 2 * Rg());
            const bd = bruteDist(S, p, planePt, 2, [[0, TWO_PI], [0, S === 'H3' ? 6 : Math.PI]], Rg);
            eSdf = Math.max(eSdf, Math.abs(Math.abs(sdf(p)) - bd));
        }
        for (let i = 0; i < 400; i++) {
            const { p, v } = randomRay(S, Rg, 0.1, 2, 1.5);
            const rs = planeRoots(S, p[1], v[1]);
            const tc = rs.length ? rs[0] : null;
            const tb = bruteFirstRoot(t => sdf(flow(S, p, v, t).p), 1e-9, S === 'H3' ? 12 : TWO_PI, 40000);
            if ((tc === null) !== (tb === null)) { mism++; continue; }
            if (tc !== null) { hits++; eT = Math.max(eT, Math.abs(tc - tb!)); }
        }
        log(`[${S}] plane: |SDF| vs brute distance max diff ${eSdf.toExponential(1)}; hit closed form vs brute: ${hits} hits, ${mism} mismatches, max|dt| ${eT.toExponential(1)}`);
    }
}

// ===================== DISK and QUAD as plane pieces; quad = Klein/gnomonic rectangle =====================
{
    const Rg = rng(2);
    for (const S of ['H3', 'S3'] as Space[]) {
        // Quad with half-widths a (x) and b (z): |h_x| <= tanh a h_w etc. Interior corner angle & area by Monte Carlo
        const a = 0.8, b = 0.6;
        const ta = S === 'H3' ? Math.tanh(a) : Math.tan(a), tb = S === 'H3' ? Math.tanh(b) : Math.tan(b);
        // Monte Carlo area with the chart density: H3 (1-|k|^2)^{-3/2}, S3 (1+|k|^2)^{-3/2}
        let acc = 0; const M = 400000;
        for (let i = 0; i < M; i++) {
            const x = (2 * Rg() - 1) * ta, z = (2 * Rg() - 1) * tb, k2 = x * x + z * z;
            acc += S === 'H3' ? Math.pow(1 - k2, -1.5) : Math.pow(1 + k2, -1.5);
        }
        const areaMC = acc / M * 4 * ta * tb;
        const cosAlpha = S === 'H3' ? Math.sinh(a) * Math.sinh(b) : -Math.sin(a) * Math.sin(b);
        const alpha = Math.acos(cosAlpha);
        const areaGB = S === 'H3' ? TWO_PI - 4 * alpha : 4 * alpha - TWO_PI;   // Gauss–Bonnet, K = -1 / +1
        // corner angle measured: tangent vectors along the two edges at the corner
        const kc = [ta, tb];
        const corner: V4 = (() => { const w = 1 / Math.sqrt(S === 'H3' ? 1 - kc[0] ** 2 - kc[1] ** 2 : 1 + kc[0] ** 2 + kc[1] ** 2); return [kc[0] * w, 0, kc[1] * w, w]; })();
        const toPt = (x: number, z: number): V4 => { const w = 1 / Math.sqrt(S === 'H3' ? 1 - x * x - z * z : 1 + x * x + z * z); return [x * w, 0, z * w, w]; };
        const e1 = tangent(S, corner, toPt(-ta, tb)), e2 = tangent(S, corner, toPt(ta, -tb));
        // tangent() is not the log map in general; use the true geodesic direction = dirTo
        const angle = Math.acos(dot(S, e1, e2));
        // edge is geodesic: midpoint of geodesic between corners (ta,tb),(ta,-tb) lies on x = ta*w
        const q1 = toPt(ta, tb), q2 = toPt(ta, -tb);
        const dd = dist(S, q1, q2), g = flow(S, q1, tangent(S, q1, q2), dd / 3).p;
        log(`[${S}] quad a=${a} b=${b}: corner angle measured ${angle.toFixed(6)} vs acos(${S === 'H3' ? 'sinh a sinh b' : '-sin a sin b'}) ${alpha.toFixed(6)}; area MC ${areaMC.toFixed(4)} vs Gauss-Bonnet ${areaGB.toFixed(4)}; geodesic edge residual x - tanh(a) w = ${(g[0] - ta * g[3]).toExponential(1)}`);
        // Disk: area MC vs closed form; uniform-area radius sampling CDF check
        const rho = 1.1, kr = S === 'H3' ? Math.tanh(rho) : Math.tan(rho);
        let ad = 0;
        for (let i = 0; i < M; i++) {
            const x = (2 * Rg() - 1) * kr, z = (2 * Rg() - 1) * kr, k2 = x * x + z * z;
            if (k2 <= kr * kr) ad += S === 'H3' ? Math.pow(1 - k2, -1.5) : Math.pow(1 + k2, -1.5);
        }
        const areaD = ad / M * 4 * kr * kr;
        const areaDc = S === 'H3' ? TWO_PI * (Math.cosh(rho) - 1) : TWO_PI * (1 - Math.cos(rho));
        log(`[${S}] disk rho=${rho}: area MC ${areaD.toFixed(4)} vs ${S === 'H3' ? '2pi(cosh rho - 1)' : '2pi(1 - cos rho)'} ${areaDc.toFixed(4)}`);
    }
}

// ===================== TUBE (capped cylinder) about the y-axis geodesic =====================
// radial distance rho(p): H3 asinh(|p_xz|);  S3 atan(|p_xz|, |p_yw|)
// axial coordinate s(p):  H3 atanh(p_y/p_w);  S3 atan(p_y, p_w)
function tubeRadial(S: Space, p: V4) {
    const pxz = Math.hypot(p[0], p[2]);
    return S === 'H3' ? Math.asinh(pxz) : Math.atan2(pxz, Math.hypot(p[1], p[3]));
}
function capSdf(S: Space, p: V4, h: number) {
    // signed distance to the plane perpendicular to the axis at axial |s| = h (outside > 0)
    const y = Math.abs(p[1]);
    return S === 'H3' ? Math.asinh(y * Math.cosh(h) - p[3] * Math.sinh(h)) : Math.asin(Math.max(-1, Math.min(1, y * Math.cos(h) - p[3] * Math.sin(h))));
}
function cappedTubeSdf(S: Space, p: V4, r: number, h: number) {
    return Math.max(tubeRadial(S, p) - r, capSdf(S, p, h));
}
// tube surface roots (all in (0, Tmax))
function tubeRoots(S: Space, p: V4, v: V4, r: number): number[] {
    const Px = p[0], Pz = p[2], Vx = v[0], Vz = v[2];
    if (S === 'H3') {
        // (A x + B/x)^2 + (C x + D/x)^2 = sinh^2 r, x = e^t  ->  al y^2 + (2be - S2) y + ga = 0, y = e^{2t}
        const A = (Px + Vx) / 2, B = (Px - Vx) / 2, C = (Pz + Vz) / 2, D = (Pz - Vz) / 2;
        const al = A * A + C * C, be = A * B + C * D, ga = B * B + D * D, S2 = Math.sinh(r) ** 2;
        const bb = 2 * be - S2;
        const disc = bb * bb - 4 * al * ga;
        if (disc < 0 || al === 0) return [];
        const q = -0.5 * (bb + Math.sign(bb || 1) * Math.sqrt(disc));
        const ys = [q / al, ga / q];
        return ys.filter(y => y > 1).map(y => 0.5 * Math.log(y)).sort((x, y) => x - y);
    }
    const P2 = Px * Px + Pz * Pz, V2 = Vx * Vx + Vz * Vz, PV = Px * Vx + Pz * Vz;
    const Mm = (P2 + V2) / 2, c2 = (P2 - V2) / 2, Am = Math.hypot(c2, PV), psi = Math.atan2(PV, c2);
    if (Am === 0) return [];
    const c0 = (Math.sin(r) ** 2 - Mm) / Am;
    if (c0 >= 1 || c0 <= -1) return [];
    const b0 = Math.acos(c0);
    const out: number[] = [];
    for (const base of [(psi + b0) / 2, (psi - b0) / 2]) {
        const t0 = mod(base, Math.PI);
        for (const t of [t0, t0 + Math.PI]) if (t > 0) out.push(t);
    }
    return out.sort((x, y) => x - y);
}
// CSG first crossing: roots of each boundary piece, kept when the point lies in the other piece.
function cappedTubeHit(S: Space, p: V4, v: V4, r: number, h: number): number | null {
    const cands: number[] = [];
    for (const t of tubeRoots(S, p, v, r)) { const q = flow(S, p, v, t).p; if (capSdf(S, q, h) <= 1e-12) cands.push(t); }
    for (const sgn of [1, -1]) {
        const N: V4 = S === 'H3' ? [0, sgn * Math.cosh(h), 0, Math.sinh(h)] : [0, sgn * Math.cos(h), 0, -Math.sin(h)];
        // <x,N> in the space's own form: H3: x_y N_y - x_w N_w ; S3: x_y N_y + x_w N_w
        for (const t of planeRoots(S, dot(S, p, N), dot(S, v, N))) {
            const q = flow(S, p, v, t).p;
            if (tubeRadial(S, q) - r <= 1e-12 && Math.sign(q[1]) === sgn) cands.push(t);
        }
    }
    return cands.length ? Math.min(...cands) : null;
}
{
    const Rg = rng(3);
    for (const S of ['H3', 'S3'] as Space[]) {
        const r = 0.5, h = 0.7;
        // SDF exactness of the radial term vs brute distance to the axis; thurston's acosh form for comparison
        let eRad = 0, eTh = 0;
        for (let i = 0; i < 2000; i++) {
            const p = pointAt(S, randDir(Rg), 2.5 * Rg());
            let m = Infinity;
            // distance to the axis geodesic: minimise over s, golden-section on a dense scan
            for (let k = 0; k <= 4000; k++) { const s = -4 + 8 * k / 4000; m = Math.min(m, dist(S, p, [0, sh(S, s), 0, ch(S, s)])); }
            eRad = Math.max(eRad, Math.abs(tubeRadial(S, p) - m));
            if (S === 'H3') eTh = Math.max(eTh, Math.abs(Math.acosh(Math.sqrt(p[3] ** 2 - p[1] ** 2)) - m));
        }
        // capped-tube SDF: never overestimates; exact inside
        let over = 0, inErr = 0;
        const surfs: [(u: number[]) => V4, [number, number][]][] = [
            [u => { const s = u[1]; const e: V4 = [Math.cos(u[0]), 0, Math.sin(u[0]), 0]; const ax: V4 = [0, sh(S, s), 0, ch(S, s)];
                    const nrm = tangent(S, ax, e); return flow(S, ax, nrm, r).p; }, [[0, TWO_PI], [-h, h]]],
            ...[1, -1].map(sg => [(u: number[]) => { const ax: V4 = [0, sg * sh(S, h), 0, ch(S, h)]; const e: V4 = [Math.cos(u[0]), 0, Math.sin(u[0]), 0];
                    return flow(S, ax, tangent(S, ax, e), u[1]).p; }, [[0, TWO_PI], [0, r]]] as [(u: number[]) => V4, [number, number][]]),
        ];
        for (let i = 0; i < 80; i++) {
            const p = pointAt(S, randDir(Rg), 1.6 * Rg());
            const bd = Math.min(...surfs.map(([f, rg]) => bruteDist(S, p, f, 2, rg, Rg)));
            const sd = cappedTubeSdf(S, p, r, h);
            if (sd > 0) over = Math.max(over, sd - bd); else inErr = Math.max(inErr, Math.abs(-sd - bd));
        }
        // closed form (CSG roots) vs brute
        let mism = 0, eT = 0, hits = 0;
        for (let i = 0; i < 400; i++) {
            const { p, v } = randomRay(S, Rg, 0.05, 2, 0.8);
            const tc = cappedTubeHit(S, p, v, r, h);
            const tb = bruteFirstRoot(t => cappedTubeSdf(S, flow(S, p, v, t).p, r, h), 1e-9, S === 'H3' ? 8 : TWO_PI, 40000);
            if ((tc === null) !== (tb === null)) { mism++; continue; }
            if (tc !== null) { hits++; eT = Math.max(eT, Math.abs(tc - tb!)); }
        }
        log(`[${S}] tube r=${r} h=${h}: radial ${S === 'H3' ? 'asinh(|p_xz|)' : 'atan(|p_xz|,|p_yw|)'} vs brute axis distance max diff ${eRad.toExponential(1)}${S === 'H3' ? `, thurston acosh(sqrt(w^2-y^2)) diff ${eTh.toExponential(1)}` : ''}; capped SDF overestimate max ${over.toExponential(1)} (<=0 good), inside |err| ${inErr.toExponential(1)}; hit CSG-roots vs brute ${hits} hits ${mism} mismatches max|dt| ${eT.toExponential(1)}`);
    }
}

// ===================== BOX = three slabs (Klein / gnomonic box with half-widths tanh h_i / tan h_i) =====================
function boxFaceN(S: Space, i: number, sg: number, h: number): V4 {
    const N: V4 = [0, 0, 0, 0];
    N[i] = sg * ch(S, h); N[3] = S === 'H3' ? Math.sinh(h) : -Math.sin(h);
    return N; // outside where <x,N> > 0
}
function boxSdf(S: Space, p: V4, H: number[]) {
    let m = -Infinity;
    for (let i = 0; i < 3; i++) for (const sg of [1, -1]) m = Math.max(m, ash(S, dot(S, p, boxFaceN(S, i, sg, H[i]))));
    return m;
}
function boxHitCSG(S: Space, p: V4, v: V4, H: number[]) {
    const c: number[] = [];
    for (let i = 0; i < 3; i++) for (const sg of [1, -1]) {
        const N = boxFaceN(S, i, sg, H[i]);
        for (const t of planeRoots(S, dot(S, p, N), dot(S, v, N))) {
            const q = flow(S, p, v, t).p;
            let ok = true;
            for (let j = 0; j < 3; j++) for (const s2 of [1, -1]) if (!(j === i && s2 === sg) && dot(S, q, boxFaceN(S, j, s2, H[j])) > 1e-12) ok = false;
            if (ok) c.push(t);
        }
    }
    return c.length ? Math.min(...c) : null;
}
// H3 slab method in tau = tanh t (monotone): Klein coordinates k_i(tau) = (P_i + V_i tau)/(p_w + v_w tau)
function boxHitH3Slab(p: V4, v: V4, H: number[]) {
    let lo = 0, hi = 1;   // tau in [0,1): t >= 0
    for (let i = 0; i < 3; i++) {
        const k = Math.tanh(H[i]);
        // |P_i + V_i tau| <= k (p_w + v_w tau)  <=>  two linear inequalities in tau
        for (const sg of [1, -1]) {
            const A = sg * v[i] - k * v[3], B = sg * p[i] - k * p[3];   // A tau + B <= 0
            if (Math.abs(A) < 1e-300) { if (B > 0) return null; continue; }
            const tau = -B / A;
            if (A > 0) hi = Math.min(hi, tau); else lo = Math.max(lo, tau);
        }
    }
    if (lo > hi) return null;
    const inside = boxSdf('H3', p, H) < 0;
    const tau = inside ? hi : lo;
    if (!(tau > 0 && tau < 1)) return null;
    return Math.atanh(tau);
}
{
    const Rg = rng(4);
    for (const S of ['H3', 'S3'] as Space[]) {
        const H = [0.6, 0.4, 0.5];
        let mism = 0, mismS = 0, eT = 0, eS = 0, hits = 0;
        for (let i = 0; i < 400; i++) {
            const { p, v } = randomRay(S, Rg, 0.05, 2, 0.8);
            const tb = bruteFirstRoot(t => boxSdf(S, flow(S, p, v, t).p, H), 1e-9, S === 'H3' ? 8 : TWO_PI, 40000);
            const tc = boxHitCSG(S, p, v, H);
            if ((tc === null) !== (tb === null)) mism++; else if (tc !== null) { hits++; eT = Math.max(eT, Math.abs(tc - tb!)); }
            if (S === 'H3') {
                const ts = boxHitH3Slab(p, v, H);
                if ((ts === null) !== (tb === null)) mismS++; else if (ts !== null) eS = Math.max(eS, Math.abs(ts - tb!));
            }
        }
        // SDF never overestimates: compare with brute distance to the 6 faces (face = plane piece inside the other slabs)
        let over = 0, inErr = 0;
        for (let i = 0; i < 40; i++) {
            const p = pointAt(S, randDir(Rg), 1.5 * Rg());
            let bd = Infinity;
            for (let f = 0; f < 3; f++) for (const sg of [1, -1]) {
                const kk = H.map(x => S === 'H3' ? Math.tanh(x) : Math.tan(x));
                const surf = (u: number[]) => { const k = [0, 0, 0]; k[f] = sg * kk[f]; const o1 = (f + 1) % 3, o2 = (f + 2) % 3; k[o1] = u[0]; k[o2] = u[1];
                    const w = 1 / Math.sqrt(S === 'H3' ? 1 - k[0] ** 2 - k[1] ** 2 - k[2] ** 2 : 1 + k[0] ** 2 + k[1] ** 2 + k[2] ** 2); return [k[0] * w, k[1] * w, k[2] * w, w] as V4; };
                bd = Math.min(bd, bruteDist(S, p, surf, 2, [[-kk[(f + 1) % 3], kk[(f + 1) % 3]], [-kk[(f + 2) % 3], kk[(f + 2) % 3]]], Rg));
            }
            const sd = boxSdf(S, p, H);
            if (sd > 0) over = Math.max(over, sd - bd); else inErr = Math.max(inErr, Math.abs(-sd - bd));
        }
        const cornerK2 = H.reduce((s, x) => s + Math.tanh(x) ** 2, 0);
        log(`[${S}] box H=${H}: CSG roots vs brute ${hits} hits ${mism} mismatches max|dt| ${eT.toExponential(1)}${S === 'H3' ? `; Klein slab (tau=tanh t) ${mismS} mismatches max|dt| ${eS.toExponential(1)}; corner |k|^2=${cornerK2.toFixed(3)} (<1 needed)` : ''}; SDF overestimate max ${over.toExponential(1)}, inside |err| ${inErr.toExponential(1)}`);
    }
}

// ===================== TORUS: tube of radius r about the circle of radius R in the xz-plane =====================
function torusSdf(S: Space, p: V4, R: number, r: number) {
    const pxz = Math.hypot(p[0], p[2]);
    const c = S === 'H3' ? p[3] * Math.cosh(R) - Math.sinh(R) * pxz : p[3] * Math.cos(R) + Math.sin(R) * pxz;
    return (S === 'H3' ? Math.acosh(Math.max(1, c)) : Math.acos(Math.max(-1, Math.min(1, c)))) - r;
}
{
    const Rg = rng(5);
    for (const S of ['H3', 'S3'] as Space[]) {
        const R = 1.0, r = 0.3;
        let e = 0;
        for (let i = 0; i < 300; i++) {
            const p = pointAt(S, randDir(Rg), 2.2 * Rg());
            let m = Infinity;
            for (let k = 0; k < 20000; k++) { const th = TWO_PI * k / 20000; m = Math.min(m, dist(S, p, pointAt(S, [Math.cos(th), 0, Math.sin(th)], R))); }
            e = Math.max(e, Math.abs(torusSdf(S, p, R, r) + r - m));
        }
        // the march bound: the torus lies inside the capped tube of radius R + r and half-height r
        let viol = 0;
        for (let i = 0; i < 20000; i++) {
            const th = TWO_PI * Rg();
            const c = pointAt(S, [Math.cos(th), 0, Math.sin(th)], R);
            const q = flow(S, c, tangent(S, c, [...randDir(Rg), 0] as V4), r * Rg()).p;
            if (cappedTubeSdf(S, q, R + r, r) > 1e-12) viol++;
        }
        log(`[${S}] torus R=${R} r=${r}: SDF vs brute distance to the core circle max diff ${e.toExponential(1)}; points of the solid torus outside the capped-tube bound (R+r, r): ${viol}/20000`);
    }
    // f32 of the torus SDF near a thin tube: acosh/acos form vs chord form 2 asinh(|p-c|_M/2) / 2 asin(|p-c|/2)
    for (const S of ['H3', 'S3'] as Space[]) for (const r of [0.3, 0.01]) {
        const R = 1.0; let eA = 0, eB = 0;
        for (let i = 0; i < 20000; i++) {
            const th = TWO_PI * Rg();
            const c = pointAt(S, [Math.cos(th), 0, Math.sin(th)], R);
            const rr = r + (Rg() - 0.5) * 2e-3 * r;
            // displacement direction perpendicular to the circle
            let w = tangent(S, c, [...randDir(Rg), 0] as V4);
            const tang = tangent(S, c, [-Math.sin(th), 0, Math.cos(th), 0]);
            w = tangent(S, c, lin(w, 1, tang, -dot(S, w, tang)));
            const q = flow(S, c, w, rr).p.map(F) as V4;
            const pxz = f32.sqrt(F(F(q[0] * q[0]) + F(q[2] * q[2])));
            const CR = F(ch(S, R)), SR = F(sh(S, R));
            const cc = S === 'H3' ? F(F(q[3] * CR) - F(SR * pxz)) : F(F(q[3] * CR) + F(SR * pxz));
            const dA = S === 'H3' ? f32.acosh(Math.max(1, cc)) : F(Math.acos(Math.min(1, cc)));
            // chord: c* = nearest circle point (sinh R e, 0, cosh R) with e = p_xz/|p_xz|
            const ex = F(q[0] / pxz), ez = F(q[2] / pxz);
            const dx = F(q[0] - F(SR * ex)), dy = q[1], dz = F(q[2] - F(SR * ez)), dw = F(q[3] - CR);
            const m2 = S === 'H3' ? F(F(F(F(dx * dx) + F(dy * dy)) + F(dz * dz)) - F(dw * dw)) : F(F(F(F(dx * dx) + F(dy * dy)) + F(dz * dz)) + F(dw * dw));
            const dB = S === 'H3' ? F(2 * f32.asinh(F(f32.sqrt(Math.max(0, m2)) / 2))) : F(2 * F(Math.asin(F(f32.sqrt(m2) / 2))));
            eA = Math.max(eA, Math.abs(dA - rr)); eB = Math.max(eB, Math.abs(dB - rr));
        }
        log(`[${S}] torus f32 near surface (R=1, r=${r}): ${S === 'H3' ? 'acosh' : 'acos'} form err ${eA.toExponential(1)} (${(eA / r).toExponential(1)} r) | chord form err ${eB.toExponential(1)} (${(eB / r).toExponential(1)} r)`);
    }
}
