// Review twin: the design's S3 arc rule (one-sided receiver: upper arc w.p. 1; otherwise 1/2),
// its MIS pdf without arc knowledge, the cone "flip" form for balls, and the literal rule at a
// medium vertex (two_sided=false, n=0) as light_query_medium builds it today.
import { type Space, type V4 } from "/Users/stevetrettel/Code/PathTracerGLSL/docs/claude-2026-11-review/curved/light-sampling-twins/geom.ts";
import { S3, O, E3, flow, logDir, frame, local, makeDisk, hitDisk, sampleDisk, hitBall, ballNormal, rng, Stat, report, cosineHemi, mul, lin } from '/Users/stevetrettel/Code/PathTracerGLSL/docs/claude-2026-11-review/curved/light-sampling-twins/geom.ts';
const sp: Space = S3;
const N = Number(process.env.N ?? 1000000);
const f = frame(sp, O, E3);
interface Em { hit(p: V4, v: V4): number; nrm(y: V4): V4; sample(a: number, b: number): V4; area: number; oneSided: boolean; }
const Le = (em: Em, y: V4, vel: V4) => (!em.oneSided || sp.ip(vel, em.nrm(y)) < 0) ? 1 : 0;
function disk(D: number, rho: number, polar: number, tilt: number, flipNormal: boolean, oneSided: boolean): Em {
  const g = flow(sp, O, local(f, Math.sin(polar), 0, Math.cos(polar)), D);
  let m = lin(mul(g.vel, -1), Math.cos(tilt), f[1], Math.sin(tilt));
  if (flipNormal) m = mul(m, -1);
  const dk = makeDisk(sp, g.pos, m, rho);
  return { hit: (p, v) => hitDisk(sp, dk, p, v, 2 * Math.PI), nrm: () => dk.m, sample: (a, b) => sampleDisk(sp, dk, a, b), area: sp.diskArea(rho), oneSided };
}
function surfaceRun(label: string, em: Em) {
  const r = rng(label.length * 977 + 3);
  const sA = new Stat(), sU = new Stat(), sM = new Stat(), sH = new Stat();
  for (let i = 0; i < N; i++) {
    // A: cosine sampling; MIS weight uses p_l = A(t)/(|cos_y| area) with NO arc factor
    const [lx, ly, lz] = cosineHemi(r(), r());
    const v = local(f, lx, ly, lz);
    const t = em.hit(O, v);
    let a = 0, ma = 0;
    if (t < Infinity) {
      const fl = flow(sp, O, v, t);
      a = Math.PI * Le(em, fl.pos, fl.vel);
      const pl = sp.A(t) / (Math.abs(sp.ip(fl.vel, em.nrm(fl.pos))) * em.area), pb = lz / Math.PI;
      ma = a * pb * pb / (pb * pb + pl * pl);
    }
    sA.add(a);
    // U: area sample, take the arc leaving into n's hemisphere with probability 1
    const y = em.sample(r(), r());
    const { u, d } = logDir(sp, O, y);
    const up = sp.ip(u, E3) > 0;
    const w = up ? u : mul(u, -1), len = up ? d : 2 * Math.PI - d;
    const cx = sp.ip(w, E3);
    let c = 0, pl = 0;
    if (Math.abs(em.hit(O, w) - len) < 1e-7) {
      const vel = flow(sp, O, w, len).vel;
      const cy = Math.abs(sp.ip(vel, em.nrm(y)));
      c = Le(em, y, vel) * cx * cy / sp.A(len) * em.area;
      pl = sp.A(len) / (cy * em.area);
    }
    sU.add(c);
    const pb = cx / Math.PI;
    sM.add(ma + (c > 0 ? c * pl * pl / (pl * pl + pb * pb) : 0));
    // half rule (two-sided receiver form) on the same one-sided receiver, for reference
    const pick = r() < 0.5;
    const w2 = pick ? u : mul(u, -1), l2 = pick ? d : 2 * Math.PI - d;
    const cx2 = sp.ip(w2, E3);
    let c2 = 0;
    if (cx2 > 0 && Math.abs(em.hit(O, w2) - l2) < 1e-7) {
      const vel = flow(sp, O, w2, l2).vel;
      c2 = 2 * Le(em, y, vel) * cx2 * Math.abs(sp.ip(vel, em.nrm(y))) / sp.A(l2) * em.area;
    }
    sH.add(c2);
  }
  console.log(`--- ${label}`);
  console.log(report('  A cosine (reference)', sA));
  const z = (s: Stat) => ((s.mean - sA.mean) / Math.hypot(s.se, sA.se)).toFixed(2);
  console.log(report('  upper arc w.p. 1', sU) + `  z vs A ${z(sU)}`);
  console.log(report('  MIS(A, upper arc), pdf w/o arc factor', sM) + `  z vs A ${z(sM)}`);
  console.log(report('  1/2 rule', sH) + `  z vs A ${z(sH)}`);
}
surfaceRun('one-sided disk BELOW, facing away (long arc only) D=1 rho=0.6', disk(1, 0.6, Math.PI, 0, true, true));
surfaceRun('one-sided disk crossing horizon D=1.4 rho=1 polar=1.5 tilt=0.3', disk(1.4, 1.0, 1.5, 0.3, false, true));
surfaceRun('one-sided disk crossing horizon, normal flipped', disk(1.4, 1.0, 1.5, 0.3, true, true));
surfaceRun('two-sided disk crossing horizon', disk(1.4, 1.0, 1.5, 0.3, false, false));

