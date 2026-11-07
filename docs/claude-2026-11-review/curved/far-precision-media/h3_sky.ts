// H3 sky: the ideal-point key, the direction toward an ideal point, and the solid-angle
// Jacobian between the visual sphere at x and the sky table (the visual sphere at the origin).
import { V, mink, add, sub, scale, n3, norm3, dot3, ang3, rng, unit3, hPoint, hBoost, hFlow, hKey,
    hDirToIdeal, f } from './lib.ts';

const r = rng(12345);
const out = (s: string) => console.log(s);

// 1. Key: Klein point of gamma(t) -> (p+v).xyz/(p+v).w, which is a unit vector; p+v is null.
{
    let worstNull = 0, worstUnit = 0, worstConv: number[] = [0, 0, 0];
    const ts = [5, 10, 20];
    for (let k = 0; k < 2000; k++) {
        const D = 4 * r();
        const p = hPoint(unit3(r), D);
        const v = hBoost(p)([...unit3(r), 0]);
        const pv = add(p, v);
        worstNull = Math.max(worstNull, Math.abs(mink(pv, pv)) / (pv[3] * pv[3]));
        const kl = [pv[0]/pv[3], pv[1]/pv[3], pv[2]/pv[3]];
        worstUnit = Math.max(worstUnit, Math.abs(n3(kl) - 1));
        ts.forEach((t, i) => {
            const g = hFlow(p, v, t);
            const gk = [g[0]/g[3], g[1]/g[3], g[2]/g[3]];
            worstConv[i] = Math.max(worstConv[i], ang3(gk, kl));
        });
    }
    out(`[1] key: max |<p+v,p+v>|/w^2 = ${worstNull.toExponential(2)}; max ||Klein(p+v)|-1| = ${worstUnit.toExponential(2)}`);
    out(`    angle(Klein(gamma(t)), Klein(p+v)) max over 2000 rays, D<4: t=5 ${worstConv[0].toExponential(2)}, t=10 ${worstConv[1].toExponential(2)}, t=20 ${worstConv[2].toExponential(2)}`);
    // At the origin the key is the view direction.
    const u = unit3(r); const ko = hKey([0,0,0,1], [...u, 0]);
    out(`    at the origin: angle(key, view dir) = ${ang3(ko, u).toExponential(2)}`);
}

// 2. Direction toward an ideal point: unit, tangent, and its key is the ideal point back.
{
    let wN = 0, wT = 0, wK = 0;
    for (let k = 0; k < 2000; k++) {
        const p = hPoint(unit3(r), 4 * r());
        const xi = unit3(r);
        const w = hDirToIdeal(p, xi);
        wN = Math.max(wN, Math.abs(mink(w, w) - 1));
        wT = Math.max(wT, Math.abs(mink(w, p)));
        wK = Math.max(wK, ang3(hKey(p, w), xi));
    }
    out(`[2] dirToIdeal: max |<w,w>-1| = ${wN.toExponential(2)}, max |<w,p>| = ${wT.toExponential(2)}, max angle(key(p,w), xi) = ${wK.toExponential(2)}`);
}

