// (c) connections p→q: unit directions and lengths; flow(p,u,len) = q.
// (e) parallel transport along the connecting geodesic vs RK-free checks; arrival velocity
//     = -(initial velocity of the reverse geodesic q→p).
import { mk, F64, F32, V, rng, randUnit3, fmt } from './common.ts';
import { E3 } from './e3.ts';
import { H3 } from './h3.ts';
import { S3 } from './s3.ts';
import { H2R } from './h2r.ts';

const u = rng(3);
const randTan = (S: any, p: V) => S.reduceVec(p, S.name === 'E3' ? randUnit3(u) : [...randUnit3(u), u() - 0.5]);

for (const prec of ['f64', 'f32'] as const) {
  const A = mk(prec === 'f64' ? F64 : F32);
  for (const S of [E3(A), H3(A), S3(A), H2R(A)] as any[]) {
    const seps = S.name === 'S3' ? [1e-3, 0.5, 2, 3.1] : [1e-3, 0.5, 2, 5];
    for (const sep of seps) {
      const w = { nconn: 0, unit: 0, tan: 0, hitq: 0, len: 0, arr: 0, ptNorm: 0, ptPQ: 0, ptAngle: 0, naiveU: 0 };
      for (let k = 0; k < 200; k++) {
        const p = S.reducePoint(S.pointAt(randUnit3(u), 0.5 * u()).map(A.r));
        const v0 = randTan(S, p);
        const q = S.reducePoint(S.flow(p, v0, sep).p);
        const cs = S.connections(p, q);
        w.nconn = Math.max(w.nconn, cs.length);
        // S3: first connection must be (v0, sep), second (-v0, 2π-sep)
        for (const [i, c] of cs.entries()) {
          w.unit = Math.max(w.unit, Math.abs(S.ip(c.u, c.u) - 1));
          if (S.name !== 'E3') w.tan = Math.max(w.tan, Math.abs(S.name === 'H2R' ? c.u[0] * p[0] + c.u[1] * p[1] - c.u[2] * p[2] : S.ip(c.u, p)));
          const hit = S.flow(p, c.u, c.len).p;
          w.hitq = Math.max(w.hitq, S.distance(hit, q));
          const expectLen = i === 0 ? sep : 2 * Math.PI - sep;
          w.len = Math.max(w.len, Math.abs(c.len - expectLen) / expectLen);
          // (e) arrival velocity vs reverse geodesic: the matching reverse connection from q
          const arrive = S.flow(p, c.u, c.len).v;
          const back = S.connections(q, p)[i].u;
          { // angle measured in float64: project a+b onto T_q, metric norm (a=-b exactly gives 0)
            const S64 = ({ E3, H3, S3, H2R } as any)[S.name](mk(F64));
            const qq = S64.reducePoint(q);
            const s = arrive.map((x: number, j: number) => x / Math.sqrt(S64.ip(arrive, arrive)) + back[j] / Math.sqrt(S64.ip(back, back)));
            const tq = S.name === 'E3' ? s : S.name === 'H2R' ? (() => { const h = s[0]*qq[0]+s[1]*qq[1]-s[2]*qq[2]; return [s[0]+h*qq[0], s[1]+h*qq[1], s[2]+h*qq[2], s[3]]; })() : s.map((x: number, j: number) => x - (S64.ip(s, qq) / S64.ip(qq, qq)) * qq[j]);
            w.arr = Math.max(w.arr, Math.sqrt(Math.max(0, S64.ip(tq, tq))));
          }
          // transport of a random tangent: norm preserved, angle to velocity preserved
          const x = randTan(S, p);
          const Tx = S.transport(p, c.u, c.len, x);
          w.ptNorm = Math.max(w.ptNorm, Math.abs(S.ip(Tx, Tx) - 1));
          w.ptAngle = Math.max(w.ptAngle, Math.abs(S.ip(Tx, arrive) - S.ip(x, c.u)));
          if (i === 0 && S.transportPQ) {
            const Tq = S.transportPQ(p, q, x);
            w.ptPQ = Math.max(w.ptPQ, Math.max(...Tq.map((y: number, j: number) => Math.abs(y - Tx[j]))));
          }
        }
        if (S.connectionsNaive) {
          const cn = S.connectionsNaive(p, q)[0];
          w.naiveU = Math.max(w.naiveU, Math.max(...cn.u.map((y: number, j: number) => Math.abs(y - v0[j]))));
        }
      }
      // compare first connection direction to v0 directly
      console.log(`${prec} ${S.name.padEnd(4)} sep=${String(sep).padEnd(5)} #geodesics=${w.nconn} |u|-1:${fmt(w.unit)} <u,p>:${fmt(w.tan)} d(flow,q):${fmt(w.hitq)} rel len err:${fmt(w.len)} angle(arrival,-reverse):${fmt(w.arr)} PT |.|-1:${fmt(w.ptNorm)} PT angle:${fmt(w.ptAngle)}` + (S.transportPQ ? ` PT(p,q) vs PT(u,L):${fmt(w.ptPQ)}` : '') + (S.connectionsNaive ? ` naive-u err:${fmt(w.naiveU)}` : ''));
    }
  }
}
// independent transport check: transport of the frame along a geodesic by small steps
// (Schild-free: project-and-renormalize each step, i.e. the Levi-Civita connection of the
// embedded hypersurface = tangential projection of the ambient derivative)
{
  const A = mk(F64);
  for (const S of [H3(A), S3(A)] as any[]) {
    const p = S.pointAt([0.3, -0.5, 0.81].map((x) => x / Math.sqrt(0.9961)), 0.4), c = S.reduceVec(p, [0.2, 0.7, -0.1, 0.3]);
    const x0 = S.reduceVec(p, [0.9, 0.1, 0.4, -0.2]);
    const L = 2, n = Number(process.env.N ?? 20000);
    let x = x0.slice();
    for (let k = 1; k <= n; k++) {
      const pk = S.flow(p, c, (k * L) / n).p;
      // project onto T_pk: x ± <x,pk>pk (sign from <pk,pk>)
      const s = S.ip(pk, pk);
      x = x.map((xi: number, i: number) => xi - (S.ip(x, pk) / s) * pk[i]);
    }
    const Tx = S.transport(p, c, L, x0);
    console.log(`${S.name}: step-projection transport vs closed form, max coord diff ${fmt(Math.max(...Tx.map((y: number, i: number) => Math.abs(y - x[i]))))} (O(1/n) = ${fmt(1 / n)})`);
  }
}
