// The Seifert–Weber group data (components/quotient/seifert-weber/seifert-weber.ts), checked in
// float64 against the facts that make D a fundamental domain of a closed manifold. A port of the
// review's checks docs/claude-2026-11-review/quotients/seifert-weber/sw.ts (`geom`, `tile`) and
// extra.ts (Kac), written against the occupant's exported data so that no render has to find a
// wrong normal, pairing or twist:
//   - the closed-form radii, and unit face normals with dihedral angle 2π/5 between neighbors;
//   - every pairing g_i is in SO⁺(3,1), maps face i's five vertices onto face i xor 1, and
//     carries N_i to −N_{i xor 1} (D's side of face i onto the far side of face i xor 1);
//   - the 30 edges fall into 6 cycles of 5 (angle sum 5 · 72° = 2π) whose products are I, and the
//     20 vertices form one class (Poincaré's polyhedron theorem for a closed manifold);
//   - the cells γD with d(o, γo) ≤ 3 + R_c cover each of 20,000 points of the ball of radius 3
//     about o exactly once (a tiling, not just a pairing of faces);
//   - random geodesics teleported through D cross a face every 0.960 in the mean: Kac's lemma
//     gives 4·vol(M)/area(∂D) for the mean return time to ∂D of the geodesic flow;
//   - the emitted float32 tables, the image numbering and the camera reduction.
// The vertices are built independently of the occupant (the Euclidean dodecahedron's vertices,
// rescaled to the Klein radius tanh R_c and lifted to the hyperboloid).

import { describe, it, expect } from 'vitest';
import {
    SW_INRADIUS, SW_CIRCUMRADIUS, swFaceNormals, swPairings, swImageMatrix, swImageIndex,
    swReduce, swConstantsGLSL, swFarClipFloor, swMaxCrossings,
} from '../../../src/components/quotient/seifert-weber/seifert-weber.js';
import { mat4Apply, mat4Multiply, type Mat4, type Vec4 } from '../../../src/components/ambient/isometry.js';
import { hyperbolicGeometry } from '../../../src/components/ambient/hyperbolic/hyperbolic.js';

const SQ5 = Math.sqrt(5);
const PHI = (1 + SQ5) / 2;
const mink = (a: Vec4, b: Vec4): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] - a[3] * b[3];
const hdist = (a: Vec4, b: Vec4): number => Math.acosh(Math.max(1, -mink(a, b)));
const O: Vec4 = [0, 0, 0, 1];
const I4: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const N = swFaceNormals;
const G = swPairings;
const inD = (p: Vec4, tol = 0): boolean => N.every((n) => mink(n, p) <= tol);
const maxAbsDiff = (a: Mat4, b: Mat4): number => Math.max(...a.map((x, i) => Math.abs(x - b[i])));

function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function randUnit3(u: () => number): [number, number, number] {
    const z = 1 - 2 * u(), ph = 2 * Math.PI * u(), s = Math.sqrt(1 - z * z);
    return [s * Math.cos(ph), s * Math.sin(ph), z];
}
const pointAt = (d: [number, number, number], r: number): Vec4 =>
    [Math.sinh(r) * d[0], Math.sinh(r) * d[1], Math.sinh(r) * d[2], Math.cosh(r)];

// The 20 vertices: the Euclidean dodecahedron's vertex directions (dual to the face directions
// (0,±1,±φ), (±1,±φ,0), (±φ,0,±1)) at Klein radius tanh R_c, lifted to the hyperboloid.
const VERTS: Vec4[] = (() => {
    const raw: number[][] = [];
    for (const a of [1, -1]) for (const b of [1, -1]) for (const c of [1, -1]) raw.push([a, b, c]);
    for (const a of [1, -1]) for (const b of [1, -1]) raw.push([a / PHI, 0, b * PHI], [0, a * PHI, b / PHI], [a * PHI, b / PHI, 0]);
    const k = Math.tanh(SW_CIRCUMRADIUS), s = 1 / Math.sqrt(1 - k * k);
    return raw.map((v) => {
        const n = Math.hypot(v[0], v[1], v[2]);
        return [(k * s * v[0]) / n, (k * s * v[1]) / n, (k * s * v[2]) / n, s] as Vec4;
    });
})();
const facesOf = (v: Vec4): number[] => N.map((n, i) => [i, mink(n, v)] as const).filter(([, x]) => Math.abs(x) < 1e-9).map(([i]) => i);
const vertexIndex = (p: Vec4): number => VERTS.findIndex((v) => Math.abs(mink(v, p) + 1) < 1e-8);

