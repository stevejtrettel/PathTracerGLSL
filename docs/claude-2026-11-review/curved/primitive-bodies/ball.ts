// Ball of radius R at the origin of H3 / S3: SDF forms and closed-form ray intersection,
// checked against brute force (f64) and in float32 emulation (naive vs robust forms).
import { V4, Space, O, dot, flow, dist, pointAt, tangent, frameAt, rng, randDir, bruteFirstRoot, lin, F, f32, r4 } from './lib.ts';

// ---- closed forms (f64) ----
export function ballSdf(S: Space, p: V4, R: number) {
    const P = Math.hypot(p[0], p[1], p[2]);
    return (S === 'H3' ? Math.asinh(P) : Math.atan2(P, p[3])) - R;
}

function cross2(p: V4, v: V4) {
    const cx = p[1] * v[2] - p[2] * v[1], cy = p[2] * v[0] - p[0] * v[2], cz = p[0] * v[1] - p[1] * v[0];
    return cx * cx + cy * cy + cz * cz;
}

// H3 robust: e^t quadratic (a+b)x^2 - 2Cx + (a-b) = 0, discriminant sinh^2R - |PxV|^2,
// a+b and a-b both formed without cancellation using (a+b)(a-b) = 1 + |PxV|^2.
export function ballHitH3(p: V4, v: V4, R: number): number | null {
    const a = p[3], b = v[3], C = Math.cosh(R), Sr = Math.sinh(R);
    const cr = cross2(p, v);
    const D = Sr * Sr - cr;
    if (D < 0) return null;
    const s = a + Math.abs(b), o = (1 + cr) / s;
    const apb = b >= 0 ? s : o, amb = b >= 0 ? o : s;
    const q = C + Math.sqrt(D);
    const x1 = q / apb, x0 = amb / q;
    const inside = Math.hypot(p[0], p[1], p[2]) < Sr;
    const t = Math.log(inside ? x1 : x0);
    return t > 0 ? t : null;
}

export function ballHitS3(p: V4, v: V4, R: number): number | null {
    const a = p[3], b = v[3];
    const cr = cross2(p, v);
    const D = Math.sin(R) ** 2 - cr;
    if (D < 0) return null;
    const phi = Math.atan2(b, a), al = Math.atan2(Math.sqrt(D), Math.cos(R));
    const inside = ballSdf('S3', p, R) < 0;
    const T = 2 * Math.PI;
    const m = (x: number) => x - T * Math.floor(x / T);
    const t = inside ? m(phi + al) : m(phi - al);
    return t > 0 ? t : null;
}

// ---- float32 emulations ----
function ballHitH3_f32_robust(p: V4, v: V4, R: number): number | null {
    const a = p[3], b = v[3], C = F(Math.cosh(R)), Sr = F(Math.sinh(R));
    const cx = F(F(p[1] * v[2]) - F(p[2] * v[1])), cy = F(F(p[2] * v[0]) - F(p[0] * v[2])), cz = F(F(p[0] * v[1]) - F(p[1] * v[0]));
    const cr = F(F(F(cx * cx) + F(cy * cy)) + F(cz * cz));
    const D = F(F(Sr * Sr) - cr);
    if (D < 0) return null;
    const s = F(a + Math.abs(b)), o = F(F(1 + cr) / s);
    const apb = b >= 0 ? s : o, amb = b >= 0 ? o : s;
    const q = F(C + f32.sqrt(D));
    const x1 = F(q / apb), x0 = F(amb / q);
    const P2 = F(F(F(p[0] * p[0]) + F(p[1] * p[1])) + F(p[2] * p[2]));
    const inside = P2 < F(Sr * Sr);
    const t = f32.log(inside ? x1 : x0);
    return t > 0 ? t : null;
}
function ballHitH3_f32_naive(p: V4, v: V4, R: number): number | null {
    const a = p[3], b = v[3], C = F(Math.cosh(R));
    const D = F(F(F(C * C) - F(a * a)) + F(b * b));
    if (D < 0) return null;
    const apb = F(a + b), amb = F(a - b), sq = f32.sqrt(D);
    const x1 = F(F(C + sq) / apb), x0 = F(F(C - sq) / apb);
    const inside = a < C;
    const t = f32.log(inside ? x1 : x0);
    return t > 0 ? t : null;
}
function ballHitS3_f32(p: V4, v: V4, R: number, robust: boolean): number | null {
    const a = p[3], b = v[3];
    let D: number;
    if (robust) {
        const cx = F(F(p[1] * v[2]) - F(p[2] * v[1])), cy = F(F(p[2] * v[0]) - F(p[0] * v[2])), cz = F(F(p[0] * v[1]) - F(p[1] * v[0]));
        const cr = F(F(F(cx * cx) + F(cy * cy)) + F(cz * cz));
        D = F(F(Math.sin(R) ** 2) - cr);
    } else {
        D = F(F(F(a * a) + F(b * b)) - F(Math.cos(R) ** 2));
    }
    if (D < 0) return null;
    const phi = F(Math.atan2(b, a)), al = F(Math.atan2(f32.sqrt(D), F(Math.cos(R))));
    const P = f32.sqrt(F(F(F(p[0] * p[0]) + F(p[1] * p[1])) + F(p[2] * p[2])));
    const inside = F(Math.atan2(P, a)) < F(R);
    const T = F(2 * Math.PI);
    const m = (x: number) => F(x - F(T * Math.floor(F(x / T))));
    const t = inside ? m(F(phi + al)) : m(F(phi - al));
    return t > 0 ? t : null;
}

