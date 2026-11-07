// ray_spawn in S³: unit... sphere of radius 0.5 centred anywhere on S³ (coordinates are all ≤ 1,
// so no position dependence is expected). Smallest eps with no failure, true judge and f32 SDF.
import { mk, F64, F32, rng, randUnit3, fmt } from './common.ts';
import { S3 } from './s3.ts';
const u = rng(13);
const S64 = S3(mk(F64)), S32 = S3(mk(F32));
const N = 4000;
for (const R of [0, 1, 2, 3, 3.1]) {
  const samples = Array.from({ length: N }, () => {
    const c = S64.pointAt(randUnit3(u), R);
    const nc = S64.apply(S64.makeTranslation(c), [...randUnit3(u), 0]);
    const f = S64.flow(c, nc, 0.5);
    return { c, p: f.p, n: f.v };
  });
  const out: string[] = [];
  for (const eps of [1e-7, 3e-7, 1e-6, 3e-6, 1e-5, 1.52587890625e-5]) {
    let t = 0, w = 0;
    for (const s of samples) {
      const q = S32.flow(s.p.map(Math.fround), s.n.map(Math.fround), eps).p;
      if (S64.distance(S64.reducePoint(q), s.c) - 0.5 <= 0) t++;
      if (S32.distance(q, s.c.map(Math.fround)) - 0.5 <= 0) w++;
    }
    out.push(`eps ${fmt(eps)}: ${t}/${w}`);
  }
  console.log(`S3 R=${R} failures true/f32-SDF of ${N}: ${out.join(' | ')}`);
}