describe('Seifert–Weber group data (float64)', () => {
    it('has the closed-form radii and unit face normals at dihedral angle 2π/5', () => {
        expect(Math.cosh(SW_INRADIUS) ** 2).toBeCloseTo((5 + 2 * SQ5) / 4, 13);
        expect(Math.cosh(SW_CIRCUMRADIUS)).toBeCloseTo((7 + 3 * SQ5) / 4, 13);
        expect(SW_INRADIUS).toBeCloseTo(0.99638, 5);
        expect(SW_CIRCUMRADIUS).toBeCloseTo(1.90285, 5);
        expect(N).toHaveLength(12);
        for (let i = 0; i < 12; i++) {
            expect(Math.abs(mink(N[i], N[i]) - 1)).toBeLessThan(1e-13);
            expect(mink(N[i], O)).toBeCloseTo(-Math.sinh(SW_INRADIUS), 13);   // o is r_in inside every face
            expect(N[i ^ 1].slice(0, 3).map((x, c) => x + N[i][c]).every((x) => Math.abs(x) < 1e-15)).toBe(true);   // i xor 1 is the opposite face
        }
        // Neighbors meet at 2π/5: ⟨N_i, N_j⟩ = −cos(2π/5). The other pairs do not meet.
        let neighbors = 0;
        for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) {
            if (Math.abs(mink(N[i], N[j]) + Math.cos((2 * Math.PI) / 5)) < 1e-12) neighbors++;
        }
        expect(neighbors).toBe(30);
        expect(VERTS.every((v) => facesOf(v).length === 3 && inD(v, 1e-12))).toBe(true);
    });

    it('pairs face i with face i xor 1 by an orientation-preserving isometry', () => {
        expect(G).toHaveLength(12);
        const J = [1, 1, 1, -1];
        for (let i = 0; i < 12; i++) {
            const g = G[i];
            // gᵀ J g = J (an isometry of the form), g_ww > 0 (time-orientation), det g = +1.
            let defect = 0;
            for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
                let s = 0;
                for (let k = 0; k < 4; k++) s += g[4 * a + k] * J[k] * g[4 * b + k];
                defect = Math.max(defect, Math.abs(s - (a === b ? J[a] : 0)));
            }
            expect(defect).toBeLessThan(1e-12);
            expect(g[15]).toBeGreaterThan(0);
            expect(det4(g)).toBeCloseTo(1, 12);
            // g_i N_i = −N_{i xor 1}: the outside of face i goes to the inside of face i xor 1.
            const gN = mat4Apply(g, N[i]);
            expect(Math.max(...gN.map((x, c) => Math.abs(x + N[i ^ 1][c])))).toBeLessThan(1e-12);
            // Face i's five vertices land on face i xor 1's five vertices.
            const onFace = VERTS.map((_, k) => k).filter((k) => facesOf(VERTS[k]).includes(i));
            expect(onFace).toHaveLength(5);
            const images = onFace.map((k) => vertexIndex(mat4Apply(g, VERTS[k])));
            expect(images.every((k) => k >= 0 && facesOf(VERTS[k]).includes(i ^ 1))).toBe(true);
            expect(new Set(images).size).toBe(5);
            // g_{i xor 1} = g_i⁻¹.
            expect(maxAbsDiff(mat4Multiply(G[i ^ 1], g), I4)).toBeLessThan(1e-12);
        }
    });

    it('has 6 edge cycles of length 5 with product I, and one vertex class', () => {
        type Edge = { f: [number, number]; v: [number, number] };
        const vf = VERTS.map(facesOf);
        const edges: Edge[] = [];
        for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) {
            const common = VERTS.map((_, k) => k).filter((k) => vf[k].includes(i) && vf[k].includes(j));
            if (common.length === 2) edges.push({ f: [i, j], v: [common[0], common[1]] });
        }
        expect(edges).toHaveLength(30);
        const edgeIdx = (a: number, b: number) => edges.findIndex((e) => (e.v[0] === a && e.v[1] === b) || (e.v[0] === b && e.v[1] === a));
        const cycles: { len: number; productErr: number }[] = [];
        const seen = new Set<number>();
        for (let e0 = 0; e0 < edges.length; e0++) {
            if (seen.has(e0)) continue;
            // Walk the cycle: leave D through face f of edge e, land on edge e2 of face f xor 1,
            // continue through e2's other face; the product of the pairings must close to I.
            let e = e0, f = edges[e0].f[0], P = I4, len = 0;
            do {
                seen.add(e);
                const a = vertexIndex(mat4Apply(G[f], VERTS[edges[e].v[0]]));
                const b = vertexIndex(mat4Apply(G[f], VERTS[edges[e].v[1]]));
                const e2 = edgeIdx(a, b);
                expect(e2).toBeGreaterThanOrEqual(0);
                const fin = f ^ 1;
                const f2 = edges[e2].f[0] === fin ? edges[e2].f[1] : edges[e2].f[0];
                P = mat4Multiply(G[f], P);
                e = e2; f = f2; len++;
                expect(len).toBeLessThan(20);
            } while (!(e === e0 && f === edges[e0].f[0]));
            cycles.push({ len, productErr: maxAbsDiff(P, I4) });
        }
        expect(cycles).toHaveLength(6);
        for (const c of cycles) {
            expect(c.len).toBe(5);                                       // 5 · 2π/5 = 2π around each edge
            expect(c.productErr).toBeLessThan(1e-10);
        }
        // Vertex classes by union-find over the pairings.
        const parent = VERTS.map((_, k) => k);
        const find = (k: number): number => (parent[k] === k ? k : (parent[k] = find(parent[k])));
        for (let i = 0; i < 12; i++) for (let k = 0; k < VERTS.length; k++) if (vf[k].includes(i)) {
            parent[find(k)] = find(vertexIndex(mat4Apply(G[i], VERTS[k])));
        }
        expect(new Set(VERTS.map((_, k) => find(k))).size).toBe(1);
    });

    it('acts freely and tiles the ball of radius 3: each of 20,000 points lies in one cell', () => {
        // Every γ with d(o, γo) ≤ 3 + R_c, by breadth-first search over the generators. Γ acts
        // freely, so γo names γ: two elements reaching the same orbit point must be the same
        // matrix (a wrong twist still maps D onto cells of the {5,3,5} honeycomb, so the cover
        // count alone cannot see it; it shows up here as a nontrivial stabilizer of o). A point
        // of the ball lies in γD only if d(p, γo) ≤ R_c, so this set holds every cell that can
        // contain one.
        const reach = Math.cosh(3 + SW_CIRCUMRADIUS);
        const elems: Mat4[] = [I4];
        const key = (m: Mat4) => `${Math.round(m[12] * 1e4)},${Math.round(m[13] * 1e4)},${Math.round(m[14] * 1e4)}`;
        const index = new Map<string, number>([[key(I4), 0]]);
        let collisions = 0;
        for (let h = 0; h < elems.length; h++) {
            for (let i = 0; i < 12; i++) {
                const P = mat4Multiply(elems[h], G[i]);
                if (P[15] > reach) continue;                               // (γo)_w = cosh d(o, γo)
                const k = key(P);
                const seen = index.get(k);
                if (seen !== undefined) {
                    if (maxAbsDiff(P, elems[seen]) > 1e-6 * Math.max(...P.map(Math.abs))) collisions++;
                    continue;
                }
                index.set(k, elems.length);
                elems.push(P);
            }
        }
        expect(collisions).toBe(0);
        expect(elems.length).toBeGreaterThan(2000);
        const inverses = elems.map((m) => hyperbolicGeometry.inverse(m));
        const centers = elems.map((m) => mat4Apply(m, O));
        const coshRc = Math.cosh(SW_CIRCUMRADIUS) * (1 + 1e-9);
        const u = rng(20000);
        const counts = new Map<number, number>();
        for (let s = 0; s < 20000; s++) {
            const p = pointAt(randUnit3(u), 3 * Math.cbrt(u()));
            let c = 0;
            for (let k = 0; k < elems.length; k++) {
                if (-mink(p, centers[k]) > coshRc) continue;
                if (inD(mat4Apply(inverses[k], p))) c++;
            }
            counts.set(c, (counts.get(c) ?? 0) + 1);
        }
        expect(Object.fromEntries(counts)).toEqual({ 1: 20000 });
    });

    it('crosses a face every 0.960 in the mean (Kac)', () => {
        // 4·vol(M)/area(∂D) = 4 · 11.199 / (12 · (3π − 5α)) = 0.9599, α = acos(1/√5) the face
        // angle of the pentagons (vol(M) = 11.199 is the Seifert–Weber volume, from memory; the
        // review's Monte Carlo volume of D was 11.173 ± 0.036). The walk step is the GLSL's, in
        // float64. Measured: 0.9571 over 198,000 face-to-face segments, whose lengths spread by
        // 0.74, so the standard error is about 0.002.
        const u = rng(960);
        let length = 0, crossings = 0;
        for (let k = 0; k < 2000; k++) {
            let p: Vec4;
            do { p = pointAt(randUnit3(u), SW_CIRCUMRADIUS * Math.cbrt(u())); } while (!inD(p));
            let v = tangentAt(p, randUnit3(u));
            for (let n = 0; n < 100; n++) {
                let tau = 1, f = -1;
                for (let i = 0; i < 12; i++) {
                    const b = mink(N[i], v);
                    if (b <= 0) continue;
                    const t = Math.max(-mink(N[i], p) / b, 0);
                    if (t < tau) { tau = t; f = i; }
                }
                // The first segment starts inside D, not on a face: its mean is the residual
                // chord length, not the return time, so it is left out.
                if (n > 0) { length += Math.atanh(tau); crossings++; }
                const q = p.map((x, c) => x + tau * v[c]) as Vec4;
                const w = v.map((x, c) => x + tau * p[c]) as Vec4;
                const pn = q.map((x) => x / Math.sqrt(-mink(q, q))) as Vec4;
                const vv = w.map((x, c) => x + mink(w, pn) * pn[c]) as Vec4;
                const vn = vv.map((x) => x / Math.sqrt(mink(vv, vv))) as Vec4;
                p = mat4Apply(G[f], pn);
                v = mat4Apply(G[f], vn);
            }
        }
        expect(Math.abs(length / crossings - 0.960)).toBeLessThan(0.01);
    });

    it('emits FACE_N and PAIRING as float32 const arrays of the float64 data', () => {
        const src = swConstantsGLSL();
        const nVals = arrayNumbers(src, 'vec4', 'FACE_N');
        const gVals = arrayNumbers(src, 'mat4', 'PAIRING');
        expect(nVals).toHaveLength(48);
        expect(gVals).toHaveLength(192);
        for (let i = 0; i < 12; i++) {
            // (+ 0 makes −0 and 0 equal: GLSL reads "0.0" for either.)
            for (let c = 0; c < 4; c++) expect(nVals[4 * i + c]).toBe(Math.fround(N[i][c]) + 0);
            for (let c = 0; c < 16; c++) expect(gVals[16 * i + c]).toBe(Math.fround(G[i][c]) + 0);   // column-major, as GLSL's mat4()
        }
    });

    it('numbers the 13 NEE images: 0 is I, 1 + f is the cell across face f', () => {
        expect(swImageIndex(0, -1)).toBe(0);
        for (let f = 0; f < 12; f++) {
            expect(swImageIndex(1, f)).toBe(1 + f);
            expect(swImageMatrix(1 + f)).toEqual(G[f]);
            // Image 1 + f of a light y is g_f⁻¹·y (in the cell across face f): it lies beyond face f.
            expect(mink(N[f], mat4Apply(G[f ^ 1], O))).toBeGreaterThan(0);
        }
        expect(swImageMatrix(0)).toEqual(I4);
        expect(swImageIndex(2, 3)).toBe(-1);
        expect(swImageIndex(7, 3)).toBe(-1);
    });

    it('reduces a camera pose into D, carrying its frame along', () => {
        const u = rng(77);
        for (let k = 0; k < 500; k++) {
            const p = pointAt(randUnit3(u), 6 * Math.cbrt(u()));
            const v = tangentAt(p, randUnit3(u));
            const r = swReduce(p, [v]);
            expect(inD(r.point, 1e-9)).toBe(true);
            expect(Math.abs(mink(r.point, r.point) + 1)).toBeLessThan(1e-9);
            expect(Math.abs(mink(r.vectors[0], r.point))).toBeLessThan(1e-9);
            expect(Math.abs(mink(r.vectors[0], r.vectors[0]) - 1)).toBeLessThan(1e-9);
            // The same point of M: the product of the pairings applied carries p and v to it.
            const P = r.faces.reduce((m, f) => mat4Multiply(G[f], m), I4);
            expect(Math.max(...mat4Apply(P, p).map((x, c) => Math.abs(x - r.point[c])))).toBeLessThan(1e-9);
            expect(Math.max(...mat4Apply(P, v).map((x, c) => Math.abs(x - r.vectors[0][c])))).toBeLessThan(1e-9);
            expect(hdist(r.point, O)).toBeLessThanOrEqual(SW_CIRCUMRADIUS + 1e-9);
        }
        // A point of D is left alone; a face center (on face 0 up to rounding) ends in D without
        // bouncing between the paired faces.
        const inside = pointAt([0.2, -0.3, 0.1], 0.5);
        expect(swReduce(inside, []).point).toEqual(inside);
        const faceCenter = pointAt([N[0][0], N[0][1], N[0][2]].map((x) => x / Math.cosh(SW_INRADIUS)) as [number, number, number], SW_INRADIUS);
        expect(Math.abs(mink(N[0], faceCenter))).toBeLessThan(1e-14);
        expect(inD(swReduce(faceCenter, []).point, 1e-9)).toBe(true);
    });

    it('declares the far-clip floor 2R_c + 2r_in and the crossing cap ceil(4·farClip) + 32', () => {
        expect(swFarClipFloor()).toBeCloseTo(2 * SW_CIRCUMRADIUS + 2 * SW_INRADIUS, 12);
        expect(swFarClipFloor()).toBeCloseTo(5.798, 3);
        expect(swMaxCrossings(8)).toBe(64);
        expect(swMaxCrossings(5.8)).toBe(56);
    });
});