// Rays from distance Dc toward the ball, angle from the centre direction in [lo,hi] x silhouette angle.
function makeRay(S: Space, R: number, Dc: number, Rg: () => number, lo: number, hi: number) {
    const p = pointAt(S, randDir(Rg), Dc);
    const d0 = tangent(S, p, lin(O, 1, p, 0)); // toward O
    const sinTh = S === 'H3' ? Math.sinh(R) / Math.sinh(Dc) : Math.sin(R) / Math.sin(Dc);
    const th = Math.asin(Math.min(1, sinTh));
    const ang = th * (lo + (hi - lo) * Rg());
    const fr = frameAt(S, p);
    // e1 perpendicular to d0
    let e = fr[0]; e = lin(e, 1, d0, -dot(S, e, d0)); e = tangent(S, p, e);
    let e2 = fr[1]; e2 = lin(e2, 1, d0, -dot(S, e2, d0)); e2 = lin(e2, 1, e, -dot(S, e2, e)); e2 = tangent(S, p, e2);
    const ph = 2 * Math.PI * Rg();
    const w = lin(lin(d0, Math.cos(ang), e, Math.sin(ang) * Math.cos(ph)), 1, e2, Math.sin(ang) * Math.sin(ph));
    return { p, v: tangent(S, p, w) };
}

// ---- 1. f64 closed form vs brute force ----
{
    const Rg = rng(7);
    for (const S of ['H3', 'S3'] as Space[]) {
        let maxErr = 0, mism = 0, n = 0, hits = 0;
        for (const R of [0.05, 0.5, 1.5]) for (const Dc of [0.02, 0.3, 1, 3, 2.5]) {
            if (S === 'H3' && Dc > 3) continue;
            for (let i = 0; i < 40; i++) {
                const { p, v } = makeRay(S, R, Dc, Rg, 0, 1.3);
                const T = S === 'H3' ? Dc + 2 * R + 1 : 2 * Math.PI;
                const g = (t: number) => ballSdf(S, flow(S, p, v, t).p, R);
                const tb = bruteFirstRoot(g, 1e-12, T, 40000);
                const tc = S === 'H3' ? ballHitH3(p, v, R) : ballHitS3(p, v, R);
                n++;
                if ((tb === null) !== (tc === null)) { mism++; continue; }
                if (tb !== null && tc !== null) { hits++; maxErr = Math.max(maxErr, Math.abs(tb - tc)); }
            }
        }
        console.log(`[${S}] closed-form vs brute: rays=${n} hits=${hits} hit/miss mismatches=${mism} max|dt|=${maxErr.toExponential(2)}`);
    }
    // SDF exactness: compare ballSdf with brute min distance to surface samples
    for (const S of ['H3', 'S3'] as Space[]) {
        let maxE = 0;
        const R = 0.7;
        for (let i = 0; i < 200; i++) {
            const p = pointAt(S, randDir(Rg), 2.5 * Rg());
            let m = Infinity;
            for (let k = 0; k < 4000; k++) m = Math.min(m, dist(S, p, pointAt(S, randDir(Rg), R)));
            const sd = ballSdf(S, p, R);
            maxE = Math.max(maxE, Math.abs(Math.abs(sd) - m));
        }
        console.log(`[${S}] ball SDF |sdf| vs brute min distance over 4000 surface samples: max diff ${maxE.toExponential(2)} (sampling-limited)`);
    }
}

