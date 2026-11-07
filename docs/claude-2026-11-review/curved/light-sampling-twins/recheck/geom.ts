// Float64 twins of H3 (hyperboloid, <x,y> = x1y1+x2y2+x3y3-x4y4, origin (0,0,0,1)) and
// S3 (unit sphere in R4, origin (0,0,0,1)). Points and tangent vectors are 4-vectors.
// Everything a light sampler needs is written once against a Space record.

export type V4 = [number, number, number, number];

export interface Space {
  name: 'H3' | 'S3';
  sgn: number; // <p,p> for a point: -1 (H3), +1 (S3)
  ip(a: V4, b: V4): number;
  C(t: number): number; // cosh / cos
  S(t: number): number; // sinh / sin
  dC(t: number): number; // derivative of C: sinh / -sin
  A(r: number): number; // area density of the exp map: sinh^2 / sin^2
  dist(p: V4, q: V4): number;
  // area of a geodesic disk of radius rho (in a totally geodesic plane) and of a sphere of radius R
  diskArea(rho: number): number;
  sphereArea(R: number): number;
  // inverse CDF of the disk radius for uniform area sampling
  diskRadius(rho: number, u: number): number;
}

export const add = (a: V4, b: V4): V4 => [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
export const sub = (a: V4, b: V4): V4 => [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]];
export const mul = (a: V4, s: number): V4 => [a[0] * s, a[1] * s, a[2] * s, a[3] * s];
export const lin = (a: V4, s: number, b: V4, t: number): V4 => [
  a[0] * s + b[0] * t, a[1] * s + b[1] * t, a[2] * s + b[2] * t, a[3] * s + b[3] * t,
];

export const H3: Space = {
  name: 'H3',
  sgn: -1,
  ip: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] - a[3] * b[3],
  C: Math.cosh,
  S: Math.sinh,
  dC: Math.sinh,
  A: (r) => Math.sinh(r) ** 2,
  dist: (p, q) => Math.acosh(Math.max(1, -H3.ip(p, q))),
  diskArea: (rho) => 2 * Math.PI * (Math.cosh(rho) - 1),
  sphereArea: (R) => 4 * Math.PI * Math.sinh(R) ** 2,
  diskRadius: (rho, u) => Math.acosh(1 + u * (Math.cosh(rho) - 1)),
};

export const S3: Space = {
  name: 'S3',
  sgn: 1,
  ip: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3],
  C: Math.cos,
  S: Math.sin,
  dC: (t) => -Math.sin(t),
  A: (r) => Math.sin(r) ** 2,
  dist: (p, q) => {
    // stable: 2 atan2(|p-q|, |p+q|)
    const d = sub(p, q), s = add(p, q);
    return 2 * Math.atan2(Math.hypot(...d), Math.hypot(...s));
  },
  diskArea: (rho) => 2 * Math.PI * (1 - Math.cos(rho)),
  sphereArea: (R) => 4 * Math.PI * Math.sin(R) ** 2,
  diskRadius: (rho, u) => Math.acos(1 - u * (1 - Math.cos(rho))),
};

export const O: V4 = [0, 0, 0, 1];
export const E1: V4 = [1, 0, 0, 0];
export const E2: V4 = [0, 1, 0, 0];
export const E3: V4 = [0, 0, 1, 0];

// geodesic from p with unit tangent v: position and velocity at arc length t
export function flow(sp: Space, p: V4, v: V4, t: number): { pos: V4; vel: V4 } {
  const c = sp.C(t), s = sp.S(t);
  // H3: pos = cosh t p + sinh t v, vel = sinh t p + cosh t v
  // S3: pos = cos t p + sin t v,   vel = -sin t p + cos t v
  return { pos: lin(p, c, v, s), vel: lin(p, sp.dC(t), v, c) };
}

// project e onto the tangent space at p, then remove components along `others`, normalize
export function tangentGS(sp: Space, p: V4, e: V4, others: V4[]): V4 {
  let w = sub(e, mul(p, sp.ip(e, p) / sp.sgn));
  for (const o of others) w = sub(w, mul(o, sp.ip(w, o)));
  const n = Math.sqrt(sp.ip(w, w));
  return mul(w, 1 / n);
}

