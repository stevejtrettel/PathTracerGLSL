// Shared arithmetic for the geometry twins. Every op rounds through `r` (identity = float64,
// Math.fround = float32 with one rounding per op, roughly what a GPU without fma does).
export type V = number[];
export type M = number[][]; // row-major
export type Rnd = (x: number) => number;
export const F64: Rnd = (x) => x;
export const F32: Rnd = Math.fround;

export function mk(r: Rnd) {
  const A = {
    r,
    add: (a: V, b: V): V => a.map((x, i) => r(x + b[i])),
    sub: (a: V, b: V): V => a.map((x, i) => r(x - b[i])),
    scale: (a: V, s: number): V => a.map((x) => r(x * s)),
    lin: (s: number, a: V, t: number, b: V): V => a.map((x, i) => r(r(s * x) + r(t * b[i]))),
    // bilinear form with signature `sig` (entries ±1)
    form: (sig: number[]) => (a: V, b: V): number => {
      let s = 0;
      for (let i = 0; i < a.length; i++) s = r(s + sig[i] * r(a[i] * b[i]));
      return s;
    },
    sqrt: (x: number) => r(Math.sqrt(r(x))),
    cosh: (x: number) => r(Math.cosh(r(x))),
    // GLSL ES defines sinh(x) = (e^x - e^-x)/2 [mem]; in float32 that cancels for small x.
    sinhGLSL: (x: number) => r(r(r(Math.exp(x)) - r(Math.exp(-x))) / 2),
    sinh: (x: number) => r(Math.sinh(r(x))),
    matVec: (m: M, v: V): V => m.map((row) => { let s = 0; for (let j = 0; j < v.length; j++) s = r(s + r(row[j] * v[j])); return s; }),
    matMul: (a: M, b: M): M => a.map((row) => b[0].map((_, j) => { let s = 0; for (let k = 0; k < b.length; k++) s = r(s + r(row[k] * b[k][j])); return s; })),
    roundM: (m: M): M => m.map((row) => row.map(r)),
    roundV: (v: V): V => v.map(r),
  };
  return A;
}
export type Arith = ReturnType<typeof mk>;

export const transpose = (m: M): M => m[0].map((_, j) => m.map((row) => row[j]));
export const ident = (n: number): M => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
export function det(m: M): number {
  const n = m.length;
  if (n === 1) return m[0][0];
  let s = 0;
  for (let j = 0; j < n; j++) {
    const minor = m.slice(1).map((row) => row.filter((_, k) => k !== j));
    s += (j % 2 ? -1 : 1) * m[0][j] * det(minor);
  }
  return s;
}
export const maxAbs = (m: M) => Math.max(...m.flat().map(Math.abs));
export const subM = (a: M, b: M): M => a.map((row, i) => row.map((x, j) => x - b[i][j]));
export const col = (m: M, j: number): V => m.map((row) => row[j]);
export const fromCols = (cs: V[]): M => cs[0].map((_, i) => cs.map((c) => c[i]));

// Seeded RNG (mulberry32) so every run prints the same numbers.
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function randUnit3(u: () => number): V {
  const z = 2 * u() - 1, ph = 2 * Math.PI * u(), s = Math.sqrt(1 - z * z);
  return [s * Math.cos(ph), s * Math.sin(ph), z];
}
export const fmt = (x: number) => (Math.abs(x) < 1e-3 || Math.abs(x) >= 1e4) && x !== 0 ? x.toExponential(2) : x.toFixed(4);

// RK4 for y'' = f(y, y') on a chart.
export function rk4(f: (y: V, v: V) => V, y0: V, v0: V, T: number, n: number): { y: V; v: V } {
  let y = y0.slice(), v = v0.slice();
  const h = T / n;
  const ad = (a: V, b: V, s: number) => a.map((x, i) => x + s * b[i]);
  for (let k = 0; k < n; k++) {
    const k1y = v, k1v = f(y, v);
    const k2y = ad(v, k1v, h / 2), k2v = f(ad(y, k1y, h / 2), ad(v, k1v, h / 2));
    const k3y = ad(v, k2v, h / 2), k3v = f(ad(y, k2y, h / 2), ad(v, k2v, h / 2));
    const k4y = ad(v, k3v, h), k4v = f(ad(y, k3y, h), ad(v, k3v, h));
    y = y.map((x, i) => x + (h / 6) * (k1y[i] + 2 * k2y[i] + 2 * k3y[i] + k4y[i]));
    v = v.map((x, i) => x + (h / 6) * (k1v[i] + 2 * k2v[i] + 2 * k3v[i] + k4v[i]));
  }
  return { y, v };
}
// geodesic ODE of a conformal metric e^{2φ}δ: y'' = -2(∇φ·y')y' + |y'|²∇φ
export function conformalGeodesic(gradPhi: (y: V) => V) {
  return (y: V, v: V): V => {
    const g = gradPhi(y);
    const gv = g.reduce((s, x, i) => s + x * v[i], 0), vv = v.reduce((s, x) => s + x * x, 0);
    return v.map((x, i) => -2 * gv * x + vv * g[i]);
  };
}
