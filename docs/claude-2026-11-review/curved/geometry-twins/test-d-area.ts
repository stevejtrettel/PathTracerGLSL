// (d) area density A(r[,dir]) = |d exp_o(r ω)/dθ ∧ d/dφ| / sinθ, by central differences of the
// closed-form flow, Gram determinant in the ambient form (positive definite on tangents).
import { mk, F64, V, fmt } from './common.ts';
import { E3 } from './e3.ts';
import { H3 } from './h3.ts';
import { S3 } from './s3.ts';
import { H2R } from './h2r.ts';

const A = mk(F64);
const h = 1e-6;
for (const S of [E3(A), H3(A), S3(A), H2R(A)] as any[]) {
  let worst = 0;
  const rows: string[] = [];
  const rs = S.name === 'S3' ? [0.01, 0.5, 1, 2, 3, 3.1, 4, 6] : [0.01, 0.5, 1, 2, 4, 6];
  for (const r of rs) {
    for (const th of [0.3, 1.0, Math.PI / 2, 2.5]) {
      const ph = 0.7;
      const x = (t: number, f: number) => S.pointAt([Math.sin(t) * Math.cos(f), Math.sin(t) * Math.sin(f), Math.cos(t)], r);
      const dT = x(th + h, ph).map((a: number, i: number) => (a - x(th - h, ph)[i]) / (2 * h));
      const dF = x(th, ph + h).map((a: number, i: number) => (a - x(th, ph - h)[i]) / (2 * h));
      const g = S.ip(dT, dT) * S.ip(dF, dF) - S.ip(dT, dF) ** 2;
      const Afd = Math.sqrt(g) / Math.sin(th);
      // for H2R pass the direction at the origin in model coords (z = vertical = basis[2])
      const dir = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), 0, Math.cos(th)];
      const Af = S.areaDensity(r, dir);
      const rel = Math.abs(Afd - Af) / Math.max(Af, 1e-300);
      worst = Math.max(worst, Af > 1e-12 ? rel : 0);
      if (th === 1.0) rows.push(`r=${r}: fd ${fmt(Afd)} formula ${fmt(Af)}`);
    }
  }
  console.log(`${S.name}: worst rel err fd vs formula ${fmt(worst)}  [${rows.join('; ')}]`);
}
// pdf conversion sanity: Monte Carlo — sample uniform directions at the origin, march to a
// geodesic sphere of radius R; the fraction landing in a patch of area ΔA must be
// ΔA / (4π A(R)) in H3/S3 (isotropic). Checked for H3 by integrating A over the sphere:
// total area of the geodesic sphere = 4π sinh²R. (closed form, no sampling needed)
console.log('H3 sphere area 4π sinh²(1) =', fmt(4 * Math.PI * Math.sinh(1) ** 2), '; S3 at r=π: A=', fmt(Math.sin(Math.PI) ** 2), '(focal: every geodesic from p meets at -p)');
