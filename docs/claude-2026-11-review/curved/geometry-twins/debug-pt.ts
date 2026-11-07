import { mk, F64 } from './common.ts';
import { H3 } from './h3.ts';
import { S3 } from './s3.ts';
const A = mk(F64);
for (const S of [H3(A), S3(A)] as any[]) {
  const p = S.pointAt([0.3, -0.5, 0.81].map((x) => x / Math.sqrt(0.9961)), 0.4), c = S.reduceVec(p, [0.2, 0.7, -0.1, 0.3]);
  console.log(S.name, 'p on model', S.ip(p,p), 'pointAt dir norm', 0.3**2+0.5**2+0.81**2);
  for (const n of [1000, 10000, 100000]) {
    for (const x0 of [c, S.reduceVec(p, [0.9, 0.1, 0.4, -0.2])]) {
      let x = x0.slice();
      for (let k = 1; k <= n; k++) {
        const pk = S.flow(p, c, (k * 2) / n).p; const s = S.ip(pk, pk);
        x = x.map((xi: number, i: number) => xi - (S.ip(x, pk) / s) * pk[i]);
      }
      const Tx = S.transport(p, c, 2, x0);
      console.log(n, Math.max(...Tx.map((y: number, i: number) => Math.abs(y - x[i]))), 'norm', S.ip(x,x), S.ip(Tx,Tx));
    }
  }
}
