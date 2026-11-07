import {
    type Space, type V3, type V4, type M4, O, form, mul, apply, isoInverse, J, transpose,
    expO, logO, transvection, rotationFromQuat, placement, decompose,
    cameraOriginCentered, cameraTargetCentered, orbitPosition, orbitParams, flow,
} from './space.ts';

let rng = 12345;
const rand = () => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng / 2147483648; };
const randV = (r: number): V3 => [r * (2 * rand() - 1), r * (2 * rand() - 1), r * (2 * rand() - 1)];
const randQ = (): [number, number, number, number] => { const q = [rand() - .5, rand() - .5, rand() - .5, rand() - .5]; const l = Math.hypot(...q); return q.map((x) => x / l) as any; };
const maxAbs = (a: number[], b: number[]) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));
const isoErr = (s: Space, g: M4) => maxAbs(mul(transpose(g), mul(J(s), g)), J(s)); // g^T J g = J

function report(name: string, v: number) { console.log(`${name.padEnd(70)} ${v.toExponential(2)}`); }

for (const s of ['H', 'S'] as Space[]) {
    console.log(`\n=== ${s === 'H' ? 'H3' : 'S3'} ===`);
    const R = s === 'H' ? 4 : 1.7;   // S3: keep |v| < pi so exp/log are inverse
    let e1 = 0, e2 = 0, e3 = 0, e4 = 0, e5 = 0, e6 = 0, e7 = 0;
    for (let n = 0; n < 2000; n++) {
        const v = randV(R); const P = expO(s, v);
        e1 = Math.max(e1, Math.abs(form(s, P, P) - (s === 'H' ? -1 : 1)));
        e2 = Math.max(e2, maxAbs(logO(s, P), v));
        const T = transvection(s, P);
        e3 = Math.max(e3, isoErr(s, T));
        e4 = Math.max(e4, maxAbs(apply(T, O), P));
        // inverse transvection = transvection of the reflected point (-p, w)
        e5 = Math.max(e5, maxAbs(isoInverse(s, T), transvection(s, [-P[0], -P[1], -P[2], P[3]])));
        // T_P agrees with thurston's makeTranslationFromDir: I + sh M + (ch-1) M^2 (H3), the exp of the generator
        if (s === 'H') {
            const d = Math.hypot(...v); const u = v.map((x) => x / d);
            const M = [0, 0, 0, u[0], 0, 0, 0, u[1], 0, 0, 0, u[2], u[0], u[1], u[2], 0];
            const M2 = mul(M, M);
            const Th = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1].map((x, i) => x + Math.sinh(d) * M[i] + (Math.cosh(d) - 1) * M2[i]);
            e6 = Math.max(e6, maxAbs(Th, T) / Math.cosh(d));
        }
        // placement decomposition round-trip: compose two placements, decompose, rebuild
        const g = mul(placement(s, randV(R / 2), randQ()), placement(s, randV(R / 2), randQ()));
        const dcmp = decompose(s, g);
        const rebuilt = mul(transvection(s, expO(s, dcmp.position)), dcmp.R);
        const RR = dcmp.R; // must fix origin and be a rotation
        e7 = Math.max(e7, maxAbs(rebuilt, g) / Math.max(...g.map(Math.abs)), Math.abs(RR[15] - 1), Math.abs(RR[3]), Math.abs(RR[12]));
    }
    report('expO lands on the model (|<P,P> -/+ 1|)', e1);
    report('logO(expO(v)) = v', e2);
    report('transvection is an isometry (g^T J g = J)', e3);
    report('transvection(P) maps o to P', e4);
    report('inverse transvection = transvection(-p, w)', e5);
    if (s === 'H') report('transvection = thurston makeTranslationFromDir (rel.)', e6);
    report('compose two (T,R) placements -> decompose -> rebuild (rel.)', e7);

    // Camera frames: orthonormal tangent frame at P under the form
    let c1 = 0, c2 = 0, c3 = 0, c4 = 0, c5 = 0;
    for (let n = 0; n < 2000; n++) {
        const pos = randV(R), tgt = randV(R);
        for (const cam of [cameraOriginCentered(s, pos, tgt), cameraTargetCentered(s, pos, tgt)]) {
            const { P, F, R: Rt, U } = cam;
            const vs = [F, Rt, U];
            for (let i = 0; i < 3; i++) { c1 = Math.max(c1, Math.abs(form(s, vs[i], P))); for (let j = 0; j < 3; j++) c1 = Math.max(c1, Math.abs(form(s, vs[i], vs[j]) - (i === j ? 1 : 0))); }
            // F points at the target: flowing from P along F by dist(P,T) reaches T
            const T = expO(s, tgt);
            const dPT = s === 'H' ? Math.acosh(Math.max(1, -form(s, P, T))) : Math.acos(Math.min(1, form(s, P, T)));
            c2 = Math.max(c2, maxAbs(flow(s, P, F, dPT).P, T) / Math.max(1, Math.abs(T[3])));
            // pinhole: (F + a R + b U)/sqrt(1+a^2+b^2) is a unit tangent vector at P
            const a = 2 * rand() - 1, b = 2 * rand() - 1; const k = 1 / Math.sqrt(1 + a * a + b * b);
            const d: V4 = [0, 1, 2, 3].map((i) => k * (F[i] + a * Rt[i] + b * U[i])) as V4;
            c3 = Math.max(c3, Math.abs(form(s, d, d) - 1), Math.abs(form(s, d, P)));
            // fisheye: cos th F + sin th (tx R + ty U) is unit with no normalize
            const th = Math.PI * rand(), ph = 2 * Math.PI * rand();
            const df: V4 = [0, 1, 2, 3].map((i) => Math.cos(th) * F[i] + Math.sin(th) * (Math.cos(ph) * Rt[i] + Math.sin(ph) * U[i])) as V4;
            c4 = Math.max(c4, Math.abs(form(s, df, df) - 1));
        }
        // Orbit round trip
        const d = s === 'H' ? 0.2 + 5 * rand() : 0.2 + 2.5 * rand();
        const az = 2 * Math.PI * rand() - Math.PI, el = (Math.PI - 0.3) * (rand() - 0.5);
        const p = orbitPosition(s, tgt, d, az, el); const o = orbitParams(s, tgt, p);
        c5 = Math.max(c5, Math.abs(o.d - d), Math.abs(o.az - az), Math.abs(o.el - el));
    }
    report('camera frame orthonormal + tangent at P (both up rules)', c1);
    report('flow(P, F, dist(P,T)) reaches T (rel.)', c2);
    report('pinhole 4-direction unit + tangent', c3);
    report('fisheye 4-direction unit without normalize', c4);
    report('orbit (d,az,el) -> position -> (d,az,el) round trip', c5);

    // Holonomy: angle between the two up rules for an orbit around an off-origin target.
    const tgt: V3 = s === 'H' ? [3, 0, 0] : [1.2, 0, 0];
    const dist = s === 'H' ? 2 : 0.8;
    let worst = 0, worstAz = 0;
    for (let i = 0; i < 72; i++) {
        const az = (i / 72) * 2 * Math.PI; const pos = orbitPosition(s, tgt, dist, az, 0.3);
        const A = cameraOriginCentered(s, pos, tgt), B = cameraTargetCentered(s, pos, tgt);
        const ang = Math.acos(Math.max(-1, Math.min(1, form(s, A.U, B.U))));
        if (ang > worst) { worst = ang; worstAz = az; }
    }
    console.log(`roll between origin-centered and target-centered up, target ${JSON.stringify(tgt)}, orbit d=${dist}: max ${(worst * 180 / Math.PI).toFixed(2)} deg at az ${(worstAz * 180 / Math.PI).toFixed(0)} deg`);
}

// S3 transvection singularity near the antipode
for (const d of [Math.PI - 1e-2, Math.PI - 1e-4, Math.PI - 1e-6]) {
    const T = transvection('S', expO('S', [d, 0, 0]));
    console.log(`S3 transvection at distance pi-${(Math.PI - d).toExponential(0)}: isometry error ${isoErr('S', T).toExponential(2)}, max entry ${Math.max(...T.map(Math.abs)).toExponential(2)}`);
}
