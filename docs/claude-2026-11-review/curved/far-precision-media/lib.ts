// Shared helpers for the H3/S3 far-limit and precision checks.
// Vectors are number[4]. H3: Minkowski form x1y1+x2y2+x3y3-x4y4, origin (0,0,0,1).
// S3: Euclidean R^4, origin (0,0,0,1).
export type V = number[];
export const f = Math.fround;

export const mink = (a: V, b: V) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2] - a[3]*b[3];
export const eucl = (a: V, b: V) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3];
export const add = (a: V, b: V) => a.map((x, i) => x + b[i]);
export const sub = (a: V, b: V) => a.map((x, i) => x - b[i]);
export const scale = (a: V, s: number) => a.map((x) => x * s);
export const n3 = (a: number[]) => Math.hypot(a[0], a[1], a[2]);
export const norm3 = (a: number[]) => { const l = n3(a); return [a[0]/l, a[1]/l, a[2]/l]; };
export const dot3 = (a: number[], b: number[]) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
export const ang3 = (a: number[], b: number[]) => {
    // stable angle between two (not necessarily unit) 3-vectors
    const ua = norm3(a), ub = norm3(b);
    const c = [ua[1]*ub[2]-ua[2]*ub[1], ua[2]*ub[0]-ua[0]*ub[2], ua[0]*ub[1]-ua[1]*ub[0]];
    return Math.atan2(n3(c), dot3(ua, ub));
};

// Deterministic RNG (mulberry32)
export function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
        s += 0x6D2B79F5; let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
export function unit3(r: () => number) {
    const z = 1 - 2 * r(), ph = 2 * Math.PI * r(), s = Math.sqrt(1 - z*z);
    return [s * Math.cos(ph), s * Math.sin(ph), z];
}

// ---------- H3 (float64) ----------
export const H_O: V = [0, 0, 0, 1];
/** Point at distance D from the origin in unit direction u. */
export const hPoint = (u: number[], D: number): V => [Math.sinh(D)*u[0], Math.sinh(D)*u[1], Math.sinh(D)*u[2], Math.cosh(D)];
/** Project an ambient vector to the tangent space at p and normalize (Minkowski). */
export function hTangent(p: V, a: V): V {
    const t = add(a, scale(p, mink(a, p)));          // a + <a,p> p  (since <p,p> = -1)
    return scale(t, 1 / Math.sqrt(mink(t, t)));
}
/** Uniformly random unit tangent at p: transport a random origin direction by the boost o -> p. */
export function hBoost(p: V): (a: V) => V {
    // Boost along the axis of p taking o to p. With p = (sinh D u, cosh D):
    const s = n3(p); const D = Math.asinh(s); const u = s > 0 ? [p[0]/s, p[1]/s, p[2]/s] : [1, 0, 0];
    const ch = Math.cosh(D), sh = Math.sinh(D);
    return (a: V) => {
        const ax = dot3(a, u);                       // component of spatial part along u
        const perp = [a[0]-ax*u[0], a[1]-ax*u[1], a[2]-ax*u[2]];
        const nx = ch*ax + sh*a[3], nw = sh*ax + ch*a[3];
        return [perp[0]+nx*u[0], perp[1]+nx*u[1], perp[2]+nx*u[2], nw];
    };
}
export const hFlow = (p: V, v: V, t: number): V => add(scale(p, Math.cosh(t)), scale(v, Math.sinh(t)));
export const hVel = (p: V, v: V, t: number): V => add(scale(p, Math.sinh(t)), scale(v, Math.cosh(t)));
/** Stable distance: <p-q,p-q>_M = 4 sinh^2(d/2). */
export const hDist = (p: V, q: V) => { const d = sub(p, q); return 2 * Math.asinh(Math.sqrt(Math.max(0, mink(d, d))) / 2); };
export const hDistAcosh = (p: V, q: V) => Math.acosh(Math.max(1, -mink(p, q)));
/** Renormalize an off-hyperboloid point onto <p,p> = -1. */
export const hRenorm = (p: V) => scale(p, 1 / Math.sqrt(-mink(p, p)));
/** Sky key (ideal point of the ray (p,v)), as a unit 3-vector: normalize((p+v).xyz). */
export const hKey = (p: V, v: V) => norm3(add(p, v));
/** Unit tangent at p toward the ideal point xi (unit 3-vector): (xh + <p,xh> p) / (-<p,xh>), xh = (xi, 1). */
export function hDirToIdeal(p: V, xi: number[]): V {
    const xh = [xi[0], xi[1], xi[2], 1];
    const c = mink(p, xh);
    return scale(add(xh, scale(p, c)), 1 / (-c));
}

// ---------- S3 (float64) ----------
export const sFlow = (p: V, v: V, t: number): V => add(scale(p, Math.cos(t)), scale(v, Math.sin(t)));
