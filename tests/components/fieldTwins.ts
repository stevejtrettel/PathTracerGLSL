// Signed-distance TS twins of the marchable primitives — ONE transcription, two gates.
//
// The .glsl files are the shipping truth; these mirror them for the CPU-side checks that
// GLSL cannot run: marchBound.test.ts (does the declared bound contain the field?) and
// geometryClosure.test.ts (does a placement fold exactly, for a shape whose "surface" is
// only ever a level set?). Two consumers is exactly why they live in one file — a twin
// copied per test is a twin that drifts per test.
//
// A twin that goes stale shows up as a bound that "contains" a shape the GPU renders
// differently, so keep them transcribed rather than re-derived: same constants, same
// operator order, same conventions (GLSL's column-major mat3, `v * M` = the column-wise
// product) as the file they mirror.

import type { PrimitiveValues } from '../../src/components/geometry/index.js';

/** Signed distance TS twins — one per marchable primitive, transcribed from the GLSL
 *  (the .glsl is the shipping truth; these mirror it for the CPU-side gate). */
export const FIELDS: Record<string, (p: number[], v: PrimitiveValues) => number> = {
    sphere: (p, v) => {
        const c = v.center as number[];
        return Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - (v.radius as number);
    },
    plane: (p, v) => {
        const n = v.normal as number[];
        return p[0] * n[0] + p[1] * n[1] + p[2] * n[2] + (v.offset as number);
    },
    box: (p, v) => {
        const c = v.center as number[], h = v.halfSize as number[];
        const d = [0, 1, 2].map((i) => Math.abs(p[i] - c[i]) - h[i]);
        const outside = Math.hypot(...d.map((x) => Math.max(x, 0)));
        return outside + Math.min(Math.max(d[0], Math.max(d[1], d[2])), 0);
    },
    cylinder: (p, v) => {
        const c = v.center as number[];
        const q = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
        const dx = Math.hypot(q[0], q[2]) - (v.radius as number);
        const dy = Math.abs(q[1]) - (v.halfHeight as number);
        return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
    },
    // The marched shapes are CANONICAL (fable-sdf-contract §2): no center row — the
    // twin, like the field, is origin-centred and placement lives elsewhere.
    torus: (p, v) =>
        Math.hypot(Math.hypot(p[0], p[2]) - (v.ringRadius as number), p[1]) - (v.tubeRadius as number),
    bottle: (p, v) => {
        const q = p;
        const baseH = v.baseHeight as number, neckH = v.neckHeight as number;
        const body = fieldCylinder(q, v.baseRadius as number, baseH, v.rounded as number);
        const neck = fieldCylinder([q[0], q[1] - (baseH + neckH), q[2]], v.neckRadius as number, neckH, v.rounded as number);
        let solid = smoothUnion(body, neck, v.smoothJoin as number);
        if ((v.punt as number) > 0) {
            const dimple = Math.hypot(q[0], q[1] + baseH, q[2]) - (v.punt as number);
            solid = smoothIntersect(solid, -dimple, v.smoothJoin as number);
        }
        const shell = Math.abs(solid) - (v.thickness as number);
        const top = q[1] - (baseH + neckH + neckH / 3);
        return smoothIntersect(shell, top, v.thickness as number);
    },
    knob: (p, v) => {
        const r = v.radius as number;
        return knobShape(p.map((x) => x / r / 0.8)) * 0.8 * r;
    },
    menger: (p, v) => {
        const size = v.size as number;
        const q = p.map((x) => x / size);
        const box = [0, 1, 2].map((i) => Math.abs(q[i]) - 1);
        let d = Math.min(Math.max(box[0], Math.max(box[1], box[2])),
                         Math.hypot(...box.map((x) => Math.max(x, 0))));
        let s = 1.0;
        for (let i = 0; i < (v.iterations as number); i++) {
            const a = q.map((x) => glslMod(x * s, 2.0) - 1.0);
            s *= 3.0;
            const r = a.map((x) => Math.abs(1.0 - 3.0 * Math.abs(x)));
            const cross = Math.min(Math.max(r[0], r[1]), Math.min(Math.max(r[1], r[2]), Math.max(r[2], r[0])));
            d = Math.max(d, (cross - 1.0) / s);
        }
        return size * d;
    },
    apollonian: (p, v) => {
        const size = v.size as number;
        const q = p.map((x) => x / size);
        const s = 4.0 / Math.max(q[0] * q[0] + q[1] * q[1] + q[2] * q[2], 1e-12);
        const d = 0.25 * apollonianGasket(q.map((x) => x * s + 1.0), v.morph as number, v.iterations as number) / s;
        return size * d - (v.thickness as number);
    },
};

/** GLSL mod(): always the sign of the divisor (JS % is not). */
const glslMod = (x: number, m: number): number => x - m * Math.floor(x / m);

/** GLSL round(): halfway cases away from zero (JS Math.round goes to +∞). */
const glslRound = (x: number): number => Math.sign(x) * Math.round(Math.abs(x));

function apollonianGasket(p0: number[], morph: number, iterations: number): number {
    let p = [...p0];
    let scale = 1.0;
    for (let i = 0; i < iterations; i++) {
        p = p.map((x) => x - 2.0 * glslRound(0.5 * x));
        const p2 = p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
        const k = morph / Math.max(p2, 1e-12);
        p = p.map((x) => x * k);
        scale *= k;
    }
    const res = Math.min(Math.abs(p[2]) + Math.abs(p[0]),
                Math.min(Math.abs(p[0]) + Math.abs(p[1]), Math.abs(p[1]) + Math.abs(p[2])));
    return res / scale;
}

