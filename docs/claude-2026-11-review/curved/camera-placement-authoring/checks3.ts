// float64 conditioning of the two camera-frame constructions vs distance (H3), and a
// re-orthonormalized target-centered frame (Gram-Schmidt under the form at P = expO(pos)).
import { type V3, type V4, form, expO, cameraOriginCentered, cameraTargetCentered } from './space.ts';
const s = 'H' as const;
const orthErr = (c: { P: V4; F: V4; R: V4; U: V4 }) => {
    const vs = [c.F, c.R, c.U]; let e = 0;
    for (let i = 0; i < 3; i++) { e = Math.max(e, Math.abs(form(s, vs[i], c.P))); for (let j = 0; j < 3; j++) e = Math.max(e, Math.abs(form(s, vs[i], vs[j]) - (i === j ? 1 : 0))); }
    return e;
};
const gs = (c: { P: V4; F: V4; R: V4; U: V4 }) => {
    const P = c.P; const proj = (v: V4, onto: V4, sign: number) => { const k = form(s, v, onto) * sign; return v.map((x, i) => x - k * onto[i]) as V4; };
    const nrm = (v: V4) => { const l = Math.sqrt(form(s, v, v)); return v.map((x) => x / l) as V4; };
    let F = nrm(proj(c.F, P, -1));            // <P,P> = -1 so the projection sign flips
    let U = nrm(proj(proj(c.U, P, -1), F, 1));
    let R = nrm(proj(proj(proj(c.R, P, -1), F, 1), U, 1));
    return { P, F, R, U };
};
for (const dc of [2, 4, 6, 8, 10, 12]) {
    const pos: V3 = [dc, 0, 0], look: V3 = [dc + 1, 0.7, 0.3];
    const a = cameraOriginCentered(s, pos, look), b = cameraTargetCentered(s, pos, look);
    // re-orthonormalize b with P replaced by the exact expO(pos)
    const c = gs({ ...b, P: expO(s, pos) });
    // how far the cleaned F direction is from pointing at the target (angle, radians):
    const T = expO(s, look), P = c.P; const pt = form(s, P, T);
    const toT = T.map((x, i) => x + pt * P[i]) as V4; const l = Math.sqrt(form(s, toT, toT));
    const ang = Math.acos(Math.min(1, form(s, c.F, toT.map((x) => x / l) as V4)));
    console.log(`d=${dc}: origin-centered ${orthErr(a).toExponential(2)}  target-centered ${orthErr(b).toExponential(2)}  target-centered+GS ${orthErr(c).toExponential(2)} (F off-target ${ang.toExponential(1)} rad)`);
}
