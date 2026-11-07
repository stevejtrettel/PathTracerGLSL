// ray_spawn in H³: offset a float32 hit point along its normal by eps (geodesic flow), and
// check the spawned origin is really outside a unit-radius sphere centred at distance R from
// the world origin. Three judges: (true) float64 distance of the float32 point; (world f32)
// the sphere SDF evaluated in float32 world coordinates; (local f32) the point moved into the
// sphere's own frame by the float32 inverse placement, SDF = asinh(|x_spatial|) - 1.
// Baseline: the same experiment in E³ with today's fp_uncertainty (src/glsl/core/math.glsl:50-53).
import { mk, F64, F32, V, rng, randUnit3, fmt } from './common.ts';
import { H3 } from './h3.ts';

const u = rng(11);
const A64 = mk(F64), A32 = mk(F32);
const S64 = H3(A64), S32 = H3(A32);
const N = 2000;
const epsList = [1e-7, 1e-6, 1e-5, 3e-5, 1e-4, 3e-4, 1e-3, 3e-3, 1e-2, 3e-2, 1e-1, 3e-1];
for (const variant of ['flow', 'flow+GLSLsinh', 'flow+reduce']) {
  console.log(`\nH3 spawn variant: ${variant}. Smallest eps (from ${epsList.map(fmt).join(',')}) with 0/${N} failures, per judge`);
  for (const R of [0, 1, 2, 3, 4, 5, 6]) {
    const best: Record<string, number> = { true: NaN, worldF32: NaN, localF32: NaN };
    const fails: Record<string, number[]> = { true: [], worldF32: [], localF32: [] };
    // fixed sample set per R
    const samples = Array.from({ length: N }, () => {
      const c = S64.pointAt(randUnit3(u), R);
      const Tc = S64.makeTranslation(c);
      const nc = S64.apply(Tc, [...randUnit3(u), 0]);
      const f = S64.flow(c, nc, 1); // hit point on the unit sphere and outward normal there
      return { c, Tc32: A32.roundM(Tc), p: f.p, n: f.v };
    });
    for (const eps of epsList) {
      let cnt = { true: 0, worldF32: 0, localF32: 0 };
      for (const s of samples) {
        const p32 = s.p.map(Math.fround), n32 = s.n.map(Math.fround);
        let q = variant === 'flow+GLSLsinh' ? S32.flow(p32, n32, eps, A32.sinhGLSL).p : S32.flow(p32, n32, eps).p;
        if (variant === 'flow+reduce') q = S32.reducePoint(q);
        if (S64.distance(S64.reducePoint(q), s.c) - 1 <= 0) cnt.true++;
        if (S32.distance(q, s.c.map(Math.fround)) - 1 <= 0) cnt.worldF32++;
        const x = S32.apply(S32.inverse(s.Tc32), q);
        const sp = A32.sqrt(A32.r(A32.r(A32.r(x[0] * x[0]) + A32.r(x[1] * x[1])) + A32.r(x[2] * x[2])));
        if (A32.r(Math.asinh(sp)) - 1 <= 0) cnt.localF32++;
      }
      for (const k of Object.keys(cnt) as (keyof typeof cnt)[]) {
        fails[k].push(cnt[k]);
        if (cnt[k] === 0 && Number.isNaN(best[k])) best[k] = eps;
      }
    }
    console.log(`R=${R}: true ${fmt(best.true)} | world-f32 SDF ${fmt(best.worldF32)} | local-f32 SDF ${fmt(best.localF32)}   (failures at eps=1e-4: ${fails.true[4]}/${fails.worldF32[4]}/${fails.localF32[4]})`);
  }
}
// E3 baseline: unit sphere centred at distance R (R up to e^6 ≈ 400 so coordinates span the same
// float32 exponents as H3 at hyperbolic distance 6), eps = fp_uncertainty(p)
{
  console.log('\nE3 baseline with fp_uncertainty: failures /' + N);
  for (const R of [0, 10, 100, 400]) {
    let f = 0, worst = 0;
    for (let k = 0; k < N; k++) {
      const c = randUnit3(u).map((x) => x * R), n = randUnit3(u);
      const p = c.map((x, i) => x + n[i]);
      const p32 = p.map(Math.fround), n32 = n.map(Math.fround);
      const eps = Math.max(1.52587890625e-5, 3.0517578125e-5 * Math.max(...p32.map(Math.abs)));
      const q = p32.map((x, i) => Math.fround(x + Math.fround(eps * n32[i])));
      const c32 = c.map(Math.fround);
      const d = Math.fround(Math.sqrt(q.reduce((s, x, i) => s + Math.fround((x - c32[i]) ** 2), 0))) - 1;
      if (d <= 0) f++;
      worst = Math.max(worst, eps);
    }
    console.log(`E3 R=${R}: failures ${f}, eps up to ${fmt(worst)}`);
  }
}