// orthonormal tangent frame at p with third vector n
export function frame(sp: Space, p: V4, n: V4): [V4, V4, V4] {
  // Gram-Schmidt of the coordinate axes against p and n, keeping the candidate with the
  // largest remaining length (far from the origin in H3 every candidate shrinks a lot).
  const cands: V4[] = [E1, E2, E3, O];
  const pick = (others: V4[]): V4 => {
    let best: V4 | null = null, bl = -1;
    for (const e of cands) {
      let w = sub(e, mul(p, sp.ip(e, p) / sp.sgn));
      for (const o of others) w = sub(w, mul(o, sp.ip(w, o)));
      const l2 = sp.ip(w, w);
      if (l2 > bl) { bl = l2; best = w; }
    }
    return mul(best!, 1 / Math.sqrt(bl));
  };
  const t1 = pick([n]);
  const t2 = pick([n, t1]);
  return [t1, t2, n];
}

export function local(f: [V4, V4, V4], x: number, y: number, z: number): V4 {
  return add(add(mul(f[0], x), mul(f[1], y)), mul(f[2], z));
}

// log map: unit initial direction and length of the geodesic(s) p -> q.
// H3: one. S3: short arc (u, d) and long arc (-u, 2pi - d).
export function logDir(sp: Space, p: V4, q: V4): { u: V4; d: number } {
  const d = sp.dist(p, q);
  // q = C(d) p + S(d) u
  const u = mul(sub(q, mul(p, sp.C(d))), 1 / sp.S(d));
  return { u, d };
}

// ---------- emitters ----------

// Geodesic disk: center c, unit normal m (tangent at c), radius rho, inside the totally
// geodesic plane {p : <p,m> = 0}.
export interface Disk { c: V4; m: V4; rho: number; f1: V4; f2: V4 }
export function makeDisk(sp: Space, c: V4, m: V4, rho: number): Disk {
  const [f1, f2] = frame(sp, c, m);
  return { c, m, rho, f1, f2 };
}

export function inDisk(sp: Space, dk: Disk, y: V4): boolean {
  return sp.dist(y, dk.c) <= dk.rho;
}

// first hit t in (eps, tmax) of the geodesic (p,v) with the disk
export function hitDisk(sp: Space, dk: Disk, p: V4, v: V4, tmax: number): number {
  const a = sp.ip(p, dk.m), b = sp.ip(v, dk.m);
  const ts: number[] = [];
  if (sp.name === 'H3') {
    // a cosh t + b sinh t = 0  ->  tanh t = -a/b
    const r = -a / b;
    if (Math.abs(r) < 1) ts.push(Math.atanh(r));
  } else {
    // a cos t + b sin t = 0, roots spaced by pi
    let t0 = Math.atan2(-a, b);
    t0 = ((t0 % Math.PI) + Math.PI) % Math.PI;
    ts.push(t0, t0 + Math.PI);
  }
  ts.sort((x, y) => x - y);
  for (const t of ts) {
    if (t <= 1e-12 || t >= tmax) continue;
    const { pos } = flow(sp, p, v, t);
    if (inDisk(sp, dk, pos)) return t;
  }
  return Infinity;
}

export function sampleDisk(sp: Space, dk: Disk, u1: number, u2: number): V4 {
  const s = sp.diskRadius(dk.rho, u1);
  const phi = 2 * Math.PI * u2;
  const w = add(mul(dk.f1, Math.cos(phi)), mul(dk.f2, Math.sin(phi)));
  return lin(dk.c, sp.C(s), w, sp.S(s));
}

// Geodesic ball: center c, radius R. Distance from p: H3 cosh d = -<p,c>, S3 cos d = <p,c>.
export interface Ball { c: V4; R: number }

