// (a) flow stays on the model and matches RK4 integration of the geodesic ODE in a conformal chart.
import { mk, F64, F32, V, rng, randUnit3, rk4, conformalGeodesic, fmt } from './common.ts';
import { H3 } from './h3.ts';
import { S3 } from './s3.ts';
import { H2R } from './h2r.ts';
import { E3 } from './e3.ts';

const u = rng(1);
// chart (ball / stereographic / disk): y = x_s/(1+x_w), dy = dx_s/(1+x_w) - x_s dx_w/(1+x_w)²
function toChart(p: V, v: V, sIdx: number[], w: number) {
  const k = 1 + p[w];
  return { y: sIdx.map((i) => p[i] / k), dy: sIdx.map((i) => v[i] / k - (p[i] * v[w]) / (k * k)) };
}
const ball = (y: V) => { const s = 1 - y.reduce((a, x) => a + x * x, 0); return y.map((x) => (2 * x) / s); };
const stereo = (y: V) => { const s = 1 + y.reduce((a, x) => a + x * x, 0); return y.map((x) => (-2 * x) / s); };

function randTangent(S: any, p: V) {
  const d = randUnit3(u);
  const v = S.name === 'H2R' ? [d[0], d[1], 0, d[2]] : S.name === 'E3' ? d : [...d, 0];
  // move a tangent at origin to p: for the vec4 spaces, any vector then reduceVec
  return S.reduceVec(p, v.map((x: number) => x + 0.3 * (u() - 0.5)));
}

for (const prec of ['f64', 'f32'] as const) {
  const A = mk(prec === 'f64' ? F64 : F32);
  for (const S of [E3(A), H3(A), S3(A), H2R(A)] as any[]) {
    let worst = { pp: 0, pv: 0, vv: 0, ode: 0, odeV: 0 };
    const T = [0.01, 0.3, 1, 2.5];
    for (let trial = 0; trial < 200; trial++) {
      const p = S.reducePoint(S.pointAt(randUnit3(u), 0.5 * u()).map(A.r));
      const v = randTangent(S, p);
      for (const t of T) {
        const f = S.flow(p, v, t);
        const unitP = S.name === 'E3' ? 0 : S.name === 'H2R' ? Math.abs(f.p[0] ** 2 + f.p[1] ** 2 - f.p[2] ** 2 + 1) : Math.abs(S.ip(f.p, f.p) - (S.name === 'H3' ? -1 : 1));
        const pvH = S.name === 'H2R' ? Math.abs(f.p[0] * f.v[0] + f.p[1] * f.v[1] - f.p[2] * f.v[2]) : S.name === 'E3' ? 0 : Math.abs(S.ip(f.p, f.v));
        worst.pp = Math.max(worst.pp, unitP);
        worst.pv = Math.max(worst.pv, pvH);
        worst.vv = Math.max(worst.vv, Math.abs(S.ip(f.v, f.v) - 1));
        if (prec === 'f64' && S.name !== 'E3') {
          const ode = S.name === 'H3' ? { idx: [0, 1, 2], w: 3, g: ball } : S.name === 'S3' ? { idx: [0, 1, 2], w: 3, g: stereo } : { idx: [0, 1], w: 2, g: ball };
          const c0 = toChart(p, v, ode.idx, ode.w);
          const zero = S.name === 'H2R';
          // H²×R: integrate the H² part in the disk and z linearly
          const sol = rk4(conformalGeodesic(ode.g), c0.y, c0.dy, t, 2000);
          const c1 = toChart(f.p, f.v, ode.idx, ode.w);
          let e = Math.max(...sol.y.map((x, i) => Math.abs(x - c1.y[i])));
          let ev = Math.max(...sol.v.map((x, i) => Math.abs(x - c1.dy[i])));
          if (zero) { e = Math.max(e, Math.abs(p[3] + v[3] * t - f.p[3])); }
          worst.ode = Math.max(worst.ode, e);
          worst.odeV = Math.max(worst.odeV, ev);
        }
      }
    }
    console.log(`${prec} ${S.name.padEnd(4)} max|<p,p>∓1|=${fmt(worst.pp)} max|<p,v>|=${fmt(worst.pv)} max|<v,v>-1|=${fmt(worst.vv)}` + (prec === 'f64' && S.name !== 'E3' ? ` | vs RK4 chart: pos ${fmt(worst.ode)} vel ${fmt(worst.odeV)}` : ''));
  }
}
// H3 flow drift in float32 at large t (no reduceError): how far off the model after one long flow
{
  const A = mk(F32), S = H3(A);
  for (const t of [1, 3, 6, 9, 12, 20, 40, 80, 89, 90]) {
    const f = S.flow(S.origin, [1, 0, 0, 0], t);
    const rel = Math.abs(S.ip(f.p, f.p) + 1);
    console.log(`f32 H3 flow from origin t=${t}: |<p,p>+1|=${fmt(rel)} coords~${fmt(Math.abs(f.p[3]))} finite=${f.p.every(Number.isFinite)}`);
  }
}
