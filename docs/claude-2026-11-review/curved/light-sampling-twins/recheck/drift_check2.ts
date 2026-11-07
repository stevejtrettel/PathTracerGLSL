// Does a GENERIC per-vertex projection (hyperboloid renormalization + a normal computed AT
// the renormalized point) suffice, or is an object-specific snap onto the surface needed?
// H3 ball of radius R, center c = origin, chained wall-to-wall segments, far root of the
// general quadratic (no assumption that y lies on the wall).
import { H3, V4, flow, frame, local, rng, mul, sub, renormPoint, cosineHemi } from './geom.ts';
const sp = H3, C: V4 = [0, 0, 0, 1];
function farRoot(p: V4, v: V4, R: number): number {
  const a = -sp.ip(p, C), b = -sp.ip(v, C), K = Math.cosh(R);
  const disc = K * K - (a * a - b * b);
  if (disc < 0) return NaN;
  return Math.log((K + Math.sqrt(disc)) / (a + b));
}
// inward unit normal AT y (any on-model y): tangent projection of c at y, normalized
function inwardNormalAt(y: V4): V4 {
  const w = sub(C, mul(y, sp.ip(C, y) / sp.sgn));
  return mul(w, 1 / Math.sqrt(sp.ip(w, w)));
}
const snap = (y: V4, R: number): V4 => { const l = Math.hypot(y[0], y[1], y[2]), s = Math.sinh(R) / l; return [y[0]*s, y[1]*s, y[2]*s, Math.cosh(R)]; };
for (const R of [2, 4, 6, 8]) for (const mode of ['none', 'model', 'wall'] as const) {
  const rr = rng(5); let worstModel = 0, worstSurf = 0, bad = 0; const paths = 2000;
  for (let i = 0; i < paths; i++) {
    let y: V4 = [0, 0, Math.sinh(R), Math.cosh(R)];
    for (let k = 0; k < 8; k++) {
      let f;
      try { f = frame(sp, y, inwardNormalAt(y)); } catch { bad++; break; }
      if (f.some((e) => e.some((c) => !Number.isFinite(c)))) { bad++; break; }
      const [lx, ly, lz] = cosineHemi(rr(), rr());
      const v = local(f, lx, ly, lz);
      const t = farRoot(y, v, R);
      if (!Number.isFinite(t)) { bad++; break; }
      const g = flow(sp, y, v, t).pos;
      worstModel = Math.max(worstModel, Math.abs(sp.ip(g, g) + 1));
      const gm = renormPoint(sp, g);
      worstSurf = Math.max(worstSurf, Math.abs(Math.acosh(Math.max(1, -sp.ip(gm, C))) - R));
      y = mode === 'none' ? g : mode === 'model' ? gm : snap(g, R);
    }
  }
  console.log(`R=${R} ${mode.padEnd(5)} worst|<g,g>+1| per segment ${worstModel.toExponential(1)}  worst|d(g,c)-R| ${worstSurf.toExponential(1)}  failed ${bad}/${paths}`);
}
