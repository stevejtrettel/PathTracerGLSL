// Shared helpers for the curved-space primitive checks (float64 unless a function says f32).
// H3: hyperboloid <x,y> = x1y1+x2y2+x3y3-x4y4, origin O=(0,0,0,1). S3: unit sphere in R4, O=(0,0,0,1).
export type V4 = [number, number, number, number];
export type Space = 'H3' | 'S3';

export const O: V4 = [0, 0, 0, 1];
export const add = (a: V4, b: V4): V4 => [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
export const sub = (a: V4, b: V4): V4 => [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]];
export const mul = (a: V4, s: number): V4 => [a[0] * s, a[1] * s, a[2] * s, a[3] * s];
export const lin = (a: V4, sa: number, b: V4, sb: number): V4 =>
    [a[0] * sa + b[0] * sb, a[1] * sa + b[1] * sb, a[2] * sa + b[2] * sb, a[3] * sa + b[3] * sb];

export function dot(S: Space, a: V4, b: V4): number {
    const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    return S === 'H3' ? s - a[3] * b[3] : s + a[3] * b[3];
}
export const len3 = (a: V4) => Math.hypot(a[0], a[1], a[2]);

// Geodesic flow from p with unit tangent v (<p,v>=0, <v,v>=1).
export function flow(S: Space, p: V4, v: V4, t: number): { p: V4; v: V4 } {
    if (S === 'H3') {
        const c = Math.cosh(t), s = Math.sinh(t);
        return { p: lin(p, c, v, s), v: lin(p, s, v, c) };
    }
    const c = Math.cos(t), s = Math.sin(t);
    return { p: lin(p, c, v, s), v: lin(p, -s, v, c) };
}

// True distance between points.
export function dist(S: Space, p: V4, q: V4): number {
    if (S === 'H3') {
        // 2 asinh(|p-q|_M / 2): chord form, stable for close points
        const d = sub(p, q);
        const m = Math.max(dot('H3', d, d), 0);
        return 2 * Math.asinh(Math.sqrt(m) / 2);
    }
    const d = sub(p, q);
    return 2 * Math.asin(Math.min(1, Math.sqrt(dot('S3', d, d)) / 2));
}

// The point at distance r from O in unit spatial direction u.
export function pointAt(S: Space, u: [number, number, number], r: number): V4 {
    const n = Math.hypot(...u);
    const s = S === 'H3' ? Math.sinh(r) : Math.sin(r);
    const c = S === 'H3' ? Math.cosh(r) : Math.cos(r);
    return [u[0] / n * s, u[1] / n * s, u[2] / n * s, c];
}

// Project an arbitrary vector to the tangent space at p and normalize (a unit tangent).
export function tangent(S: Space, p: V4, w: V4): V4 {
    // H3: w + <w,p> p ; S3: w - <w,p> p
    const k = dot(S, w, p);
    const t = S === 'H3' ? lin(w, 1, p, k) : lin(w, 1, p, -k);
    const n = Math.sqrt(dot(S, t, t));
    return mul(t, 1 / n);
}

// Unit direction at p of the geodesic toward q (log map, normalized).
export function dirTo(S: Space, p: V4, q: V4): V4 {
    return tangent(S, p, q);
}

// Orthonormal tangent frame at p (Gram-Schmidt of e1,e2,e3 projected) — any orthonormal frame.
export function frameAt(S: Space, p: V4): V4[] {
    const E: V4[] = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]];
    const out: V4[] = [];
    for (const e of E) {
        let w = tangent(S, p, e);
        for (const f of out) w = lin(w, 1, f, -dot(S, w, f));
        w = mul(w, 1 / Math.sqrt(dot(S, w, w)));
        out.push(w);
    }
    return out;
}

// Seeded RNG
export function rng(seed = 1) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
export function randDir(R: () => number): [number, number, number] {
    const z = 2 * R() - 1, ph = 2 * Math.PI * R(), r = Math.sqrt(1 - z * z);
    return [r * Math.cos(ph), r * Math.sin(ph), z];
}

// Brute-force first root of f(t) on (tmin, tmax): dense scan + bisection.
export function bruteFirstRoot(f: (t: number) => number, tmin: number, tmax: number, n = 20000): number | null {
    let a = tmin, fa = f(a);
    for (let i = 1; i <= n; i++) {
        const b = tmin + (tmax - tmin) * i / n, fb = f(b);
        if ((fa > 0) !== (fb > 0) || fb === 0) {
            let lo = a, hi = b, flo = fa;
            for (let k = 0; k < 100; k++) {
                const m = 0.5 * (lo + hi), fm = f(m);
                if ((fm > 0) === (flo > 0)) { lo = m; flo = fm; } else hi = m;
            }
            return 0.5 * (lo + hi);
        }
        a = b; fa = fb;
    }
    return null;
}

// float32 emulation of GLSL ES 3.00 "inherited from formula" hyperbolics (labelled [mem] in notes).
export const F = Math.fround;
export const f32 = {
    sqrt: (x: number) => F(Math.sqrt(F(x))),
    log: (x: number) => F(Math.log(F(x))),
    asinh: (x: number) => F(Math.log(F(F(x) + F(Math.sqrt(F(F(F(x) * F(x)) + 1)))))),
    acosh: (x: number) => F(Math.log(F(F(x) + F(Math.sqrt(F(F(F(x) * F(x)) - 1)))))),
    atanh: (x: number) => F(0.5 * F(Math.log(F(F(1 + F(x)) / F(1 - F(x)))))),
};
export const r4 = (a: V4): V4 => [F(a[0]), F(a[1]), F(a[2]), F(a[3])];
