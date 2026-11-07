// Estimator equality for irradiance at x = origin, normal n = e3, Lambertian receiver.
//   A  cosine-sampled direction, trace the geodesic, score Le on the first emitter hit
//   B  area sampling on the emitter, weight Le cos_x cos_y / A(r) / pdf_area
//      (S3: both arcs d and 2pi-d; each with its own initial direction and arrival velocity)
//   C  (balls) cone sampling, sin(alpha) = S(R)/S(d); S3 also the backward cone
//   MIS  one A sample + one B sample, power heuristic
// Emission: a one-sided emitter radiates to the side its normal m (disk) / outward normal (ball)
// points to; the arrival velocity `vel` at y heads into the surface, so it is seen iff <vel,m> < 0.
import {
  H3, S3, Space, O, E1, E3, V4, flow, logDir, frame, local, makeDisk, Disk, hitDisk, sampleDisk,
  hitBall, ballNormal, Ball, rng, Stat, report, cosineHemi, lin, mul,
} from './geom.ts';

const N = Number(process.env.N ?? 400000);
const LE = 1;
const lines: string[] = [];
const say = (s: string) => { console.log(s); lines.push(s); };

const tmaxOf = (sp: Space) => (sp.name === 'H3' ? Infinity : 2 * Math.PI);

// arcs from x to y: [initial dir, length, arrival velocity]
function arcs(sp: Space, x: V4, y: V4): { u: V4; r: number; vel: V4 }[] {
  const { u, d } = logDir(sp, x, y);
  const short = { u, r: d, vel: flow(sp, x, u, d).vel };
  if (sp.name === 'H3') return [short];
  const mu = mul(u, -1);
  return [short, { u: mu, r: 2 * Math.PI - d, vel: flow(sp, x, mu, 2 * Math.PI - d).vel }];
}

interface Emitter {
  hit(p: V4, v: V4, tmax: number): number;
  normalAt(y: V4): V4;
  sample(u1: number, u2: number): V4;
  area: number;
  twoSided: boolean;
}

function diskEmitter(sp: Space, dk: Disk, twoSided: boolean): Emitter {
  return {
    hit: (p, v, tmax) => hitDisk(sp, dk, p, v, tmax),
    normalAt: () => dk.m,
    sample: (u1, u2) => sampleDisk(sp, dk, u1, u2),
    area: sp.diskArea(dk.rho),
    twoSided,
  };
}

function ballEmitter(sp: Space, bl: Ball): Emitter {
  // uniform point on the boundary sphere
  const f = frame(sp, bl.c, (() => { // any unit tangent at c
    const w = lin(E1, 1, bl.c, -sp.ip(E1, bl.c) / sp.sgn); return mul(w, 1 / Math.sqrt(sp.ip(w, w)));
  })());
  return {
    hit: (p, v, tmax) => hitBall(sp, bl, p, v, tmax),
    normalAt: (y) => ballNormal(sp, bl, y),
    sample: (u1, u2) => {
      const z = 1 - 2 * u1, s = Math.sqrt(Math.max(0, 1 - z * z)), ph = 2 * Math.PI * u2;
      const w = local(f, s * Math.cos(ph), s * Math.sin(ph), z);
      return flow(sp, bl.c, w, bl.R).pos;
    },
    area: sp.sphereArea(bl.R),
    twoSided: false,
  };
}

function emitted(em: Emitter, y: V4, vel: V4, sp: Space): number {
  if (em.twoSided) return LE;
  return sp.ip(vel, em.normalAt(y)) < 0 ? LE : 0;
}

// pdf of B in solid angle at x for a direction that first hits the emitter at y after r
function pdfB(sp: Space, em: Emitter, y: V4, vel: V4, r: number): number {
  const cy = Math.abs(sp.ip(vel, em.normalAt(y)));
  return (1 / em.area) * sp.A(r) / cy;
}

