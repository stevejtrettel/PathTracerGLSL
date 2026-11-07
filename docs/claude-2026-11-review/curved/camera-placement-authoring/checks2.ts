// (a) Orbit = rotation about the target: G(az) == T_T Ry(az) T_T^-1 G(0) for the target-centered
//     frame (and not for the origin-centered one).
// (b) Frame orthonormality error vs distance, per up rule, float64 (conditioning of the model).
// (c) float32 upload: how wrong is the camera ray when P, F, R, U are rounded to float32 and the
//     pinhole direction is formed in float32, as a function of the camera's distance from the origin.
import {
    type Space, type V3, type V4, type M4, O, form, mul, apply, isoInverse,
    expO, transvection, rotationFromQuat, cameraOriginCentered, cameraTargetCentered, orbitPosition,
} from './space.ts';

const f = Math.fround;
const camMat = (c: { P: V4; F: V4; R: V4; U: V4 }): M4 => {
    // columns R, U, -F, P (camera looks down -z of its own frame, like three.js)
    const cols = [c.R, c.U, c.F.map((x) => -x) as V4, c.P];
    const M = new Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) M[4 * i + j] = cols[j][i]; return M;
};
const maxAbs = (a: number[], b: number[]) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));

for (const s of ['H', 'S'] as Space[]) {
    console.log(`\n=== ${s === 'H' ? 'H3' : 'S3'} ===`);
    const tgt: V3 = s === 'H' ? [3, 0.5, -1] : [1.2, 0.3, -0.4];
    const d = s === 'H' ? 2 : 0.8, el = 0.3;
    const TT = transvection(s, expO(s, tgt));
    for (const [name, rule] of [['target-centered', cameraTargetCentered], ['origin-centered', cameraOriginCentered]] as const) {
        const G0 = camMat(rule(s, orbitPosition(s, tgt, d, 0, el), tgt));
        let err = 0;
        for (let i = 1; i < 36; i++) {
            const az = (i / 36) * 2 * Math.PI;
            const Ry = rotationFromQuat([0, Math.sin(az / 2), 0, Math.cos(az / 2)]);
            const predicted = mul(TT, mul(Ry, mul(isoInverse(s, TT), G0)));
            const G = camMat(rule(s, orbitPosition(s, tgt, d, az, el), tgt));
            err = Math.max(err, maxAbs(G, predicted) / Math.max(...G.map(Math.abs)));
        }
        console.log(`orbit at fixed elevation is a rotation about the target's vertical (${name}): rel. err ${err.toExponential(2)}`);
    }

    // (b) + (c)
    const dists = s === 'H' ? [0, 1, 2, 4, 6, 8, 10, 12] : [0, 0.5, 1, 2, 3, 3.1];
    for (const dc of dists) {
        const pos: V3 = [dc, 0, 0];
        const look: V3 = s === 'H' ? [dc + 1, 0.7, 0.3] : [dc + 0.3, 0.2, 0.1];
        const c = cameraTargetCentered(s, pos, look);
        const vs = [c.F, c.R, c.U];
        let orth = 0;
        for (let i = 0; i < 3; i++) { orth = Math.max(orth, Math.abs(form(s, vs[i], c.P))); for (let j = 0; j < 3; j++) orth = Math.max(orth, Math.abs(form(s, vs[i], vs[j]) - (i === j ? 1 : 0))); }
        // float32 upload + float32 pinhole; then march t=1 along the geodesic in float32 and compare
        // the reached point with the float64 one by geodesic distance.
        let worst = 0;
        for (let k = 0; k < 200; k++) {
            const a = 2 * ((k * 0.6180339) % 1) - 1, b = 2 * ((k * 0.4142135) % 1) - 1;
            const kk = 1 / Math.sqrt(1 + a * a + b * b);
            const d64: V4 = [0, 1, 2, 3].map((i) => kk * (c.F[i] + a * c.R[i] + b * c.U[i])) as V4;
            const t = 1, ct = s === 'H' ? Math.cosh(t) : Math.cos(t), st = s === 'H' ? Math.sinh(t) : Math.sin(t);
            const q64: V4 = [0, 1, 2, 3].map((i) => ct * c.P[i] + st * d64[i]) as V4;
            const P32 = c.P.map(f), F32 = c.F.map(f), R32 = c.R.map(f), U32 = c.U.map(f);
            const kk32 = f(1 / Math.sqrt(f(1 + f(f(a * a) + f(b * b)))));
            const d32 = [0, 1, 2, 3].map((i) => f(kk32 * f(f(F32[i] + f(a * R32[i])) + f(b * U32[i]))));
            const q32 = [0, 1, 2, 3].map((i) => f(f(f(ct) * P32[i]) + f(f(st) * d32[i])));
            // geodesic distance between q32 and q64 (q32 renormalized onto the model first)
            const n = Math.sqrt(Math.abs(form(s, q32 as V4, q32 as V4)));
            const qn = q32.map((x) => x / n) as V4;
            const g = s === 'H' ? -form(s, qn, q64) : form(s, qn, q64);
            const dist = s === 'H' ? Math.acosh(Math.max(1, g)) : Math.acos(Math.min(1, g));
            worst = Math.max(worst, dist);
        }
        console.log(`camera at distance ${dc.toString().padEnd(4)}: frame orthonormality (f64) ${orth.toExponential(2)}; f32 ray point error at t=1: ${worst.toExponential(2)}`);
    }
}
