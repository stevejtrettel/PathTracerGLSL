// (1) Point light: E = I max(cos,0) / A(d) (H3); S3 adds the long arc: E = I |cos| / sin^2 d,
//     against the small-ball limit with I = pi Le S(R)^2, integrated by deterministic
//     quadrature over the ball's cone(s) (cone exactness is checked in sanity.ts).
// (2) S3 antipodal caustic: a disk whose plane passes at distance h from -x. Area sampling
//     behaves like a near light (per-sample std grows as h -> 0) although the disk is far away.
import { H3, S3, Space, O, E3, flow, frame, local, makeDisk, Stat, report, cosineHemi, rng, hitDisk, sampleDisk, logDir, mul } from './geom.ts';

const lines: string[] = [];
const say = (s: string) => { console.log(s); lines.push(s); };

function coneIrradiance(sp: Space, d: number, R: number, polar: number, Le: number): number {
  // receiver normal n = e3 at O; ball center in direction (sin polar, 0, cos polar)
  const sinA = sp.S(R) / sp.S(d), cosA = Math.sqrt(1 - sinA * sinA);
  const axes = sp.name === 'S3' ? [1, -1] : [1];
  let E = 0;
  const NT = 1500, NP = 1500;
  for (const sgn of axes) {
    const ax = [sgn * Math.sin(polar), 0, sgn * Math.cos(polar)];
    // basis around ax
    const b1 = [Math.cos(polar), 0, -Math.sin(polar)], b2 = [0, 1, 0];
    for (let i = 0; i < NT; i++) {
      const ct = 1 - (i + 0.5) / NT * (1 - cosA), st = Math.sqrt(1 - ct * ct);
      for (let j = 0; j < NP; j++) {
        const ph = 2 * Math.PI * (j + 0.5) / NP;
        const wz = ct * ax[2] + st * (Math.cos(ph) * b1[2] + Math.sin(ph) * b2[2]);
        if (wz > 0) E += wz;
      }
    }
    // each cell has solid angle 2 pi (1 - cosA) / (NT NP)
  }
  return Le * E * 2 * Math.PI * (1 - cosA) / (NT * NP);
}

say('(1) point light vs small ball (deterministic cone quadrature, 1500x1500 cells per cone)');
for (const sp of [H3, S3]) {
  const d = sp.name === 'H3' ? 2 : 1.2;
  for (const polar of sp.name === 'H3' ? [0.6, 1.5] : [0.6, 1.5, 2.0, 2.8]) {
    for (const R of [0.3, 0.03, 0.003]) {
      const Le = 1;
      const I = Math.PI * Le * sp.S(R) ** 2;
      const c = Math.cos(polar);
      const point = sp.name === 'H3' ? I * Math.max(c, 0) / sp.A(d) : I * Math.abs(c) / sp.A(d);
      const ball = coneIrradiance(sp, d, R, polar, Le);
      say(`  ${sp.name} d=${d} polar=${polar} R=${R}: ball ${ball.toExponential(8)}  point ${point.toExponential(8)}  ratio ${(ball / point).toFixed(8)}`);
    }
  }
}

say('');
say('(2) S3 antipodal caustic: two-sided disk on the axis at distance pi-h (its plane passes at distance h from x and from -x), rho = 0.3');
const N = Number(process.env.N ?? 1000000);
for (const h of [0.2, 0.05, 0.01]) {
  const sp = S3, D = Math.PI - h, rho = 0.3;
  const g = flow(sp, O, E3, D);
  const dk = makeDisk(sp, g.pos, mul(g.vel, -1), rho);
  const tb = Math.tan(rho) / Math.sin(D), beta = Math.atan(tb);
  const expected = Math.PI * Math.sin(beta) ** 2;
  const f = frame(sp, O, E3), area = sp.diskArea(rho);
  const rr = rng(Math.round(h * 1e6));
  const sA = new Stat(), sB = new Stat(), sM = new Stat();
  for (let i = 0; i < N; i++) {
    const [lx, ly, lz] = cosineHemi(rr(), rr());
    const v = local(f, lx, ly, lz);
    const t = hitDisk(sp, dk, O, v, 2 * Math.PI);
    let fa = 0, wa = 0;
    if (t < Infinity) {
      const vel = flow(sp, O, v, t).vel;
      const pb = sp.A(t) / (Math.abs(sp.ip(vel, dk.m)) * area), pa = lz / Math.PI;
      fa = Math.PI; wa = pa * pa / (pa * pa + pb * pb);
    }
    sA.add(fa);
    const y = sampleDisk(sp, dk, rr(), rr());
    const { u, d } = logDir(sp, O, y);
    let fb = 0, fm = 0;
    for (const [uu, r] of [[u, d], [mul(u, -1), 2 * Math.PI - d]] as const) {
      const cx = sp.ip(uu, E3);
      if (cx <= 0) continue;
      const vel = flow(sp, O, uu, r).vel;
      const cy = Math.abs(sp.ip(vel, dk.m));
      const val = cx * cy / sp.A(r) * area;
      fb += val;
      const pb = sp.A(r) / (cy * area), pa = cx / Math.PI;
      fm += val * pb * pb / (pa * pa + pb * pb);
    }
    sB.add(fb); sM.add(fa * wa + fm);
  }
  say(`  h=${h} (disk center at distance ${D.toFixed(3)} from x), N=${N}`);
  for (const [lab, s] of [['A cosine', sA], ['B area', sB], ['MIS', sM]] as const) {
    say(report(`    ${lab}`, s, expected) + `  per-sample std ${(s.se * Math.sqrt(s.n)).toPrecision(3)}`);
  }
}
import { writeFileSync } from 'node:fs';
writeFileSync(new URL('./pointlight.out.txt', import.meta.url), lines.join('\n') + '\n');
