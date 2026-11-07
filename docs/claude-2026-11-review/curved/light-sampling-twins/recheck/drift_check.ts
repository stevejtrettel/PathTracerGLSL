// Independent check of the H3 drift claim. Chains wall-to-wall segments in an H3 ball of
// radius R (center at origin) and reports the model error |<y,y>+1| and the surface error
// |dist(y,c)-R| after each bounce, for three treatments of the hit point:
//   none   : y = flow(p,v,t)
//   model  : y rescaled onto the hyperboloid only
//   wall   : y snapped onto the wall in the ball's frame
// Intersection uses EITHER the closed-form other root (assumes y on the wall) OR the general
// quadratic far root (no assumption). Frames: longest-candidate Gram-Schmidt (geom.ts).
import { H3, V4, flow, frame, local, hitBallFromWall, ballNormal, rng, mul, renormPoint, cosineHemi } from './geom.ts';
const sp = H3;
function farRoot(p: V4, v: V4, R: number): number {
  // a cosh t + b sinh t = cosh R, a = -<p,c>, b = -<v,c>, c = origin -> a = p4, b = v4
  const a = p[3], b = v[3], K = Math.cosh(R);
  const disc = K * K - (a * a - b * b);
  if (disc < 0) return NaN;
  const sq = Math.sqrt(disc);
  const z = (K + sq) / (a + b); // larger root in z = e^t  (a+b>0)
  return Math.log(z);
}
const snap = (y: V4, R: number): V4 => { const l = Math.hypot(y[0], y[1], y[2]), s = Math.sinh(R) / l; return [y[0]*s, y[1]*s, y[2]*s, Math.cosh(R)]; };
for (const R of [2, 4, 6]) for (const isect of ['closed', 'quadratic'] as const) for (const mode of ['none', 'model', 'wall'] as const) {
  const rr = rng(5); let worstModel = 0, worstSurf = 0, nan = 0; const paths = 2000;
  for (let i = 0; i < paths; i++) {
    let y: V4 = [0, 0, Math.sinh(R), Math.cosh(R)];
    for (let k = 0; k < 8; k++) {
      const nIn = mul(ballNormal(sp, { c: [0,0,0,1], R }, y), -1);
      const f = frame(sp, y, nIn);
      if (f.some((e) => e.some((c) => !Number.isFinite(c)))) { nan++; break; }
      const [lx, ly, lz] = cosineHemi(rr(), rr());
      const v = local(f, lx, ly, lz);
      const t = isect === 'closed' ? hitBallFromWall(sp, { c: [0,0,0,1], R }, v) : farRoot(y, v, R);
      if (!Number.isFinite(t)) { nan++; break; }
      let g = flow(sp, y, v, t).pos;
      worstModel = Math.max(worstModel, Math.abs(sp.ip(g, g) + 1));
      worstSurf = Math.max(worstSurf, Math.abs(Math.acosh(Math.max(1, g[3])) - R));
      y = mode === 'none' ? g : mode === 'model' ? renormPoint(sp, g) : snap(g, R);
    }
  }
  console.log(`R=${R} isect=${isect.padEnd(9)} ${mode.padEnd(5)} worst|<y,y>+1| ${worstModel.toExponential(1)}  worst|d-R| ${worstSurf.toExponential(1)}  failed paths ${nan}/${paths}`);
}
