// H3 float32: overflow of cosh, positional error of flowed points vs a 4-coordinate
// fp_uncertainty, the far clip's shadow target (distance + re-aim), and what a clip cuts
// from a plane near its ideal boundary.
import { V, mink, add, sub, scale, n3, norm3, rng, unit3, hPoint, hBoost, hFlow, hDist, hDistAcosh,
    hRenorm, f } from './lib.ts';
const r = rng(777);
const out = (s: string) => console.log(s);

// float32 GLSL-like ops (correctly rounded each op: optimistic vs a real GPU)
const fcosh = (t: number) => f(Math.cosh(f(t)));
const fsinh = (t: number) => f(Math.sinh(f(t)));
const F = (a: V) => a.map(f);
const fflow = (p: V, v: V, t: number) => { const c = fcosh(t), s = fsinh(t); return p.map((x, i) => f(f(x * c) + f(v[i] * s))); };
const fmink = (a: V, b: V) => f(f(f(f(a[0]*b[0]) + f(a[1]*b[1])) + f(a[2]*b[2])) - f(a[3]*b[3]));

// 1. Overflow
{
    let t = 80; while (isFinite(fcosh(t))) t += 0.01;
    out(`[1] float32 cosh(t) overflows at t = ${t.toFixed(2)}; products cosh(t)*cosh(D) overflow at t + D ~ ${(t + Math.log(2) - 0).toFixed(1)} - ln(2)`);
}

// 2. Position error of a flowed point (float32) in arc length, vs fp_uncertainty using
//    max |coord| over xyz only and over xyzw.
{
    const REL = 3.0517578125e-5, ABS = 1.52587890625e-5;
    for (const D of [0, 1, 2, 3, 4, 5, 6, 8, 10]) {
        let worst = 0, worstRatio3 = 0, worstRatio4 = 0, fp4 = 0;
        for (let k = 0; k < 2000; k++) {
            const u = unit3(r);
            // the hit point is at distance ~D from the world origin: a ray from origin-ish point flows to it
            const p0 = hPoint(unit3(r), 0.5 * r());
            const v0 = hBoost(p0)([...unit3(r), 0]);
            // choose t so that the endpoint is near distance D (approx: t = D)
            const t = D;
            const exact = hFlow(p0, v0, t);
            const pf = fflow(F(p0), F(v0), t);
            const e = hDist(exact, hRenorm(pf));
            worst = Math.max(worst, e);
            const m3 = Math.max(Math.abs(pf[0]), Math.abs(pf[1]), Math.abs(pf[2]));
            const m4 = Math.max(m3, Math.abs(pf[3]));
            worstRatio3 = Math.max(worstRatio3, e / Math.max(ABS, REL * m3));
            worstRatio4 = Math.max(worstRatio4, e / Math.max(ABS, REL * m4));
            fp4 = Math.max(fp4, Math.max(ABS, REL * m4));
        }
        out(`[2] flowed point at ~D=${D} from origin: max arc error ${worst.toExponential(2)}; err/fp_unc(xyz) ${worstRatio3.toExponential(2)}; err/fp_unc(xyzw) ${worstRatio4.toExponential(2)}; fp_unc(xyzw) = ${fp4.toExponential(2)}`);
    }
}

// 3. Far clip T: the shadow target light_p = flow(x, w, T) in float32, then the walker's
//    remaining distance (stable asinh form, and acosh form) and the re-aimed direction.
{
    for (const D of [0, 2, 4]) for (const T of [10, 12, 20, 30, 40, 60]) {
        let wd = 0, wdA = 0, wAim = 0, nonfinite = 0;
        for (let k = 0; k < 500; k++) {
            const x = hPoint(unit3(r), D);
            const w = hBoost(x)([...unit3(r), 0]);
            const xf = F(x), wf = F(w);
            const L = fflow(xf, wf, T);
            if (!L.every(isFinite)) { nonfinite++; continue; }
            // distance in float32: stable form
            const dv = L.map((a, i) => f(a - xf[i]));
            const m = fmink(dv, dv);
            const dS = f(2 * Math.asinh(f(Math.sqrt(Math.max(0, m)) / 2)));
            const dA = f(Math.acosh(Math.max(1, f(-fmink(xf, L)))));
            if (!isFinite(dS) || !isFinite(dA)) { nonfinite++; continue; }
            wd = Math.max(wd, Math.abs(dS - T)); wdA = Math.max(wdA, Math.abs(dA - T));
            // re-aim: u = (q + c p)/sqrt(c^2 - 1), c = <p,q>
            const c = fmink(xf, L);
            const s = f(Math.sqrt(f(f(c * c) - 1)));
            const u = L.map((q, i) => f(f(q + f(c * xf[i])) / s));
            // angle between u and w measured in the tangent space at x: acos(<u,w>) with u renormalized
            const un = scale(add(u, scale(x, mink(u, x))), 1); const nu = Math.sqrt(Math.max(1e-300, mink(un, un)));
            const ang = Math.acos(Math.min(1, Math.max(-1, mink(un, w) / nu)));
            if (!isFinite(ang)) { nonfinite++; continue; }
            wAim = Math.max(wAim, ang);
        }
        out(`[3] x at D=${D}, clip T=${T}: |dist err| asinh-form ${wd.toExponential(2)}, acosh-form ${wdA.toExponential(2)}; re-aim angle err ${wAim.toExponential(2)} rad; nonfinite ${nonfinite}/500`);
    }
}

