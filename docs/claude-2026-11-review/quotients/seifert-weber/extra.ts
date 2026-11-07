// Extra cross-checks: face angle, ∂D area, Kac/Santaló mean time between face crossings, number field of all 12 generators.
// Re-uses sw.ts by importing nothing (sw.ts runs on import); recompute what is needed.
const SQ5 = Math.sqrt(5), PHI = (1 + SQ5) / 2;
const mink = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] - a[3] * b[3];
const rIn = Math.acosh(Math.sqrt((5 + 2 * SQ5) / 4));
const rCirc = Math.acosh((7 + 3 * SQ5) / 4);
// a face: normal (0,1,φ). Its 5 vertices (Klein radius tanh R_c, directions from the vertex list) — take those with n̂·v̂ maximal.
const raw: number[][] = [];
for (const a of [1, -1]) for (const b of [1, -1]) for (const c of [1, -1]) raw.push([a, b, c]);
for (const a of [1, -1]) for (const b of [1, -1]) raw.push([a / PHI, 0, b * PHI], [0, a * PHI, b / PHI], [a * PHI, b / PHI, 0]);
const n0 = [0, 1, PHI].map((x) => x / Math.hypot(1, PHI));
const k = Math.tanh(rCirc);
const lift = (v: number[]) => { const n = Math.hypot(...v); const kv = v.map((x) => (x / n) * k); const s = 1 / Math.sqrt(1 - k * k); return [kv[0] * s, kv[1] * s, kv[2] * s, s]; };
const dots = raw.map((v) => (v[0] * n0[0] + v[1] * n0[1] + v[2] * n0[2]) / Math.hypot(...v));
const mx = Math.max(...dots);
const fv = raw.filter((_, i) => Math.abs(dots[i] - mx) < 1e-9).map(lift);
console.log("vertices on face:", fv.length);
// angle at vertex A between geodesics to its two neighbours B, C on the face: tangent dirs (B + <B,A>A)
const tang = (A: number[], B: number[]) => { const c = mink(A, B); const w = B.map((x, i) => x + c * A[i]); const n = Math.sqrt(mink(w, w)); return w.map((x) => x / n); };
const A = fv[0];
const dist = fv.map((B) => Math.acosh(Math.max(1, -mink(A, B))));
const nb = fv.map((_, i) => i).filter((i) => i > 0).sort((i, j) => dist[i] - dist[j]).slice(0, 2);
const ang = Math.acos(mink(tang(A, fv[nb[0]]), tang(A, fv[nb[1]])));
console.log("edge length", dist[nb[0]], " face angle (deg)", ang * 180 / Math.PI);
const pentArea = 3 * Math.PI - 5 * ang;
const areaD = 12 * pentArea;
const vol = 11.1990647;
console.log({ pentArea, areaD, meanTimeBetweenCrossings_Kac: (4 * vol) / areaD, measured: "0.957–0.960 (out-teleport.txt)" });
// closed form check: cos(face angle)? print value
console.log("cos(face angle) =", Math.cos(ang), " (1−√5)/... candidates:", (1 - SQ5) / 4, 1 / SQ5, (SQ5 - 1) / 2 - 0);
