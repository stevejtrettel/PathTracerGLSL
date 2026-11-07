// One uploaded mat4 Ginv (world->local) per curved placement: check that
//   local->world normal  G n  ==  J * ((J n) * Ginv)   (GLSL row-vector product v * M)
// so the normal needs no second matrix (the analogue of "quaternion conjugation is free").
import { type Space, type V4, type M4, J, mul, apply, isoInverse, placement } from './space.ts';
const rowMul = (v: V4, M: M4): V4 => [0, 1, 2, 3].map((j) => v[0] * M[j] + v[1] * M[4 + j] + v[2] * M[8 + j] + v[3] * M[12 + j]) as V4;
for (const s of ['H', 'S'] as Space[]) {
    let e = 0;
    for (let k = 0; k < 500; k++) {
        const g = placement(s, [Math.sin(k) * 2, Math.cos(3 * k), Math.sin(7 * k)], (() => { const q = [Math.sin(k), Math.cos(2 * k), Math.sin(5 * k), 1]; const l = Math.hypot(...q); return q.map((x) => x / l) as any; })());
        const Ginv = isoInverse(s, g);
        const n: V4 = [Math.sin(11 * k), Math.cos(13 * k), Math.sin(17 * k), Math.cos(19 * k)];
        const want = apply(g, n);
        const got = apply(J(s), rowMul(apply(J(s), n), Ginv));
        e = Math.max(e, ...want.map((x, i) => Math.abs(x - got[i]) / Math.max(1, Math.abs(x))));
        // and Ginv really inverts g
        const I = mul(Ginv, g); e = Math.max(e, ...I.map((x, i) => Math.abs(x - (i % 5 === 0 ? 1 : 0))));
    }
    console.log(`${s}3: normal via Ginv only, and Ginv*g = I: max rel err ${e.toExponential(2)}`);
}
