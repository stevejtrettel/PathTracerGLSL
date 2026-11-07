// S3 with today's LightSample contract (one wi, one distance per sample): the light sampler
// picks ONE of the two arcs to its sampled point with probability 1/2, so its solid-angle pdf
// is (1/2) A(r) / (|cos_y| area). The BSDF-hit MIS weight must use the same 1/2.
// Compared with the sum-over-both-arcs estimator B and the cosine estimator A.
import { S3, Space, O, E3, V4, flow, logDir, frame, local, makeDisk, hitDisk, sampleDisk, hitBall, ballNormal, rng, Stat, report, cosineHemi, mul, lin } from './geom.ts';

const sp: Space = S3;
const N = Number(process.env.N ?? 2000000);
const lines: string[] = [];
const say = (s: string) => { console.log(s); lines.push(s); };

interface Em { hit(p: V4, v: V4): number; nrm(y: V4): V4; sample(a: number, b: number): V4; area: number; }

function run(label: string, em: Em, expected?: number) {
  const f = frame(sp, O, E3), rr = rng(label.length * 31 + 7);
  const sA = new Stat(), sB2 = new Stat(), sB1 = new Stat(), sM1 = new Stat();
  for (let i = 0; i < N; i++) {
    const [lx, ly, lz] = cosineHemi(rr(), rr());
    const v = local(f, lx, ly, lz);
    const t = em.hit(O, v);
    let fa = 0, wa = 0;
    if (t < Infinity) {
      const vel = flow(sp, O, v, t).vel;
      fa = Math.PI;
      const pl = 0.5 * sp.A(t) / (Math.abs(sp.ip(vel, em.nrm(flow(sp, O, v, t).pos))) * em.area), pb = lz / Math.PI;
      wa = pb * pb / (pb * pb + pl * pl);
    }
    sA.add(fa);
    const y = em.sample(rr(), rr());
    const { u, d } = logDir(sp, O, y);
    const arcs: [V4, number][] = [[u, d], [mul(u, -1), 2 * Math.PI - d]];
    const contrib = (w: V4, r: number) => {
      const cx = sp.ip(w, E3);
      if (cx <= 0) return { val: 0, cx: 0, pl: 0 };
      if (Math.abs(em.hit(O, w) - r) > 1e-7) return { val: 0, cx: 0, pl: 0 };
      const cy = Math.abs(sp.ip(flow(sp, O, w, r).vel, em.nrm(y)));
      return { val: cx * cy / sp.A(r) * em.area, cx, pl: sp.A(r) / (cy * em.area) };
    };
    // sum over both arcs
    let b2 = 0; for (const [w, r] of arcs) b2 += contrib(w, r).val;
    sB2.add(b2);
    // one arc, chosen with probability 1/2
    const [w, r] = arcs[rr() < 0.5 ? 0 : 1];
    const c = contrib(w, r);
    sB1.add(2 * c.val);
    let m = fa * wa;
    if (c.val > 0) { const pl = 0.5 * c.pl, pb = c.cx / Math.PI; m += 2 * c.val * pl * pl / (pl * pl + pb * pb); }
    sM1.add(m);
  }
  say(`--- S3 ${label} (N=${N})`);
  say(report('  A cosine', sA, expected));
  say(report('  B both arcs summed', sB2, expected));
  say(report('  B one random arc (x2)', sB1, expected));
  say(report('  MIS(A, one-arc B), pdf halved', sM1, expected));
}

function tiltedDisk(D: number, rho: number, polar: number, tilt: number): Em {
  const f = frame(sp, O, E3);
  const g = flow(sp, O, local(f, Math.sin(polar), 0, Math.cos(polar)), D);
  const m = lin(mul(g.vel, -1), Math.cos(tilt), f[1], Math.sin(tilt));
  const dk = makeDisk(sp, g.pos, m, rho);
  return { hit: (p, v) => hitDisk(sp, dk, p, v, 2 * Math.PI), nrm: () => dk.m, sample: (a, b) => sampleDisk(sp, dk, a, b), area: sp.diskArea(rho) };
}
function ball(d: number, R: number, polar: number): Em {
  const f = frame(sp, O, E3);
  const c = flow(sp, O, local(f, Math.sin(polar), 0, Math.cos(polar)), d).pos;
  const bl = { c, R };
  const fc = frame(sp, c, flow(sp, O, local(f, Math.sin(polar), 0, Math.cos(polar)), d).vel);
  return {
    hit: (p, v) => hitBall(sp, bl, p, v, 2 * Math.PI), nrm: (y) => ballNormal(sp, bl, y), area: sp.sphereArea(R),
    sample: (a, b) => { const z = 1 - 2 * a, s = Math.sqrt(1 - z * z), ph = 2 * Math.PI * b; return flow(sp, c, local(fc, s * Math.cos(ph), s * Math.sin(ph), z), R).pos; },
  };
}
// two-sided disks (the arc that arrives from behind still sees emission)
run('disk on axis D=1 rho=0.6', tiltedDisk(1, 0.6, 0, 0), Math.PI * Math.sin(Math.atan(Math.tan(0.6) / Math.sin(1))) ** 2);
run('disk crossing horizon D=1.4 rho=1.0 polar=1.5 tilt=0.3', tiltedDisk(1.4, 1.0, 1.5, 0.3));
run('ball crossing horizon d=1.3 R=0.6 polar=1.45', ball(1.3, 0.6, 1.45));
import { writeFileSync } from 'node:fs';
writeFileSync(new URL('./s3_one_arc.out.txt', import.meta.url), lines.join('\n') + '\n');