function run(sp: Space, label: string, em: Emitter, expected: number | undefined, cone?: Ball) {
  if (process.env.ONLY && !(sp.name + ' ' + label).includes(process.env.ONLY)) return;
  const n = E3, f = frame(sp, O, n), tmax = tmaxOf(sp);
  const sA = new Stat(), sB = new Stat(), sM = new Stat(), sC = new Stat();
  let h = 2166136261; for (const ch of sp.name + label + (process.env.SALT ?? '')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rr = rng(h);
  let coneMiss = 0;
  for (let i = 0; i < N; i++) {
    // A
    const [lx, ly, lz] = cosineHemi(rr(), rr());
    const v = local(f, lx, ly, lz);
    const t = em.hit(O, v, tmax);
    let fA = 0, wA = 0;
    if (t < Infinity) {
      const { pos, vel } = flow(sp, O, v, t);
      const le = emitted(em, pos, vel, sp);
      fA = le * Math.PI; // L cos / (cos/pi)
      const pa = lz / Math.PI, pb = pdfB(sp, em, pos, vel, t);
      wA = pa * pa / (pa * pa + pb * pb);
    }
    sA.add(fA);
    // B
    const y = em.sample(rr(), rr());
    let fB = 0, fBmis = 0;
    for (const a of arcs(sp, O, y)) {
      const cx = sp.ip(a.u, n);
      if (cx <= 0) continue;
      const th = em.hit(O, a.u, tmax);
      if (!(Math.abs(th - a.r) < 1e-7)) continue; // occluded (by the emitter itself)
      const ny = em.normalAt(y);
      const cy = Math.abs(sp.ip(a.vel, ny));
      const le = emitted(em, y, a.vel, sp);
      const contrib = le * cx * cy / sp.A(a.r) * em.area;
      fB += contrib;
      const pb = pdfB(sp, em, y, a.vel, a.r), pa = cx / Math.PI;
      fBmis += contrib * pb * pb / (pa * pa + pb * pb);
    }
    sB.add(fB);
    sM.add(fA * wA + fBmis);
    // C: cone(s) toward the ball
    if (cone) {
      const { u: uc, d } = logDir(sp, O, cone.c);
      const sinA = sp.S(cone.R) / sp.S(d);
      const cosA = Math.sqrt(1 - sinA * sinA);
      const nCones = sp.name === 'S3' ? 2 : 1;
      const which = nCones === 2 && rr() < 0.5 ? -1 : 1;
      const axis = mul(uc, which);
      const fc = frame(sp, O, axis);
      const ct = 1 - rr() * (1 - cosA), st = Math.sqrt(Math.max(0, 1 - ct * ct)), ph = 2 * Math.PI * rr();
      const w = local(fc, st * Math.cos(ph), st * Math.sin(ph), ct);
      const pdf = 1 / (nCones * 2 * Math.PI * (1 - cosA));
      const cx = sp.ip(w, n);
      let fC = 0;
      if (cx > 0) {
        const tc = em.hit(O, w, tmax);
        if (tc === Infinity) coneMiss++;
        else { const { pos, vel } = flow(sp, O, w, tc); fC = emitted(em, pos, vel, sp) * cx / pdf; }
      }
      sC.add(fC);
    }
  }
  say(`--- ${sp.name}: ${label}  (N=${N})`);
  say(report('  A cosine/BSDF', sA, expected));
  say(report('  B area sampling', sB, expected));
  say(report('  MIS(A,B) power', sM, expected));
  if (cone) say(report('  C cone sampling', sC, expected) + `  cone misses ${coneMiss}`);
  if (expected === undefined) {
    const z = (a: Stat, b: Stat) => ((a.mean - b.mean) / Math.hypot(a.se, b.se)).toFixed(2);
    say(`  pairwise z: A-B ${z(sA, sB)}  A-MIS ${z(sA, sM)}  B-MIS ${z(sB, sM)}` + (cone ? `  A-C ${z(sA, sC)}  B-C ${z(sB, sC)}` : ''));
  }
}

// disk centered on the axis at distance D, facing x: E = Le pi sin^2(beta), tan beta = T(rho)/S(D)
function axisDisk(sp: Space, D: number, rho: number, dir: 1 | -1, twoSided: boolean, faceFlip = false) {
  const g = flow(sp, O, mul(E3, dir), D);
  const m = mul(g.vel, faceFlip ? 1 : -1); // -vel faces x along the short arc
  return diskEmitter(sp, makeDisk(sp, g.pos, m, rho), twoSided);
}
function tanBeta(sp: Space, D: number, rho: number) {
  return sp.name === 'H3' ? Math.tanh(rho) / Math.sinh(D) : Math.tan(rho) / Math.sin(D);
}
const capE = (tb: number) => { const b = Math.atan(tb); return LE * Math.PI * Math.sin(b) ** 2; };

// tilted, off-axis disk
function tiltedDisk(sp: Space, D: number, rho: number, polar: number, tilt: number, twoSided: boolean) {
  const f = frame(sp, O, E3);
  const w = local(f, Math.sin(polar), 0, Math.cos(polar));
  const g = flow(sp, O, w, D);
  const m0 = mul(g.vel, -1);
  // a unit tangent at c orthogonal to m0: the frame's second vector is orthogonal to O, w, hence to c, vel
  const e = f[1];
  const m = lin(m0, Math.cos(tilt), e, Math.sin(tilt));
  return diskEmitter(sp, makeDisk(sp, g.pos, m, rho), twoSided);
}

function ballAt(sp: Space, d: number, R: number, polar: number): Ball {
  const f = frame(sp, O, E3);
  const w = local(f, Math.sin(polar), 0, Math.cos(polar));
  return { c: flow(sp, O, w, d).pos, R };
}

// ---------------- H3 ----------------
run(H3, 'disk on axis D=1 rho=0.7 one-sided', axisDisk(H3, 1, 0.7, 1, false), capE(tanBeta(H3, 1, 0.7)));
run(H3, 'disk on axis D=4 rho=3 one-sided', axisDisk(H3, 4, 3, 1, false), capE(tanBeta(H3, 4, 3)));
run(H3, 'disk tilted off-axis D=1.5 rho=1.2 polar=1.0 tilt=0.8', tiltedDisk(H3, 1.5, 1.2, 1.0, 0.8, false), undefined);
run(H3, 'disk crossing horizon D=0.8 rho=1.5 polar=1.3 tilt=0.4 2-sided', tiltedDisk(H3, 0.8, 1.5, 1.3, 0.4, true), undefined);
{
  const b = ballAt(H3, 1.2, 0.6, 0); const sa = Math.sinh(0.6) / Math.sinh(1.2);
  run(H3, 'ball on axis d=1.2 R=0.6', ballEmitter(H3, b), LE * Math.PI * sa * sa, b);
}
{
  const b = ballAt(H3, 3, 2, 0); const sa = Math.sinh(2) / Math.sinh(3);
  run(H3, 'ball on axis d=3 R=2', ballEmitter(H3, b), LE * Math.PI * sa * sa, b);
}
{
  // cap fully above horizon: E = Le pi sin^2(alpha) cos(polar) exactly
  const d = 2, R = 0.5, pol = 0.9; const b = ballAt(H3, d, R, pol); const sa = Math.sinh(R) / Math.sinh(d);
  run(H3, 'ball off-axis d=2 R=0.5 polar=0.9', ballEmitter(H3, b), LE * Math.PI * sa * sa * Math.cos(pol), b);
}
run(H3, 'ball crossing horizon d=1 R=0.7 polar=1.4', ballEmitter(H3, ballAt(H3, 1, 0.7, 1.4)), undefined, ballAt(H3, 1, 0.7, 1.4));

// ---------------- S3 ----------------
run(S3, 'disk on axis D=1 rho=0.6 one-sided', axisDisk(S3, 1, 0.6, 1, false), capE(tanBeta(S3, 1, 0.6)));
run(S3, 'disk on axis D=2 rho=0.5 (beyond pi/2) one-sided', axisDisk(S3, 2, 0.5, 1, false), capE(tanBeta(S3, 2, 0.5)));
// below the horizon: reached only by the long arc, which arrives from the disk's other side
run(S3, 'disk BELOW x D=1 rho=0.6 one-sided facing x', axisDisk(S3, 1, 0.6, -1, false), 0);
run(S3, 'disk BELOW x D=1 rho=0.6 one-sided facing away', axisDisk(S3, 1, 0.6, -1, false, true), capE(tanBeta(S3, 1, 0.6)));
run(S3, 'disk BELOW x D=1 rho=0.6 two-sided', axisDisk(S3, 1, 0.6, -1, true), capE(tanBeta(S3, 1, 0.6)));
run(S3, 'disk tilted off-axis D=1.2 rho=0.7 polar=1.2 tilt=0.8 2-sided', tiltedDisk(S3, 1.2, 0.7, 1.2, 0.8, true), undefined);
run(S3, 'disk crossing horizon D=1.4 rho=1.0 polar=1.5 tilt=0.3 2-sided', tiltedDisk(S3, 1.4, 1.0, 1.5, 0.3, true), undefined);
{
  const b = ballAt(S3, 1, 0.5, 0); const sa = Math.sin(0.5) / Math.sin(1);
  run(S3, 'ball on axis d=1 R=0.5', ballEmitter(S3, b), LE * Math.PI * sa * sa, b);
}
{
  // ball below x: seen only through the backward cone (long arcs)
  const b = ballAt(S3, 1, 0.5, Math.PI); const sa = Math.sin(0.5) / Math.sin(1);
  run(S3, 'ball BELOW x d=1 R=0.5', ballEmitter(S3, b), LE * Math.PI * sa * sa, b);
}
{
  const d = 2.2, R = 0.4, pol = 0.7; const b = ballAt(S3, d, R, pol); const sa = Math.sin(R) / Math.sin(d);
  run(S3, 'ball off-axis d=2.2 R=0.4 polar=0.7', ballEmitter(S3, b), LE * Math.PI * sa * sa * Math.cos(pol), b);
}
run(S3, 'ball crossing horizon d=1.3 R=0.6 polar=1.45', ballEmitter(S3, ballAt(S3, 1.3, 0.6, 1.45)), undefined, ballAt(S3, 1.3, 0.6, 1.45));

import { writeFileSync } from 'node:fs';
if (!process.env.ONLY) writeFileSync(new URL('./irradiance.out.txt', import.meta.url), lines.join('\n') + '\n');