// 4. What a clip T removes near a plane's ideal boundary circle. Plane at distance h from x;
//    a ray at angle theta from the perpendicular hits at tanh t = tanh h / cos theta. Hits with
//    t > T lie in an angular band of width cos^-1(tanh h / tanh T) - cos^-1(tanh h).
{
    for (const h of [0.1, 1, 3]) for (const T of [6, 10, 12, 20]) {
        const band = Math.acos(Math.tanh(h) / Math.tanh(T)) - Math.acos(Math.tanh(h));
        out(`[4] plane at h=${h}, clip T=${T}: clipped band width ${band.toExponential(2)} rad (approx 2 sinh(h) e^-2T = ${(2 * Math.sinh(h) * Math.exp(-2 * T)).toExponential(2)})`);
    }
    // numeric confirmation of tanh t = tanh h / cos theta by flowing a ray to the plane z = h-plane
    const h = 1, th = 0.4;
    const x: V = [0, 0, 0, 1];
    const v: V = [Math.sin(th), 0, Math.cos(th), 0];
    // plane: totally geodesic, normal n = boost of (0,0,1,0) to distance h: points y with <y,n> = 0,
    // n = (0,0,cosh h, sinh h)
    const n: V = [0, 0, Math.cosh(h), Math.sinh(h)];
    const tt = Math.atanh(-mink(n, x) / mink(n, v));
    out(`    check: root tanh t = -<n,x>/<n,v> gives t=${tt.toFixed(9)}, formula gives ${Math.atanh(Math.tanh(h) / Math.cos(th)).toFixed(9)}`);
}

// 2b. Same flowed float32 points, two ways of putting them back on the hyperboloid:
//     radial (p / sqrt(-<p,p>), thurston's hypNormalize) vs keeping xyz and recomputing
//     w = sqrt(1 + |xyz|^2). Also the error of merely ROUNDING an exact point to float32.
{
    const wfix = (p: V): V => [p[0], p[1], p[2], Math.sqrt(1 + p[0]*p[0] + p[1]*p[1] + p[2]*p[2])];
    for (const D of [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12]) {
        let eRad = 0, eW = 0, eRound = 0, nanRad = 0;
        for (let k = 0; k < 2000; k++) {
            const p0 = hPoint(unit3(r), 0.5 * r());
            const v0 = hBoost(p0)([...unit3(r), 0]);
            const exact = hFlow(p0, v0, D);
            const pf = fflow(F(p0), F(v0), D);
            const rad = -mink(pf, pf) > 0 ? hDist(exact, hRenorm(pf)) : NaN;
            if (isNaN(rad)) nanRad++; else eRad = Math.max(eRad, rad);
            eW = Math.max(eW, hDist(exact, wfix(pf)));
            eRound = Math.max(eRound, hDist(exact, wfix(F(exact))));
        }
        const w = Math.cosh(D + 0.5);
        out(`[2b] D~${D}: arc err radial-renorm ${eRad.toExponential(2)} (${nanRad} not renormalizable), w-recompute ${eW.toExponential(2)}, rounding exact point ${eRound.toExponential(2)}; 2^-23*w = ${(w * 2 ** -23).toExponential(2)}, 2^-23*w^2 = ${(w * w * 2 ** -23).toExponential(2)}`);
    }
}