/** A unit tangent at p from a direction at o, by the transvection o → p (parallel transport). */
function tangentAt(p: Vec4, d: [number, number, number]): Vec4 {
    const ch = p[3], ds = d[0] * p[0] + d[1] * p[1] + d[2] * p[2];
    return [d[0] + (ds / (1 + ch)) * p[0], d[1] + (ds / (1 + ch)) * p[1], d[2] + (ds / (1 + ch)) * p[2], ds];
}

function det4(m: Mat4): number {
    const a = (r: number, c: number) => m[4 * c + r];
    let d = 0;
    for (let c = 0; c < 4; c++) {
        const rows = [1, 2, 3], cols = [0, 1, 2, 3].filter((x) => x !== c);
        const s = (i: number, j: number) => a(rows[i], cols[j]);
        const d3 = s(0, 0) * (s(1, 1) * s(2, 2) - s(1, 2) * s(2, 1)) - s(0, 1) * (s(1, 0) * s(2, 2) - s(1, 2) * s(2, 0)) + s(0, 2) * (s(1, 0) * s(2, 1) - s(1, 1) * s(2, 0));
        d += (c % 2 ? -1 : 1) * a(0, c) * d3;
    }
    return d;
}

/** The numbers inside `const <type> NAME[12] = <type>[12](<type>(...), ...);`. */
function arrayNumbers(src: string, type: string, name: string): number[] {
    const m = new RegExp(`const ${type} ${name}\\[12\\] = ${type}\\[12\\]\\(([^;]*)\\);`).exec(src);
    if (m === null) throw new Error(`no const ${type} ${name}[12] in:\n${src}`);
    const body = m[1].replaceAll(`${type}(`, '(');
    return [...body.matchAll(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/g)].map((x) => Number(x[0]));
}
