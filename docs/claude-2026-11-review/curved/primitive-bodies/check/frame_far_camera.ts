// Checker's independent test. H3 ball, robust formula, object-frame scheme (B), float32.
// Question: does the object-frame error depend on the RELATIVE distance d (camera->object) only,
// or also on the camera's distance D from the world origin? Also: how wide is the misclassified
// silhouette band in radians (pixel ~ 1e-3 rad)?
import { V4, dist, flow, rng, randDir, F } from '../lib.ts';
import { ballHitH3 } from '../ball.ts';
type M4 = number[][];
function boost(u: number[], d: number): M4 {
  const c = Math.cosh(d), s = Math.sinh(d);
  const M: M4 = [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
  for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) M[i][j] += (c - 1) * u[i] * u[j]; M[i][3] = s * u[i]; M[3][i] = s * u[i]; }
  M[3][3] = c; return M;
}
const mm = (A: M4, B: M4): M4 => A.map((r) => [0,1,2,3].map(j => r.reduce((s, x, k) => s + x * B[k][j], 0)));
const ap = (M: M4, x: V4): V4 => M.map(r => r[0]*x[0]+r[1]*x[1]+r[2]*x[2]+r[3]*x[3]) as V4;
const ap32 = (M: M4, x: V4): V4 => [0,1,2,3].map(i => { let a = 0; for (let j = 0; j < 4; j++) a = F(a + F(F(M[i][j]) * F(x[j]))); return a; }) as V4;
function robust32(p: V4, v: V4, R: number) {
  const a = p[3], b = v[3];
  const cx = F(F(p[1]*v[2]) - F(p[2]*v[1])), cy = F(F(p[2]*v[0]) - F(p[0]*v[2])), cz = F(F(p[0]*v[1]) - F(p[1]*v[0]));
  const C = F(Math.cosh(R)), Sr = F(Math.sinh(R));
  const cr = F(F(F(cx*cx) + F(cy*cy)) + F(cz*cz)); const D = F(F(Sr*Sr) - cr); if (D < 0) return null;
  const s = F(a + Math.abs(b)), o = F(F(1 + cr) / s); const apb = b >= 0 ? s : o, amb = b >= 0 ? o : s;
  const q = F(C + F(Math.sqrt(D))); const P2 = F(F(F(p[0]*p[0]) + F(p[1]*p[1])) + F(p[2]*p[2]));
  const t = F(Math.log(P2 < F(Sr*Sr) ? F(q / apb) : F(amb / q))); return t > 0 ? t : null;
}
for (const R of [0.1, 1.0]) for (const d of [1, 3]) for (const Dcam of [0, 3, 6]) {
  const Rg = rng(11); let bad = 0; const N = 4000; let th0 = 0;
  for (let i = 0; i < N; i++) {
    const w = randDir(Rg), u = randDir(Rg);
    const Mcam = boost(w, Dcam);                 // camera placement (world)
    const Mobj = mm(Mcam, boost(u, d));          // object placement (world) = camera * relative
    const Minv = mm(boost(u, -d), boost(w, -Dcam));
    const th = Math.asin(Math.sinh(R) / Math.sinh(d)) * (0.9 + 0.2 * Rg()); th0 = Math.asin(Math.sinh(R) / Math.sinh(d));
    let e = randDir(Rg); const k = e[0]*u[0]+e[1]*u[1]+e[2]*u[2]; e = [e[0]-k*u[0], e[1]-k*u[1], e[2]-k*u[2]]; const ne = Math.hypot(...e); e = e.map(x => x/ne) as any;
    const dir = [0,1,2].map(j => Math.cos(th)*u[j] + Math.sin(th)*e[j]);
    const pc: V4 = [0,0,0,1], vc: V4 = [dir[0], dir[1], dir[2], 0];
    // world ray in f32 (as stored on the GPU), then object frame in f32
    const pw = ap32(Mcam, pc), vw = ap32(Mcam, vc);
    const pl = ap32(Minv, pw), vl = ap32(Minv, vw);
    const ref = ballHitH3(ap(boost(u, -d), pc), ap(boost(u, -d), vc), R);
    const tb = robust32(pl, vl, R);
    if ((tb === null) !== (ref === null)) bad++;
    void Mobj; void dist; void flow;
  }
  const frac = bad / N;
  console.log(`R=${R} d(cam->obj)=${d} Dcam(world)=${Dcam}: object-frame wrong ${(100*frac).toFixed(2)}% of rays in the +-10% silhouette band; silhouette angle ${th0.toExponential(2)} rad, wrong band ~${(frac*0.2*th0).toExponential(1)} rad`);
}
// Band widths implied by primitive-bodies' own (B) percentages, camera at the world origin:
for (const [R, d, f] of [[0.1, 6, 0.034], [0.1, 8, 0.459], [0.01, 6, 0.29]]) {
  const th = Math.asin(Math.sinh(R) / Math.sinh(d));
  console.log(`agent case R=${R} d=${d}: silhouette ${th.toExponential(2)} rad, wrong band ~${(f*0.2*th).toExponential(1)} rad (pixel ~1e-3 rad)`);
}
