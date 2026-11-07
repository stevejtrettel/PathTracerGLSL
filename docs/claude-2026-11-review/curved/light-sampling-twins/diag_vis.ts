// Diagnostic: in the S3 furnace with a big ball, how often does the NEE visibility test
// (|t_hit - r| < 1e-7) reject an arc that is geometrically visible, and how much do they carry?
import { S3, O, E3, flow, logDir, frame, local, hitBallFromWall, ballNormal, rng, mul } from './geom.ts';
const sp = S3;
for (const R of [2.2, 3.0]) {
  const bl = { c: O, R }, rr = rng(99), fc = frame(sp, O, E3), area = sp.sphereArea(R);
  const wall = () => { const z = 1 - 2 * rr(), s = Math.sqrt(1 - z * z), ph = 2 * Math.PI * rr(); return flow(sp, O, local(fc, s * Math.cos(ph), s * Math.sin(ph), z), R).pos; };
  let n = 0, rejNear = 0, accepted = 0, sumAcc = 0, sumRej = 0, worst = 0;
  const M = 2000000;
  for (let i = 0; i < M; i++) {
    const y = wall(), yl = wall();
    const nIn = mul(ballNormal(sp, bl, y), -1);
    const { u, d } = logDir(sp, y, yl);
    for (const [uu, r] of [[u, d], [mul(u, -1), 2 * Math.PI - d]] as const) {
      const cx = sp.ip(uu, nIn); if (cx <= 0) continue;
      n++;
      const th = hitBallFromWall(sp, bl, uu), err = Math.abs(th - r);
      const vel = flow(sp, y, uu, r).vel;
      const val = cx * Math.abs(sp.ip(vel, ballNormal(sp, bl, yl))) / sp.A(r) * area / Math.PI;
      if (err < 1e-7) { accepted++; sumAcc += val; worst = Math.max(worst, err); }
      else if (err < 1e-2) { rejNear++; sumRej += val; }
    }
  }
  console.log(`S3 R=${R}: arcs with cos_x>0 ${n}; accepted ${accepted} (largest accepted error ${worst.toExponential(1)}); rejected with 1e-7<err<1e-2: ${rejNear}; mean NEE estimate of E/(pi Le) accepted ${(sumAcc / M).toFixed(6)}, lost to near-misses ${(sumRej / M).toExponential(2)}`);
}
