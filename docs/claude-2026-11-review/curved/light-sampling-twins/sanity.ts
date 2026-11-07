// Geometry sanity: flow stays on the manifold, velocities are unit tangents, log inverts exp,
// the right-triangle formulas used for cone half-angles hold, and cone sampling is exact
// (directions just inside the cone hit the ball, just outside miss).
import { H3, S3, Space, O, E1, E2, E3, V4, flow, logDir, frame, local, makeDisk, hitDisk, hitBall, rng, lin, sub } from './geom.ts';

const r = rng(7);
let worst = 0;
function chk(label: string, x: number) { worst = Math.max(worst, Math.abs(x)); if (Math.abs(x) > 1e-9) console.log('FAIL', label, x); }

for (const sp of [H3, S3] as Space[]) {
  worst = 0;
  for (let i = 0; i < 2000; i++) {
    const f = frame(sp, O, E3);
    const z = 2 * r() - 1, ph = 2 * Math.PI * r(), s = Math.sqrt(1 - z * z);
    const v = local(f, s * Math.cos(ph), s * Math.sin(ph), z);
    const t = (sp.name === 'H3' ? 5 : 6.2) * r();
    const { pos, vel } = flow(sp, O, v, t);
    chk('onManifold', sp.ip(pos, pos) - sp.sgn);
    chk('velUnit', sp.ip(vel, vel) - 1);
    chk('velTangent', sp.ip(vel, pos));
    const L = logDir(sp, O, pos);
    const dExp = sp.name === 'S3' && t > Math.PI ? 2 * Math.PI - t : t;
    chk('logDist', L.d - dExp);
    // arrival velocity of the short geodesic O -> pos equals minus the direction from pos back
    // to O (so cos at the light needs only direction_to(y, x), no new seam)
    const back = logDir(sp, pos, O).u, arr = flow(sp, O, L.u, L.d).vel;
    chk('arrival=-direction_to(y,x)', Math.hypot(...lin(arr, 1, back, 1)));
    // S3 long arc: -u for length 2pi-d reaches the same point, arriving with -vel_short
    if (sp.name === 'S3') {
      const long = flow(sp, O, lin(L.u, -1, L.u, 0), 2 * Math.PI - L.d);
      chk('longArcPos', Math.hypot(...sub(long.pos, pos)));
      const short = flow(sp, O, L.u, L.d);
      chk('longArcVel', Math.hypot(...lin(long.vel, 1, short.vel, 1)));
    }
  }
  console.log(`${sp.name}: flow/log identities, worst abs error ${worst.toExponential(2)}`);

  // Disk perpendicular to the axis: boundary seen at tan(beta) = T(rho)/S(D)
  for (const [D, rho] of sp.name === 'H3' ? [[1, 0.7], [3, 2]] : [[1, 0.6], [2.5, 0.4]]) {
    const c = flow(sp, O, E3, D);
    const m = c.vel; // normal along the axis
    const dk = makeDisk(sp, c.pos, m, rho);
    const tanB = (sp.name === 'H3' ? Math.tanh(rho) / Math.sinh(D) : Math.tan(rho) / Math.sin(D));
    let beta = Math.atan(tanB); if (beta < 0) beta += Math.PI;
    let bad = 0;
    for (let k = 0; k < 200; k++) {
      const ph = 2 * Math.PI * r();
      for (const [th, want] of [[beta * (1 - 1e-7), true], [beta * (1 + 1e-7), false]] as [number, boolean][]) {
        const v = lin(lin(E1, Math.sin(th) * Math.cos(ph), E2, Math.sin(th) * Math.sin(ph)), 1, E3, Math.cos(th));
        const t = hitDisk(sp, dk, O, v, sp.name === 'H3' ? Infinity : Math.PI); // short side only
        if ((t < Infinity) !== want) bad++;
      }
    }
    console.log(`${sp.name}: disk D=${D} rho=${rho}: tan(beta)=T(rho)/S(D) boundary misclassified ${bad}/400`);
  }

  // Ball: cone half-angle sin(alpha) = S(R)/S(d); directions at alpha(1-eps) hit, alpha(1+eps) miss.
  // S3: the backward cone around -axis also hits (via the antipode).
  for (const [d, R] of sp.name === 'H3' ? [[1, 0.5], [4, 2.5], [0.3, 0.29]] : [[1, 0.5], [2.5, 0.4], [1.5, 1.4]]) {
    const c = flow(sp, O, E3, d).pos;
    const sinA = sp.S(R) / sp.S(d);
    const alpha = Math.asin(sinA);
    let bad = 0, badBack = 0;
    for (let k = 0; k < 200; k++) {
      const ph = 2 * Math.PI * r();
      for (const [th, want] of [[alpha * (1 - 1e-7), true], [alpha * (1 + 1e-7), false]] as [number, boolean][]) {
        const v = lin(lin(E1, Math.sin(th) * Math.cos(ph), E2, Math.sin(th) * Math.sin(ph)), 1, E3, Math.cos(th));
        const tmax = sp.name === 'H3' ? Infinity : 2 * Math.PI;
        if ((hitBall(sp, { c, R }, O, v, tmax) < Infinity) !== want) bad++;
        if (sp.name === 'S3') {
          const vb = lin(lin(E1, Math.sin(th) * Math.cos(ph), E2, Math.sin(th) * Math.sin(ph)), 1, E3, -Math.cos(th));
          if ((hitBall(sp, { c, R }, O, vb, tmax) < Infinity) !== want) badBack++;
        }
      }
    }
    console.log(`${sp.name}: ball d=${d} R=${R} alpha=${alpha.toFixed(6)}: forward cone misclassified ${bad}/400` +
      (sp.name === 'S3' ? `, backward cone misclassified ${badBack}/400` : ''));
  }
}