// 3. Jacobian: dOmega_o / dOmega_x = 1/((p+w).w)^2 = (-<p, xh>)^2 at the ideal point xh=(xi,1).
//    Finite differences: map a tiny triangle of directions at x to keys, compare spherical areas.
{
    const triArea = (a: number[], b: number[], c: number[]) => {
        // spherical triangle area (Van Oosterom–Strackee)
        const num = Math.abs(dot3(a, [b[1]*c[2]-b[2]*c[1], b[2]*c[0]-b[0]*c[2], b[0]*c[1]-b[1]*c[0]]));
        const den = 1 + dot3(a, b) + dot3(b, c) + dot3(c, a);
        return 2 * Math.atan2(num, den);
    };
    let worstRel = 0;
    for (let k = 0; k < 500; k++) {
        const D = 3 * r();
        const p = hPoint(unit3(r), D);
        const B = hBoost(p);
        const a0 = unit3(r);
        // small triangle at x in the origin-frame parametrization (boost is an isometry, so
        // spherical areas of a0-triangles = solid angles at x)
        const e = 1e-5;
        const up = Math.abs(a0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const b1 = norm3([up[1]*a0[2]-up[2]*a0[1], up[2]*a0[0]-up[0]*a0[2], up[0]*a0[1]-up[1]*a0[0]]);
        const b2 = [a0[1]*b1[2]-a0[2]*b1[1], a0[2]*b1[0]-a0[0]*b1[2], a0[0]*b1[1]-a0[1]*b1[0]];
        const t1 = norm3([a0[0] + e*b1[0], a0[1] + e*b1[1], a0[2] + e*b1[2]]);
        const t2 = norm3([a0[0] + e*b2[0], a0[1] + e*b2[1], a0[2] + e*b2[2]]);
        const areaX = triArea(a0, t1, t2);
        const keys = [a0, t1, t2].map((a) => hKey(p, B([...a, 0])));
        const areaO = triArea(keys[0], keys[1], keys[2]);
        const w = B([...a0, 0]);
        const pred = 1 / ((p[3] + w[3]) ** 2);
        worstRel = Math.max(worstRel, Math.abs(areaO / areaX / pred - 1));
    }
    out(`[3] Jacobian dOmega_o/dOmega_x vs 1/((p+w).w)^2: max relative deviation (FD, e=1e-5, centroid-free, 500 cases, D<3) = ${worstRel.toExponential(2)}`);
}

// 4. Monte Carlo: the converted pdf integrates to 1 over the visual sphere at x.
//    pdf_x(w) = pdf_o(key(p,w)) / ((p+w).w)^2. Two table pdfs: uniform, and a peaked one.
{
    const peaked = (xi: number[]) => { const c = 3 / (4 * Math.PI); return c * Math.max(0, xi[2]) * 2 * 2 / 2 * 0 + (Math.exp(4 * xi[2]) * 4 / (2 * Math.PI * (Math.exp(4) - Math.exp(-4)))); };
    for (const D of [0, 1, 2, 3]) {
        const p = hPoint([1, 0, 0], D);
        const B = hBoost(p);
        let su = 0, sp = 0, su2 = 0; const N = 1000000;
        for (let k = 0; k < N; k++) {
            const a = unit3(r); const w = B([...a, 0]);      // uniform over dOmega_x, pdf 1/(4 pi)
            const xi = hKey(p, w); const J = 1 / ((p[3] + w[3]) ** 2);
            su += J; su2 += J * J;
            sp += peaked(xi) * J * 4 * Math.PI;
        }
        out(`[4] D=${D}: E_unif[4pi * pdf_x] uniform table = ${(su / N).toFixed(4)}, peaked table = ${(sp / N).toFixed(4)} (expect 1; std err uniform ${Math.sqrt((su2 / N - (su / N) ** 2) / N).toExponential(1)})`);
    }
    // The weight spread for a constant sky sampled through the origin table at x:
    for (const D of [1, 2, 3, 4]) out(`    D=${D}: J ranges over [e^{-2D}, e^{2D}] = [${Math.exp(-2*D).toExponential(1)}, ${Math.exp(2*D).toExponential(1)}]`);
}

// 5. float32 accuracy of the key normalize((p+v).xyz) for float32-stored (p, v).
{
    const F = (a: V) => a.map(f);
    for (const D of [0, 1, 2, 4, 6, 8]) {
        let worst = 0, worstBack = 0;
        for (let k = 0; k < 4000; k++) {
            const u = unit3(r);
            const p = hPoint(u, D);
            // half the rays random, half pointing nearly back at the origin (the cancelling case)
            const a = k % 2 === 0 ? unit3(r) : norm3([-u[0] + 0.05*(r()-0.5), -u[1] + 0.05*(r()-0.5), -u[2] + 0.05*(r()-0.5)]);
            const v = hBoost(p)([...a, 0]);
            const exact = hKey(p, v);
            const pf = F(p), vf = F(v);
            const s = [f(pf[0] + vf[0]), f(pf[1] + vf[1]), f(pf[2] + vf[2])];
            const e = ang3(s, exact);
            if (k % 2 === 0) worst = Math.max(worst, e); else worstBack = Math.max(worstBack, e);
        }
        out(`[5] float32 key, ray origin at D=${D}: max angle error random dirs ${worst.toExponential(2)} rad, dirs toward the origin ${worstBack.toExponential(2)} rad`);
    }
}

// 6. Deterministic quadrature (Fibonacci sphere at x): (1/4pi) * integral of J dOmega_x = 1, and
//    integral of pdf_o(key) J dOmega_x = 1 for the peaked table.
{
    const peaked = (xi: number[]) => Math.exp(4 * xi[2]) * 4 / (2 * Math.PI * (Math.exp(4) - Math.exp(-4)));
    const N = 2000000, ga = Math.PI * (3 - Math.sqrt(5));
    for (const D of [0, 1, 2, 3, 4]) {
        const p = hPoint(norm3([1, 0.3, -0.2]), D); const B = hBoost(p);
        let su = 0, sp = 0;
        for (let i = 0; i < N; i++) {
            const z = 1 - (2 * i + 1) / N, s = Math.sqrt(1 - z * z), ph = ga * i;
            const w = B([s * Math.cos(ph), s * Math.sin(ph), z, 0]);
            const J = 1 / ((p[3] + w[3]) ** 2);
            su += J; sp += peaked(hKey(p, w)) * J;
        }
        out(`[6] D=${D}: quadrature (1/4pi) int J dOmega_x = ${(su / N).toFixed(6)}; int pdf_o J dOmega_x = ${(sp / N * 4 * Math.PI).toFixed(6)}`);
    }
}
