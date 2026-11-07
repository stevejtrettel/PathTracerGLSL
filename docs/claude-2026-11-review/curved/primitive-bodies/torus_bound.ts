// Per-space march bound of the torus (core circle radius R, tube r): capped tube of radius R + r and
// half-height h. E3 uses h = r. Candidates: H3 h = asinh(sinh r / cosh R), S3 h = asin(sin r / cos R).
// Count solid-torus points outside the bound, and how tight the bound is (max |axial| over the solid torus).
import { V4, Space, O, dot, flow, pointAt, tangent, rng, randDir, lin } from './lib.ts';
const capSdf = (S: Space, p: V4, h: number) => { const y = Math.abs(p[1]);
  return S === 'H3' ? Math.asinh(y * Math.cosh(h) - p[3] * Math.sinh(h)) : Math.asin(Math.max(-1, Math.min(1, y * Math.cos(h) - p[3] * Math.sin(h)))); };
const radial = (S: Space, p: V4) => { const a = Math.hypot(p[0], p[2]); return S === 'H3' ? Math.asinh(a) : Math.atan2(a, Math.hypot(p[1], p[3])); };
const Rg = rng(8);
for (const S of ['H3', 'S3'] as Space[]) for (const [R, r] of [[1, 0.3], [0.5, 0.4], [1.2, 0.3]]) {
  const hs: Record<string, number> = { 'h=r': r, tight: S === 'H3' ? Math.asinh(Math.sinh(r) / Math.cosh(R)) : Math.asin(Math.min(1, Math.sin(r) / Math.cos(R))) };
  if (S === 'S3' && R + r >= Math.PI / 2) { console.log(`${S} R=${R} r=${r}: R + r >= pi/2 -> no capped-tube bound (cap planes meet on the polar circle)`); continue; }
  const out: string[] = [];
  for (const [k, h] of Object.entries(hs)) {
    let viol = 0, maxCap = -Infinity;
    for (let i = 0; i < 40000; i++) {
      const th = 2 * Math.PI * Rg();
      const c = pointAt(S, [Math.cos(th), 0, Math.sin(th)], R);
      const q = flow(S, c, tangent(S, c, [...randDir(Rg), 0] as V4), r * Math.cbrt(Rg())).p;
      const cs = capSdf(S, q, h); maxCap = Math.max(maxCap, cs);
      if (cs > 1e-12 || radial(S, q) - (R + r) > 1e-12) viol++;
    }
    out.push(`${k} (h=${h.toFixed(4)}): outside ${viol}/40000, max cap sdf ${maxCap.toExponential(1)}`);
  }
  console.log(`${S} R=${R} r=${r}: ${out.join(' | ')}`);
}