// ---- 2. float32: robust vs naive, grazing rays ----
{
    console.log('\nfloat32 grazing rays (angle 0.9-1.1 x silhouette): wrong hit/miss %, and max hit-point error / R among agreeing hits');
    for (const S of ['H3', 'S3'] as Space[]) {
        for (const R of [1, 0.1, 0.01]) for (const Dc of S === 'H3' ? [1, 3, 6, 9] : [0.5, 1.5, 3.0]) {
            if (Dc <= R) continue;
            const Rg = rng(11);
            const st = { rob: { bad: 0, err: 0 }, nai: { bad: 0, err: 0 }, in64: { bad: 0, err: 0 } };
            const N = 4000;
            for (let i = 0; i < N; i++) {
                const { p, v } = makeRay(S, R, Dc, Rg, 0.9, 1.1);
                const ref = S === 'H3' ? ballHitH3(p, v, R) : ballHitS3(p, v, R);
                const pf = r4(p), vf = r4(v);
                const cands = S === 'H3'
                    ? { rob: ballHitH3_f32_robust(pf, vf, R), nai: ballHitH3_f32_naive(pf, vf, R) }
                    : { rob: ballHitS3_f32(pf, vf, R, true), nai: ballHitS3_f32(pf, vf, R, false) };
                (cands as any).in64 = S === 'H3' ? ballHitH3(pf, vf, R) : ballHitS3(pf, vf, R);
                for (const k of ['rob', 'nai', 'in64'] as const) {
                    const c = cands[k];
                    if ((c === null) !== (ref === null)) { st[k].bad++; continue; }
                    if (c !== null && ref !== null) {
                        const e = dist(S, flow(S, p, v, ref).p, flow(S, p, v, c).p) / R;
                        st[k].err = Math.max(st[k].err, e);
                    }
                }
            }
            console.log(`[${S}] R=${R} Dc=${Dc}: robust wrong=${(100 * st.rob.bad / N).toFixed(2)}% err/R=${st.rob.err.toExponential(1)} | naive wrong=${(100 * st.nai.bad / N).toFixed(2)}% err/R=${st.nai.err.toExponential(1)} | f64-robust-on-f32-inputs wrong=${(100 * st.in64.bad / N).toFixed(2)}% err/R=${st.in64.err.toExponential(1)}`);
        }
    }
}

// ---- 3. SDF forms in float32 near the surface: acosh(w)-R vs asinh(|P|)-R (H3); acos(w)-R vs atan(|P|,w)-R (S3)
{
    console.log('\nSDF near the surface in float32 (|sdf_f32 - sdf_exact|, max over points within 1e-3 of the surface):');
    const Rg = rng(3);
    for (const R of [1, 0.1, 0.01]) {
        let eA = 0, eB = 0, eC = 0, eD = 0;
        for (let i = 0; i < 20000; i++) {
            const r = R + (Rg() - 0.5) * 2e-3;
            const pH = r4(pointAt('H3', randDir(Rg), r)), pS = r4(pointAt('S3', randDir(Rg), r));
            const PH = f32.sqrt(F(F(F(pH[0] * pH[0]) + F(pH[1] * pH[1])) + F(pH[2] * pH[2])));
            const PS = f32.sqrt(F(F(F(pS[0] * pS[0]) + F(pS[1] * pS[1])) + F(pS[2] * pS[2])));
            eA = Math.max(eA, Math.abs(F(f32.acosh(pH[3]) - F(R)) - (r - R)));
            eB = Math.max(eB, Math.abs(F(f32.asinh(PH) - F(R)) - (r - R)));
            eC = Math.max(eC, Math.abs(F(F(Math.acos(pS[3])) - F(R)) - (r - R)));
            eD = Math.max(eD, Math.abs(F(F(Math.atan2(PS, pS[3])) - F(R)) - (r - R)));
        }
        console.log(`R=${R}: H3 acosh(w)-R err ${eA.toExponential(1)} | asinh(|P|)-R err ${eB.toExponential(1)} || S3 acos(w)-R err ${eC.toExponential(1)} | atan(|P|,w)-R err ${eD.toExponential(1)}`);
    }
}