// Ball crossing the horizon: cone sampling, forward cone then flip to the upper member of {w,-w}.
{
  const d = 1.3, R = 0.6, polar = 1.45;
  const uc = local(f, Math.sin(polar), 0, Math.cos(polar));
  const c = flow(sp, O, uc, d).pos, bl = { c, R };
  const sinA = Math.sin(R) / Math.sin(d), cosA = Math.sqrt(1 - sinA * sinA), Om = 2 * Math.PI * (1 - cosA);
  const fc = frame(sp, O, uc);
  const r = rng(4242);
  const sA = new Stat(), sC = new Stat(), sM = new Stat();
  for (let i = 0; i < N; i++) {
    const [lx, ly, lz] = cosineHemi(r(), r());
    const v = local(f, lx, ly, lz);
    const t = hitBall(sp, bl, O, v, 2 * Math.PI);
    let a = 0, ma = 0;
    if (t < Infinity) { a = Math.PI; const pl = 1 / Om, pb = lz / Math.PI; ma = a * pb * pb / (pb * pb + pl * pl); }
    sA.add(a);
    const ct = 1 - r() * (1 - cosA), st = Math.sqrt(1 - ct * ct), ph = 2 * Math.PI * r();
    let w = local(fc, st * Math.cos(ph), st * Math.sin(ph), ct);
    if (sp.ip(w, E3) < 0) w = mul(w, -1);
    const cx = sp.ip(w, E3);
    const th = hitBall(sp, bl, O, w, 2 * Math.PI);
    const cval = th < Infinity ? cx * Om : 0;
    sC.add(cval);
    const pb = cx / Math.PI, pl = 1 / Om;
    sM.add(ma + (cval > 0 ? cval * pl * pl / (pl * pl + pb * pb) : 0));
  }
  console.log('--- ball crossing horizon d=1.3 R=0.6 polar=1.45 (one-sided receiver)');
  console.log(report('  A cosine (reference)', sA));
  const z = (s: Stat) => ((s.mean - sA.mean) / Math.hypot(s.se, sA.se)).toFixed(2);
  console.log(report('  cone + flip to upper', sC) + `  z vs A ${z(sC)}`);
  console.log(report('  MIS(A, cone+flip) pdf 1/Omega', sM) + `  z vs A ${z(sM)}`);
}

// Medium vertex: isotropic phase 1/(4 pi); the query has n = 0 and two_sided = false.
{
  const em = disk(1.2, 0.5, 0.7, 0.2, false, false);
  const r = rng(99);
  const sRef = new Stat(), sHalf = new Stat(), sLitGT = new Stat(), sLitGE = new Stat();
  for (let i = 0; i < N; i++) {
    const z = 1 - 2 * r(), s = Math.sqrt(1 - z * z), ph = 2 * Math.PI * r();
    const v = local(f, s * Math.cos(ph), s * Math.sin(ph), z);
    sRef.add(em.hit(O, v) < Infinity ? 1 : 0); // integral of L * (1/4pi) over the sphere, / (1/4pi)
    const y = em.sample(r(), r());
    const { u, d } = logDir(sp, O, y);
    const val = (w: V4, len: number) => Math.abs(em.hit(O, w) - len) < 1e-7
      ? (1 / (4 * Math.PI)) * Math.abs(sp.ip(flow(sp, O, w, len).vel, em.nrm(y))) / sp.A(len) * em.area : 0;
    const pick = r() < 0.5;
    sHalf.add(2 * (pick ? val(u, d) : val(mul(u, -1), 2 * Math.PI - d)));
    const nzero = 0; // <u, n> with n = 0
    sLitGT.add(nzero > 0 ? val(u, d) : val(mul(u, -1), 2 * Math.PI - d));
    sLitGE.add(nzero >= 0 ? val(u, d) : val(mul(u, -1), 2 * Math.PI - d));
  }
  console.log('--- medium vertex (n = 0, two_sided = false), two-sided disk, isotropic phase');
  const z = (s: Stat) => ((s.mean - sRef.mean) / Math.hypot(s.se, sRef.se)).toFixed(2);
  console.log(report('  uniform-sphere reference', sRef));
  console.log(report('  1/2 rule', sHalf) + `  z vs ref ${z(sHalf)}`);
  console.log(report('  literal one-sided rule, test > 0', sLitGT) + `  z vs ref ${z(sLitGT)}`);
  console.log(report('  literal one-sided rule, test >= 0', sLitGE) + `  z vs ref ${z(sLitGE)}`);
}