// ---- TS twins of bottle.glsl's file-private operators ----

function smoothUnion(a: number, b: number, k: number): number {
    const h = Math.max(k - Math.abs(a - b), 0);
    return Math.min(a, b) - 0.25 * h * h / k;
}
const smoothIntersect = (a: number, b: number, k: number): number => -smoothUnion(-a, -b, k);

function fieldCylinder(p: number[], radius: number, halfHeight: number, rounded: number): number {
    const w = [Math.abs(Math.hypot(p[0], p[2])) - (radius - rounded), Math.abs(p[1]) - (halfHeight - rounded)];
    return Math.min(Math.max(w[0], w[1]), 0) + Math.hypot(Math.max(w[0], 0), Math.max(w[1], 0)) - rounded;
}


// ---- TS twin of the VENDORED knob field (knob.glsl) --------------------------
// The corpus documents no extent, so this twin is also what MEASURED the bound in
// knob.ts. Transcribed, including `p * M` = the column-wise product GLSL gives it.

function knobRotMul(v: number[], axis: number[], angle: number): number[] {
    const n = Math.hypot(...axis);
    const [x, y, z] = axis.map((a) => a / n);
    const s = Math.sin(angle), c = Math.cos(angle), oc = 1 - c;
    const cols = [
        [oc * x * x + c, oc * x * y - z * s, oc * z * x + y * s],
        [oc * x * y + z * s, oc * y * y + c, oc * y * z - x * s],
        [oc * z * x - y * s, oc * y * z + x * s, oc * z * z + c],
    ];
    return cols.map((col) => v[0] * col[0] + v[1] * col[1] + v[2] * col[2]);
}

function knobShape(p: number[]): number {
    const clamp01 = (x: number): number => Math.min(Math.max(x, 0), 1);
    const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
    const sub = (a: number[], b: number[]): number[] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const sdSphere = (v: number[], r: number): number => Math.hypot(...v) - r;
    const sdTorus = (q: number[], t: number[]): number => Math.hypot(Math.hypot(q[0], q[2]) - t[0], q[1]) - t[1];
    const sdCone = (q: number[], c: number[]): number => c[0] * Math.hypot(q[0], q[1]) + c[1] * q[2];
    const sdCyl = (q: number[], h: number, r: number): number => {
        const d = [Math.abs(Math.hypot(q[0], q[2])) - h, Math.abs(q[1]) - r];
        return Math.min(Math.max(d[0], d[1]), 0) + Math.hypot(Math.max(d[0], 0), Math.max(d[1], 0));
    };
    const sdTriPrism = (q: number[], h: number[]): number => {
        const a = q.map(Math.abs);
        return Math.max(a[2] - h[1], Math.max(a[0] * 0.866025 + q[1] * 0.5, -q[1]) - h[0] * 0.5);
    };
    const su = (d1: number, d2: number, k: number): number => {
        const h = clamp01(0.5 + 0.5 * (d2 - d1) / k);
        return mix(d2, d1, h) - k * h * (1 - h);
    };
    const ssub = (d1: number, d2: number, k: number): number => {
        const h = clamp01(0.5 - 0.5 * (d2 + d1) / k);
        return mix(d2, -d1, h) + k * h * (1 - h);
    };
    const base = (q: number[]): number => {
        let b = su(sdCone(knobRotMul([q[0], q[1] + 0.9, q[2]], [1, 0, 0], -Math.PI / 2), [Math.PI / 3, Math.PI / 3]),
                   sdCone(knobRotMul([q[0], q[1] - 0.9, q[2]], [1, 0, 0], Math.PI / 2), [Math.PI / 3, Math.PI / 3]),
                   0.02);
        b = Math.max(b, sdCyl(q, 1.1, 0.25)) * 0.7;
        b = Math.max(-sdCyl(q, 0.6, 0.3), b);
        b = Math.max(-sdTriPrism(knobRotMul([q[0], q[1], q[2] - 1], [1, 0, 0], Math.PI / 2), [1.2, 0.3]), b);
        return b;
    };
    const sphere = sdSphere(p, 1.0);
    const cutout = sdSphere(sub(p, [0, 0.5, 0.5]), 0.7);
    const etch = sdTorus(knobRotMul(sub(p, [0, 0.2, 0.2]), [1, 0, 0], -Math.PI / 4), [1.0, 0.05]);
    let d = ssub(cutout, sphere, 0.1);
    d = Math.min(d, sdSphere(p, 0.75));
    d = Math.max(-etch, d);
    return Math.min(ssub(sphere, base(sub(p, [0, -0.775, 0])), 0.1), d);
}

// ---- surface projection (geometryClosure's sampler) -------------------------

/** Newton-project `p0` onto {f = 0} using the twin's finite-difference gradient. For a
 *  near-unit-gradient distance field this converges in a handful of steps from a start
 *  within an octave's reach; returns null if it stalls (a crease, or a start too far),
 *  which callers treat as "pick another seed" rather than as a failure. */
export function projectToSurface(f: (p: number[]) => number, p0: number[], tol = 1e-11): number[] | null {
    const h = 1e-6;
    let p = [...p0];
    for (let i = 0; i < 64; i++) {
        const d = f(p);
        if (Math.abs(d) < tol) return p;
        const g = [0, 1, 2].map((k) => {
            const a = [...p], b = [...p];
            a[k] += h; b[k] -= h;
            return (f(a) - f(b)) / (2 * h);
        });
        const g2 = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
        if (g2 < 1e-12) return null;
        p = [0, 1, 2].map((k) => p[k] - d * g[k] / g2);
    }
    return Math.abs(f(p)) < 1e-8 ? p : null;
}
