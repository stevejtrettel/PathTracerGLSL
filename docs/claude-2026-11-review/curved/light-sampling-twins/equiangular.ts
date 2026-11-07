// Equiangular sampling of a point light seen from a ray segment [0,T] in a homogeneous medium.
// Ray (p,v) from O along e3; light at q. The foot of q on the geodesic is at t0, distance h:
//   H3: a=-<p,q>, b=-<v,q>:  cosh d(t) = a cosh t + b sinh t = cosh h cosh(t - t0),
//       tanh t0 = -b/a, cosh h = sqrt(a^2-b^2).   theta(tau) = atan(tanh tau / sinh h)
//   S3: a=<p,q>, b=<v,q>:    cos d(t) = a cos t + b sin t = cos h cos(t - t0),
//       t0 = atan2(b,a), cos h = sqrt(a^2+b^2).   theta(tau) = atan2(sin tau, sin h cos tau)
//       (continuous in tau; increases by 2 pi per period)
// Sampling: theta uniform in [theta(-t0), theta(T-t0)], invert; pdf(t) = S(h) / ((thb-tha) A(d(t))).
// Integrand (single scattering of the point light, both arcs in S3):
//   f(t) = sigma_s e^{-sigma_t t} sum_arcs phase(cos) I e^{-sigma_t r} / A(r)
import { H3, S3, Space, O, E1, E3, V4, flow, logDir, frame, local, Stat, report, rng, mul } from './geom.ts';

const lines: string[] = [];
const say = (s: string) => { console.log(s); lines.push(s); };
const SIG_T = 0.6, SIG_S = 0.4, I = 3, G = 0.5;
const hg = (c: number) => (1 - G * G) / (4 * Math.PI * Math.pow(1 + G * G - 2 * G * c, 1.5));

function unwrap(angle: number, near: number) {
  return angle + 2 * Math.PI * Math.round((near - angle) / (2 * Math.PI));
}

function setup(sp: Space, q: V4) {
  const p = O, v = E3;
  if (sp.name === 'H3') {
    const a = -sp.ip(p, q), b = -sp.ip(v, q);
    const t0 = Math.atanh(-b / a), ch = Math.sqrt(a * a - b * b), sh = Math.sqrt(ch * ch - 1);
    const theta = (tau: number) => Math.atan(Math.tanh(tau) / sh);
    const inv = (th: number) => Math.atanh(sh * Math.tan(th));
    return { t0, Sh: sh, theta, inv };
  }
  const a = sp.ip(p, q), b = sp.ip(v, q);
  const t0 = Math.atan2(b, a), chh = Math.hypot(a, b), sh = Math.sqrt(1 - chh * chh);
  const theta = (tau: number) => unwrap(Math.atan2(Math.sin(tau), sh * Math.cos(tau)), tau);
  const inv = (th: number) => unwrap(Math.atan2(sh * Math.sin(th), Math.cos(th)), th);
  return { t0, Sh: sh, theta, inv };
}

function integrand(sp: Space, q: V4, t: number): number {
  const g = flow(sp, O, E3, t);
  const { u, d } = logDir(sp, g.pos, q);
  const arcs: [V4, number][] = [[u, d]];
  if (sp.name === 'S3') arcs.push([mul(u, -1), 2 * Math.PI - d]);
  let s = 0;
  for (const [w, r] of arcs) s += hg(sp.ip(w, g.vel)) * I * Math.exp(-SIG_T * r) / sp.A(r);
  return SIG_S * Math.exp(-SIG_T * t) * s;
}

function simpson(f: (t: number) => number, a: number, b: number, n: number) {
  const hh = (b - a) / n; let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * hh) * (i % 2 ? 4 : 2);
  return s * hh / 3;
}

function lightAt(sp: Space, dist: number, polar: number, azim: number): V4 {
  const f = frame(sp, O, E3);
  const w = local(f, Math.sin(polar) * Math.cos(azim), Math.sin(polar) * Math.sin(azim), Math.cos(polar));
  return flow(sp, O, w, dist).pos;
}

const N = Number(process.env.N ?? 1000000);
const cases: [Space, number, number, number][] = [
  // space, light distance from ray origin, polar angle from ray, segment length T
  [H3, 1.0, 1.2, 3], [H3, 0.3, 1.5, 6], [H3, 3, 0.3, 2], [H3, 0.05, 1.0, 4],
  [S3, 1.0, 1.2, 3], [S3, 0.3, 1.5, 6], [S3, 2.5, 0.8, 5.5], [S3, 0.05, 1.0, 2 * Math.PI - 1e-3], [S3, 1.5, 2.6, 1.0],
];
say(`sigma_t=${SIG_T} sigma_s=${SIG_S} I=${I} HG g=${G}; N=${N}`);
for (const [sp, dist, polar, T] of cases) {
  const q = lightAt(sp, dist, polar, 0.7);
  const { t0, Sh, theta, inv } = setup(sp, q);
  const tha = theta(-t0), thb = theta(T - t0);
  const pdf = (t: number) => Sh / ((thb - tha) * sp.A(sp.dist(flow(sp, O, E3, t).pos, q)));
  // normalization and round trip
  const norm = simpson(pdf, 0, T, 200000);
  let rt = 0;
  for (let k = 0; k <= 1000; k++) { const t = T * k / 1000; rt = Math.max(rt, Math.abs(inv(theta(t - t0)) + t0 - t)); }
  // brute force
  const ref = simpson((t) => integrand(sp, q, t), 0, T, 200000);
  const ref2 = simpson((t) => integrand(sp, q, t), 0, T, 400000);
  // MC: equiangular vs uniform t
  const rr = rng(Math.round(dist * 1000 + T * 10));
  const sE = new Stat(), sU = new Stat();
  let maxRel = 0;
  for (let i = 0; i < N; i++) {
    const th = tha + rr() * (thb - tha);
    const t = inv(th) + t0;
    const p = pdf(t);
    sE.add(integrand(sp, q, t) / p);
    if (i < 2000) {
      // the pdf written as dtheta/dt / (thb - tha), by finite difference
      const e = 1e-6, fd = (theta(t + e - t0) - theta(t - e - t0)) / (2 * e) / (thb - tha);
      maxRel = Math.max(maxRel, Math.abs(fd / p - 1));
    }
    const tu = rr() * T;
    sU.add(integrand(sp, q, tu) * T);
  }
  say(`--- ${sp.name} light dist ${dist} polar ${polar} T=${T.toFixed(4)}: foot t0=${t0.toFixed(4)} h=${(sp.name === 'H3' ? Math.asinh(Sh) : Math.asin(Sh)).toFixed(4)} theta range [${tha.toFixed(4)}, ${thb.toFixed(4)}]`);
  say(`  integral of pdf over [0,T] (Simpson 2e5) = ${norm.toFixed(9)}; max |t(theta(t)) - t| = ${rt.toExponential(1)}; max rel |pdf - dtheta/dt/range| = ${maxRel.toExponential(1)}`);
  say(`  brute force (Simpson 2e5 / 4e5) = ${ref.toPrecision(10)} / ${ref2.toPrecision(10)}`);
  say(report('  equiangular MC', sE, ref2) + `  per-sample std ${(sE.se * Math.sqrt(N)).toPrecision(3)}`);
  say(report('  uniform-t MC', sU, ref2) + `  per-sample std ${(sU.se * Math.sqrt(N)).toPrecision(3)}`);
}
import { writeFileSync } from 'node:fs';
writeFileSync(new URL('./equiangular.out.txt', import.meta.url), lines.join('\n') + '\n');
