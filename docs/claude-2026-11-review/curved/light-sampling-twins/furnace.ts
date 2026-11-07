// Closed furnace: camera inside a geodesic ball of radius R whose wall is Lambertian with
// albedo rho and emits Le. With at most N scattering events the radiance is
// Le * sum_{k=0..N} rho^k (-> Le/(1-rho)). Three estimators: pt (BSDF only), pt-nee, pt-mis.
// NEE samples the wall uniformly in curved area (4 pi S(R)^2); S3 sums both arcs, each
// with its own visibility (a ball with R > pi/2 is not convex in S3).
import { H3, S3, Space, O, E1, E3, V4, flow, logDir, frame, local, hitBall, hitBallFromWall, ballNormal, Ball, rng, Stat, report, cosineHemi, mul, renormPoint } from './geom.ts';

// Re-derive the hit point in the ball's local frame (center at the origin): keep the spatial
// direction, set the spatial length to S(R) and the 4th coordinate to C(R).
function snapToWall(sp: Space, y: V4, R: number): V4 {
  const l = Math.hypot(y[0], y[1], y[2]), s = sp.S(R) / l;
  return [y[0] * s, y[1] * s, y[2] * s, sp.C(R)];
}

const NP = Number(process.env.N ?? 300000);
const LE = 1, RHO = 0.8, NB = 6;
const expected = LE * (1 - RHO ** (NB + 1)) / (1 - RHO);
const lines: string[] = [];
const say = (s: string) => { console.log(s); lines.push(s); };

function arcs(sp: Space, x: V4, y: V4) {
  const { u, d } = logDir(sp, x, y);
  const out = [{ u, r: d, vel: flow(sp, x, u, d).vel }];
  if (sp.name === 'S3') { const mu = mul(u, -1); out.push({ u: mu, r: 2 * Math.PI - d, vel: flow(sp, x, mu, 2 * Math.PI - d).vel }); }
  return out;
}

function furnace(sp: Space, R: number, mode: 'pt' | 'nee' | 'mis', seed: number, camDist = R / 2, exp: number | undefined = expected) {
  const bl: Ball = { c: O, R };
  const tmax = sp.name === 'H3' ? Infinity : 2 * Math.PI;
  const area = sp.sphereArea(R);
  const rr = rng(seed);
  const fc = frame(sp, O, E3);
  const sampleWall = (): V4 => {
    const z = 1 - 2 * rr(), s = Math.sqrt(Math.max(0, 1 - z * z)), ph = 2 * Math.PI * rr();
    return flow(sp, O, local(fc, s * Math.cos(ph), s * Math.sin(ph), z), R).pos;
  };
  const x0 = flow(sp, O, E1, camDist).pos;
  const f0 = frame(sp, x0, flow(sp, O, E1, camDist).vel);
  const st = new Stat(); const drift = new Stat();
  let lost = 0;
  for (let i = 0; i < NP; i++) {
    // camera ray: uniform direction from x0
    const z = 1 - 2 * rr(), s = Math.sqrt(1 - z * z), ph = 2 * Math.PI * rr();
    let p = x0, v = local(f0, s * Math.cos(ph), s * Math.sin(ph), z);
    let L = 0, beta = 1;
    let t = hitBall(sp, bl, p, v, tmax);
    if (t === Infinity) { lost++; st.add(0); continue; } // S3, R > pi/2: this great circle lies inside the ball
    let g = flow(sp, p, v, t);
    L += LE; // camera ray sees the wall directly (weight 1 in every estimator)
    for (let k = 1; k <= NB; k++) {
      const y = (process.env.RENORM ?? 'wall') === 'wall' ? snapToWall(sp, g.pos, R)
        : process.env.RENORM === 'model' ? renormPoint(sp, g.pos) : g.pos;
      if (k === NB) drift.add(Math.abs(sp.ip(g.pos, g.pos) - sp.sgn));
      const nIn = mul(ballNormal(sp, bl, y), -1);
      // NEE at vertex k
      if (mode !== 'pt') {
        const yl = sampleWall();
        for (const a of arcs(sp, y, yl)) {
          const cx = sp.ip(a.u, nIn);
          if (cx <= 0) continue;
          const th = hitBallFromWall(sp, bl, a.u);
          if (!(Math.abs(th - a.r) < 1e-7)) continue;
          const cy = Math.abs(sp.ip(a.vel, ballNormal(sp, bl, yl)));
          const pl = sp.A(a.r) / (cy * area); // solid-angle pdf of NEE
          const pb = cx / Math.PI;
          const w = mode === 'mis' ? pl * pl / (pl * pl + pb * pb) : 1;
          L += beta * w * (RHO / Math.PI) * LE * cx / pl;
        }
      }
      // BSDF continuation (cosine), throughput * rho
      const fr = frame(sp, y, nIn);
      const [lx, ly, lz] = cosineHemi(rr(), rr());
      v = local(fr, lx, ly, lz);
      p = y;
      beta *= RHO;
      t = hitBallFromWall(sp, bl, v);
      if (t === Infinity) { lost++; break; }
      g = flow(sp, p, v, t);
      if (mode === 'pt') L += beta * LE;
      else if (mode === 'mis') {
        const cy = Math.abs(sp.ip(g.vel, ballNormal(sp, bl, g.pos)));
        const pl = sp.A(t) / (cy * area), pb = lz / Math.PI;
        L += beta * LE * pb * pb / (pl * pl + pb * pb);
      }
    }
    st.add(L);
  }
  say(report(`  ${sp.name} R=${R} cam@${camDist.toFixed(2)} ${mode}`, st, exp) + (lost ? `  never reach wall ${lost}` : '') + `  mean|<y,y>-sgn| at last vertex ${drift.mean.toExponential(1)}`);
}

say(`furnace: Le=${LE} rho=${RHO} maxBounces=${NB}; expected Le*sum rho^k = ${expected}; paths=${NP}`);
let seed = Number(process.env.SEED ?? 1);
const modes = ['pt', 'nee', 'mis'] as const;
for (const R of [0.5, 2, 4]) for (const m of modes) furnace(H3, R, m, seed++);
for (const R of [0.5, 1.4]) for (const m of modes) furnace(S3, R, m, seed++);
// S3 balls with R > pi/2 are not convex; from the center every geodesic reaches the wall and
// from a wall point every geodesic returns to the wall, so it is still a closed furnace.
for (const R of [2.2, 3.0]) for (const m of modes) furnace(S3, R, m, seed++, 0);
// Off-center camera in a big S3 ball: some camera geodesics are great circles that never leave
// the ball (they score 0), so there is no closed form; the three estimators must still agree.
// The great circle through the camera in direction theta (from the camera->center axis) stays
// at distance >= h from the center with sin h = sin(d0) sin(theta), so it never reaches the
// wall iff pi - h < R, i.e. sin(theta) > sin(R)/sin(d0). Those rays score 0 (no sky in S3).
{
  const R = 2.2, d0 = 1.1, sinT = Math.sin(R) / Math.sin(d0);
  const hitFrac = 1 - Math.sqrt(1 - sinT * sinT);
  say(`  off-center camera in an S3 ball with R > pi/2: fraction of camera rays that reach the wall ${hitFrac.toFixed(6)}`);
  for (const m of modes) furnace(S3, R, m, seed++, d0, hitFrac * expected);
}
import { writeFileSync } from 'node:fs';
writeFileSync(new URL('./furnace.out.txt', import.meta.url), lines.join('\n') + '\n');