// first hit t in (eps, tmax) of the geodesic (p,v) with the ball's boundary sphere
export function hitBall(sp: Space, bl: Ball, p: V4, v: V4, tmax: number): number {
  if (sp.name === 'H3') {
    const a = -sp.ip(p, bl.c), b = -sp.ip(v, bl.c), K = Math.cosh(bl.R);
    // a cosh t + b sinh t = K ; z = e^t: (a+b) z^2 - 2K z + (a-b) = 0
    const disc = K * K - (a * a - b * b);
    if (disc < 0) return Infinity;
    const sq = Math.sqrt(disc);
    const ts = [(K - sq) / (a + b), (K + sq) / (a + b)].map((z) => (z > 0 ? Math.log(z) : -Infinity));
    for (const t of ts.sort((x, y) => x - y)) if (t > 1e-9 && t < tmax) return t;
    return Infinity;
  } else {
    const a = sp.ip(p, bl.c), b = sp.ip(v, bl.c), K = Math.cos(bl.R);
    const r = Math.hypot(a, b);
    if (K > r) return Infinity;
    const phi = Math.atan2(b, a), da = Math.acos(K / r);
    const ts: number[] = [];
    for (const t of [phi - da, phi + da]) {
      for (let k = -1; k <= 2; k++) ts.push(t + 2 * Math.PI * k);
    }
    ts.sort((x, y) => x - y);
    for (const t of ts) if (t > 1e-9 && t < tmax) return t;
    return Infinity;
  }
}

// outward unit normal of the ball at boundary point y
export function ballNormal(sp: Space, bl: Ball, y: V4): V4 {
  // the radial geodesic from c reaches y at R with velocity = outward normal
  const { u } = logDir(sp, bl.c, y);
  return flow(sp, bl.c, u, bl.R).vel;
}

// ---------- RNG (sfc32, 53-bit doubles) ----------
export function rng(seed: number): () => number {
  let a = 0x9e3779b9 ^ seed, b = 0x243f6a88, c = 0xb7e15162, d = seed | 0;
  const next = () => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 20; i++) next();
  return () => (next() * 2 ** 21 + (next() >>> 11)) / 2 ** 53;
}

// ---------- statistics ----------
export class Stat {
  n = 0; s = 0; s2 = 0;
  add(x: number) { this.n++; this.s += x; this.s2 += x * x; }
  get mean() { return this.s / this.n; }
  get se() { const m = this.mean; return Math.sqrt(Math.max(0, this.s2 / this.n - m * m) / this.n); }
}

export function report(label: string, st: Stat, expected?: number): string {
  const m = st.mean, se = st.se;
  let line = `${label.padEnd(46)} mean ${m.toPrecision(7)}  se ${se.toPrecision(2)}`;
  if (expected !== undefined) {
    const z = se > 0 ? ((m - expected) / se).toFixed(2) : (Math.abs(m - expected) < 1e-9 * Math.max(1, Math.abs(expected)) ? 'exact (zero variance)' : 'MISMATCH');
    line += `  expected ${expected.toPrecision(7)}  z ${z}`;
  }
  return line;
}

export function cosineHemi(u1: number, u2: number): [number, number, number] {
  const r = Math.sqrt(u1), phi = 2 * Math.PI * u2;
  return [r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(Math.max(0, 1 - u1))];
}

// Ray leaving a point ON the boundary sphere of a ball (inward or outward): the other root in
// closed form, no epsilon. H3: tanh(t/2) = -b/cosh R with b = -<v,c>; S3: tan(t/2) = b/cos R
// with b = <v,c>, t/2 taken in (0, pi).
export function hitBallFromWall(sp: Space, bl: Ball, v: V4): number {
  if (sp.name === 'H3') {
    const b = -sp.ip(v, bl.c), r = -b / Math.cosh(bl.R);
    return r > 0 && r < 1 ? 2 * Math.atanh(r) : Infinity;
  }
  const b = sp.ip(v, bl.c);
  let h = Math.atan2(b, Math.cos(bl.R));
  if (h <= 0) h += Math.PI;
  return 2 * h;
}

// Project a drifted point back onto the model (<p,p> = sgn). H3's geodesic flow amplifies
// off-model error by ~e^{2t} per segment, so chained segments need this at every vertex.
export function renormPoint(sp: Space, p: V4): V4 {
  return mul(p, 1 / Math.sqrt(sp.ip(p, p) / sp.sgn));
}
